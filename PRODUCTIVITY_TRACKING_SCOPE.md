# FieldOS — Staff Productivity & Verification: Scope

**Goal (your words):** track staff productivity — verify officers actually did
what they claim and are genuinely visiting clients for collections — and
**notify branch managers when something looks off.**

Three capabilities serve this: (1) **location verification** (visit-point +
last-seen map), (2) **face/photo verification** (currently mocked), and
(3) an **anomaly engine + manager alerts**. None is a one-line change — below is
the honest scope, options, and a phased plan. Today's build already gives us
the foundation: real GPS at visit check-in, a custom dev build (native modules
allowed), and the Exceptions Queue on the dashboard.

---

## A. Location verification — visit-point + last-seen map (recommended)

You chose **visit-point + last-seen** (not continuous tracking) — lower battery,
privacy-defensible, still proves "were they actually there."

**What we capture**
- **Visit point** — already captured at each check-in (lat/lng/accuracy/address/time). Just needs to be stored + surfaced on a map (it already syncs).
- **Last-seen** — capture the officer's location at each app action (login, start-day, collection, visit, EOD) and on a light foreground heartbeat while the app is open. Store `last_seen_lat/lng/at` per officer. (No background/continuous tracking.)

**Dashboard map view**
- A branch map (configurable center/zoom per branch) with: officer **last-seen pins** and the day's **visit pins**, click for detail (who, when, address, accuracy).
- Map tech: **react-leaflet + OpenStreetMap** tiles (free, no API key, works for Nepal) — recommended; or Mapbox/Google if you want satellite (needs a key).

**Backend**
- Add `last_seen_lat/lng/at` to the officer/device, plus a `/manager/locations` endpoint feeding the map. Visit points come from the existing `visit_checkins`.

**Verification value:** compare each visit's GPS against the client's center/expected area → flag "claimed a visit but was nowhere near the client."

**Effort:** ~1–1.5 weeks (capture + store + endpoint + map UI). Anti-spoof (detect mock-location/fake GPS) is a +few-days add-on (Android exposes `isFromMockProvider`).

---

## B. Face / photo verification (currently mocked)

Today the face check is a mock modal. Two real levels:

**B1 — Photo proof (recommended for pilot, ~1 week)**
- At start-day and high-value collections, **capture a selfie with `expo-camera`** and store it with the action.
- The manager sees the photo against the action in the dashboard. No automated matching — but it's real accountability ("show me who recorded this"), cheap, and reliable on all phones.

**B2 — Automated face match (phase 2, ~2–3 weeks)**
- **Enroll** a reference face per officer at onboarding (selfie → face embedding).
- At verification, capture a selfie → compute embedding on-device → cosine-similarity vs the enrolled embedding → pass/fail at a threshold.
- Tech: `expo-camera` + an on-device face-embedding model (MobileFaceNet via `react-native-fast-tflite` or ExecuTorch). We already have the dev-build pipeline for native models (same path as Gemma).
- Caveats: needs decent cameras/lighting; **liveness/anti-spoof** (defeating a photo-of-a-photo) is a further, harder step; consent + storage of biometric templates raises privacy/legal duties.

**Recommendation:** ship **B1 (photo proof)** for the pilot; do **B2** only if the pilot shows officers gaming identity. Automated biometrics is real work + a privacy/compliance commitment.

---

## C. Anomaly engine + manager alerts (the actual "notify if something's off")

Rule-based first (matches the roadmap; explainable; no ML risk). Runs server-side, feeds the **Exceptions Queue** + notifies the manager.

**Signals we already have / will have:** visit GPS vs client's center, visit count vs EOD claim, collections vs visits, check-in times, mock-location flag, last-seen staleness.

**Example rules (v1):**
- Visit check-in GPS > N km from the client's center → "possible off-site check-in."
- EOD claims more visits/collections than recorded check-ins/collections → "EOD mismatch."
- Collection recorded with **no visit** for that client that day → "unverified collection."
- **Mock/fake GPS** detected → "location spoofing suspected."
- No check-ins by midday for a started officer → "inactive officer."
- Several check-ins at the **same coordinates** in minutes → "batch/fake visits."

**Alerts:** each rule that fires creates an Exceptions Queue item (severity) + a manager notification (in-app now; push/SMS later). Manager can review, dismiss, or escalate.

**Effort:** ~1–1.5 weeks for the rule engine + Exceptions wiring + in-app manager notifications. Push (FCM) / SMS is a +few-days add-on.

---

## Privacy & adoption (important)
- Officers must **consent** and see plainly what's captured (visit points, last-seen, selfies) — frame it as **visit verification**, not surveillance. The roadmap explicitly flags "GPS surveillance fear" as an adoption red flag.
- Keep to **visit-point + last-seen** (your choice) — not full-day tracking.
- Define **retention** (e.g., purge raw locations after N days; keep aggregates) and who can see what (RBAC).
- Biometric templates (B2) carry legal/consent obligations — get sign-off before enabling.

---

## Recommended phasing
| Phase | Scope | Effort |
|-------|-------|--------|
| **1** | Last-seen capture + visit-point map on dashboard; anomaly rules v1 (visit-vs-GPS, EOD mismatch, unverified collection) → Exceptions Queue + in-app manager alerts | ~2 weeks |
| **2** | Photo-proof selfies (B1) at start-day/high-value; mock-GPS detection | ~1 week |
| **3** | Automated on-device face match (B2); push/SMS alerts | ~3 weeks |

**For the current pilot:** Phase 1 + 2 deliver your core goal — verified visits on a map, photo proof, and "notify the manager if it looks off" — without the heavy biometric build. Phase 3 follows if the pilot shows it's needed.

---

## Deferred items from device testing (small, tracked here so they're not lost)
- **Device registration** isn't called on login and the endpoint takes query params (not a body) → Sync Monitoring shows 0 devices. Quick fix: call register on login with query params. (Low impact.)
- **Voice notes / KYC docs** are ack'd on sync but **not stored server-side** yet.
- Audit-log rows show no role and use the demo officer's name (you logged in as FO-208).
