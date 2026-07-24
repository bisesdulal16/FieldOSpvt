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
let _progress = 0; // 0..1 download progress while status === 'downloading'
let _generate: ((prompt: string) => Promise<string>) | null = null;
const _listeners = new Set<(s: OnDeviceStatus) => void>();

/** Called by the provider as the model progresses through its lifecycle.
 *  `progress` (0..1) is the model-file download fraction; surfaced in the UI. */
export function setOnDeviceLLM(
  status: OnDeviceStatus,
  generate: ((prompt: string) => Promise<string>) | null,
  progress?: number,
): void {
  _status = status;
  if (typeof progress === 'number') _progress = Math.max(0, Math.min(1, progress));
  if (status === 'ready') _progress = 1;
  _generate = status === 'ready' ? generate : null;
  console.log(`[OnDeviceLLM] status → ${status}${status === 'downloading' ? ` (${Math.round(_progress * 100)}%)` : ''}`);
  for (const l of _listeners) l(status);
}

export function onDeviceStatus(): OnDeviceStatus {
  return _status;
}

/** Download progress 0..1 (meaningful while status === 'downloading'). */
export function onDeviceProgress(): number {
  return _progress;
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
  if (_status !== 'ready' || !_generate) {
    console.log(`[OnDeviceLLM] generate skipped (status=${_status}) → falling back to server/heuristic`);
    return null;
  }
  try {
    console.log('[OnDeviceLLM] generating on-device…');
    const out = await _generate(prompt);
    return out && out.trim() ? out.trim() : null;
  } catch (e) {
    console.log('[OnDeviceLLM] on-device generate failed → fallback', e);
    return null;
  }
}
