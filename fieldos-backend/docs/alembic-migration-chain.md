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
