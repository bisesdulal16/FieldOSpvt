# FieldOS Nepal — Pilot Scope & Playbook

Practical plan for a 1-branch, 5–10 field-officer pilot. Grounded in the
current build (offline-first mobile app + FastAPI backend + Next.js dashboard,
rule-based AI live, optional on-device Gemma on 4GB+ phones).

---

## 1. Organization setup flow (one-time, ~half a day)

**A. Stand up the server** (see `PILOT_DEPLOYMENT_NEPAL.md`)
- Branch-LAN laptop/mini-PC (recommended) or a small VPS.
- `alembic upgrade head`, set a real `JWT_SECRET_KEY`, start backend + dashboard.
- Open the firewall ports (8000/3000) and confirm a phone on the branch Wi-Fi can reach `http://<server>:8000/health`.

**B. Load clients** (see §4 — start manual, not CBS)
- Import/seed 10–15 real client profiles for the branch.

**C. Create the branch manager + field officers (in the dashboard)**
1. Log in as the branch manager (`BM-001` seeded; change its PIN first).
2. **Staff Activity → Add Staff** → for each officer enter `staff_id` (e.g. `FO-211`), name, phone, and a starting PIN. The dashboard shows the PIN **once** — record it to hand to the officer.
3. Repeat for 5–10 officers.
4. **Assign Task** → give each officer their day-1 tasks (collection/visit/follow-up) tied to clients.

**D. Hand off credentials**
- Give each officer their `staff_id` + PIN. They change the PIN on first login (Profile → Change PIN).

### What each role sees
- **Field officer (app):** login → home (today's due clients, visits planned, collection target, promises) → Tasks → per-client actions (Visit, Collect, PTP, KYC, Voice note) → End of Day.
- **Branch manager (dashboard):** Branch Overview KPIs, Staff Activity, Collections, Visits, PAR/overdue, PTP due, EOD reviews, Sync monitoring, Audit logs, AI insights/suggestions. Read-only operational truth that replaces phone calls to officers.

### What to capture during the pilot (to optimize next stages)
Track these from day 1 — they decide the product's next moves:
- **Adoption:** daily active officers, logins/day, days-since-last-use per officer.
- **Workflow:** collections entered same-day %, visit check-in completion %, PTP follow-up rate, EOD submitted %.
- **Reliability:** offline-sync success rate, failed-sync count + reasons, average time queued.
- **Speed:** time per collection, taps to complete a collection, app cold-start time.
- **Devices/connectivity:** phone model + RAM (decides on-device AI reach), how often officers work offline, sync latency.
- **AI usefulness:** are priority-queue/suggestions acted on? Are voice/assistant used? (engine: on-device vs server vs heuristic).
- **Friction/feedback:** where officers drop off, confusion points, manager's "would you go back to paper?" answer.
- **Manager value:** reduction in phone calls to officers (target ≥40%).

---

## 2. Field officer daily flow

1. **Start of day** — open app, log in (PIN/biometric), **Start Day** (identity check). Review **Tasks** (assigned + due list, AI-prioritized).
2. **Per client (in the field):**
   - **Visit check-in** — captures GPS (readable address), proves the visit.
   - **Collect** — enter amount + method → digital **receipt** (saved offline, syncs).
   - **Promise-to-Pay** — if they can't pay: amount + date + reason.
   - **KYC / Document** — capture citizenship/photo if needed.
   - **Voice/text note** — quick visit note (typed; AI cleanup/summary).
3. **Offline** — everything saves locally and queues; the Sync Center shows pending items.
4. **Back in coverage** — sync drains the queue (or auto-syncs); receipts/visits appear on the manager dashboard within ~30s.
5. **End of day** — submit the **EOD report** (collected, visits, pending) — once per day.

---

## 3. Pilot onboarding checklist / mini-training (per officer, ~30 min)

Each officer completes this once before going live:
- [ ] Install the app (APK) and open it
- [ ] Log in with issued `staff_id` + PIN
- [ ] **Change PIN** (Profile → Change PIN)
- [ ] Switch language to Nepali and back (confirm comfort)
- [ ] **Start Day**
- [ ] Open a task → **Visit check-in** (see the GPS address)
- [ ] Record a **test Collection** → view the receipt
- [ ] Record a **Promise-to-Pay**
- [ ] **Airplane mode** → record a collection → see it queue → turn Wi-Fi on → **Sync** → see it clear
- [ ] Create a **voice/text note** + run AI cleanup
- [ ] Submit an **End of Day** report
- [ ] Confirm with the manager that the above appears on the dashboard

**Manager training (~30 min):** add/Assign tasks, read each Operations view, review EOD, watch Sync monitoring, send an Announcement, read AI insights, export audit logs.

---

## 4. CBS connection — recommendation: **manual for the pilot, not live CBS**

**Recommendation: load 10–15 real client profiles manually/by import. Do NOT integrate live CBS for the pilot.**

Why:
- The pilot's goal is to prove **workflow adoption** (officers + manager using it daily), not data-integration completeness.
- Live CBS integration is the riskiest, slowest piece — CBS versions/configs vary, and write-back has reconciliation/double-posting risk. The roadmap deliberately defers it (read-only first, write-back much later).
- Live CBS needs IT/finance sign-off and credentials — that delays the pilot by weeks.
- 10–15 representative clients are enough to exercise every workflow (collections, PAR, PTP, EOD) convincingly.

How to load them:
- Prepare a CSV/seed of 10–15 real (anonymized) clients: member id, name, center, loan outstanding, due amount, next installment, overdue days.
- Load via the seed script or the CBS import endpoint (`/cbs/import` accepts a client list). No live CBS link.

When to connect CBS: **after** the pilot proves adoption — start with **read-only** (pull client/loan/PAR), then event reconciliation, then controlled write-back. Not now.

---

## 5. What's mock / demo / not-production-ready (be transparent in the pilot)

| Area | State | Pilot stance |
|------|-------|--------------|
| **Core workflow** (login, tasks, collect, visit, PTP, EOD, offline sync, dashboard) | **Real, working** | Pilot foundation ✅ |
| **Rule-based AI** (priority queue, suggestions, EOD/branch summary) | **Real, DB-computed** | Use it ✅ |
| **Voice notes** | **Typed text + AI cleanup; NO audio recording / speech-to-text** | Use as text notes; set expectations. Audio+STT is a later phase |
| **On-device Gemma (voice/assistant LLM)** | Works on **4GB+ arm64** phones; budget phones fall back to server/heuristic | Bonus on capable phones; not relied on |
| **CBS section** | Works against **imported/seed** data, not a live CBS | Use seed/import data |
| **Security & Pilot dashboard pages** (Threat Model, Pen Test, Compliance, Pilot Overview, Branch Readiness) | **Static "Reference"/demo content**, not live operational data | Treat as documentation; don't present as live metrics |
| **Biometric login** | Device-dependent ("not available" on some phones) | PIN is the reliable path |
| **Backend on LAN** | Needs same Wi-Fi + open firewall; LAN IP only | Fine for 1 branch; use a hosted server for multi-branch |
| **Tasks** | Assigned by manager (or seeded); not auto-generated from CBS schedules yet | Manager assigns daily during pilot |
| **Some pilot dashboard sub-pages** (Documents, Training, Metrics, Feedback, Escalations, Agreements, Device Mgmt) | Hidden / no backend endpoint | Out of scope for pilot week 1 |

### Known follow-ups (post-pilot, by priority)
1. Audio recording + Nepali speech-to-text for voice notes.
2. Live CBS read integration (then reconciliation, then controlled write-back).
3. Server-side storage for voice notes & KYC documents (currently ack'd, not stored).
4. Wire the remaining pilot dashboard sub-pages to real endpoints.
5. Hosted server + HTTPS for multi-branch (removes the LAN/firewall/cleartext constraints).

---

## Pilot go/no-go (1 branch)
**GO when:** server reachable from officer phones, 10–15 clients loaded, 5–10 officers created + trained (checklist done), manager trained, and one full officer→dashboard round-trip verified (collection + visit + EOD shows on the dashboard). Everything in §5 row 1–2 is real; the rest is clearly labeled.
