import os
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models.branch import Branch
from app.models.client import Client
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.models.collection import Collection
from app.models.user import User
from app.services.auth_service import hash_pin
from app.services.communication_outbox_service import claim_outbox_batch

pytestmark = pytest.mark.skipif(
    not os.getenv("POSTGRES_TEST_DSN"),
    reason="set POSTGRES_TEST_DSN to run real Postgres SKIP LOCKED concurrency validation",
)


async def _seed_pg(session_factory, receipt_id: str):
    async with session_factory() as s:
        branch = Branch(branch_id=f"BR-{receipt_id}", name="PG Branch")
        s.add(branch)
        await s.flush()
        user = User(staff_id=f"FO-{receipt_id[-3:]}", name="PG Worker", role="field_officer", hashed_pin=hash_pin("1234"), branch_id=branch.id, is_active=True)
        client = Client(member_id=f"M-{receipt_id}", name="PG Client", phone_number="+977-9800000001", outstanding_balance=1000, due_amount=100)
        s.add_all([user, client])
        await s.flush()
        collection = Collection(receipt_id=receipt_id, client_id=client.id, officer_id=user.id, branch_id=branch.id, amount=100, outstanding_after=900, payment_method="cash")
        s.add(collection)
        await s.flush()
        event = ClientCommunicationEvent(collection_id=collection.id, client_id=client.id, branch_id=branch.id, officer_id=user.id, status="queued", idempotency_key=f"client_comm:collection_verification:{receipt_id}", source_reference=receipt_id)
        s.add(event)
        await s.flush()
        attempt = ClientCommunicationAttempt(event_id=event.id, channel="sms", provider="log", recipient=client.phone_number, status="queued")
        s.add(attempt)
        await s.flush()
        outbox = ClientCommunicationOutbox(event_id=event.id, attempt_id=attempt.id, payload_json='{"channel":"sms","provider":"log","recipient":"+977-9800000001","message":"test"}', idempotency_key=f"client_comm:collection_verification:{receipt_id}:sms:1", status="pending")
        s.add(outbox)
        await s.commit()
        return outbox.id


async def test_postgres_skip_locked_two_workers_and_stale_recovery():
    engine = create_async_engine(os.environ["POSTGRES_TEST_DSN"], echo=False, pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    try:
        one = await _seed_pg(session_factory, "RCPT-PG-001")
        two = await _seed_pg(session_factory, "RCPT-PG-002")

        session_a = session_factory()
        session_b = session_factory()
        try:
            claimed_a = await claim_outbox_batch(session_a, worker_id="pg-worker-a", batch_size=1)
            assert [c.id for c in claimed_a] == [one]
            # Worker A intentionally keeps its transaction open here. SKIP LOCKED
            # must prevent Worker B from seeing/claiming the same row while still
            # allowing it to claim the second eligible row.
            claimed_b = await claim_outbox_batch(session_b, worker_id="pg-worker-b", batch_size=1)
            assert [c.id for c in claimed_b] == [two]
            await session_a.commit()
            await session_b.commit()
        finally:
            await session_a.close()
            await session_b.close()

        async with session_factory() as s:
            # use database time for stale timestamp
            await s.execute(
                ClientCommunicationOutbox.__table__.update()
                .where(ClientCommunicationOutbox.id == one)
                .values(locked_at=datetime(2000, 1, 1), status="processing", locked_by="stale-pg-worker")
            )
            await s.commit()
        async with session_factory() as s:
            recovered = await claim_outbox_batch(s, worker_id="pg-worker-c", batch_size=1, lock_timeout_seconds=1)
            await s.commit()
        assert [c.id for c in recovered] == [one]
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()
