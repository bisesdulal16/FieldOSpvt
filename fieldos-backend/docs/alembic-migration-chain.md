# Alembic Migration Chain

## Purpose

FieldOS must be able to build a brand-new PostgreSQL schema from an actually empty database using only Alembic:

```bash
cd fieldos-backend
./venv/bin/alembic upgrade head
```

This document records the historical clean-install repair for the migration chain through `014_sms_policy_controls`.

## Original failure

A clean disposable PostgreSQL database failed at revision:

```text
004_add_face_verification.py
```

Failure:

```text
relation "day_start_records" does not exist
ALTER TABLE day_start_records ADD COLUMN face_verified BOOLEAN
```

The reproduction used a throwaway PostgreSQL container/database with:

- no `alembic_version` table
- no application tables
- no copied live schema
- no Alembic stamp
- no production data

## Root cause

Revision `004_add_face_verification` added face-verification columns to `day_start_records`, but no earlier Alembic revision created that table.

The table existed historically because the FastAPI startup path used `Base.metadata.create_all`, so already-running/dev databases could have `day_start_records` before migration `004` ran. A clean Alembic-only install did not have that app-created table, making the historical chain nondeterministic.

The audit also found older app-managed tables/columns that existed in SQLAlchemy models but were missing from the Alembic clean-install path, plus early migrations that used PostgreSQL enums/date/numeric types where current ORM models write strings/floats.

## Repair approach

Smallest safe correction applied:

1. `004_add_face_verification` now creates `day_start_records` with the current intended day-start schema when the table is absent, then includes the face-verification fields.
2. If `day_start_records` already exists, `004` only adds missing face columns. This preserves historical behavior for databases that had the app-created table before running `004`.
3. `001_initial` now includes app-managed pilot tables and current-compatible columns that were historically created by `Base.metadata.create_all` but omitted from Alembic.
4. `001_initial` uses current-compatible primitive column types for early string/float/date-as-string models instead of PostgreSQL enums/date/numeric types where the ORM writes strings/floats.
5. Revision IDs and `down_revision` relationships were not changed.

## Existing databases are unaffected

Existing deployed databases that are already past revisions `001` or `004` do not rerun those historical `upgrade()` functions. The edits repair deterministic clean installs only.

The `004` downgrade is guarded:

- if `004` created `day_start_records` for a clean install, downgrade removes that table at the matching point
- if the table pre-existed historically, downgrade removes only the face-verification columns

No live data is altered by this repair unless an operator deliberately runs historical downgrades on a disposable or non-production database.

## Clean-install validation

Validated on disposable PostgreSQL:

```bash
cd fieldos-backend
DB_TYPE=postgres \
DATABASE_URL=postgresql+asyncpg://.../empty_disposable_db \
./venv/bin/alembic upgrade head
```

Result:

```text
alembic_version=014_sms_policy_controls
```

Confirmed policy tables exist:

- `sms_consent_evidence`
- `sms_suppression_records`
- `sms_approved_templates`
- `sms_quota_reservations`

Schema smoke checks inspect tables, foreign keys, indexes, constraints, column types, defaults, and key nullability.

## Existing-013 upgrade validation

Validated the deployment-safe checkpoint path separately on disposable PostgreSQL:

```text
013_comm_broker -> 014_sms_policy_controls
014_sms_policy_controls -> 013_comm_broker
013_comm_broker -> 014_sms_policy_controls
```

This confirms the repair does not break databases that were already at revision `013_comm_broker` before the SMS policy migration.

## Schema parity validation

Compared two disposable databases:

- Database A: empty database upgraded through the full chain to `head`
- Database B: upgraded to `013_comm_broker`, then upgraded to `014_sms_policy_controls`

Result:

```text
schema_parity_a_vs_013_to_014=passed
```

No meaningful table, column, constraint, index, type, or default differences were found.

## ORM/application smoke validation

Against a fresh full-chain PostgreSQL database, validation imported all SQLAlchemy models and performed synthetic read/write smoke operations for:

- users/roles
- day-start records
- client communications
- communication outbox
- consent evidence
- suppression records
- approved templates
- quota reservations

No production data, provider credentials, live recipients, or real SMS providers were used.

## Downgrade behavior

Disposable downgrade validation passed for:

```text
head -> 013_comm_broker
013_comm_broker -> head
head -> base
base -> head
```

Historical full downgrades are destructive by design because they remove application tables. They are validated only in disposable databases and should not be used as a production rollback mechanism without a separate backup/restore plan.

## Automated regression validation

CI includes a PostgreSQL service-backed test:

```bash
cd fieldos-backend
RUN_ALEMBIC_POSTGRES_CHAIN=1 \
MIGRATION_TEST_DATABASE_URL=postgresql://fieldos:fieldos_test_password@127.0.0.1:5432/fieldos_admin \
pytest -q tests/test_alembic_clean_install_chain.py
```

The test creates a unique disposable database, runs:

```text
alembic upgrade head
alembic downgrade 013_comm_broker
alembic upgrade head
```

Then verifies:

- final Alembic head is `014_sms_policy_controls`
- `day_start_records` exists
- all four SMS policy tables exist
- foreign keys and indexes are present

The test refuses non-local PostgreSQL targets outside CI and only drops databases with the `fieldos_migration_test_` prefix.

## Remaining limitations

- This repair does not deploy, rebuild, or modify live PostgreSQL.
- It does not apply migration `014` live.
- It does not enable Sparrow, provider credentials, workers, n8n, Redis replay, reminders, or real SMS.
- Historical downgrades remain destructive and are suitable only for disposable validation unless separately planned.
- Future model changes must be represented in Alembic instead of relying on `Base.metadata.create_all` to mutate application databases.


## Revision 015 schema parity alignment

After the clean-install repair, a PostgreSQL `base -> head` database was compared against imported SQLAlchemy `Base.metadata`. The audit found no missing tables or columns, but did find type, nullability, FK, unique/index, and narrow DB-check differences. Revision `015_schema_parity_alignment` resolves the meaningful drift without rewriting the historical repair commit.

### Source-of-truth policy

- Alembic is the schema authority for PostgreSQL deployments.
- SQLAlchemy ORM metadata is the current application contract for model shape, type, length, nullability, FKs, uniqueness, and indexes unless a stronger database-only integrity check is documented below.
- Runtime startup must not call `Base.metadata.create_all` to create or hide missing production tables. Backend startup now verifies that PostgreSQL is at the expected Alembic head and fails with a sanitized error if the database is absent, unstamped, or behind.
- SQLite/test fixtures and seed scripts may still use `create_all` for isolated disposable schemas only.

### Complete parity findings and decisions

| Area | Finding | Decision | Correction |
|---|---|---|---|
| Tables | No missing ORM tables; no unexpected DB tables after importing all model modules. | ORM and PostgreSQL already aligned. | None. |
| Columns | No missing ORM columns; no unexpected DB columns. | ORM and PostgreSQL already aligned. | None. |
| Timestamp columns | 28 historical `created_at`/`updated_at` columns were `TIMESTAMP WITH TIME ZONE` in PostgreSQL while ORM uses naive `DateTime`. Application writes Python `datetime.utcnow()` values and tests/fixtures treat these as naive audit timestamps. | **B: PostgreSQL should match ORM.** | `015` converts these columns to `TIMESTAMP WITHOUT TIME ZONE` using `AT TIME ZONE 'UTC'`. |
| ISO timestamp string fields | `collections.collected_at`, `devices.last_sync_at`, `sync_events.synced_at`, `task_assignments.completed_at`, `visit_checkins.checked_in_at`, `visit_checkins.synced_at` were PostgreSQL timestamps while ORM/API/mobile sync treat them as bounded ISO strings. | **B: PostgreSQL should match ORM.** | `015` converts to `VARCHAR(30)` using `::text`. |
| JSON/text payload fields | `sync_events.payload_json` and `end_of_day_reports.exceptions_json` were `JSONB` while services store JSON-encoded strings and model helpers call `json.loads`/`json.dumps`. | **B: PostgreSQL should match ORM.** | `015` converts `JSONB -> TEXT` using `::text`; downgrade uses `::jsonb` and will abort invalid JSON. |
| Role length | `users.role` was `VARCHAR(20)` while ORM declares `String(50)`. Current enum values fit 20, but the model is the application contract. | **B: PostgreSQL should match ORM.** | `015` widens to `VARCHAR(50)`. |
| Nullability too loose | Several ORM non-null timestamp columns were nullable in PostgreSQL: announcements, collection events, day-start, feedback, loan schedule, org units, SMS notifications. Application supplies Python defaults but DB permitted nulls. | **B: PostgreSQL should match ORM.** | `015` backfills nulls with current UTC timestamp and sets `NOT NULL`. |
| Nullability too strict | `loan_accounts.installment_frequency` and `task_assignments.task_date` were NOT NULL in DB while model/routes allow omission. | **B: PostgreSQL should match ORM.** | `015` drops `NOT NULL`. |
| Branch FKs | Branch scope columns on collections, end-of-day reports, promises, tasks, and visits had ORM FKs but no PostgreSQL FK constraints. | **B: PostgreSQL should match ORM.** | `015` adds validated FK constraints to `branches.id`; invalid live data should abort migration instead of being coerced. |
| Uniqueness | `client_communication_events.idempotency_key`, `client_communication_outbox.idempotency_key`, `client_communication_worker_heartbeats.worker_id`, and `org_units.code` were unique in ORM but lacked DB unique constraints. | **B: PostgreSQL should match ORM.** | `015` adds unique constraints; duplicates must be fixed before production migration. |
| Indexes | ORM `index=True` fields added after earlier migrations were missing single-column DB indexes, mostly SMS policy and communication fields. | **B: PostgreSQL should match ORM.** | `015` adds missing single-column indexes. Unique indexes are accepted as satisfying indexed unique columns. |
| SMS check constraints | SMS policy tables include DB-only enum-like check constraints for consent/template/quota/suppression states. ORM represents these as constrained strings and services enforce constants. | **D: intentionally DB-stricter.** | Keep narrow allowlist with regression assertions: `ck_sms_template_status`, `ck_sms_consent_status`, `ck_sms_quota_status`, `ck_sms_suppression_reason`. |
| Server defaults vs Python defaults | Some Alembic columns retain server defaults while ORM supplies Python defaults. | **D: intentionally compatible.** | Keep DB defaults where present; parity regression focuses on shape, type, nullability, FK, uniqueness, and index drift. |

### High-risk field adjudication

| Field | Evidence | Decision | Risk if unresolved |
|---|---|---|---|
| `day_start_records.created_at` | `DayStartRecord.created_at` has Python default and non-null ORM mapping; day-start router creates rows through ORM. | DB should set NOT NULL after backfill. | Direct DB writes could create null timestamps. |
| `collections.collected_at` | Sync service writes `to_nepal_iso(...)`; money-path test asserts string length and `+05:45` suffix. | DB should be `VARCHAR(30)`. | Timestamp coercion can alter mobile/API string semantics. |
| `devices.last_sync_at` | Device model/API treats last sync as optional ISO string. | DB should be `VARCHAR(30)`. | Timestamp coercion can change API round-trip. |
| `sync_events.payload_json` | Sync/communication services store JSON strings and parse with `json.loads`. | DB should be `TEXT`. | JSONB returns dict-like values in some paths and breaks string parsing assumptions. |
| `end_of_day_reports.exceptions_json` | Model property serializes/deserializes with `json.dumps/json.loads`. | DB should be `TEXT`. | JSONB/text mismatch breaks property behavior. |
| `users.role` | RBAC uses string values from `UserRole`; ORM contract is `String(50)`. | DB should widen to `VARCHAR(50)`. | Future valid role strings could fail DB insert despite ORM accepting them. |
| `loan_accounts.installment_frequency` | Loan router/model permit omission; field is optional. | DB should allow NULL. | Valid loan creation without frequency fails. |
| `task_assignments.task_date` | n8n/sync/task flows can omit task date; model is optional. | DB should allow NULL. | Valid follow-up tasks without date fail. |

### Data conversion and production preflight requirements

Before applying `015` to production/pilot PostgreSQL, run preflight queries for:

- duplicate values in newly unique columns:
  - `client_communication_events.idempotency_key`
  - `client_communication_outbox.idempotency_key`
  - `client_communication_worker_heartbeats.worker_id`
  - `org_units.code`
- orphan branch references in newly constrained FK columns:
  - `collections.branch_id`
  - `end_of_day_reports.branch_id`
  - `promise_to_pay.branch_id`
  - `task_assignments.branch_id`
  - `visit_checkins.branch_id`
- invalid JSON text if downgrading after new writes to `sync_events.payload_json` or `end_of_day_reports.exceptions_json`.

Conversion policy:

- Timestamp-with-time-zone to naive timestamp uses `AT TIME ZONE 'UTC'` and does not guess local time.
- Timestamp-to-string fields use PostgreSQL `::text` to preserve a readable existing value.
- JSONB-to-text uses `::text`; rollback uses `::jsonb` and aborts on invalid JSON instead of lossy coercion.
- Nullability hardening backfills only timestamp audit fields with the migration execution time before setting `NOT NULL`.
- No production data is copied into tests or migrations.

### Existing database upgrade behavior

- Fresh database: `base -> 015_schema_parity_alignment` builds the current schema deterministically.
- Existing 013 database: `013_comm_broker -> 014_sms_policy_controls -> 015_schema_parity_alignment` is supported.
- Existing 014 database: `014_sms_policy_controls -> 015_schema_parity_alignment` is supported.
- Downgrade checkpoint: `015 -> 014 -> 015` is supported for disposable validation. Production downgrade requires the JSON/string validity caveats above.
- Full destructive `head -> base -> head` remains disposable-validation-only.

### Regression coverage

- `tests/test_alembic_clean_install_chain.py` now expects final head `015_schema_parity_alignment`.
- `tests/test_alembic_schema_parity.py` runs PostgreSQL-only clean-install parity checks against imported ORM metadata.
- The parity test fails on unapproved table, column, type, length, nullability, FK, unique, or index drift.
- Accepted intentional differences are narrowly allowlisted SMS check constraints with explicit names.
- Behavior coverage verifies PostgreSQL round-trips for day-start timestamps, ISO-string timestamp fields, JSON-string fields, role values, loan frequency omission, and task-date omission.
