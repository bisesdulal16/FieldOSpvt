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
import { ARC_TEMPLATE_112, similarityTransform, warpToTemplate } from '../../utils/faceAlign';

// The face model is BUNDLED in the APK (assets/models/mobilefacenet.tflite,
// registered via metro.config.js) so clock-in needs NO network — this is the
// fix for the pilot's "stuck on Loading face model…" hang when the homelab was
// unreachable. The URL is kept only as a runtime fallback if the bundled asset
// ever fails to resolve. require() is wrapped so a missing asset can't crash the
// bundle (same safe-by-default posture as the native imports below).
let BUNDLED_FACE_MODEL: any = null;
try {
  /* eslint-disable @typescript-eslint/no-require-imports */
  BUNDLED_FACE_MODEL = require('../../assets/models/mobilefacenet.tflite');
  /* eslint-enable @typescript-eslint/no-require-imports */
} catch {
  BUNDLED_FACE_MODEL = null;
}

const FACE_MODEL_URL =
  process.env.EXPO_PUBLIC_FACE_MODEL_URL ||
  'https://huggingface.co/thanhnew2001/mobilefacenet/resolve/main/mobilefacenet.tflite';

// Prefer the bundled asset; fall back to the URL only if it didn't resolve.
const FACE_MODEL_SOURCE: any = BUNDLED_FACE_MODEL ?? { url: FACE_MODEL_URL };

// Input normalization: the served mobilefacenet.tflite (Sirius-AI/MobileFaceNet
// export, input [1,112,112,3] float32) is trained with SIGNED [-1,1] preprocessing
// = (px - 127.5) / 128. Feeding it [0,1] pushes every input off-distribution, the
// embeddings collapse toward one direction, and cosine stays ~0.78+ for ANY two
// faces — i.e. the pilot's "match 1.00 on a different face" false-accept.
//
// This was previously env-switchable (EXPO_PUBLIC_FACE_NORM) and eas.json shipped
// 'unit' — the wrong value — which caused the false-accept. It is now PINNED to
// signed in code so the model always gets its correct preprocessing. If you ever
// swap to a model trained on [0,1], change this constant (and add a matching test).
const FACE_NORM_UNIT = false; // pinned: signed [-1,1] — see note above

// Log embedding/similarity diagnostics to Metro/logcat so the threshold can be
// tuned on real officers + cameras during the pilot. Off unless explicitly enabled.
const FACE_DEBUG = String(process.env.EXPO_PUBLIC_FACE_DEBUG).toLowerCase() === 'true';

// Force the plain CPU (XNNPACK) delegate. On low-end Android like the Redmi 11s
// (MediaTek) the GPU/NNAPI delegates fail to init on this model — which surfaced
// as "phone doesn't support face model". CPU is slower per frame but the embedding
// is one-shot, so it's the reliable choice. 'default' == CPU in fast-tflite.
const FACE_DELEGATE = 'default' as const;

// Working size the full frame is downscaled to before the alignment warp. The 5
// landmarks are scaled into this space and the warp samples from it. ~320px on the
// long side keeps the face well-resolved for a 112 crop while keeping the JS warp
// (one-shot, on capture only) cheap. Aspect ratio is preserved per-frame below.
const ALIGN_WORK_MAX = 320;

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

/**
 * Why face clock-in couldn't run:
 *   'native' — a native module (vision-camera / face detector / tflite) didn't load,
 *              i.e. Expo Go or a build missing those modules. Needs a proper build.
 *   'model'  — the natives are fine but the MobileFaceNet file failed to download or
 *              parse. Check EXPO_PUBLIC_FACE_MODEL_URL is reachable from the phone.
 * Reported so the pilot can tell these apart instead of guessing at "unavailable".
 */
export type FaceUnavailableReason = 'native' | 'model';

export interface FaceScannerProps {
  mode: FaceScannerMode;
  /** Fired with a single averaged/first embedding (legacy single-capture callers). */
  onEmbedding?: (embedding: number[]) => void;
  /**
   * Fired with ALL captured frames when `samples` > 1, so the caller can average
   * them (enroll = a stable template, verify = a robust sample). Preferred over
   * onEmbedding when set.
   */
  onEmbeddings?: (embeddings: number[][]) => void;
  /** How many frames to capture after liveness passes (default 1). */
  samples?: number;
  onUnavailable: (reason?: FaceUnavailableReason) => void;
  onCancel: () => void;
}

export function FaceScanner(props: FaceScannerProps) {
  useEffect(() => {
    if (!NATIVE_OK) props.onUnavailable('native');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!NATIVE_OK) return null;
  return <RealScanner {...props} />;
}

// ─── Real implementation (only mounted when native modules exist) ─

function RealScanner({ mode, onEmbedding, onEmbeddings, samples = 1, onUnavailable, onCancel }: FaceScannerProps) {
  const wantSamples = Math.max(1, Math.floor(samples));
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
    landmarkMode: 'all', // needed for 5-point alignment (eyes/nose/mouth)
    classificationMode: 'all', // needed for eye-open probabilities (blink)
    contourMode: 'none',
    trackingEnabled: false,
  });

  // Load the embedding model — bundled asset when available (no network), else
  // the URL fallback. Pinned to the CPU delegate so it loads on low-end chipsets.
  const tf = useTensorflowModel(FACE_MODEL_SOURCE, FACE_DELEGATE);
  const model = tf.state === 'loaded' ? tf.model : null;

  // Liveness state machine, shared into the worklet.
  const sawClosed = useSharedValue(false);   // eyes were closed at some point
  const blinkDone = useSharedValue(false);   // …then reopened → a real blink
  const turnDone = useSharedValue(false);    // head turned past the yaw threshold
  const captured = useSharedValue(false);    // one embedding already emitted

  const [step, setStep] = useState<'blink' | 'turn' | 'hold' | 'done'>('blink');
  const [faceInView, setFaceInView] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const emittedRef = useRef(false);
  const framesRef = useRef<number[][]>([]);

  useEffect(() => {
    if (!hasPermission) requestPermission();
    if (FACE_DEBUG) {
      console.log(`[FaceScanner] model state=${tf.state} delegate=${FACE_DELEGATE} source=${BUNDLED_FACE_MODEL ? 'bundled-asset' : `url:${FACE_MODEL_URL}`}`);
    }
    if (tf.state === 'error') {
      // Surface the actual native error (delegate/parse/download) instead of a bare
      // "model unavailable" — this is what told the pilot "phone doesn't support model"
      // with no way to know why.
      console.warn('[FaceScanner] model load failed:', (tf as any).error);
      onUnavailable('model');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission, tf.state]);

  const reportStep = useRunOnJS((s: 'blink' | 'turn' | 'hold' | 'done', inView: boolean) => {
    setFaceInView(inView);
    setStep(s);
  }, []);

  // DEBUG-ONLY: log the orientation decision + the eye landmarks (post-scale) so the
  // per-device rotation/mirror can be confirmed on a new phone family (this is the
  // exact signal that pinned the collapse bug — the resize buffer and the landmark
  // coords must live in the same upright space). Gated behind FACE_DEBUG.
  const logOrient = useRunOnJS((
    ori: string, mir: boolean, rot: string,
    frameW: number, frameH: number, fw: number, fh: number,
    lex: number, ley: number, rex: number, rey: number,
  ) => {
    console.log(
      `[FaceScanner] orient=${ori} mirror=${mir} rot=${rot} ` +
      `frame=${frameW}x${frameH} buf=${fw}x${fh} ` +
      `Leye=(${lex.toFixed(1)},${ley.toFixed(1)}) Reye=(${rex.toFixed(1)},${rey.toFixed(1)})`
    );
  }, []);

  const emit = useRunOnJS((vec: number[]) => {
    if (emittedRef.current) return; // already delivered the final batch
    if (FACE_DEBUG) {
      // Norm should be a stable positive number; a flat/near-zero vector or wildly
      // varying norm means preprocessing is off. verifyEmbedding() logs the cosine.
      let n = 0;
      for (const x of vec) n += x * x;
      console.log(`[FaceScanner] frame ${framesRef.current.length + 1}/${wantSamples} dim=${vec.length} L2norm=${Math.sqrt(n).toFixed(4)} head=[${vec.slice(0, 4).map((x) => x.toFixed(3)).join(', ')}]`);
    }
    framesRef.current.push(vec);
    setCaptureCount(framesRef.current.length);
    if (framesRef.current.length < wantSamples) {
      // Need more frames — let the worklet capture again on the next frontal frame.
      captured.value = false;
      return;
    }
    // Got the full batch: deliver once and stop the worklet for good.
    emittedRef.current = true;
    const frames = framesRef.current;
    if (onEmbeddings) onEmbeddings(frames);
    else if (onEmbedding) onEmbedding(frames[0]);
  }, [onEmbedding, onEmbeddings, wantSamples]);

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
      // ALIGNMENT (the false-accept fix): MobileFaceNet needs a landmark-aligned
      // 112×112 crop, not a raw bounding-box crop. A loose bbox crop collapses the
      // embedding space so two different people in the same pose score ~0.999. We
      // warp the 5 detector landmarks onto the ArcFace template. Enroll AND verify
      // run this same path, so their preprocessing matches (required for cosine).
      const lm = f.landmarks;
      if (
        !lm || !lm.LEFT_EYE || !lm.RIGHT_EYE || !lm.NOSE_BASE ||
        !lm.MOUTH_LEFT || !lm.MOUTH_RIGHT
      ) {
        // No landmarks this frame → skip rather than emit an unaligned (bad) crop.
        reportStep('hold', true);
        return;
      }

      // ORIENTATION FIX (the collapse bug): the face detector hands ML Kit the
      // frame WITH its rotationDegrees, so the returned landmark coords are in an
      // UPRIGHT image whose dims are the frame's SWAPPED (uprightW = frame.height,
      // uprightH = frame.width — see the plugin's `width = image.height`). The
      // resize plugin, however, outputs the RAW sensor buffer unless told to
      // rotate/mirror. Feeding upright landmarks against a raw (rotated+mirrored)
      // buffer made `warpToTemplate` sample the wrong pixels → a black/garbage crop
      // → identical (collapsed) embeddings for everyone. So we rotate/mirror the
      // resize buffer into the SAME upright space the landmarks live in, then scale
      // the landmarks by the same factor. resize order is crop→scale→rotate→mirror,
      // and `scale` is PRE-rotation, so we scale the raw dims and let rotate swap them.
      //
      // Map the frame's display orientation → the CLOCKWISE rotation resize must
      // apply to bring the raw sensor buffer into the same UPRIGHT space ML Kit
      // reported the landmarks in. VERIFIED on-device (Samsung front cam, crop-dump
      // + landmark overlay, 2026-07-27): the raw buffer is `landscape-left` /
      // `frame=640x480` and needs a 270° CW rotate to stand the face upright with the
      // 5 landmarks landing exactly on eyes/nose/mouth. (An earlier 90° guess was
      // 180° off → the warp sampled the dark chest → collapsed embeddings.) The other
      // orientations are the consistent ±90° neighbours; re-verify per device family.
      const ori = frame.orientation as string;
      let rot: '0deg' | '90deg' | '180deg' | '270deg';
      if (ori === 'landscape-left') rot = '270deg';        // verified on-device
      else if (ori === 'portrait-upside-down') rot = '180deg';
      else if (ori === 'landscape-right') rot = '90deg';
      else rot = '0deg'; // 'portrait'
      const mir = !!frame.isMirrored;

      // Upright working dims: for a 90°/270° rotation the raw dims swap.
      const scaleF = ALIGN_WORK_MAX / Math.max(frame.width, frame.height);
      const rawW = Math.round(frame.width * scaleF);
      const rawH = Math.round(frame.height * scaleF);
      const swap = rot === '90deg' || rot === '270deg';
      const fw = swap ? rawH : rawW; // output (post-rotation) buffer width
      const fh = swap ? rawW : rawH; // output (post-rotation) buffer height
      const buf = resize(frame, {
        scale: { width: rawW, height: rawH }, // PRE-rotation dims
        rotation: rot,
        mirror: mir,
        pixelFormat: 'rgb',
        dataType: 'uint8',
      });

      // Landmarks are in the upright image space (dims = frame.height × frame.width,
      // matching the rotated buffer) → scale by the same factor into the buffer.
      const src = [
        [lm.LEFT_EYE.x * scaleF, lm.LEFT_EYE.y * scaleF],
        [lm.RIGHT_EYE.x * scaleF, lm.RIGHT_EYE.y * scaleF],
        [lm.NOSE_BASE.x * scaleF, lm.NOSE_BASE.y * scaleF],
        [lm.MOUTH_LEFT.x * scaleF, lm.MOUTH_LEFT.y * scaleF],
        [lm.MOUTH_RIGHT.x * scaleF, lm.MOUTH_RIGHT.y * scaleF],
      ];
      if (FACE_DEBUG) {
        logOrient(
          ori, mir, rot, frame.width, frame.height, fw, fh,
          lm.LEFT_EYE.x * scaleF, lm.LEFT_EYE.y * scaleF,
          lm.RIGHT_EYE.x * scaleF, lm.RIGHT_EYE.y * scaleF,
        );
      }
      const m = similarityTransform(src, ARC_TEMPLATE_112);
      const aligned = warpToTemplate(buf as Uint8Array, fw, fh, m, 112); // 112×112×3 uint8

      // Signed [-1,1] normalization = (px-127.5)/128 (FACE_NORM_UNIT pinned false).
      const input = new Float32Array(aligned.length);
      if (FACE_NORM_UNIT) {
        for (let i = 0; i < aligned.length; i++) input[i] = aligned[i] / 255.0;
      } else {
        for (let i = 0; i < aligned.length; i++) input[i] = (aligned[i] - 127.5) / 128.0;
      }

      const outputs = model.runSync([input]);
      const embedding = Array.from(outputs[0] as Float32Array);
      // Pause the worklet after each grab; emit() (on JS) resets captured=false
      // to collect the next frame, or leaves it true once the batch is complete.
      captured.value = true;
      reportStep('hold', true);
      emit(embedding);
    } else {
      reportStep('hold', true);
    }
  }, [model, detectFaces, resize, reportStep, emit, logOrient]);

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

  const collecting = captureCount > 0 && captureCount < wantSamples;
  const prompt = !faceInView
    ? 'Center your face in the frame'
    : step === 'blink'
      ? 'Blink your eyes'
      : step === 'turn'
        ? 'Slowly turn your head left or right'
        : collecting
          ? `Hold still — capturing ${captureCount}/${wantSamples}`
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
