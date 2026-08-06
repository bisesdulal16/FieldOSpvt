"""PostgreSQL-only schema parity and affected-field behavior tests."""
from __future__ import annotations

import importlib
import os
import pkgutil
from datetime import datetime

import asyncpg
import pytest
import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Float, Integer, Numeric, String, Text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from tests.test_alembic_clean_install_chain import _admin_url, _create_database, _db_url, _drop_database, _run_alembic

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_ALEMBIC_POSTGRES_CHAIN") != "1",
    reason="requires disposable PostgreSQL; set RUN_ALEMBIC_POSTGRES_CHAIN=1",
)

EXPECTED_HEAD = "015_schema_parity_alignment"
INTENTIONAL_DB_CHECKS = {
    ("sms_approved_templates", "ck_sms_template_status"),
    ("sms_consent_evidence", "ck_sms_consent_status"),
    ("sms_quota_reservations", "ck_sms_quota_status"),
    ("sms_suppression_records", "ck_sms_suppression_reason"),
}


def _import_all_models():
    import app.models  # noqa: F401
    import app.models as models_pkg

    for module in pkgutil.iter_modules(models_pkg.__path__):
        if not module.ispkg and not module.name.startswith("_"):
            importlib.import_module(f"app.models.{module.name}")
    from app.database import Base

    return Base


def _orm_type(column: sa.Column) -> str:
    typ = column.type
    if isinstance(typ, Integer):
        return "integer"
    if isinstance(typ, Text):
        return "text"
    if isinstance(typ, String):
        return f"varchar({typ.length})" if typ.length else "varchar"
    if isinstance(typ, Float):
        return "double precision"
    if isinstance(typ, Boolean):
        return "boolean"
    if isinstance(typ, DateTime):
        return f"timestamp_tz_{bool(typ.timezone)}"
    if isinstance(typ, Numeric):
        return f"numeric({typ.precision},{typ.scale})"
    return typ.__class__.__name__.lower()


def _db_type(row: asyncpg.Record) -> str:
    data_type = row["data_type"]
    if data_type == "integer":
        return "integer"
    if data_type == "text":
        return "text"
    if data_type == "character varying":
        length = row["character_maximum_length"]
        return f"varchar({length})" if length else "varchar"
    if data_type == "double precision":
        return "double precision"
    if data_type == "boolean":
        return "boolean"
    if data_type == "timestamp without time zone":
        return "timestamp_tz_False"
    if data_type == "timestamp with time zone":
        return "timestamp_tz_True"
    if data_type == "numeric":
        return f"numeric({row['numeric_precision']},{row['numeric_scale']})"
    return data_type


async def _schema_drift(database_url: str) -> list[str]:
    Base = _import_all_models()
    conn = await asyncpg.connect(database_url)
    drift: list[str] = []
    try:
        db_tables = {
            row["table_name"]
            for row in await conn.fetch(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema='public' AND table_type='BASE TABLE'
                """
            )
        }
        orm_tables = set(Base.metadata.tables)
        for table in sorted(orm_tables - db_tables):
            drift.append(f"missing table {table}")
        for table in sorted(db_tables - orm_tables - {"alembic_version"}):
            drift.append(f"unexpected table {table}")

        for table_name in sorted(orm_tables & db_tables):
            table = Base.metadata.tables[table_name]
            db_columns = {
                row["column_name"]: row
                for row in await conn.fetch(
                    """
                    SELECT column_name, data_type, character_maximum_length, numeric_precision,
                           numeric_scale, is_nullable, column_default
                    FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=$1
                    """,
                    table_name,
                )
            }
            orm_columns = {column.name: column for column in table.columns}
            for column in sorted(orm_columns.keys() - db_columns.keys()):
                drift.append(f"{table_name}.{column} missing in DB")
            for column in sorted(db_columns.keys() - orm_columns.keys()):
                drift.append(f"{table_name}.{column} unexpected in DB")
            for column_name in sorted(set(orm_columns) & set(db_columns)):
                orm_column = orm_columns[column_name]
                db_column = db_columns[column_name]
                if _orm_type(orm_column) != _db_type(db_column):
                    drift.append(f"{table_name}.{column_name} type ORM={_orm_type(orm_column)} DB={_db_type(db_column)}")
                if bool(orm_column.nullable) != (db_column["is_nullable"] == "YES"):
                    drift.append(f"{table_name}.{column_name} nullability ORM={orm_column.nullable} DB={db_column['is_nullable']}")

            db_fks = {
                (row["column_name"], f"{row['foreign_table']}.{row['foreign_column']}")
                for row in await conn.fetch(
                    """
                    SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
                    JOIN information_schema.constraint_column_usage ccu
                      ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
                    WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='FOREIGN KEY'
                    """,
                    table_name,
                )
            }
            orm_fks = {(column.name, str(fk.column)) for column in table.columns for fk in column.foreign_keys}
            for fk in sorted(orm_fks - db_fks):
                drift.append(f"{table_name}.{fk[0]} missing FK to {fk[1]}")

            db_uniques = {
                tuple(row["cols"])
                for row in await conn.fetch(
                    """
                    SELECT array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS cols
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
                    WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='UNIQUE'
                    GROUP BY tc.constraint_name
                    """,
                    table_name,
                )
            }
            orm_uniques = {(column.name,) for column in table.columns if column.unique}
            for constraint in table.constraints:
                if isinstance(constraint, sa.UniqueConstraint):
                    orm_uniques.add(tuple(column.name for column in constraint.columns))
            for unique in sorted(orm_uniques - db_uniques):
                drift.append(f"{table_name}.{','.join(unique)} missing UNIQUE")

            db_indexes = {
                (tuple(row["cols"]), bool(row["unique"]))
                for row in await conn.fetch(
                    """
                    SELECT array_agg(a.attname ORDER BY x.ordinality) AS cols, ix.indisunique AS unique
                    FROM pg_class t
                    JOIN pg_index ix ON t.oid=ix.indrelid
                    JOIN pg_class i ON i.oid=ix.indexrelid
                    JOIN unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality) ON true
                    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=x.attnum
                    JOIN pg_namespace n ON n.oid=t.relnamespace
                    WHERE n.nspname='public' AND t.relname=$1 AND NOT ix.indisprimary
                    GROUP BY i.relname, ix.indisunique
                    """,
                    table_name,
                )
            }
            db_index_columns = {cols for cols, _unique in db_indexes}
            orm_indexes = {(column.name,) for column in table.columns if column.index}
            for index in table.indexes:
                orm_indexes.add(tuple(column.name for column in index.columns))
            for index in sorted(orm_indexes - db_index_columns):
                drift.append(f"{table_name}.{','.join(index)} missing INDEX")

            db_checks = await conn.fetch(
                """
                SELECT conname FROM pg_constraint c
                JOIN pg_class t ON t.oid=c.conrelid
                JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname='public' AND t.relname=$1 AND c.contype='c'
                """,
                table_name,
            )
            for row in db_checks:
                check = (table_name, row["conname"])
                if check not in INTENTIONAL_DB_CHECKS:
                    drift.append(f"{table_name}.{row['conname']} unexpected CHECK")
        return drift
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_alembic_head_schema_matches_sqlalchemy_metadata_with_documented_exceptions() -> None:
    admin_url = _admin_url()
    database = await _create_database(admin_url, "fieldos_migration_test_parity")
    try:
        async_url = _db_url(admin_url, database, async_driver=True)
        sync_url = _db_url(admin_url, database, async_driver=False)
        _run_alembic(async_url, "upgrade", "head")
        drift = await _schema_drift(sync_url)
        assert drift == []
    finally:
        await _drop_database(admin_url, database)


@pytest.mark.asyncio
async def test_schema_aligned_fields_round_trip_on_postgresql() -> None:
    from app.models.branch import Branch
    from app.models.client import Client
    from app.models.collection import Collection
    from app.models.day_start import DayStartRecord
    from app.models.device import Device
    from app.models.end_of_day import EndOfDayReport
    from app.models.loan_account import LoanAccount
    from app.models.sync_event import SyncEvent
    from app.models.task import TaskAssignment
    from app.models.user import User, UserRole

    admin_url = _admin_url()
    database = await _create_database(admin_url, "fieldos_migration_test_behavior")
    engine = None
    try:
        async_url = _db_url(admin_url, database, async_driver=True)
        _run_alembic(async_url, "upgrade", "head")
        engine = create_async_engine(async_url, pool_pre_ping=True)
        Session = async_sessionmaker(engine, expire_on_commit=False)
        async with Session() as session:
            branch = Branch(branch_id="BR-PARITY", name="Parity Branch", office_ip="127.0.0.1")
            session.add(branch)
            await session.flush()
            role_value = max((role.value for role in UserRole), key=len)
            user = User(staff_id="FO-PARITY", name="Parity Officer", role=role_value, hashed_pin="hash", branch_id=branch.id)
            client = Client(member_id="M-PARITY", name="Parity Client", phone_number="+9779800000000")
            session.add_all([user, client])
            await session.flush()

            day_start = DayStartRecord(officer_id=user.id, branch_id=branch.id, day_date="2026-08-04", started_at="2026-08-04T09:00:00+05:45")
            collection = Collection(receipt_id="R-PARITY", client_id=client.id, officer_id=user.id, branch_id=branch.id, amount=125.5, collected_at="2026-08-04T09:01:02+05:45")
            device = Device(device_id="device-parity", user_id=user.id, last_sync_at="2026-08-04T09:02:03+05:45")
            sync_event = SyncEvent(entity_type="collection", entity_id="R-PARITY", operation="upsert", payload_json='{"amount":125.5}', synced_at="2026-08-04T09:03:04+05:45")
            eod = EndOfDayReport(report_date="2026-08-04", officer_id=user.id, branch_id=branch.id)
            eod.exceptions = {"missing_receipts": ["R-1"], "count": 1}
            loan_with_frequency = LoanAccount(client_id=client.id, loan_id="LN-PARITY-1", installment_frequency="weekly")
            loan_without_frequency = LoanAccount(client_id=client.id, loan_id="LN-PARITY-2")
            task_with_date = TaskAssignment(client_id=client.id, user_id=user.id, branch_id=branch.id, task_type="collection", task_date="2026-08-05")
            task_without_date = TaskAssignment(client_id=client.id, user_id=user.id, branch_id=branch.id, task_type="follow_up")
            session.add_all([
                day_start,
                collection,
                device,
                sync_event,
                eod,
                loan_with_frequency,
                loan_without_frequency,
                task_with_date,
                task_without_date,
            ])
            await session.commit()
            ids = {
                "day_start": day_start.id,
                "collection": collection.id,
                "device": device.id,
                "sync_event": sync_event.id,
                "eod": eod.id,
                "loan_with_frequency": loan_with_frequency.id,
                "loan_without_frequency": loan_without_frequency.id,
                "task_with_date": task_with_date.id,
                "task_without_date": task_without_date.id,
            }

        async with Session() as session:
            assert (await session.get(DayStartRecord, ids["day_start"])).created_at is not None
            assert (await session.get(Collection, ids["collection"])).collected_at == "2026-08-04T09:01:02+05:45"
            assert (await session.get(Device, ids["device"])).last_sync_at == "2026-08-04T09:02:03+05:45"
            assert (await session.get(SyncEvent, ids["sync_event"])).payload_json == '{"amount":125.5}'
            assert (await session.get(EndOfDayReport, ids["eod"])).exceptions == {"missing_receipts": ["R-1"], "count": 1}
            assert (await session.get(LoanAccount, ids["loan_with_frequency"])).installment_frequency == "weekly"
            assert (await session.get(LoanAccount, ids["loan_without_frequency"])).installment_frequency is None
            assert (await session.get(TaskAssignment, ids["task_with_date"])).task_date == "2026-08-05"
            assert (await session.get(TaskAssignment, ids["task_without_date"])).task_date is None
    finally:
        if engine is not None:
            await engine.dispose()
        await _drop_database(admin_url, database)
