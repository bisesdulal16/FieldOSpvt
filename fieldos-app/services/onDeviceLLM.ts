/**
 * FieldOS Nepal — On-Device LLM bridge
 *
 * On-device inference (Gemma via MediaPipe) runs through a React hook
 * (`useLLM`), which can only live inside a component. This module is the
 * framework-agnostic bridge: the OnDeviceLLMProvider registers a `generate`
 * function here once the model is ready, and plain service functions call
 * `onDeviceGenerate()` without needing React.
 *
 * Safety: if the native module isn't present (e.g. Expo Go, or a low-RAM
 * device that we gate out), status stays 'unavailable' and onDeviceGenerate
 * returns null — callers then fall back to the server LLM / heuristic.
 */

export type OnDeviceStatus =
  | 'unavailable'   // no native module, or device gated out
  | 'downloading'   // fetching the model file (first run)
  | 'loading'       // loading the model into memory
  | 'ready'         // can answer prompts
  | 'error';

let _status: OnDeviceStatus = 'unavailable';
let _generate: ((prompt: string) => Promise<string>) | null = null;
const _listeners = new Set<(s: OnDeviceStatus) => void>();

/** Called by the provider as the model progresses through its lifecycle. */
export function setOnDeviceLLM(
  status: OnDeviceStatus,
  generate: ((prompt: string) => Promise<string>) | null,
): void {
  _status = status;
  _generate = status === 'ready' ? generate : null;
  for (const l of _listeners) l(status);
}

export function onDeviceStatus(): OnDeviceStatus {
  return _status;
}

export function subscribeOnDeviceStatus(cb: (s: OnDeviceStatus) => void): () => void {
  _listeners.add(cb);
  cb(_status);
  return () => _listeners.delete(cb);
}

/**
 * Run a prompt on the on-device model.
 * Returns the text, or null if on-device inference isn't available — the
 * caller should then fall back to the server LLM / heuristic.
 */
export async function onDeviceGenerate(prompt: string): Promise<string | null> {
  if (_status !== 'ready' || !_generate) return null;
  try {
    const out = await _generate(prompt);
    return out && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}
