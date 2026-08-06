"""PostgreSQL-only Alembic clean-install regression.

This test is opt-in because it requires a disposable PostgreSQL server and creates
throwaway databases. It must never be pointed at production. CI enables it with a
local service container.
"""

from __future__ import annotations

import os
import subprocess
import sys
import site
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import asyncpg
import pytest


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_ALEMBIC_POSTGRES_CHAIN") != "1",
    reason="requires disposable PostgreSQL; set RUN_ALEMBIC_POSTGRES_CHAIN=1",
)

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
EXPECTED_HEAD = "015_schema_parity_alignment"
POLICY_TABLES = {
    "sms_consent_evidence",
    "sms_suppression_records",
    "sms_approved_templates",
    "sms_quota_reservations",
}


def _admin_url() -> str:
    url = os.environ.get("MIGRATION_TEST_DATABASE_URL")
    if not url:
        pytest.skip("MIGRATION_TEST_DATABASE_URL is required for PostgreSQL migration-chain validation")
    parsed = urlparse(url)
    if parsed.hostname not in {"127.0.0.1", "localhost"} and os.getenv("CI") != "true":
        pytest.fail("migration-chain validation refuses non-local PostgreSQL outside CI")
    return url


def _db_url(admin_url: str, database: str, *, async_driver: bool = False) -> str:
    parsed = urlparse(admin_url)
    scheme = "postgresql+asyncpg" if async_driver else "postgresql"
    return urlunparse(parsed._replace(scheme=scheme, path=f"/{database}"))


async def _create_database(admin_url: str, prefix: str) -> str:
    name = f"{prefix}_{uuid.uuid4().hex[:12]}"
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f"CREATE DATABASE {name}")
    finally:
        await conn.close()
    return name


async def _drop_database(admin_url: str, name: str) -> None:
    if not name.startswith("fieldos_migration_test_"):
        raise AssertionError(f"refusing to drop unexpected database name: {name}")
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1", name)
        await conn.execute(f"DROP DATABASE IF EXISTS {name}")
    finally:
        await conn.close()


def _run_alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    python_path = os.pathsep.join([site.getsitepackages()[0], str(BACKEND_ROOT)])
    env.update({"DB_TYPE": "postgres", "DATABASE_URL": database_url, "PYTHONPATH": python_path})
    result = subprocess.run(
        [str(Path(sys.executable).parent / "alembic"), "-c", str(ALEMBIC_INI), *args],
        cwd=BACKEND_ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    assert result.returncode == 0, result.stdout


async def _inspect_schema(database_url: str) -> dict[str, object]:
    conn = await asyncpg.connect(database_url)
    try:
        version = await conn.fetchval("SELECT version_num FROM alembic_version")
        table_rows = await conn.fetch(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_type='BASE TABLE'
            """
        )
        tables = {row["table_name"] for row in table_rows}
        foreign_keys = await conn.fetchval(
            """
            SELECT count(*) FROM information_schema.table_constraints
            WHERE table_schema='public' AND constraint_type='FOREIGN KEY'
            """
        )
        indexes = await conn.fetchval("SELECT count(*) FROM pg_indexes WHERE schemaname='public'")
        return {
            "version": version,
            "tables": tables,
            "foreign_keys": int(foreign_keys),
            "indexes": int(indexes),
        }
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_empty_postgresql_database_upgrades_to_current_head_and_safe_checkpoint() -> None:
    admin_url = _admin_url()
    database = await _create_database(admin_url, "fieldos_migration_test_clean")
    try:
        database_url = _db_url(admin_url, database, async_driver=True)
        sync_database_url = _db_url(admin_url, database, async_driver=False)

        _run_alembic(database_url, "upgrade", "head")
        schema = await _inspect_schema(sync_database_url)
        assert schema["version"] == EXPECTED_HEAD
        assert POLICY_TABLES.issubset(schema["tables"])
        assert "day_start_records" in schema["tables"]
        assert schema["foreign_keys"] > 0
        assert schema["indexes"] > 0

        _run_alembic(database_url, "downgrade", "013_comm_broker")
        checkpoint = await _inspect_schema(sync_database_url)
        assert checkpoint["version"] == "013_comm_broker"

        _run_alembic(database_url, "upgrade", "head")
        upgraded_again = await _inspect_schema(sync_database_url)
        assert upgraded_again["version"] == EXPECTED_HEAD
        assert POLICY_TABLES.issubset(upgraded_again["tables"])
    finally:
        await _drop_database(admin_url, database)
