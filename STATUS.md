# FieldOS — STATUS.md (Honesty Map)

---

## ⬆️ UPDATE — 2026-07-10 (pilot-hardening sprint, same day)

The audit below is the "before" picture. Here is what changed after it, all **verified by
running the apps** (backend curl, dashboard in-browser, mobile on the Pixel 8 emulator):

**Golden path now closes end-to-end.** Officer logs in → opens a due client → records a
collection → gets a digital receipt (attributed to the officer, GPS logged) → the collection
appears on the manager dashboard (NPR total + top-performer), attributed to that officer, with
an audit-log row. Verified on-device: "Collection Recorded! NPR 5,200, Maya Devi Shrestha,
Field Officer: Ram Bahadur Shah."

**Loan origination now exists and is demoable** (you chose to keep it in scope). Full lifecycle
built and verified: officer **registers a borrower** → **submits a loan application** (pending)
→ manager **approves** → manager **disburses** (generates a 25-week repayment schedule and makes
the borrower collectable). Approve/Disburse run from a new **Loan Approvals** page in the
dashboard; I clicked Disburse in the real UI and confirmed the schedule generated and the
borrower became collectable. An officer's attempt to approve returns **403** (RBAC works).

**Security floor — now 5/5 for pilot size:**
- *Authentication:* every field-officer endpoint (`/collections`, `/visit-checkins`,
  `/promise-to-pay`, `/end-of-day`, `/sync`, `/audit-events`, `/clients`, `/tasks`, `/loans`)
  now requires a valid JWT. Unauthenticated calls return **401** (verified). `officer_id` is
  derived from the token — a forged `officer_id: 999` in the body is ignored (verified: stored
  as the real officer).
- *RBAC:* approve/disburse and all `/manager/*` routes require branch-manager/admin (verified 403 for officer).
- *Hashed credentials:* bcrypt (already true).
- *Append-only audit:* sensitive actions (`collection_recorded`, `loan_application_submitted`,
  `loan_approved`, `loan_disbursed`, `borrower_registered`, `visit_checkin`, `promise_to_pay_created`,
  `end_of_day_submitted`) write a server-side audit row tied to the authenticated user (verified,
  shows real names like "Suman Karki").
- *No secrets in git:* `.env` files and `*.db` untracked (`git rm --cached`), `.gitignore`
  hardened, `.env.example` templates added, dev JWT secret rotated. **Follow-up:** the old secret
  still exists in git history — do a history scrub (git-filter-repo/BFG) before the repo is shared.

**Timezone bug fixed.** All business timestamps and "today" filters now use Asia/Kathmandu
consistently (`app/utils/nepal_time.py`); a device's UTC timestamp is converted to Nepal time on
receipt. The dashboard now shows collections made "today."

**Demo dataset seeded** (`seed_demo.py`): 1 branch, 2 field officers (FO-208, FO-209) + manager
(BM-001), 15 Nepali-named borrowers across 3 centers, loans in mixed states — active/collecting,
one delinquent (Kamala BK, 45 days overdue / NPA risk), 2 pending applications, 1 approved
awaiting disbursement.

**Follow-up sprint additions (same day, verified):**
- **Mobile origination screens built** — officer can now **Register Borrower** (button on the
  Tasks tab) and **Submit Loan Application** from the phone. Verified on-device end-to-end:
  registered Sabina (M-017) → submitted LN-M-017-0017 → it appeared in the manager's dashboard
  Loan Approvals queue. The officer→manager→collection loop is now fully closed through real UIs.
- **Brandable single tenant** — `GET /api/v1/branding` (env-driven: `ORG_NAME`, `ORG_TAGLINE`,
  `ORG_PRODUCT_SUFFIX`, colors, logo). Dashboard login/sidebar and mobile login consume it.
  Verified: setting `ORG_NAME="Sana Kisan"` rebranded the dashboard login with no code change.
- **GPS check-in gate fixed** — a visit check-in with no GPS fix (permission denied, GPS
  unavailable, or location timeout) now *requires* a written reason before it can be saved;
  it can no longer silently succeed without location.
- **Share Receipt wired** — the receipt "Share" button now opens the native share sheet with a
  text receipt (was a "coming soon" alert).
- **Change client on Collect** — the Collect tab now has a "Change" button to switch borrower
  without going back through Tasks.
- **Dashboard header date** now uses Asia/Kathmandu, matching the backend's "today".

**Post-pilot growth sprint (verified):**
- **Office-WiFi day-start gate + selfie done** — an officer can only start their day from the
  branch network: the backend checks the request's source IP against the branch's registered
  `office_ip` and returns **403** when off-network (verified: 127.0.0.1 → verified start;
  spoofed 202.51.1.99 → blocked). Start-of-day captures a real front-camera **selfie** (verified
  on-device: camera → 30 KB photo stored) and GPS. Manager sees it all in the dashboard's new
  **Day-Start Attendance** view (selfie thumbnail + "Office network ✓" badge); blocked attempts
  are audited. Config: `Branch.office_ip` (comma-separated IPs; empty = gate disabled).
- **Postgres migration done** — backend runs on Postgres (not just SQLite), verified end-to-end
  against a real local Postgres 16 (golden path + origination + auth + audit all pass). Only fix
  needed: timestamps now stored at seconds precision to fit `VARCHAR(30)` (SQLite ignored length;
  Postgres enforces it). `asyncpg` added. Deploy playbook in **DEPLOY.md** (Neon + Fly.io + Vercel
  + EAS) — the cloud steps are account-gated so they're documented for you to run.
- **Anti-fraud SMS receipt (the sellable wedge) built + verified** — every collection auto-texts
  the client the exact recorded amount, **server-side on both the direct-POST and offline-sync
  paths**, so an officer can't under-report without the client's SMS exposing it. Pluggable gateway
  (`log` for dev/demo, `sparrow` for Nepal prod). Logged in `sms_notifications`; manager sees the
  proof in the dashboard's new **Client Receipts** view. Verified: recorded NPR 5,200 (direct) and
  NPR 1,800 (offline) → both clients messaged, both shown `sent` on the dashboard.

**Also done:** the branding `logo_url` now **renders** on the dashboard login + sidebar and the
mobile login (with graceful fallback to the default icon when unset) — verified by serving a
data-URI "SK" logo, which appeared in both the dashboard login and sidebar. The **second field
officer** (FO-209, Hari Prasad Koirala) is a real account with its own Balaju clients; per-officer
task scoping verified (FO-208 sees 7 Kalanki/Swoyambhu clients, FO-209 sees 5 different Balaju
clients), and both appear on the manager's PAR/staff views.

**Still not done** (next-steps queue): git-history secret scrub (rotated + untracked, but the
old secret remains in history — needs `git-filter-repo`/BFG + force-push, which rewrites shared
history and should be done deliberately); Postgres for multi-branch concurrency (deliberately
deferred — SQLite is correct for a single-branch pilot). See PILOT.md.

The section below is the original pre-fix audit, kept for honesty and history.

---

**Audited:** 2026-07-10 by running the actual apps, not by reading code.
**Auditor method:** Booted the FastAPI backend (Python 3.12), the Next.js dashboard (in a
real browser), and the Expo mobile app **on a real Android emulator (Pixel 8)** driven with
`adb`. Every verdict below is either something I saw happen (WORKS), something whose code runs
but does not finish its job (PARTIAL), or UI/endpoints with nothing real behind them
(DECORATIVE).

> **The one-line truth:** The backend + manager dashboard are real and mostly work. The
> mobile app boots, logs in against the real backend, and shows real data — but the **single
> most important field action, "record a collection," fails on the device**, and even a
> successful collection would **not appear on today's dashboard** because of a timezone bug.
> Separately, **every field-officer API endpoint has no authentication at all.** The product
> is genuinely further along than a prototype, but the golden path is not closed.

---

## 0. The golden-path mismatch you need to decide first

Your sprint brief defines the golden path as a **loan-origination lifecycle**:

> register a borrower → submit a loan application → approve it → record disbursement →
> generate a repayment schedule → record a collection → issue a digital receipt → dashboard.

**That is not the product that exists, and it is not the product your own vision doc describes.**

- The **vision doc's 16 MVP items** are a *workforce-operations* tool: attendance, daily
  tasks, GPS visits, **collections execution**, and a manager dashboard. It explicitly
  *excludes* loan origination ("Management can see loan portfolio data" — implying that comes
  from the CBS, not from this app).
- The **built app** matches the vision doc, not the sprint brief. Borrowers and loans are
  **seeded** into the database. There is **no screen anywhere** to register a borrower, submit
  a loan application, approve a loan, record a disbursement, or generate a repayment schedule.

So of the 8 steps in your stated golden path, **5 do not exist in any form** and were never
scoped. See §2 for the verdicts and §4 for my recommended re-cut of the golden path to the
one that is ~80% built and matches your survey's actual pain points.

---

## 1. What I ran, and how

| Tier | How it was run | Result |
|------|----------------|--------|
| Backend (FastAPI) | `python3.12 -m venv`, `pip install -r requirements.txt`, `python seed.py`, `uvicorn` | **Runs.** Health OK, login issues JWTs. |
| Dashboard (Next.js 16) | `npm install`, `npm run dev`, driven in a real browser | **Runs.** Manager login → live KPIs from backend. |
| Mobile (Expo SDK 54) | Expo Go on Pixel 8 Android emulator, `adb reverse` to backend, driven with `adb` taps | **Runs.** Login → Home → Tasks → Collect all render real data. |

**Two environment gotchas found on a clean clone (documented so the next run is painless):**

1. **Python 3.14 breaks the backend.** `pydantic-core` has no wheel for 3.14; the pinned
   `pydantic==2.9.2` fails to build. **Use Python 3.11/3.12.** (Documented in CLAUDE.md.)
2. **The committed `fieldos_nepal.db` is schema-stale.** It predates migrations 002/003, so
   on a fresh clone `POST /collections` 500s with `table collections has no column named
   gps_address`, and the dashboard's `tasks` table doesn't exist (it's `task_assignments`).
   **Fix:** delete the committed DB and re-run `seed.py` (+ `seed_manager.py`). The committed
   binary DB should not be in git at all — see §5.

---

## 2. Golden-path verdicts (feature by feature)

### Loan origination half — **does not exist**

| Step | Verdict | Evidence |
|------|---------|----------|
| Register a borrower | **DECORATIVE / MISSING** | Clients are seeded (`seed.py`). No create-client screen or `POST /clients`. |
| Submit loan application | **MISSING** | No application entity, screen, or endpoint. |
| Approve loan | **MISSING** | No approval workflow, state machine, or endpoint. |
| Record disbursement | **MISSING** | No disbursement flow. Loans seeded as already-active. |
| Generate repayment schedule | **MISSING** | Loans seeded with a static schedule; nothing generates one. |

### Collections / field-ops half — **mostly built, key links broken**

| Step | Verdict | Evidence |
|------|---------|----------|
| **Login (officer + manager)** | **WORKS** | Drove FO-208/1234 on the emulator; backend logged `POST /auth/login 200`. Manager BM-001 logs into dashboard. JWT issued and stored. |
| **See due clients / tasks** | **WORKS** | Tasks tab showed 6 real clients incl. Kamala BK "21 days overdue — NPA risk". Data comes from `/tasks/today`. |
| **Client detail (balance, due)** | **WORKS** | `/clients/{id}` returns loan info, outstanding, due, schedule. Renders in Collect header. |
| **Record a collection** | **PARTIAL → effectively BROKEN on device** | Collect screen shows the right client (Maya Devi, due 5,200) and GPS is captured, but tapping **Record Collection** errors **"Client information missing. Please select a client from your task list."** Nothing persists. Backend `POST /collections` *does* work via direct call, so the break is the mobile client-context wiring. **Matches your own logged bug** ("Recorded Collection not being saved or reflected in History"). |
| **Collection → manager dashboard** | **BROKEN (timezone)** | Even a *successful* collection is stamped `collected_at` in **UTC** (`2026-07-11`) while the dashboard's "today" filter uses server-**local** `date.today()` (`2026-07-10`). They never match → dashboard shows **NPR 0** despite collections in the DB. Also `officer_id` persists as **NULL**, so "which officer collected" is unattributable. |
| **Digital receipt** | **PARTIAL** | Receipt screen + `receipt_id` generation exist; "Share Receipt" is a stub. Not re-verified end-to-end because the collection that feeds it fails first. |
| **Visit check-in (GPS)** | **WORKS (backend)** | `POST /visit-checkins` persists lat/lng/address. GPS captured on emulator. (Note: your logged bug — check-in succeeds even with location off — is a client-side gate, not verified this pass.) |
| **Promise-to-Pay** | **WORKS (backend)** | `POST /promise-to-pay` persists (requires `outstanding_amount`, `expected_payment_date`). |
| **End-of-Day** | **WORKS (backend)** | `POST /end-of-day` persists (requires `report_date`). Your logged "can't submit EOD" is likely the same client-context/validation family as collections. |
| **Sync queue** | **PARTIAL** | `POST /sync/events` accepts batches and returns results; offline queue exists in the app's SQLite. Not stress-tested for conflict/retry this pass. |
| **Manager dashboard** | **WORKS (with the today-filter caveat)** | Branch Overview, Staff Activity, Collections, Visits, PAR, PTP, EOD, Sync, Audit, Assign Task, Add Staff all render live backend data. KPIs are real; the "today" numbers are wrong due to the timezone bug above. |

### Security floor (your 5 non-negotiables) — **2 of 5 real**

| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| Real authentication | **PARTIAL** | Login issues real JWTs and **manager/pilot routes enforce them** (`require_manager_or_admin`; unauth → 401). But **every field-officer route is wide open.** |
| Role-based access | **PARTIAL** | RBAC exists and works for manager/admin routes; field routes have no role check because they have no auth check. |
| Hashed credentials | **WORKS** | `bcrypt` in `auth_service`. PINs are hashed, not stored plaintext. |
| Append-only audit log on sensitive actions | **PARTIAL/DECORATIVE** | An audit table + `/audit-events` exist and store rows, but **the collection endpoint writes no audit row**, and audit rows have `user_name = NULL` (no auth context). So the highest-value audit ("who approved/collected") is not actually captured server-side. |
| No secrets committed | **FAILS** | `fieldos-backend/.env` (with `JWT_SECRET_KEY`), `fieldos-app/.env`, `fieldos-dashboard/.env`, **and the binary `fieldos_nepal.db`** are all committed to git. See §5. |

**The headline security finding:** `POST /api/v1/collections`, `/visit-checkins`,
`/promise-to-pay`, `/end-of-day`, `/sync/events`, `/audit-events`, `/clients`, `/tasks` accept
requests with **no token at all**, and trust `officer_id` / `client_id` / `outstanding_after`
**from the request body**. Anyone on the network can forge a collection for any officer against
any client, or read any client's data. For "it's other people's money," this is the #1 fix.

---

## 3. AI, i18n, and the "16 phases / 237 files" claims

- **Data AI (priority queue, suggestions, EOD/branch summaries)** = **REAL** and rule-based
  (SQL over the DB). Legitimately useful, low-risk. Keep.
- **Voice notes** = typed text + LLM cleanup only. **No audio capture / speech-to-text.** The
  "voice" framing oversells it.
- **On-device LLM (Gemma via MediaPipe)** = only activates in a native dev build on a capable
  arm64 phone; **falls back to heuristics in Expo Go and on budget phones.** Fine, but it is a
  heavy dependency (`expo-llm-mediapipe`) that forces a custom dev-client and blocks Expo Go
  for anyone who wants the on-device path. See §6.
- **i18n EN/NE** = real, ~587 keys, full parity claimed. The login/home screens toggled
  cleanly. Your logged bug (newer AI screens don't toggle) is plausible and not re-verified.
- **Security / Pilot / CBS dashboard pages** = **DECORATIVE.** Threat model, pen-test
  checklist, compliance score (82/100), pilot overview are **static reference content**, not
  live measurements. They look like features; they are documents rendered as pages.
- **CBS integration** = works only over seed/imported data; **no live CBS** (intentional, per
  your own decision — correct for pilot).

---

## 4. Recommended re-cut of the golden path (my call, not an option list)

Build the golden path that is **~80% already built** and that **matches your survey's top
pains** (collection visibility, field verification, manager dashboard), not the loan-lifecycle
one that doesn't exist:

> **Manager assigns a task → field officer logs in → sees the due client → checks in at the
> visit (GPS) → records a collection → gets a digital receipt → the collection appears on the
> manager's dashboard, attributed to that officer, with an audit-log entry.**

Every box in that path already has a screen and an endpoint. The work is **fixing the broken
links, not building new features.** Loan origination (register/apply/approve/disburse/schedule)
is a **separate, larger product bet** — cut it from the pilot demo (justification in the plan).

---

## 5. Secrets & git hygiene (fix before any pilot)

Committed to the repo right now:

- `fieldos-backend/.env` — contains `JWT_SECRET_KEY=REDACTED_ROTATED_SECRET`.
- `fieldos-app/.env`, `fieldos-dashboard/.env`.
- `fieldos-backend/fieldos_nepal.db` — a binary SQLite DB, also the cause of the stale-schema
  500s in §1.

**Action:** add all `.env` and `*.db` to `.gitignore`, `git rm --cached` them, rotate the JWT
secret, and commit `.env.example` files instead. (This is a history-rewrite conversation too,
but at minimum stop tracking them now.)

---

## 6. Bitter-Lesson pass — what to DELETE, not add

The MVP serves **one** institution. Anything built for scale, flexibility, or "later" before
the pilot is proven is waste. Candidates for deletion/deferral:

| Thing | Why it's over-engineered for pre-pilot | Recommendation |
|-------|----------------------------------------|----------------|
| **`expo-llm-mediapipe` on-device LLM** | Forces a custom dev-client, blocks Expo Go, ~200MB model, 3-tier fallback logic — all to summarize a typed note. An API call or the existing heuristic does this. | **Rip out for pilot.** Keep the heuristic fallback only. Removes a whole build/deploy headache. |
| **91 backend endpoints / 15 routers** | Pilot needs ~15 endpoints. CBS (15), security (14), pilot (20), voice-ai (4) are mostly serving DECORATIVE dashboard pages. | **Don't delete the code, but stop maintaining/testing it.** Freeze everything off the golden path. |
| **Security/Pilot/Threat-model dashboard pages** | Static documents dressed as live features. They inflate the surface area and the "40+ views" claim. | Collapse into 1–2 honest "Reference" pages or a markdown doc. |
| **CBS read/reconcile/write-back (3 phases)** | Full write-back with idempotency keys before a single real CBS is connected. | Keep read-only stub; delete write-back path from pilot scope. |
| **Alembic + Postgres dual-mode config** | Migrations framework + Postgres/SQLite branching for a single-tenant SQLite pilot. | Fine to keep (cheap), but don't invest more until multi-branch. |
| **Multi-tenant / white-label SaaS ("like GHL")** | This is Phase 18 in your own roadmap and your own doc says *"do not build multi-tenant billing before pilot."* The golden path is currently broken. | **Do not start now.** Build one clean, brandable tenant; extract multi-tenancy only after one MFI runs the workflow for real. (Details in the plan.) |

---

## 7. Bottom line

- **Real and working:** backend core, manager auth/RBAC, dashboard, task assignment, visit
  check-in, PTP, EOD, data-AI, i18n, offline queue plumbing.
- **Built but broken (the golden path):** mobile record-collection (client context lost),
  collection→dashboard (timezone), officer attribution (null officer_id), server-side audit on
  collections (not written).
- **Missing entirely:** loan origination lifecycle (never scoped — recommend cutting).
- **Must-fix security:** field endpoints have no auth; secrets + DB committed to git.

The distance to a demoable pilot is **small and mostly repair work** — see the ranked blocker
list in the plan. It is *not* "build 5 more features."
