# Handoff — Multi-Branch Asha Pilot (2026-07-27)

> **SUPERSEDED IN PART (later same day):** P2 (Asha branding, commit `08e66ddc`) and P3
> (Client/PTP/EOD branch scoping, commit `ac1bb69e`) — listed as remaining in §3/§4 below — have
> since SHIPPED. Remaining work + the CI fix now live in `HANDOFF_QWEN_2026-07-27.md`. Trust
> `git log` + that file over §3/§4 here. The decisions (§1) and architecture (§2) still hold.

> Session handoff so this can be picked up in Hermes. Covers what was decided, what
> shipped, how it was verified, and the exact follow-ups left before the pilot.
> When this doc and older docs disagree, this doc + `git log` win.

---

## 0. TL;DR

Goal: get FieldOS ready for a **multi-branch pilot at Asha Laghubitta**, branded for Asha.

Three asks in scope:
1. **Face-match** — already fixed (crop fix landed ~0.8 impostor/genuine gap). ✅ done, no action.
2. **Brand for Asha** — ⏳ NOT started (backend plumbing exists; clients hardcode "FieldOS").
3. **Multi-branch pilot** — 🟡 core branch-scoping done + tested; DB/seed/follow-ups remain.

This session delivered the **money-risk item**: branch query-scoping so Branch A can't
read Branch B's money/activity. 3 commits, clean tree on `main`, full test suite green
(37 passed).

---

## 1. Decisions locked this session (don't re-litigate)

| Decision | Choice | Why |
|---|---|---|
| Pilot database | **Postgres** (not SQLite) | SQLite serializes writes; multi-branch concurrent sync will lock. CLAUDE.md says the Postgres path is verified. |
| Branch-scoping model | **Denormalize `branch_id`** onto collections/visits/tasks (Option B), stamped at write, backfilled | Consistent with day_start/audit/feedback; money stays with the branch it happened at; fast filters; correct for financial audit. |
| Admin vs manager scope | **Admin/HO = all branches; branch manager = own branch only** | Matches how a real MFI head office works. |
| Task branch | **Assignee officer's branch** (where work happens), not the assigning manager's | Handles an area manager assigning across branches. |
| Face-match | **Done** — treat as a real control, not beta | Crop fix gave ~0.8 separation; user confirmed. |
| Multi-tenant | **Still PARKED** (CLAUDE.md hard-rule #5) | This is multi-*branch* (one institution), which that rule allows. The danger it warns about — a missing query-scope leaking money across branches — is exactly what this session closed. |

---

## 2. What shipped — 3 commits on `main`

```
b8526ce0 feat(branch-scoping): scope manager read endpoints + isolation tests
612defc2 feat(branch-scoping): stamp branch_id on money/activity writes + scope helper
4e8d37de feat(face): first-enrollment selfie becomes officer profile picture
```
(parent: `f32d229d`, the consolidation-feedback-pilot merge)

Tree is clean. Nothing pushed unless you pushed it — check `git status` / `git log origin/main`.

### 2a. `4e8d37de` — face-photo → profile picture
Was uncommitted in the tree at session start; committed as its own unit so it's independently
revertible. First face enrollment captures a best-effort JPEG (`takeSnapshot`) → stored as the
officer's profile picture. First-enroll-wins (re-enroll never overwrites). Snapshot failure never
blocks enrollment.
- Migration `007_add_face_photo.py` (adds `users.face_photo`, data URI for pilot)
- `face.py` enroll sets it once; `face/status` returns it
- App: `FaceScanner.tsx` (snapshot), `faceVerifyService.ts` (`getFaceStatus`), `profile.tsx` (renders photo, falls back to initials)

### 2b. `612defc2` — branch-scoping foundation (WRITE side)
- **Models**: `branch_id` (nullable FK → branches.id, indexed) added to `Collection`,
  `VisitCheckin`, `TaskAssignment`.
- **Migration `008_add_branch_scoping.py`**: adds the 3 columns + indexes, **backfills** each
  row's branch from the recording officer (`officer_id`/`user_id` → `users.branch_id`).
  Correlated UPDATE, works on **SQLite and Postgres**.
- **Enforcement helper** in `app/deps/auth_deps.py` — the ONE place (CLAUDE.md hard-rule #5):
  - `scope_to_branch(query, model, user)` — admin → unchanged; manager → `model.branch_id == user.branch_id`; **manager with no branch → `branch_id == -1` (fail-closed, sees nothing, never all)**.
  - `can_see_all_branches(user)` — currently `role == admin`. `_CROSS_BRANCH_ROLES` is the one list to edit if area_manager should also see all.
- **All 6 write paths stamp branch_id**:
  - `collections.py` (direct POST) → `current_user.branch_id`
  - `visit.py` (direct POST) → `current_user.branch_id`
  - `manager.py` create_task → **assignee's** branch (falls back to manager's if unassigned)
  - `sync_service.py` ×3 (offline collection/visit/task) → resolved from the trusted officer; task uses the **assignee's** branch
  - (day_start already stamped `branch_id` before this session)

### 2c. `b8526ce0` — read-side scoping + isolation tests
Every `/manager/*` endpoint reading a branch-dimensioned table is now scoped.

**Scoped:** dashboard, staff, visits, collections, exceptions (high-value collections part),
pilot-metrics, cash-reconciliation, anomalies, staff-locations, day-starts, tasks/today,
officer-activity (cross-branch **404 guard** so a manager can't pull another branch's officer by id).

**Tests** `fieldos-backend/tests/test_branch_isolation.py` (5, all pass):
1. Branch-A manager sees only A's collections, zero of B's (and mirror for B)
2. Admin sees the consolidated total (both branches)
3. Manager with no branch → sees nothing (fail-closed)
4. Dashboard KPIs per-branch for manager, consolidated for admin
5. officer-activity cross-branch guard returns 404 for a manager, 200 for admin

---

## 3. KNOWN GAP — endpoints NOT branch-scoped yet ⚠️

These read tables that **have no `branch_id`** (migration 008 only covered collections/visits/tasks).
Each is flagged in its own docstring in `manager.py`. **A branch manager currently sees org-wide
data on these**:

| Endpoint | Driven by table | 
|---|---|
| `par-followup` | Client |
| `ptp-today` | PromiseToPay |
| `eod-reviews` | EndOfDayReport |
| `receipts` | SmsNotification |
| `clients` | Client |
| `sync-status`, `sync-events` | SyncEvent |

**Follow-up to close them:** a migration `009` adding `branch_id` to `clients`, `promise_to_pay`,
`end_of_day_reports` (+ backfill from officer/center), stamp on write, then `scope_to_branch` those
endpoints. **Decide before go-live** whether a branch manager seeing another branch's overdue
clients / EOD submissions is acceptable for the pilot. If not, this is required, not optional.

---

## 4. Follow-ups remaining for the pilot (priority order)

### P1 — Postgres migration run + multi-branch seed  (pilot DB decision)
- Set `DB_TYPE=postgres` + `DATABASE_URL=postgresql+asyncpg://...?ssl=require` (see DEPLOY.md; Neon).
- `alembic upgrade head` → must run through **008** cleanly on Postgres (008 backfill is Postgres-safe but has only been executed on SQLite in tests — RUN IT on PG and confirm).
- Write/adjust a **multi-branch Asha seed**: ≥2 real Asha branches, each with its own officers +
  branch manager + `office_ip`, plus one admin/HO user with `branch_id = NULL`.
- Smoke-test: log in as each branch manager, confirm scoped dashboards; log in as admin, confirm consolidated.

### P2 — Asha branding pass  (ask #2, not started)
- Backend plumbing EXISTS: `app/config.py` `ORG_*` vars + `GET /api/v1/branding`; SMS receipts already use `ORG_NAME`. Just set env: `ORG_NAME`, `ORG_NAME_NE`, `ORG_TAGLINE`, `ORG_PRODUCT_SUFFIX`, colors, `ORG_LOGO_URL`.
- **~288 hardcoded "FieldOS" literals** in `fieldos-app/` + `fieldos-dashboard/src/` must be routed to the branding endpoint / i18n. (grep: `grep -rniE "FieldOS" fieldos-app/app fieldos-app/components fieldos-app/i18n fieldos-dashboard/src`)
- App display name + icon for the Asha APK (app.json / EAS); dashboard login + sidebar logo/colors.

### P3 — Client/PTP/EOD branch scoping  (§3 above) — decide if pilot needs it.

### P4 — Pre-pilot gate (from PILOT_DEVICE_TEST_2026-07-20.md, mostly since fixed)
- Fresh **on-device re-test** of the golden path on the multi-branch build (last honest device test was 2026-07-20, 10/16; fixes have landed since but no re-test doc).
- Git-history secret scrub (CLAUDE.md notes secrets were historically tracked; current tree is clean).

---

## 5. How to run / verify (from `fieldos-backend/`)

```bash
# tests (isolated /tmp/fieldos_test.db; does not touch dev data)
pip install -r requirements-dev.txt
python -m pytest tests/test_branch_isolation.py -q      # the 5 branch-isolation tests
python -m pytest tests/ -q                               # full suite (expect 37 passed)
```

Branch-scoping is enforced in ONE place — `app/deps/auth_deps.py::scope_to_branch`. To add scoping
to a new endpoint: add `current_user: User = Depends(get_current_user)` to the signature, then wrap
each `select(...)` over Collection/VisitCheckin/TaskAssignment/DayStartRecord with
`scope_to_branch(q, Model, current_user)`. For officer-list endpoints, filter the `User` list by
`current_user.branch_id` (guarded by `can_see_all_branches`).

---

## 6. Competitive context (why the pilot is positioned this way)

From the B4 Tech competitor review (`~/Documents/projects/clients/B4 Tech`, read-only, outside repo):
- Incumbents: **Synergy MFin Plus** (CBS, the incumbent at Asha), **Uranus** (cloud CBS), **MoFin** (member-facing mobile banking, on a signed tripartite SLA with Synergy + Asha).
- Gap FieldOS fills: nobody owns the **field officer's workflow + the cash-collection fraud control** (GPS-verified visit + un-skippable server-side SMS receipt + audit). Do NOT try to be a CBS — sit beside it (CSV bridge is read-first, never writes to CBS).
- The MoFin↔Synergy SLA is confidential (real PANs/people, dated 2026); keep competitor pricing/"exclusive features" internal.
```
```
