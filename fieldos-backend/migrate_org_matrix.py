"""Idempotent runtime migration for the org matrix (PILOT_SCOPE_V2.md §8-A).

WHY THIS EXISTS: the backend boots with `Base.metadata.create_all`
(app/main.py) — NOT Alembic-at-runtime. `create_all` creates the *new*
`org_units` table on its own, but it will NOT add the new columns to the
existing `users` table, nor backfill `department` from `role`. Alembic 005
covers a clean/prod path; this script covers the LIVE pilot SQLite DB in
place, safely and repeatably.

Run it once against the pilot DB after deploying the model changes:

    python migrate_org_matrix.py            # uses SQLITE_PATH from env/config
    python migrate_org_matrix.py path.db    # or an explicit path

Safe to run multiple times: every ALTER/UPDATE is guarded.
"""
import os
import sqlite3
import sys

# Read the SQLite path the same way app/config.py does, so this script doesn't
# depend on a private config attribute (and works regardless of DB_TYPE).
DEFAULT_SQLITE_PATH = os.getenv("SQLITE_PATH", "/tmp/fieldos_nepal.db")

# (column, DDL type + default) for the columns added to `users`.
USER_COLUMNS = [
    ("department", "VARCHAR(30) NOT NULL DEFAULT 'operations'"),
    ("data_scope", "VARCHAR(20) NOT NULL DEFAULT 'own'"),
    ("permission_set", "VARCHAR(60) NOT NULL DEFAULT 'write'"),
    ("manager_id", "INTEGER REFERENCES users(id)"),
    ("org_unit_id", "INTEGER REFERENCES org_units(id)"),
]


def _existing_columns(cur, table):
    cur.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cur.fetchall()}


def _table_exists(cur, table):
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None


def migrate(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    cur = conn.cursor()

    if not _table_exists(cur, "users"):
        print(f"  ! no `users` table in {db_path} — run seed first; nothing to migrate.")
        conn.close()
        return

    # org_units is created by create_all on boot; create it here too so this
    # script is self-sufficient if run before the app has started.
    if not _table_exists(cur, "org_units"):
        cur.execute(
            """
            CREATE TABLE org_units (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME,
                updated_at DATETIME,
                type VARCHAR(20) NOT NULL DEFAULT 'branch',
                name VARCHAR(200) NOT NULL,
                name_ne VARCHAR(200),
                code VARCHAR(120),
                parent_id INTEGER REFERENCES org_units(id),
                branch_id INTEGER REFERENCES branches(id)
            )
            """
        )
        cur.execute("CREATE UNIQUE INDEX ix_org_units_code ON org_units(code)")
        cur.execute("CREATE INDEX ix_org_units_parent_id ON org_units(parent_id)")
        print("  + created org_units table")
    else:
        print("  = org_units table already present")

    have = _existing_columns(cur, "users")
    added = []
    for col, ddl in USER_COLUMNS:
        if col not in have:
            cur.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
            added.append(col)
    print(f"  + added user columns: {added}" if added else "  = user columns already present")

    # Backfill department/scope/permission from role. WHERE clauses make this
    # idempotent-safe: re-running just re-asserts the same derived values.
    cur.execute(
        "UPDATE users SET department='operations', data_scope='branch', permission_set='write' "
        "WHERE role IN ('field_officer','branch_manager')"
    )
    cur.execute("UPDATE users SET data_scope='own' WHERE role='field_officer'")
    cur.execute(
        "UPDATE users SET department='operations', data_scope='region', permission_set='read,write' "
        "WHERE role='area_manager'"
    )
    cur.execute(
        "UPDATE users SET department='admin_it', data_scope='org', permission_set='admin' "
        "WHERE role='admin'"
    )
    conn.commit()

    cur.execute("SELECT role, department, data_scope, permission_set, COUNT(*) "
                "FROM users GROUP BY role, department, data_scope, permission_set")
    print("  backfill result (role -> department/scope/perm):")
    for role, dept, scope, perm, n in cur.fetchall():
        print(f"    {role:<15} -> {dept}/{scope}/{perm}  (x{n})")

    conn.close()
    print("  done.")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SQLITE_PATH
    print(f"Migrating org matrix into: {path}")
    migrate(path)
