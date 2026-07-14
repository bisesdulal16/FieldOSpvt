# Face Clock-In + Real Voice Notes + On-Device Gemma — Setup

Built 2026-07-14. These three features use **native modules**, so they only run in an
**EAS dev-client / standalone build on a real arm64 phone** — never Expo Go or an emulator.

---

## 1. What was built

| Feature | Where | Runs |
|---------|-------|------|
| **Face clock-in** (enroll → on-device MobileFaceNet embedding → cosine match + blink/turn liveness) | `components/fieldos/FaceScanner.tsx`, `services/faceVerifyService.ts`, `app/face-enroll.tsx`, wired into Home "Start Day" | On-device (offline-capable) |
| **Real voice notes** (record audio → Whisper transcription → existing AI cleanup/summary) | `app/voice-notes.tsx`, `services/voiceNoteService.ts` (`transcribeAudio`) → backend `/voice-ai/transcribe` → homelab Whisper | Online (homelab), types as fallback |
| **On-device Gemma** (kept, not ripped out) | `components/OnDeviceLLMProvider.tsx`, `services/onDeviceLLM.ts` — already Tier 1 for cleanup/summary | On-device; server LLM is Tier 2 |

Face match and Gemma are **offline-first Tier 1**; Whisper STT and the Ollama LLM are the **online Tier 2** on the homelab. Everything degrades gracefully (photo-proof / typed text / heuristics) when a tier is unavailable.

## 2. Install the native deps (mobile)

```bash
cd fieldos-app
npx expo install expo-audio
npm install react-native-vision-camera react-native-vision-camera-face-detector \
            vision-camera-resize-plugin react-native-fast-tflite react-native-worklets-core
npx expo install --fix   # reconcile versions to Expo SDK 54
```

`babel.config.js` already includes `react-native-worklets-core/plugin` (required for frame
processors — keep it LAST). `app.json` already registers the `react-native-vision-camera` and
`expo-audio` config plugins and has `RECORD_AUDIO` + `CAMERA` permissions.

## 3. Face model file (MobileFaceNet)

The embedding model is loaded **at runtime from a URL** (same pattern as the Gemma model), so a
missing file never breaks the JS bundle. Host `mobilefacenet.tflite` on the homelab and set:

```bash
# fieldos-app EAS env / .env
EXPO_PUBLIC_FACE_MODEL_URL=http://192.168.1.50:9000/models/mobilefacenet.tflite
EXPO_PUBLIC_FACE_THRESHOLD=0.62      # DEVICE-TUNE cosine pass mark (0.55–0.70 typical)
```

If unset, it falls back to a public HuggingFace MobileFaceNet. **DEVICE-TUNE on real officers:**
the input normalization in `FaceScanner.tsx` assumes `(px-127.5)/128` → `[-1,1]`; some MobileFaceNet
exports want `[0,1]` or uint8. Confirm the model's expected input and the embedding length (128 or
192) on the first device run.

## 4. Homelab Whisper (STT)

Run any OpenAI-compatible Whisper server, e.g. faster-whisper-server:

```bash
docker run -d --gpus all -p 9000:8000 fedirz/faster-whisper-server:latest-cuda
# CPU-only: fedirz/faster-whisper-server:latest-cpu
```

Point the backend at it (`fieldos-backend/.env`):

```bash
WHISPER_URL=http://192.168.1.50:9000/v1/audio/transcriptions
WHISPER_MODEL=Systran/faster-whisper-small     # or -medium for better Nepali
# LLM (already wired) for cleanup/summary:
OLLAMA_URL=http://192.168.1.50:11434
OLLAMA_MODEL=gemma2:2b
```

When `WHISPER_URL` is unset/unreachable, `/voice-ai/transcribe` returns empty text and the officer
just types — the flow never hard-fails.

## 5. Build & run on a real device

```bash
cd fieldos-app
eas build -p android --profile development   # dev-client, or 'preview' for a shareable APK
# install the APK on a real Samsung/Pixel (4GB+ RAM), then:
npx expo start --dev-client
```

## 6. Backend migration

New columns: `users.face_template`, `users.face_enrolled_at`, `day_start_records.face_verified`,
`day_start_records.face_similarity`. On a fresh DB `seed_demo.py` creates them; on an existing
Postgres run `alembic upgrade head` (migration `004_add_face_verification`).

## 7. On-device test checklist

```
[ ] Onboarding → "Set up face clock-in" → blink + turn prompts → "Face enrolled"
[ ] Start Day → face scan → matches you → day starts (manager sees face_verified ✓)
[ ] Start Day with a photo of your face on another screen → liveness blocks it
[ ] Low-end/Expo Go → face scan unavailable → falls back to photo selfie (no crash)
[ ] Voice note → tap mic → speak Nepali → stop → transcript appears → AI cleanup/summary
[ ] Whisper box off → recording stops, alert to type → note still saves
[ ] Capable phone → Gemma loads (logs: status → ready) → cleanup runs offline
```
