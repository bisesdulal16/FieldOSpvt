# FieldOS Nepal — Project Status & Resume Guide

**Last updated:** 2026-06-21
**Active branch:** `fix/sync-fields-nav-dashboard-round2` (16 commits ahead of `main`, pushed, **not yet merged**)

This is the "start here" doc. It says where we are, how to resume, what works,
what's mocked, and what's next. Companion docs:
- `PILOT_SCOPE.md` — org setup, officer daily flow, training, CBS decision.
- `PRODUCTIVITY_TRACKING_SCOPE.md` — face/photo, location map, anomaly alerts plan.
- `PILOT_DEPLOYMENT_NEPAL.md` — server/deploy guide.
- `IOS_DEVICE_BUILD.md` / `ON_DEVICE_AI_SETUP.md` — device builds + on-device LLM.

---

## Current stage
**Late-stage pilot hardening on a real Android device.** Core officer→dashboard
workflow is real and verified end-to-end. We are fixing issues found during
on-device testing on a **Samsung Galaxy Note 10+** and have scoped (not built)
the larger productivity-tracking features.

**Next decision:** merge this branch to `main`, then start **Phase 1**
(location map + anomaly alerts) from `PRODUCTIVITY_TRACKING_SCOPE.md`.

---

## How to resume (local dev on this Windows PC)

**Stack:** Expo SDK 54 app + FastAPI backend (SQLite) + Next.js dashboard. Backend on `192.168.1.50:8000` (LAN), dashboard on `:3000`, Metro `:8081`.

```bash
# 1. Backend  — DO NOT delete fieldos_nepal.db (that wipes pilot data!)
cd fieldos-backend
venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. Dashboard
cd fieldos-dashboard
BACKEND_URL=http://127.0.0.1:8000 npm run dev    # http://localhost:3000

# 3. Mobile — standalone preview APK (no Metro needed) OR dev client
#    Latest preview APK is built via: eas build --profile preview --platform android
```

- **Credentials:** Field officer `FO-208 / 1234`; Branch manager `BM-001 / 1234`.
- **Mobile `.env`:** `EXPO_PUBLIC_API_URL=http://192.168.1.50:8000/api/v1` (must match the PC's Wi-Fi IP; phone on same Wi-Fi).
- **Firewall:** inbound TCP 8000/3000/8081 must be open (rule "FieldOS Pilot Ports" added; re-add if the PC changed).
- **adb:** `C:\Users\Bishesh Dulal\AppData\Local\Android\Sdk\platform-tools\adb.exe` (install APK with `adb install -r <apk>`).

### ⚠️ Persistence (important)
DB is **SQLite** at `fieldos-backend/fieldos_nepal.db` and **is persistent**.
Earlier "data keeps disappearing" was caused by running `rm fieldos_nepal.db`
before restarts — **never do that**; just restart uvicorn. `seed.py` is
non-destructive (creates tables + demo rows only). Back up = copy the `.db`.
For production/multi-branch, switch to PostgreSQL (see deployment guide).

---

## What works (real, verified end-to-end)
- Login (officer + manager), **manager assigns tasks → officer sees them**.
- **Collection** (direct POST + offline queue) → dashboard with officer, amount, time.
- **Visit check-in** → GPS + readable address → dashboard; visit now lets the
  officer pick the **outcome** (Collect / Promise-to-Pay / No payment) — no forced collection.
- **Promise-to-Pay** (real amount input) → dashboard PTP-Due.
- **End-of-Day** (real totals computed locally) → dashboard EOD Review.
- **Offline-first**: actions queue locally and sync on reconnect.
- **Manager dashboard**: Branch Overview, Staff Activity (visits/collections per officer),
  Collections (with time), Visits, PAR, PTP, EOD, Sync, Audit, Assign Task,
  **Add Staff** (creates officers, persists), **Send Announcement**.
- **Data AI (rule-based, DB-computed):** priority queue, suggestions, EOD & branch summaries.
- **Collect tab** now shows a **client picker + captures GPS** (no hardcoded client).
- i18n English/Nepali full parity (587 keys).

## AI status
- **Data AI** = real (rule-based SQL). ✅
- **Voice/assistant LLM** = 3-tier: **on-device Gemma** (MediaPipe, 4GB+ arm64 phones)
  → **server LLM** (Ollama, optional) → **heuristic** fallback. On-device only
  activates in a dev/standalone build on a capable phone; budget phones fall back.
- **Voice notes are typed text + AI cleanup** — NO audio recording / speech-to-text yet.

---

## Known issues / mocked / not-production-ready
| Item | State |
|------|-------|
| Voice notes | Typed only (no audio capture/STT). Backend acks `voice_note` sync but does not store it server-side. |
| KYC documents | Ack'd on sync, not stored server-side. |
| Face verification | **Mocked** modal. Real photo-proof / face-match is Phase 2/3 (see productivity scope). |
| Live location map | Not built. Visit GPS is captured + stored; no map view or last-seen yet (Phase 1). |
| Device registration | Not called on login + endpoint expects query params → Sync Monitoring shows 0 devices. Low-impact follow-up. |
| Security/Pilot dashboard pages | Static "Reference"/demo content (threat model, pen test, compliance, pilot overview) — documentation, not live. |
| CBS section | Works on seed/imported data; **no live CBS** (intentional for pilot — see PILOT_SCOPE.md). |
| EOD once-per-day flag | Device-local, keyed by date; looked "stuck submitted" only because the backend was being wiped. Resolved by not wiping. |
| Audit log names | Show "Ram Bahadur Shah"/FO-208 because that's the demo officer account used in testing. |
| Backend on LAN | Needs same Wi-Fi + open firewall + cleartext HTTP (enabled). Use hosted HTTPS server for multi-branch. |

---

## What's next (recommended order)
1. **Merge `fix/sync-fields-nav-dashboard-round2` → `main`** to lock the pilot build (branch is 16 commits ahead).
2. **Phase 1 — Productivity tracking core** (`PRODUCTIVITY_TRACKING_SCOPE.md`): last-seen + visit-point **map on the dashboard**, anomaly rules v1 (visit GPS vs client center, EOD-vs-actual, collection-without-visit, mock-GPS), → Exceptions Queue + manager alerts. (~2 wks)
3. **Phase 2 — Photo proof** selfies at start-day/high-value + mock-GPS detection. (~1 wk)
4. Smaller: device registration fix; server-side storage for voice notes/KYC; "Change client" button on Collect; wire remaining pilot dashboard sub-pages.
5. **Phase 3 (optional)** — automated on-device face matching; push/SMS alerts.

### Pilot data decision (decided)
Load **10–15 real clients manually/by import** for the pilot. Do **not** connect
live CBS yet (read-only CBS comes after adoption is proven).

---

## Latest builds
- Android **preview** APK (standalone, pilot-installable) rebuilt per change via
  `eas build --profile preview --platform android` on account **bisesdulal16**.
  Get the newest from https://expo.dev/accounts/bisesdulal16/projects/fieldos-nepal/builds .
- EAS project linked (`projectId` in `app.json`); `eas.json` has development/preview/production profiles with the backend URL baked into `preview`.
