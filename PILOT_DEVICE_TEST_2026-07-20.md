# FieldOS — On-Device Golden-Path Test (2026-07-20)

**Tester:** Bishesh · **Device:** Samsung Galaxy Note 10+ · **Officer:** FO-209 (Hari Prasad Koirala)
**Build:** APK vs `fieldos-api.hackdome.online` (mock sync off) · **Branding:** still "FieldOS Nepal" (Asha rebrand pending)
**Result:** 10 pass · 5 fail · 1 not run (of 16). Core money path closes; 5 issues to act on.

## Server-side verification (confirmed against backend)

| Receipt | Amount | Attributed to | SMS | Audit |
|---|---|---|---|---|
| RCP-1784599618410 (G5, direct) | NPR 2,500 | Hari Prasad Koirala (FO-209) ✅ | sent ✅ | `collection_recorded` ✅ |
| RCP-1784600309143 (O1→O2, offline→synced) | NPR 1,000 | Hari Prasad Koirala (FO-209) ✅ | sent ✅ | `collection_recorded` ✅ |

Attribution, audit, and the anti-fraud SMS all fire correctly — including on the **offline-then-synced** path.
Note: both collections stored `gps_address: null` server-side (app sends lat/lng/accuracy but not the reverse-geocoded address).

## Failures (root cause + disposition)

### F4 — Face verify accepted a different person (sister) 🔴 Critical
- Model runs (F1–F3 passed with real liveness), so this is accuracy, not a stub.
- Cause: likely `.tflite` input-normalization mismatch (`[-1,1]` vs `[0,1]`/uint8) → non-discriminative embeddings, and/or the 0.62 threshold too loose (siblings compound it). No similarity score surfaced.
- **Disposition:** needs a device-tuning session (see below). Until then, treat the day-start **selfie** as the real control, not the match. Do NOT market face-match as a security guarantee for the pilot.

### O1 — Offline lockout + day-start re-prompt 🟠 High (pilot blocker)
- (a) Offline login fails ("network request failed") — login needs a server round-trip; must cache the JWT so an officer who logged in at the office keeps working offline.
- (b) Day-start re-prompts on every login — should persist **one start-day per day** until EOD.
- (c) "29 items synced" = leftover **FO-208** queue on the same device drained under FO-209 → offline queue is not scoped per user (multi-user-device concern; matches two `user_id=1` audit rows written during FO-209's sync).
- Desired behavior (tester): one start-day/day; no network required once the day is started at the office.

### G7 — GPS gate bypassable via "reason" 🟠 Decision (not a bug)
- Deliberate: no GPS fix → officer types a reason → check-in allowed (`app/visit-checkin.tsx:125`).
- Contradicts CLAUDE.md hard rule ("Block submission if `gpsStatus !== 'success'`").
- **Decision (2026-07-20):** keep the reason-override (rural GPS genuinely fails) but **surface the reason to the manager as an exception**, and update the hard rule to match. TODO: manager "no-GPS check-ins" exception view.

### G2 — Task search bar not clickable 🟡 Medium (quick fix)
- The search bar is a static `<View>`+`<Text>` placeholder, not a `<TextInput>` (`app/(tabs)/tasks.tsx:127`). Filter chips below intercept taps. Known issue in CLAUDE.md's table.
- **Fix:** real TextInput + name/member-ID filter.

### G6 — Nepali toggle incomplete 🟡 Medium
- Receipt (amount/ID/date/name) and task/client info don't switch to Nepali. Hardcoded strings on `receipt.tsx` + client cards; amount/date not localized. (Client *names* are proper nouns — expected to stay.)
- **Fix:** i18n audit of receipt + client card + task detail.

## Also observed (inside G5 "pass")
- Standalone **Collect** (via `(tabs)/collect.tsx`) shows **0 due/outstanding** and its **"change client" picker is empty** — only Collect-from-a-task works.
- Backend collection schema already supports `face_verified` + GPS; the app captures GPS coords but never sets `face_verified` and drops `gps_address`.

## Priority for pilot
O1 (offline lockout) → F4 (face tuning) → G7 (manager exception view) → G2 (search) → G6 (i18n) → standalone-collect bug.
