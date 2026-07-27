# Handoff → qwen3.6 (desktop) — 2026-07-27

Branch: `scope/multibranch-pilot` (open PR to `main`, CI **red**).
Context: multi-branch Asha pilot. Branding (P2) + Client/PTP/EOD scoping (P3) already shipped
this session. This handoff is the **remaining verification + config work**, in priority order.

---

## TASK 1 — Land the CI fix (START HERE, unblocks the PR)

**Status:** fix already applied to the working tree, **not committed, not yet test-verified.**

Root cause: `fieldos-backend/tests/conftest.py` `seeded_db` fixture had two stacked bugs that
error-out all 45 tests at setup (CI shows `NameError: name 'fo' is not defined`):

1. field-officer `User` was inlined in `add_all([...])`, never bound → `fo.id` undefined.
2. the `TaskAssignment` seed used `task_id=` and `due_date=` — **neither is a column** on the
   model (`app/models/task.py`); the date column is `task_date`.

The applied fix (already in the tree): bind `fo`, `await s.flush()`, and build the task with
`user_id / client_id / branch_id / task_date=today_nepal_str() / task_type / status`.

**What qwen must do:**
```bash
cd fieldos-backend
rm -f /tmp/fieldos_test.db*        # a stale local test DB masks the real result — MUST delete first
python -m pytest -q                 # expect: all pass (was 37; +branch-isolation additions)
```
- If green → commit conftest.py alone: `fix(ci): bind fo user + correct TaskAssignment seed columns`
  (end with the Co-Authored-By line), push, confirm the PR CI goes green.
- If still failing → read the FIRST real traceback (`pytest -x tests/test_money_paths.py::test_login_returns_token`),
  it will name the next bad column/kwarg. The branch-scoping commits added `branch_id` to several
  models + new isolation tests, so any surviving seed/schema drift will surface there.

---

## TASK 2 — Set the actual Asha branding values (config, not code)

**Status:** branding *code* is done (commit `08e66ddc` — all display strings now read the branding
endpoint / store). But the `ORG_*` env values still default to **"FieldOS"** — nothing is actually
branded Asha yet. `fieldos-backend/app/config.py:36-42` + `.env.example:13`.

**What qwen must do:**
1. Backend `.env` (pilot/prod): set
   ```
   ORG_NAME=Asha Laghubitta Bittiya Sanstha       # confirm exact legal/display name with Bishesh
   ORG_NAME_NE=<Devanagari name>                   # ask Bishesh for the official Nepali form
   ORG_TAGLINE=<Asha tagline or branch line>
   ORG_PRODUCT_SUFFIX=Branch Manager Dashboard
   ORG_LOGO_URL=<hosted Asha logo URL>             # needs an asset — see step 3
   ORG_PRIMARY_COLOR / ORG_* colors               # if Asha has brand colors; else keep navy/orange
   ```
2. Verify `GET /api/v1/branding` returns Asha, then eyeball dashboard login + sidebar and mobile
   login — they consume that endpoint, so no code change needed.
3. Mobile APK identity (this is the only branding gap that needs an asset, not just env):
   - `fieldos-app/app.json` → `expo.name` / `expo.slug` / icon + splash → Asha.
   - `fieldos-app/eas.json` → set the Asha `EXPO_PUBLIC_*` / `ORG_*` env for the build profile.
   - Needs an **Asha logo/icon file** from Bishesh (get PNG ≥1024²). Flag if missing.
4. Leave internal identifiers ALONE: `useFieldOSStore`, `components/fieldos/*`, `fieldos_token`
   localStorage keys, CSS class names, the model download URL. (~238 "FieldOS" grep hits are these
   — renaming them is pure churn/breakage, not branding.) Only real user-facing string still
   hardcoded is the support email `support@fieldos.np` in `fieldos-app/i18n/en.ts:656` — swap to
   Asha's support contact if Bishesh has one.

---

## TASK 3 — Run migrations 008 + 009 on real Postgres, then seed multi-branch (P1)

**Status:** migrations exist and are Postgres-safe by construction (correlated UPDATE backfills),
but have **only been executed on SQLite** (in tests). Postgres run is the real gate.

**OWNED BY CLAUDE (homelab) — qwen: do NOT touch this one.** The pilot Postgres lives in the
Proxmox homelab, so Claude runs it there directly (stand up a fresh PG container, `alembic upgrade
head` through 008+009 on an empty schema, write the multi-branch Asha seed: ≥2 branches each with
officers + branch manager + `office_ip`, plus one admin/HO user with `branch_id = NULL`, then the
per-branch isolation smoke test). Decision: fresh PG + fresh seed; the existing SQLite pilot is
treated as done (no data carryover). qwen picks up the resulting `DATABASE_URL` for Task 4's build.

---

## TASK 4 — On-device golden-path re-test on the multi-branch build (P4)

**Status:** last honest device test was 2026-07-20 (10/16). Many fixes have landed since (face,
money plumbing, day-start, branch-scoping) with **no re-test doc**.

**What qwen must set up / Bishesh runs on device:**
- EAS build of `scope/multibranch-pilot` with the Asha env from Task 2.
- Golden path: manager assigns → officer FO-208/1234 logs in → sees due client → GPS visit
  check-in → record collection → digital receipt → shows on manager dashboard attributed to the
  officer + audit entry.
- Multi-branch check: a Branch-A manager must NOT see Branch-B collections/PTP/EOD/clients.
- Re-seed / roll FO-208 tasks to the current Nepal date first (tasks gate on `task_date == today`).
- Face gate: enroll A → start day as A (PASS) → as B (must REJECT). Read logcat
  `[faceVerify] cosine=… → PASS/FAIL`.
- Record results in a dated `PILOT_DEVICE_TEST_2026-07-27.md`.

---

## Reference

- Branch-scoping is enforced in ONE place: `app/deps/auth_deps.py::scope_to_branch`
  (admin → all; manager → own branch; manager w/ no branch → fail-closed sees nothing).
- Test creds: FO-208 / 1234 (officer), BM-001 / 1234 (manager). Run steps in root `CLAUDE.md`.
- The stale doc `HANDOFF_MULTIBRANCH_PILOT_2026-07-27.md` predates the P2/P3 commits — trust
  `git log` + this file over it.
