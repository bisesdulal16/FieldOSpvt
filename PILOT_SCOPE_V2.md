# FieldOS Pilot Scope v2 — Consolidation + Hierarchical Feedback

**Date:** 2026-07-23 · **Supersedes emphasis of** `PILOT_SCOPE.md` (does not delete it — see §0)
**Thesis shift:** from "1-branch field-officer adoption pilot" → "org-wide **consolidation super-app** whose **star feature is a hierarchical feedback loop**, with an AI calling agent designed-for but deferred to Phase 2."

---

## 0. How this relates to the existing scope

`PILOT_SCOPE.md` is still correct for the **field-officer money loop** (login → tasks → collect → visit → PTP → EOD → offline sync → dashboard). That loop is **built and works** (golden path closed on-device 2026-07-20). This v2 doc **wraps** that loop in two new ideas and re-prioritizes:

- **Consolidation:** position FieldOS as the single replacement for the many disconnected apps a Nepali MFI runs today (passbook, field-officer app, collection sheet, reminder tools, grievance/feedback, MIS dashboards).
- **Hierarchical feedback (THE STAR):** capture feedback against real tasks/tools, and roll it **up the org hierarchy** so field officer → monitoring → branch manager → central office each see and act on it at their level.

Pilot decisions locked (2026-07-23):
- **Build all three levels as thin slices** (officer / manager+monitoring / central) so the hierarchy is visible day one — not deep features.
- **CBS sync = TBD**, pending recon. Design a **swappable sync adapter**; nothing else depends on which mechanism wins.
- **AI calling agent = Phase 2.** Scope the data model to support it; build nothing callable for the pilot.
- **Feedback loop is the headline.** Consolidation is the context that makes feedback meaningful.

---

## 1. The consolidation map — what FieldOS replaces

The pitch is "everything they need in one place; kill the time-sinks." The fragmented stack in a typical Nepali MFI, and where each piece lands in FieldOS:

| Fragmented tool today | Primary user | FieldOS home | Pilot status |
|---|---|---|---|
| **Field-officer app** (collections/disbursement) | Field officer | Officer app — Tasks/Collect/Visit/PTP/EOD | ✅ Built |
| **Passbook** (member savings/loan book) | Member / officer | Member passbook view (read from CBS/import) | 🟡 Thin slice |
| **Collection sheet / day book** | Officer / branch | Auto-built from tasks + CBS due list | 🟡 Thin slice |
| **Reminder / SMS tool** | Central office | Reminders module (manual/SMS now; **AI voice = Phase 2**) | ⚪ Stub in pilot |
| **Grievance / feedback** (usually manual/paper) | All levels | **Hierarchical feedback (star)** | 🟢 Build for pilot |
| **MIS / reporting dashboards** | Branch mgr, central | Dashboard KPIs + rollup views | ✅ Partly built |
| **Attendance / GPS tracking** | Officer / monitoring | Start-Day face check + visit GPS | ✅ Built (bugs open) |
| **KYC / onboarding** | Officer | KYC capture on client | 🟡 Partial |

> **The "identify others" ask — now grounded in the real CBS (§5 recon).** Confirmed modules at Asha worth surfacing/absorbing beyond the core loop: **Coverage / Claims** (microinsurance — `Client → Coverage/Claims`, `D063/D083`), **Center-meeting scheduling** (the Collection Sheet is meeting-driven: "According to meeting"), **Wallet Service / Mobile Banking (MBNextgen)**, **CIB/CIR reporting** (loan carries `CIR Number MFI/Commercial`). Passbook maps exactly to CBS **Statements** (SN·Cr·Dr·Bal·Value-Date). Still ask officers which apps they open in a day — that list is the consolidation backlog, but the CBS module map is the confirmed superset.

---

## 2. The org hierarchy — the gap to close

**What exists in code today** (`app/models/user.py`, re-verified 2026-07-23):
`UserRole = field_officer · branch_manager · area_manager · admin` — **`admin` DOES exist** (`user.py:14`; used by `require_admin` in `auth_deps.py` and the RBAC matrix in `security.py`). A `branch_id` FK on users exists, but **no departments, no reporting line (`manager_id`), no cross-branch "monitoring" concept, and no OrgUnit table** (grep-confirmed absent). Schema ships via `Base.metadata.create_all` at startup (`main.py:58`) — Alembic files exist but are **not auto-run**, so `create_all` creates *new tables* but will **not** add columns to `users` or backfill data. New columns on existing tables therefore need an explicit migration step (see §8-A).

**The correction (2026-07-23): FieldOS is a MATRIX, not one reporting chain.**
The MFI is organized by **department** (function) crossed with **geography** (where you sit). Audit/Monitoring is a *separate department* that reads **across all branches** — it does not sit above the branch manager in a command chain. A `manager_id` self-FK alone cannot express "reads across the org but manages no one." So we model three independent axes:

```
GEOGRAPHIC (where you sit)              DEPARTMENT (what you do)
  HO                                      operations     (officers, branch mgrs)
   └─ Region                              audit          (monitoring — reads across)
       └─ Branch                          admin_it       (system, not financial data)
           └─ Center → Group → Member     head_office    (org-wide operational+strategic)

User = (org_node) × (department) × (data_scope) × (permission_set)
  department:      operations | audit | admin_it | head_office
  data_scope:      own | branch | region | org        (how far you see)
  permission_set:  read | write | flag | admin        (what you can do — composable)
  manager_id:      OPERATIONS chain ONLY (officer → branch_mgr → region)
```

Rule of thumb: **department = kind of work · data_scope = reach · permission_set = capability.** They're orthogonal — that's the whole reason a single role enum or a single reporting chain can't represent it.

**Model changes for the pilot (full matrix — decided 2026-07-23):**
1. Add `department` enum + `data_scope` + `permission_set` to `User` (or a thin `UserAccess` row).
2. Add `manager_id` self-FK — used **only** for the operations chain; audit/HO get scope-based access, not chain-based.
3. Add an `OrgUnit` table (`type: ho|region|branch|center`, `parent_id`) so `data_scope=region|org` resolves to a real subtree. (Existing `branch_id` stays; `OrgUnit` is what lets audit/HO query across branches.)
4. Backfill `department` for existing users from their current `role`: `field_officer`/`branch_manager` → `operations`; `area_manager` → `operations` w/ `data_scope=region`; **the existing `admin` role → `admin_it`** (default; a real HO user is then created as `head_office` separately). The `role` enum stays as-is (auth_deps/security depend on it); `department` is the new orthogonal axis layered on top, not a replacement.

---

## 2b. The four department views

Each department gets a view defined by its (scope × permissions). The "one screen that defines it" is the demo anchor for each.

| Dept | Sees (scope) | Can do | Defining screen |
|---|---|---|---|
| **Operations** (officer, branch mgr) | own / branch | read + **write** | Officer: the money loop (built). Branch mgr: branch KPIs + staff activity + EOD review |
| **Audit / Monitoring** | **org** (all branches) | read + **flag** + escalate | **Exception queue** — a ranked "these ~12 things look wrong this week", not a KPI dashboard |
| **Admin / IT** | org (system, **not** financial) | **admin** (users/devices/config) | User & device management, role/dept assignment, sync + system health |
| **Head Office** | **org** (operational + strategic) | read + write (policy) | Org rollup — portfolio/PAR by region→branch, **feedback aggregate**, launches feedback campaigns |

**✅ Validated against the real CBS (2026-07-23):** the department matrix isn't invented — Mfin Plus already has these as first-class modules: **Add-ons → Internal Audit**, **Add-ons → Monitoring (List/Evaluation)**, **Utilities → Role Delegation** (+ `G009 Staff Vs Role`), and a **Head-Office centralized-approval** tier. The departments you described are how Asha is actually structured. FieldOS's job is to make that cross-department view *consolidated and usable*, not to reinvent it.

> **Boundary — don't duplicate CBS staff evaluation.** CBS already runs **Staff Evaluation** (`M044/M120/M123`, Add-ons → Staff Evaluation w/ targets). FieldOS's monitoring/feedback layer should **complement** it (qualitative feedback, exceptions, time-sink signal) — not rebuild formal performance scoring. Pull evaluation context in read-only if useful; don't own it.

**Per-view notes (the "all four, briefly" cut):**
- **Operations** — already built; unchanged. Write-heavy field layer. Branch manager = operations dept scoped to one branch.
- **Audit / Monitoring** — the novel one. Cross-branch **read + flag**, never edits operational/financial data (enforced in permissions, not just hidden in UI). Its exception queue is powered by the **existing rule-based AI** (`/manager/ai/*`, `/manager/exceptions`). It's the natural consumer of the **audit logs** already captured, and it sees **all feedback** across branches — including identity-protected ones a branch manager can't trace (see anonymity Q in §7).
- **Admin / IT** — the plumbing dept: users, devices, roles/departments, config, deploy/sync health. Deliberately **walled off from financial data** — an IT admin must not read collections. This wall is itself part of the audit story (IT can't silently alter a loan).
- **Head Office** — strategic rollup + the **origin of feedback campaigns** ("ask every level a question"). Operational-and-strategic, drills region → branch. Where the org-wide feedback aggregate lands.

---

## 3. The star: hierarchical feedback loop

**Effectively greenfield for persistence.** A submit endpoint exists — `POST /api/v1/pilot/feedback` (pilot router) — but it writes to `_feedback_store`, a **module-level in-memory Python list** (`pilot.py:42`) that is wiped on every backend restart. So there is **no data to migrate**: build the `Feedback`/`FeedbackEvent` tables from zero and repoint the existing routes at them (keeps the URL stable for any app code already calling it). The UX shell (a submit route + a GET that returns responses + summary stats) is the part that's reusable. Design:

### Data model (new)
```
Feedback
  id, created_at, author_user_id, author_role
  branch_id                      -- denormalized for fast branch rollup
  subject_type                   -- 'tool' | 'task' | 'client' | 'process' | 'general'
  subject_ref                    -- e.g. which module/app/task the feedback is about
  category                       -- 'bug' | 'time-sink' | 'request' | 'praise' | 'blocker'
  severity                       -- 1..5
  body_text, body_ne             -- bilingual
  voice_note_ref                 -- optional (reuse existing voice-note path)
  status                         -- 'open' | 'ack' | 'in_review' | 'resolved' | 'wont_fix'
  visibility_scope               -- 'branch' | 'up_chain' | 'org'  (who can see it)

FeedbackEvent   (audit/rollup trail)
  feedback_id, at, actor_user_id, action, note
  -- actions: created, escalated, commented, status_change, routed_to(role)
```

### The rollup behavior (this is the product)
- **Field officer** submits feedback tied to a real thing ("the Collect screen takes too many taps", "this center's tasks are always stale"). One tap from where the friction happened.
- **Monitoring staff / branch manager** see all feedback in their branch, triage it, `ack`/comment/escalate. Escalation sets `visibility_scope = up_chain` and routes to the parent in `manager_id`.
- **Central office (admin)** sees an **aggregate view**: feedback volume by branch, by category (esp. "time-sink"), top requests, unresolved-by-age. This is the "collect feedback across positions, make it visible at every level" ask, made concrete.
- **Every level can both give and receive** feedback — the pilot must prove feedback flows *up* (officer→HO) and *down* (HO asks a question → branches answer).

### "Ask for feedback from multiple levels" (feedback campaigns)
Small but high-value: a **prompt/campaign** central office pushes down — "Which app wastes the most of your day this week?" — targeted at a role level, answered in-app, results aggregated by position. This is what turns FieldOS into a listening tool, not just a ticket box. **Recommend building a minimal version in the pilot** since it's the clearest demo of the thesis.

### Pilot cut (what to actually build week 1)
- [ ] `Feedback` + `FeedbackEvent` models + migration
- [ ] Submit feedback from officer app (tied to current screen/task; text + optional voice note)
- [ ] Branch view: list, triage, escalate (manager + monitoring)
- [ ] Central aggregate view: counts by branch/category/age
- [ ] One feedback **campaign** pushed HO→officers, answers aggregated
- [ ] Rollup query driven by `manager_id`

---

## 4. AI calling agent — Phase 2 (design-for, don't build)

Deferred by decision, but the pilot data model must not block it. Reserve the seams:

- **Data:** `Reminder` records already implied by tasks/PTP. Add `contact_channel` (`voice|sms|manual`) and `call_outcome` (`no_answer|promised|paid|refused|wrong_number`) fields now, populated manually in the pilot, so Phase 2 AI calls write to the same shape.
- **Phase 2 build (later):** telephony provider (probe Nepali coverage — Sparrow SMS / Twilio viability), Nepali **TTS** + **STT** (you already run **Whisper** on proxmox2 — reuse for STT), a call script/agent that reads due list → dials → delivers reminder in Nepali → logs `call_outcome` → creates a Feedback/followup if flagged.
- **Pilot stance:** reminders are **manual or SMS stub**; the "auto-call" is scoped, storyboarded, and shown as roadmap — not live.

---

## 5. CBS integration — RESOLVED by recon (2026-07-23)

**CBS = Mfin Plus 4.09.23** (vendor **Synergy Tech / syntechnepal.com**), a JSF/PrimeFaces web app at **Asha Laghubitta**. Scale: ~140k members, 170+ branches, 545 staff. Full structure map in the recon report (held separately).

**The decision: scheduled CSV/XLSX import via the existing `data_bridge.py`. No live API.**

- **No REST/developer API** in the operational UI. A formal DB/API integration is a **commercial conversation with Synergy Tech**, not an engineering task — track as a separate BD thread, not a pilot dependency.
- **Rich export surface exists:** every report exports `PDF/EXCEL/XLSX/HTML/CSV`; **Query Report** builds custom column sets. This feeds the **already-built** `POST /api/v1/data/import-clients` (CSV upsert) — we now know the real columns to map.
- **Real-time is off the table for the pilot** → **scheduled batch** (export report → import). Matches the manual-first posture.
- **Write-back path exists but is deferred:** the **Upload** (Cash Sheet / Payment Sheet) file-based batch import is the eventual reconciliation channel. Per the CLAUDE.md rule (read-only first, write-back much later), **out of pilot scope.**

**The universal join key (most important engineering fact):** CBS encodes the org tree directly in a `.`-delimited code —
```
branch.center.group.member[.product.serial]
  center = branch.center           (e.g. 99.999)
  member = branch.center.group.member   (e.g. 9999.999.99.9999)
  loan   = …member.PRODUCT.serial       (e.g. 9999.999.99.9.GL.9)
```
→ **Parse this to build the OrgUnit tree (§2) instead of hand-entering it.** FieldOS's hierarchy and CBS's hierarchy become the same tree. This is also the join key for every import (member/loan/saving/center all carry it).

**Which CBS reports feed which FieldOS surface:**

| FieldOS surface | CBS source report(s) | Format |
|---|---|---|
| Client/member list + KYC | `G003 Member`, Member/KYC screens | CSV/XLSX |
| Loan accounts + due list | `M010 Loan Detail`, `M012 Loan Statement`, `D029 Loan Detail` | CSV/XLSX |
| Repayment schedule (due date + amount) | Loan detail "PREVIEW SCHEDULE" table | per-loan |
| **PAR / overdue (days-past-due)** | `PAR Report` (aging-bucket dropdown), `M015 Aging`, `M016 Arrears` | CSV/XLSX |
| Passbook / statements | Saving `Statements` (SN·Cr·Dr·Bal·Value-Date) | per-account |
| Collection sheet / meetings | `D020/D021 Collection Sheet`, `D053 Center Meeting` | CSV/XLSX |
| Staff ↔ center/role mapping | `G008 Staffwise Center List`, `G009 Staff Vs Role` | CSV/XLSX |

**⚠ BS/AD calendar — now a hard requirement.** Every CBS date is **Bikram Sambat** (e.g. `2083/02/22`). The app standardizes on Asia/Kathmandu *time* but that's timezone, not *calendar*. **Import + reconciliation must convert BS↔AD or date joins silently fail.** Decide a BS↔AD library now (Python side, in `data_bridge.py`); CBS itself has a converter under Tools → Date-Converter for spot-checks.

For pilot week 1 the recommendation is unchanged: **import 10–15 real (anonymized) clients** via `data/import-clients` — do **not** block the pilot on live CBS sync. The recon just means the *real* import is now a column-mapping + BS-date task, not an unknown.

> The CBS recon prompt (for the Claude Chrome extension) is maintained separately — it extracts **structure + one masked sample row per screen**, never bulk PII. Its #8 (integration surface + CBS vendor/version) is the single answer that picks the adapter above.

---

## 6. Pilot phases

**Phase 0 — Recon & prep (now):**
CBS structure recon (Chrome ext) · confirm the consolidation list with 2–3 real officers · re-seed pilot DB (stale by Nepal-date).

**Phase 1 — Hierarchy + feedback (the star):**
`manager_id` + `monitoring` role · Feedback models + submit/triage/escalate · central aggregate · one campaign. Wrap around the **already-working** officer money loop.

**Phase 2 — Consolidation depth + AI calling:**
Passbook/collection-sheet views deepened · CBS adapter (per recon) · AI voice calling agent (telephony + Nepali TTS + Whisper STT).

---

## 8. Phase 1 build order (dependency-sorted — start here)

Priorities locked 2026-07-23: **Feedback → Consolidation → AI**. Feedback-first means the demo audience is HO/Monitoring, so the star must light up before consolidation depth. Build in this order — each step unblocks the next.

**A. Org model foundation (unblocks everything below)**
1. `OrgUnit` table (`type: ho|region|branch|center`, `parent_id`) + Alembic migration. Seed `ho → branch → center → group → member` (no region tier — §7).
2. Add `department` (`operations|audit|admin_it|head_office`) + `data_scope` (`own|branch|region|org`) + `permission_set` to `User` (or thin `UserAccess` row) + `manager_id` self-FK (operations chain only). Migrate existing users per §2.4.
3. Seed one `audit`, one `admin_it`, one `head_office` user for the demo (they don't exist today — §2.4).

**B. Feedback star (the headline — depends on A)**
4. `Feedback` + `FeedbackEvent` tables + migration (§3 model). Repoint `POST/GET /pilot/feedback` off the in-memory `_feedback_store` onto the tables — same URLs.
5. **Anonymity enforcement in the serializer** (§7): strip `author_user_id` from any branch-manager-scoped response; keep it for audit. Write a test that asserts a BM token never receives the author id.
6. Officer-app submit: feedback tied to current screen/task, text + optional voice note (reuse voice-note path).
7. Branch/Monitoring triage view: list, `ack`/comment/escalate; escalation sets `visibility_scope=up_chain`, routes via `manager_id`.
8. Central aggregate: counts by branch/category/age; "time-sink" cut highlighted.
9. One feedback **campaign**: HO pushes a targeted prompt down, answers aggregate by role. (Smallest thing that demos the thesis — build it.)

**C. Consolidation thin-slices (depends on A; parallel to B once A lands)**
10. Passbook read view ← CBS `Statements` import (SN·Cr·Dr·Bal·Value-Date).
11. Collection-sheet view auto-built from tasks + CBS due list.
12. Real import pass: map 10–15 anonymized pilot-branch clients through `POST /data/import-clients`, parsing the `.`-delimited join key (§5) into the OrgUnit tree. **Wire a BS↔AD library first** — every CBS date is Bikram Sambat (§5 ⚠).

**D. AI-call seams only (no live calling — §4)**
13. Add `contact_channel` + `call_outcome` fields to the reminder shape; populate manually in the pilot. Nothing dials.

**Critical path:** A1 → A2 → B4 → B5 → B6/B7 → B8 → B9. C and D hang off A but don't block the feedback demo. **Do not start C12 (real import) until the BS↔AD library is chosen** — it silently corrupts date joins otherwise.

> **A-status (2026-07-23): §8-A shipped (backend).** `OrgUnit` model + registration (A1); `Department`/`DataScope`/`PermissionSet` enums + `department`/`data_scope`/`permission_set`/`manager_id`/`org_unit_id` columns on `User`, Alembic `005` **and** an idempotent `migrate_org_matrix.py` for the live SQLite pilot DB — because the app boots via `create_all`, not Alembic (A2); seed builds HO(000)→branch(0042)→3 centers with `.`-delimited codes + seeds `MON-001` (audit), `IT-001` (admin_it), `HO-001` (head_office) and wires officers→BM via `manager_id` (A3). Migration + seed logic verified against scratch SQLite (create_all + async seed not run here — no SQLAlchemy in this env; run `python migrate_org_matrix.py` on the pilot DB and re-`seed_demo.py` for a fresh demo).
>
> **⚠ RBAC enforcement gap (partially closed in §8-B):** `IT-001`/`HO-001` use `role="admin"` (the only RBAC primitive that maps them into manager/admin route deps). But `require_admin`/`require_manager_or_admin` grant broad access, so **at the RBAC layer `admin_it` can currently read financial/collection routes** — contradicting §2b's "Admin/IT walled off from financial data." §8-B added the enforcement PRIMITIVE — `require_department(...)` in `auth_deps.py` — and the feedback routes use it. **Still TODO:** retrofit the financial routers (collections/clients/loans/manager) to `Depends(require_department("operations","audit","head_office"))` so `admin_it` is actually walled off. That retrofit is a §8-C follow-up, tracked here so the demo doesn't overclaim the wall.

> **§8-B shipped (backend, 2026-07-23) — the feedback star:**
> - **B4** `Feedback` + `FeedbackEvent` + `FeedbackCampaign` models (`app/models/feedback.py`, registered; Alembic `006`). All NEW tables → `create_all` builds them on boot, no runtime ALTER needed.
> - **B5** anonymity serializer (`app/services/feedback_access.py`) + `require_department` dep (`auth_deps.py`). **Invariant proven**: branch-manager view OMITS every author-identity key; audit/head_office see it. Committed test `tests/test_feedback_anonymity.py` (11 assertions) + verified by isolated logic run (no SQLAlchemy in this env).
> - **B6/B7** `app/routers/feedback.py`: `POST /feedback` (submit, any user, subject-tied), `GET /feedback` (dept-scoped + anonymity), `POST /feedback/{id}/ack|comment|escalate|status` (triage; escalate rides `manager_id` → up_chain, or org-wide when no ops parent — correct for HO→1-branch). Registered in `main.py`.
> - **B8** `GET /feedback/aggregate` (audit/HO only): counts by branch/category/age-bucket, unresolved-by-age, **time-sink highlighted**. Bucketing logic verified in isolation (8 assertions).
> - **B9** campaigns: `POST /feedback/campaigns` (HO only), `GET /feedback/campaigns` (role-targeted list), `GET /feedback/campaigns/{id}/results` (answers by role). Answers reuse `POST /feedback` with `campaign_id`.
>
> **§8-B dashboard UI shipped (2026-07-23):** `fieldos-dashboard/src/app/page.tsx` — three views wired into the sidebar under a new always-visible **"Feedback"** nav group (the star renders in pilot mode, not gated behind `!PILOT_MODE`):
> - **Feedback Inbox** (`feedback-inbox`) — triage list off `GET /feedback` with ack/comment/escalate/resolve via `apiMutation`; shows `Anonymous` when the server stripped the author (anonymity is enforced server-side, the UI just renders what it's given).
> - **Feedback Rollup** (`feedback-rollup`) — `GET /feedback/aggregate`: time-sink headline stat, by-category, unresolved-by-age, by-branch. A backend 403 renders a graceful "Head Office / Monitoring only" gate (`DeptGate`) instead of an error.
> - **Feedback Campaigns** (`feedback-campaigns`) — create (HO-only, 403→inline message), list role-targeted campaigns, inline results-by-role (`CampaignResults`).
> - Reuses existing `useManagerAPI`/`apiMutation`/`LoadingSkeleton`/`ErrorState`/`DashboardTable`/`Card`; added `Textarea` import. Symbol-resolution + brace-balance verified; **`tsc`/`next build` NOT run here (no node/node_modules in this env)** — run a dashboard build before demo.
>
> **§8-A + §8-B DEPLOYED & VERIFIED LIVE (2026-07-23):** the pilot runs dockerized (backend :8000, dashboard :3100, **Postgres** — not SQLite — on proxmox). Both images rebuilt from this branch and restarted; live pilot DB migrated.
> - **DB reality check:** the live DB is Postgres built entirely by `create_all` with **no `alembic_version`** — so alembic is NOT the migration path here (it would collide with existing tables). New tables (`org_units`, `feedback`, `feedback_events`, `feedback_campaigns`) auto-created by `create_all` on boot; the `users` columns were added by a new idempotent **`migrate_org_matrix_pg.sql`** (`ADD COLUMN IF NOT EXISTS` + role backfill). `pg_dump` snapshot taken first: `/root/fieldos_nepal-backup-20260723-040401.sql`.
> - **Verified live end-to-end** (curl, both direct-to-backend AND through the dashboard proxy the browser uses): submit → list returns `anonymous:true` with **zero author keys** for a branch-manager token; ack/escalate work (BM has no `manager_id` in this DB so escalate correctly routes org-wide); `/feedback/aggregate` returns **403** for operations dept (the `require_department` wall). Import-check inside the built image confirmed all A/B modules load + all 10 feedback routes register. Dashboard `next build` compiled clean; nav labels + `DeptGate` copy confirmed in the served bundle.
> - **Integration bug found & fixed by doing the real build:** the dashboard API proxy (`src/app/api/fieldos/[...path]/route.ts`) auto-prepends `manager/` to any path not in a `knownModules` allowlist — so `/feedback` 404'd through the browser path. Added `feedback` to both allowlists. (This only surfaced via the proxy, not direct-to-backend — the reason "complete the build" mattered.)
>
> **Demo accounts seeded on live DB (2026-07-23):** `seed_demo_dept_users.py` (run via `docker exec fieldos-backend python seed_demo_dept_users.py`, idempotent) created an HO org node (code 000) + two org-wide logins, **PIN 1234**: `HO-DEMO` (head_office) and `MON-DEMO` (audit/monitoring). These unlock the department-gated Rollup/Campaigns views — the live pilot DB otherwise had only field/branch users, so those views 403'd for everyone. **Full loop verified live across all four roles:** BM→403+author-stripped, MON→sees author, HO→aggregate 200 + own campaign + results, FO answers campaign → HO sees `field_officer: 1`.
>
> **Two more bugs found & fixed by the real run (isolation tests missed both):** (1) `feedback.py` used `datetime.fromisoformat` in the aggregate but never imported `datetime` → 500 (my isolated test defined its own `datetime`). (2) `GET /feedback/campaigns` filtered strictly by target role, so the HO *creator* couldn't see their own campaign → added `or created_by_user_id == me` + a `created_by_me` flag. Both fixed, rebuilt, re-verified.
>
> **§8-B mobile submit screen SHIPPED + typechecked (2026-07-23) — the officer's way IN, loop now closed:**
> - `fieldos-app/services/feedbackService.ts` — `submitFeedback` (POST /feedback) + `fetchOpenCampaigns` (GET /feedback/campaigns); direct fetch w/ token, graceful failure (no offline DB — feedback isn't a money path). Barrel-exported in `services/index.ts`.
> - `fieldos-app/app/give-feedback.tsx` — category chips (time_sink/bug/request/blocker/praise), 1–5 severity (hidden for praise), body text, optional **campaign banner** (answers tagged with `campaign_id`), success state. Leads with the anonymity promise (`fbAnonymousNote`: "Your branch manager won't see your name") so officers trust it. Matches the PTP screen idiom exactly (AppHeader/PrimaryButton/StatusChip/useTranslation/constants).
> - 23 i18n keys added to **both** en.ts + ne.ts (balanced). Entry point: the profile "Support" section's previously-dead "Report App Issue" row (was `alert('coming soon')`) now navigates to `/give-feedback`.
> - **Verified: full `tsc --noEmit` on the mobile app = 0 errors** (the app has node_modules; ran via `docker run node:20`). And the **exact request body the service sends works live** (FO-208 submit → 200; officer sees the open campaign; HO rollup reflects the new time-sink). Officer→HO loop closed end-to-end.
>
> **B is functionally COMPLETE** (backend + dashboard + mobile, all live-verified). Remaining polish: automated `pytest` run of the committed `tests/test_feedback_anonymity.py`; a fresh **EAS build** to get the new screen onto officers' devices (code is in the repo, not yet in an APK). Live DB holds a few demo feedback + 1 campaign from verification (left in deliberately so the Inbox demos populated).
>
> **§8-C SHIPPED + verified live (2026-07-23) — the financial-data wall:** `admin_it` is now genuinely blocked from financial/client-PII routes, in permissions not just UI (§2b).
> - `require_financial_access = require_department('operations','audit','head_office')` added to `auth_deps.py` (everyone EXCEPT admin_it; older users default to operations so it's safe).
> - Attached as a **router-level dependency** on: collections, clients, loans, manager, cbs, data_bridge, tasks, visit, promise, eod, meetings. `bootstrap.py` (custom inline auth, not a Depends) got an inline `department=='admin_it' → 403` check.
> - **Verified:** a temp `IT-DEMO` (admin_it) account got **403** on clients/tasks/manager/cbs/data/bootstrap; FO/BM/MON-DEMO/HO-DEMO all still **200**; officer golden path intact (bootstrap/tasks/clients 200, visit POST reaches handler validation = 422 not 403). Temp account deleted after; HO-DEMO/MON-DEMO remain.
>
> **§8-A / §8-B / §8-C all deployed & live-verified on the pilot.** Remaining polish (non-blocking): fresh **EAS build** to push the mobile feedback screen to devices; automated `pytest` run of `tests/test_feedback_anonymity.py`; add a `require_financial_access` test to the committed suite (live-curl covered it manually).

**Explicitly NOT in Phase 1:** live AI calling, CBS write-back (Upload/Cash-Sheet), multi-tenant layer (parked per CLAUDE.md), the 5 device-test bugs *except* face false-accept — track those, don't block the feedback plumbing on them. Face false-accept is an auth-bypass; fix before *wider* rollout, not before this demo.

---

## 7. Open questions / risks

- **Monitoring vs branch-manager** — RESOLVED (2026-07-23): distinct **departments**, not one role. Audit/Monitoring reads across all branches; branch manager writes within one. Modeled as the matrix in §2.
- **Feedback anonymity** — RESOLVED (2026-07-23): **anonymous to the branch manager, attributed to Audit/Monitoring.** BM sees the body + branch + category but NOT `author_user_id`; Audit dept sees identity (integrity/abuse control). Enforce in the API serializer per requesting department — never send `author_user_id` to a branch-manager-scoped response. This is the reason feedback-first has value: officers can flag their own manager's process honestly. (Author-chooses-per-item is a Phase-2 nicety, not pilot.)
- **Region tier for the pilot** — RESOLVED (2026-07-23): **HO → 1 branch for the pilot.** OrgUnit supports `region` in the schema (so the tree grammar from §5 parses cleanly later), but the pilot seeds only `ho → branch → center → group → member`. `area_manager` users get `data_scope=region` in the model but there's one branch under them for the demo. Don't seed a region level you won't populate.
- **Pilot site = Asha Laghubitta** (confirmed via CBS access). Get **written sign-off** for CBS report-export use + which single branch is the pilot. CBS holds 140k members' PII — the FieldOS pilot must only ever import the pilot branch's clients.
- **BS↔AD calendar library** — pick one (Python) before the real import is wired; every CBS date is Bikram Sambat.
- **Synergy Tech (vendor) contact** — decide whether to open a formal API/DB-integration conversation in parallel (removes the CSV-export dependency long-term). BD thread, not a build task.
- **The 5 open device-test bugs** (offline lockout, face false-accept, GPS-gate, search, i18n) — face false-accept is an auth-bypass and should be fixed before wider rollout, but is **lower priority than feedback plumbing for THIS pilot**. Track, don't block.
- **Which real MFI/branch is the pilot site**, and is CBS access sanctioned in writing? (PII + regulatory.)
