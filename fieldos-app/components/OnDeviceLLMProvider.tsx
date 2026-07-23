/**
 * FieldOS Nepal — On-Device LLM Provider (Gemma via MediaPipe)
 *
 * Loads a small Gemma model on-device and registers a generate() function
 * with services/onDeviceLLM so plain services can use it. Designed for a
 * MIXED fleet:
 *   - Native module missing (Expo Go / no dev build) → renders children
 *     untouched; status stays 'unavailable' → callers fall back to server.
 *   - Low-RAM device (< ~3.5 GB) → gated out → 'unavailable' → fall back.
 *   - Capable device → downloads (first run) + loads the model, then 'ready'.
 *
 * The native import is guarded so this file is safe to mount in Expo Go.
 */
import React, { useEffect, useRef } from 'react';
import * as Device from 'expo-device';
import { setOnDeviceLLM } from '../services/onDeviceLLM';

// Guarded require: undefined in Expo Go (no native module) → no-op provider.
let mediapipe: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mediapipe = require('expo-llm-mediapipe');
} catch {
  mediapipe = null;
}

// Gemma 3 1B int4 (~555 MB) MediaPipe .task — Google's current small on-device model.
// Self-hosted at /dl (like the face model) because the HF gemma repos are gated (401)
// and the old t-ghosh .bin URL now 404s. Overridable via env.
const MODEL_NAME = process.env.EXPO_PUBLIC_ONDEVICE_MODEL_NAME || 'gemma3-1b-it-int4.task';
const MODEL_URL =
  process.env.EXPO_PUBLIC_ONDEVICE_MODEL_URL ||
  'https://fieldos.hackdome.online/dl/gemma3-1b-it-int4.task';
// Gemma-3 1B int4 is light — a ~2GB-RAM phone can run it. Lower the gate from the old 2B's 3.4GB.
const MIN_RAM_BYTES = 2.2 * 1024 * 1024 * 1024;

function RealProvider({ children }: { children: React.ReactNode }) {
  const llm = mediapipe.useLLM({
    modelUrl: MODEL_URL,
    modelName: MODEL_NAME,
    maxTokens: 512,
    temperature: 0.2,
    topK: 40,
    randomSeed: 42,
  });
  const llmRef = useRef(llm);
  llmRef.current = llm;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mem = Device.totalMemory ?? 0;
      console.log(`[OnDeviceLLM] device RAM=${(mem / 1024 ** 3).toFixed(1)}GB, gate=${(MIN_RAM_BYTES / 1024 ** 3).toFixed(1)}GB, isDevice=${Device.isDevice}`);
      if (!mem || mem < MIN_RAM_BYTES) {
        setOnDeviceLLM('unavailable', null); // low-end / unknown device → server fallback
        return;
      }
      try {
        const cur = llmRef.current;
        console.log(`[OnDeviceLLM] downloadStatus=${cur.downloadStatus}; starting download/load…`);
        if (cur.downloadStatus !== 'downloaded') {
          setOnDeviceLLM('downloading', null, 0);
          // Poll the hook's downloadProgress (0..1) so the UI can show a real bar.
          const poll = setInterval(() => {
            const p = llmRef.current?.downloadProgress;
            if (typeof p === 'number') setOnDeviceLLM('downloading', null, p);
          }, 500);
          try { await cur.downloadModel(); } finally { clearInterval(poll); }
        }
        if (cancelled) return;
        setOnDeviceLLM('loading', null, 1);
        await cur.loadModel();
        if (cancelled) return;
        setOnDeviceLLM('ready', (prompt: string) => llmRef.current.generateResponse(prompt), 1);
      } catch {
        setOnDeviceLLM('error', null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // run once on mount; llmRef keeps the latest model handle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

export function OnDeviceLLMProvider({ children }: { children: React.ReactNode }) {
  // If the native module isn't present, render children as-is (Expo Go safe).
  if (!mediapipe?.useLLM) return <>{children}</>;
  return <RealProvider>{children}</RealProvider>;
}
