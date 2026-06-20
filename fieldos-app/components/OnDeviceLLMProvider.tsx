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

// Gemma 2B int4 (~1.3 GB) — overridable via env for other on-device models.
const MODEL_NAME = process.env.EXPO_PUBLIC_ONDEVICE_MODEL_NAME || 'gemma-1.1-2b-it-int4.bin';
const MODEL_URL =
  process.env.EXPO_PUBLIC_ONDEVICE_MODEL_URL ||
  'https://huggingface.co/t-ghosh/gemma-tflite/resolve/main/gemma-1.1-2b-it-int4.bin';
// Don't attempt a 2B model below this much total RAM.
const MIN_RAM_BYTES = 3.4 * 1024 * 1024 * 1024;

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
          setOnDeviceLLM('downloading', null);
          await cur.downloadModel();
        }
        if (cancelled) return;
        setOnDeviceLLM('loading', null);
        await cur.loadModel();
        if (cancelled) return;
        setOnDeviceLLM('ready', (prompt: string) => llmRef.current.generateResponse(prompt));
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
