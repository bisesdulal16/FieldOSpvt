-- Postgres org-matrix migration (PILOT_SCOPE_V2.md §8-A) for the LIVE pilot DB.
--
-- WHY A .sql (not alembic): this DB was built entirely by SQLAlchemy create_all
-- and has NO alembic_version row, so `alembic upgrade head` would try to create
-- tables that already exist and fail. create_all (on the rebuilt image's boot)
-- creates the NEW tables (org_units, feedback*) automatically, but it will NOT
-- add the new columns to the existing `users` table nor backfill them. This
-- script does exactly that part, idempotently (ADD COLUMN IF NOT EXISTS).
--
-- Safe to run repeatedly. Additive only — never drops or deletes.
--   docker exec -i fieldos-postgres psql -U fieldos -d fieldos_nepal < migrate_org_matrix_pg.sql

BEGIN;

-- New columns on users (defaults keep every existing row valid until backfill).
ALTER TABLE users ADD COLUMN IF NOT EXISTS department      VARCHAR(30) NOT NULL DEFAULT 'operations';
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_scope      VARCHAR(20) NOT NULL DEFAULT 'own';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permission_set  VARCHAR(60) NOT NULL DEFAULT 'write';
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id      INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_unit_id     INTEGER;

-- FKs, added only if absent (org_units may not exist until create_all runs; guard).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_manager_id') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_manager_id
      FOREIGN KEY (manager_id) REFERENCES users(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_units')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_org_unit_id') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_org_unit_id
      FOREIGN KEY (org_unit_id) REFERENCES org_units(id);
  END IF;
END $$;

-- Backfill department/scope/permission from the existing role (idempotent —
-- re-running just re-asserts the same derived values).
UPDATE users SET department='operations', data_scope='branch', permission_set='write'
  WHERE role IN ('field_officer','branch_manager');
UPDATE users SET data_scope='own' WHERE role='field_officer';
UPDATE users SET department='operations', data_scope='region', permission_set='read,write'
  WHERE role='area_manager';
UPDATE users SET department='admin_it', data_scope='org', permission_set='admin'
  WHERE role='admin';

COMMIT;

-- Report the result.
SELECT role, department, data_scope, permission_set, COUNT(*)
FROM users GROUP BY role, department, data_scope, permission_set ORDER BY role;
