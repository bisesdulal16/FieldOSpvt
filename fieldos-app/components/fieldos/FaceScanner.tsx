/**
 * FieldOS Nepal — FaceScanner (on-device face capture + liveness)
 *
 * Renders the front camera, runs a MobileFaceNet embedding on-device, and only
 * fires `onEmbedding` after a LIVENESS gesture (blink, then a small head turn) so
 * a photo-of-a-photo can't pass. Used for both enrollment and clock-in verify.
 *
 * SAFE-BY-DEFAULT: every native module (vision-camera, the face detector, the
 * resize plugin, fast-tflite) is guard-loaded. In Expo Go or on a phone without a
 * dev build, this renders nothing and immediately calls `onUnavailable()` so the
 * caller falls back to plain photo-proof.
 *
 * DEVICE-TUNE markers below (model I/O layout, normalization, liveness angles)
 * are the bits to confirm on a real Samsung/Pixel during the pilot.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { colors, fontSize, spacing, borderRadius } from '../../constants';

// Model lives on the homelab (or HF); loaded at runtime so a missing file never
// breaks the JS bundle — same pattern as the on-device Gemma model.
const FACE_MODEL_URL =
  process.env.EXPO_PUBLIC_FACE_MODEL_URL ||
  'https://huggingface.co/thanhnew2001/mobilefacenet/resolve/main/mobilefacenet.tflite';

// ─── Guarded native imports ──────────────────────────────────────
let VisionCamera: any = null;
let FaceDetector: any = null;
let ResizePlugin: any = null;
let FastTflite: any = null;
let Worklets: any = null;
try {
  /* eslint-disable @typescript-eslint/no-require-imports */
  VisionCamera = require('react-native-vision-camera');
  FaceDetector = require('react-native-vision-camera-face-detector');
  ResizePlugin = require('vision-camera-resize-plugin');
  FastTflite = require('react-native-fast-tflite');
  Worklets = require('react-native-worklets-core');
  /* eslint-enable @typescript-eslint/no-require-imports */
} catch {
  VisionCamera = null; // any missing dep → whole feature unavailable
}

const NATIVE_OK = !!(VisionCamera && FaceDetector && ResizePlugin && FastTflite && Worklets);

export type FaceScannerMode = 'enroll' | 'verify';

export interface FaceScannerProps {
  mode: FaceScannerMode;
  onEmbedding: (embedding: number[]) => void;
  onUnavailable: () => void;
  onCancel: () => void;
}

export function FaceScanner(props: FaceScannerProps) {
  useEffect(() => {
    if (!NATIVE_OK) props.onUnavailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!NATIVE_OK) return null;
  return <RealScanner {...props} />;
}

// ─── Real implementation (only mounted when native modules exist) ─

function RealScanner({ mode, onEmbedding, onUnavailable, onCancel }: FaceScannerProps) {
  const { Camera, useCameraDevice, useCameraPermission, useFrameProcessor } = VisionCamera;
  const { useFaceDetector } = FaceDetector;
  const { useResizePlugin } = ResizePlugin;
  const { useTensorflowModel } = FastTflite;
  const { useSharedValue, useRunOnJS } = Worklets;

  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const { resize } = useResizePlugin();
  const { detectFaces } = useFaceDetector({
    performanceMode: 'accurate',
    landmarkMode: 'none',
    classificationMode: 'all', // needed for eye-open probabilities (blink)
    contourMode: 'none',
    trackingEnabled: false,
  });

  // Load the embedding model at runtime from a URL (homelab or HF).
  const tf = useTensorflowModel({ url: FACE_MODEL_URL });
  const model = tf.state === 'loaded' ? tf.model : null;

  // Liveness state machine, shared into the worklet.
  const sawClosed = useSharedValue(false);   // eyes were closed at some point
  const blinkDone = useSharedValue(false);   // …then reopened → a real blink
  const turnDone = useSharedValue(false);    // head turned past the yaw threshold
  const captured = useSharedValue(false);    // one embedding already emitted

  const [step, setStep] = useState<'blink' | 'turn' | 'hold' | 'done'>('blink');
  const [faceInView, setFaceInView] = useState(false);
  const emittedRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
    if (tf.state === 'error') onUnavailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission, tf.state]);

  const reportStep = useRunOnJS((s: 'blink' | 'turn' | 'hold' | 'done', inView: boolean) => {
    setFaceInView(inView);
    setStep(s);
  }, []);

  const emit = useRunOnJS((vec: number[]) => {
    if (emittedRef.current) return;
    emittedRef.current = true;
    onEmbedding(vec);
  }, [onEmbedding]);

  const frameProcessor = useFrameProcessor((frame: any) => {
    'worklet';
    if (!model || captured.value) return;

    const faces = detectFaces(frame);
    if (!faces || faces.length !== 1) {
      reportStep(blinkDone.value ? (turnDone.value ? 'hold' : 'turn') : 'blink', false);
      return;
    }
    const f = faces[0];
    const eyesOpen = ((f.leftEyeOpenProbability ?? 1) + (f.rightEyeOpenProbability ?? 1)) / 2;
    const yaw = Math.abs(f.yawAngle ?? 0); // DEVICE-TUNE: some builds report yaw sign only

    // 1) Blink: eyes must close then reopen.
    if (!blinkDone.value) {
      if (eyesOpen < 0.25) sawClosed.value = true;
      if (sawClosed.value && eyesOpen > 0.7) blinkDone.value = true;
      reportStep('blink', true);
      return;
    }
    // 2) Turn: head must rotate past ~20°.
    if (!turnDone.value) {
      if (yaw > 20) turnDone.value = true; // DEVICE-TUNE angle
      reportStep('turn', true);
      return;
    }
    // 3) Capture on a frontal, eyes-open frame.
    if (yaw < 12 && eyesOpen > 0.6) {
      const b = f.bounds; // { x, y, width, height } in frame coords
      // Expand + clamp the crop box a little around the face.
      const pad = b.width * 0.15;
      const x = Math.max(0, b.x - pad);
      const y = Math.max(0, b.y - pad);
      const w = Math.min(frame.width - x, b.width + pad * 2);
      const h = Math.min(frame.height - y, b.height + pad * 2);

      // 112×112 RGB float — MobileFaceNet's expected input.
      const resized = resize(frame, {
        crop: { x, y, width: w, height: h },
        scale: { width: 112, height: 112 },
        pixelFormat: 'rgb',
        dataType: 'float32',
      });
      // Normalise to [-1, 1]. DEVICE-TUNE: some MobileFaceNet exports want [0,1] or uint8.
      const input = new Float32Array(resized.length);
      for (let i = 0; i < resized.length; i++) input[i] = (resized[i] - 127.5) / 128.0;

      const outputs = model.runSync([input]);
      const embedding = Array.from(outputs[0] as Float32Array);
      captured.value = true;
      reportStep('done', true);
      emit(embedding);
    } else {
      reportStep('hold', true);
    }
  }, [model, detectFaces, resize, reportStep, emit]);

  // ─── Render ────────────────────────────────────────────────────

  if (!device) {
    return <Centered><Text style={styles.msg}>No front camera found.</Text></Centered>;
  }
  if (!hasPermission) {
    return <Centered><Text style={styles.msg}>Camera permission needed for face clock-in.</Text></Centered>;
  }
  if (tf.state !== 'loaded') {
    return (
      <Centered>
        <ActivityIndicator size="large" color={colors.white} />
        <Text style={styles.msg}>Loading face model…</Text>
      </Centered>
    );
  }

  const prompt = !faceInView
    ? 'Center your face in the frame'
    : step === 'blink'
      ? 'Blink your eyes'
      : step === 'turn'
        ? 'Slowly turn your head left or right'
        : step === 'hold'
          ? 'Look straight at the camera'
          : 'Captured ✓';

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.reticle} />
        <View style={styles.promptBox}>
          <Text style={styles.promptText}>
            {mode === 'enroll' ? 'Enroll your face' : 'Face clock-in'}
          </Text>
          <Text style={styles.promptSub}>{prompt}</Text>
          <View style={styles.dots}>
            <Dot on={step !== 'blink'} label="Blink" />
            <Dot on={step === 'hold' || step === 'done'} label="Turn" />
            <Dot on={step === 'done'} label="Capture" />
          </View>
        </View>
        <TouchableOpacity style={styles.cancel} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={[styles.container, styles.centered]}>{children}</View>;
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <View style={styles.dotWrap}>
      <View style={[styles.dot, on && styles.dotOn]} />
      <Text style={styles.dotLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  msg: { color: colors.white, fontSize: fontSize.base, textAlign: 'center', paddingHorizontal: spacing.xl },
  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 60 },
  reticle: {
    width: 240, height: 300, borderRadius: 160, borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)', marginTop: 40,
  },
  promptBox: {
    backgroundColor: 'rgba(11,27,58,0.85)', borderRadius: borderRadius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center', gap: 6,
    marginHorizontal: spacing.lg,
  },
  promptText: { color: colors.white, fontSize: fontSize.lg, fontWeight: '700' },
  promptSub: { color: 'rgba(255,255,255,0.9)', fontSize: fontSize.base },
  dots: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  dotWrap: { alignItems: 'center', gap: 4 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { backgroundColor: colors.green },
  dotLabel: { color: 'rgba(255,255,255,0.85)', fontSize: fontSize.xs },
  cancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
  cancelText: { color: colors.white, fontSize: fontSize.base, fontWeight: '600' },
});
