# On-Device AI (Gemma via MediaPipe) — Setup & Behavior

FieldOS can run a small **Gemma** model **on the phone itself** for voice-note
cleanup, visit summaries, and the "Ask FieldOS" assistant — no server, fully
offline. This uses [`expo-llm-mediapipe`](https://github.com/tirthajyoti-ghosh/expo-llm-mediapipe)
(Google MediaPipe LLM Inference under the hood).

## Three-tier AI, automatic fallback (mixed fleet safe)

Every voice/assistant call tries, in order:

1. **On-device Gemma** — capable phone (≥ ~3.5 GB RAM) with the model loaded.
2. **Server LLM** — backend Ollama (`/voice-ai/*`), if the phone can reach it.
3. **Heuristic** — built-in rules, always works (even offline, even low-end).

So the app behaves correctly on **every** device:
- Low-end phone or Expo Go → on-device is skipped → server/heuristic.
- High-end phone with the dev build → on-device, offline.

> The **data AI** (priority queue, suggestions, EOD/branch summaries) is
> separate and already real (computed from the DB). It does not need this.

## Why this needs a custom dev build (NOT Expo Go)

`expo-llm-mediapipe` ships native code, so it only runs in a **custom dev
build** / standalone APK — not in Expo Go. The code is written so the current
Expo Go pilot keeps working: the native module is imported behind a guard, and
if it's absent the app silently uses tiers 2–3.

## Build & run

```bash
cd fieldos-app

# 1. Log in to EAS (one-time)
npx eas login

# 2. Build a development client APK (Android)
npx eas build --profile development --platform android
#   → install the resulting .apk on a 4GB+ Android phone

# 3. Start the dev server for that client (not Expo Go)
npx expo start --dev-client
```

First launch on a capable phone downloads the Gemma model (~1.3 GB) once, then
caches it. Subsequent launches load from cache. Low-RAM phones skip the
download entirely (gated in `components/OnDeviceLLMProvider.tsx`).

## Configuration

`fieldos-app/.env` (optional overrides — sensible Gemma 2B defaults are built in):

```bash
# Swap the on-device model if desired
EXPO_PUBLIC_ONDEVICE_MODEL_NAME=gemma-1.1-2b-it-int4.bin
EXPO_PUBLIC_ONDEVICE_MODEL_URL=https://huggingface.co/t-ghosh/gemma-tflite/resolve/main/gemma-1.1-2b-it-int4.bin
```

RAM gate (`MIN_RAM_BYTES` in `OnDeviceLLMProvider.tsx`) defaults to ~3.4 GB.
Lower only if you've tested the model on those phones.

## Where it's wired

| Piece | File |
|-------|------|
| Native model lifecycle (download/load) + RAM gate | `components/OnDeviceLLMProvider.tsx` |
| Framework-agnostic bridge (status + `onDeviceGenerate`) | `services/onDeviceLLM.ts` |
| Provider mounted at root | `app/_layout.tsx` |
| Voice cleanup / summary use on-device first | `services/voiceNoteService.ts` |
| Ask-assistant uses on-device first | `services/aiAssistantService.ts` |

## Verifying which engine answered

- On-device: served locally (no network needed); status is exposed via
  `subscribeOnDeviceStatus()` in `services/onDeviceLLM.ts`.
- Server/heuristic: the backend response includes `data.engine` =
  `"llm"` or `"heuristic"`.

## Notes / caveats

- The integration point is `OnDeviceLLMProvider.tsx`; if the `expo-llm-mediapipe`
  API shifts, that's the one file to adjust.
- iOS 14+ / Android 7+ (SDK 24+). A 2B int4 model realistically needs a 4GB+
  device for usable speed.
- The model URL above is a community-hosted Gemma build; for production, host
  the `.bin` on your own storage/CDN and point the env vars at it.
