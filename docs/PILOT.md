# FieldOS — PILOT.md

How to demo FieldOS to a microfinance institution in under 10 minutes, what's real, what
isn't, and how to set it up. Everything here was verified by running the apps on 2026-07-10.

---

## What the pilot proves

One microfinance institution can run one real field workflow end to end:

> **Register a borrower → submit a loan application → manager approves → manager disburses
> (repayment schedule auto-generated) → field officer records a repayment collection → digital
> receipt issued → it all shows on the manager dashboard, attributed to the officer, with an
> audit trail.**

Every step in that sentence works today and is demoable.

---

## Setup (once, ~5 min)

Three processes: backend (`:8000`), dashboard (`:3000`), mobile (Expo). Use **Python 3.11 or
3.12** — not 3.14.

```bash
# 1) Backend
cd fieldos-backend
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python seed_demo.py                      # DESTRUCTIVE: builds the 15-borrower demo dataset
uvicorn app.main:app --host 0.0.0.0 --port 8000
#   health: curl http://localhost:8000/health  → {"status":"ok",...}

# 2) Dashboard (new terminal)
cd fieldos-dashboard
npm install
BACKEND_URL=http://127.0.0.1:8000 npm run dev     # http://localhost:3000

# 3) Mobile (new terminal) — physical phone on same Wi-Fi, OR emulator
cd fieldos-app
# point the app at your machine's LAN IP for a physical phone:
#   echo 'EXPO_PUBLIC_API_URL=http://<YOUR_LAN_IP>:8000/api/v1' > .env
npm install
npx expo start                                    # scan QR in Expo Go
# Android emulator alternative (localhost via adb reverse):
#   adb reverse tcp:8000 tcp:8000 && adb reverse tcp:8081 tcp:8081
#   CI=1 EXPO_OFFLINE=1 npx expo start --go --offline
```

**Credentials (all PIN `1234`):** Field officer `FO-208` (Ram Bahadur Shah) and `FO-209`
(Hari Prasad Koirala); Branch manager `BM-001` (Suman Karki).

---

## The 10-minute live demo script

Have the **dashboard** open on your laptop (logged in as `BM-001`) and the **mobile app** open
on a phone (logged in as `FO-208`). Frame it as "a day at a branch."

**1. The manager's morning view (dashboard, ~1 min).**
Log in as `BM-001 / 1234`. Land on **Branch Overview** — live KPIs for the branch: staff started,
collections received, PAR follow-up due, exceptions. "This is what a branch manager sees instead
of phoning officers all day."

**2. A new borrower joins + gets a loan (origination, ~3 min).**
Go to **Loan Approvals** in the sidebar. Show the two **Pending Applications** (Sarita Bhandari,
Radha Karki) that officers submitted from the field. Click **Approve** on one — it moves to
**Approved — Awaiting Disbursement**. Click **Disburse** — narrate: "This generates the weekly
repayment schedule and makes the borrower collectable in the field." (Behind the scenes: 25
weekly installments created; the borrower now has a due amount.) Point out that a field officer
*cannot* approve a loan — approval and disbursement are manager-only and every action is audited.

**3. The officer collects in the field (mobile, ~3 min).**
On the phone (logged in as `FO-208`): **Tasks** tab shows today's due clients, including **Kamala
BK — "45 days overdue, NPA risk."** Tap **Collect** on a due client (e.g. Maya Devi Shrestha).
Note the screen captured **GPS** for the visit. Tap **Set Full Due Amount**, choose **Cash**, tap
**Record Collection**. A **digital receipt** appears: amount, client, payment method, **the
officer's name**, remaining due, "GPS logged." "Works offline — it saves on the device and syncs
when there's signal."

**4. The anti-fraud punchline — the client gets a receipt the officer can't fake (dashboard, ~1 min).**
This is the feature to sell hard. Open **Client Receipts** in the dashboard: the collection you
just recorded already sent the *client* an SMS — *"[MFI]: NPR 5,200 received from you. Receipt …
If this amount is wrong, contact your branch office."* Say it plainly: *"The system sends this,
not the officer's phone. So an officer physically cannot pocket part of a payment and record less
— the client is told the exact amount on record and will notice."* That is the leakage-killer,
and it fires on both online and offline collections. (In the demo it's the built-in `log`
provider; in production you plug in a Nepal SMS gateway — one env var.)

**5. It shows up for the manager, instantly (dashboard, ~2 min).**
Back on **Branch Overview** → **Collections Received** now includes that payment, and **Top
Performers — Collections** shows the officer. Open **Audit Logs** → the collection (and the loan
approval/disbursement) appear as append-only entries attributed to the person who did them.
"Every rupee movement and every approval is traceable to a named person — because it's other
people's money."

That's the whole loop: origination → field collection → receipt → manager visibility → audit.

---

## Known limitations — state these plainly

- **Loan application & borrower registration are API-only right now.** The manager-side approve/
  disburse UI is built; the *officer-side* "register borrower / submit application" screens in the
  mobile app are not yet built. For the demo, applications are pre-seeded, so the approve→disburse→
  collect loop is fully demoable. (Top of the next-steps queue.)
- **Offline sync is a resilient retry/queue, not multi-device conflict resolution.** Actions save
  to the device's SQLite and POST when reachable; on failure they stay queued and retry. This is
  the honest offline model for a single-device-per-officer pilot — not CRDT-style merge.
- **No live core-banking (CBS) integration.** Borrower/loan data lives in FieldOS for the pilot
  (your explicit decision). CBS read-integration comes after adoption is proven.
- **Voice notes are typed text + AI cleanup** — no audio recording / speech-to-text.
- **Face verification is a mock** (animated modal), not real biometric matching.
- **Security/Pilot/Threat-model dashboard pages are static reference content**, not live metrics.
- **Single tenant, not yet white-labelable.** Branding (org name/logo/colors) is fixed; the
  multi-tenant / self-signup SaaS layer is deliberately deferred until one MFI runs this for real.
- **Dashboard header date** shows the browser's local date, which can differ from the backend's
  Nepal date by a day near midnight (cosmetic; KPI data uses Nepal date correctly).
- **Deployment:** SQLite is fine for a single-branch pilot; switch to PostgreSQL for multi-branch
  concurrency. Do a **git-history secret scrub** before sharing the repo (old JWT secret is still
  in history even though it's rotated and untracked now).

---

## Verified on 2026-07-10

- Unauthenticated field endpoints → 401; forged `officer_id` in body → ignored (uses token).
- Officer attempting loan approval → 403 (RBAC).
- Full origination lifecycle via API and via the dashboard UI (disburse → 25-installment schedule).
- On-device collection (Pixel 8 emulator) → persisted with correct client + officer → digital
  receipt → reflected on the manager dashboard (NPR 6,700 total, top performer) → audit row.
