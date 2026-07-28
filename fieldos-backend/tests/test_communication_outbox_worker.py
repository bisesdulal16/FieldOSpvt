import json
import logging
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationEvent,
    ClientCommunicationOutbox,
)
from app.models.user import Department, User, UserRole
from app.services.auth_service import hash_pin
from app.services.communication_outbox_service import (
    calculate_retry_delay_seconds,
    claim_outbox_batch,
    process_claimed_outbox,
    queue_health,
    run_once,
)
from app.services.communication_providers import DispatchResult
from tests.conftest import auth, login

PHONE = "+977-9800000001"


async def _make_outbox(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, receipt_id="RCPT-WORKER-001"):
    monkeypatch.setattr(settings, "CLIENT_PROTECTION_ENABLED", True)
    monkeypatch.setattr(settings, "VERIFICATION_SMS_ENABLED", True)
    token = await login(client, "FO-208")
    resp = await client.post(
        "/api/v1/collections/",
        headers=auth(token),
        json={"client_id": 1, "amount": 2500, "payment_method": "cash", "receipt_id": receipt_id},
    )
    assert resp.status_code == 200, resp.text
    async with AsyncSessionLocal() as s:
        outbox = (
            await s.execute(select(ClientCommunicationOutbox).order_by(ClientCommunicationOutbox.id.desc()).limit(1))
        ).scalar_one()
        return outbox.id


async def _outbox_state(outbox_id=1):
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        event = await s.get(ClientCommunicationEvent, outbox.event_id)
        return outbox.status, attempt.status, event.status


async def test_one_worker_claims_a_row(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-a", batch_size=1)
        await s.commit()
    assert [c.id for c in claimed] == [1]
    assert claimed[0].locked_by == "worker-a"
    assert (await _outbox_state())[0] == "processing"


async def test_two_workers_cannot_claim_same_row(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        first = await claim_outbox_batch(s, worker_id="worker-a", batch_size=1)
        await s.commit()
    async with AsyncSessionLocal() as s:
        second = await claim_outbox_batch(s, worker_id="worker-b", batch_size=1)
        await s.commit()
    assert len(first) == 1
    assert second == []


async def test_batch_size_enforced(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch, "RCPT-BATCH-1")
    await _make_outbox(client, monkeypatch, "RCPT-BATCH-2")
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-a", batch_size=1)
        await s.commit()
    assert len(claimed) == 1


async def test_future_available_at_not_claimed(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.available_at = datetime.utcnow() + timedelta(hours=1)
        await s.commit()
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-a", batch_size=1)
        await s.commit()
    assert claimed == []


async def test_stale_processing_row_is_recovered(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.status = "processing"
        outbox.locked_by = "dead-worker"
        outbox.locked_at = datetime.utcnow() - timedelta(seconds=999)
        await s.commit()
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-b", batch_size=1, lock_timeout_seconds=1)
        audits = (await s.execute(select(AuditLog).where(AuditLog.action_type == "communication_stale_lock_recovered"))).scalars().all()
        await s.commit()
    assert len(claimed) == 1
    assert claimed[0].locked_by == "worker-b"
    assert audits


async def test_successful_log_dispatch_marks_published_and_attempt_submitted_not_delivered(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    results = await run_once(worker_id="worker-a", batch_size=1, jitter_fn=lambda _: 0)
    assert results[0].status == "published"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, 1)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        event = await s.get(ClientCommunicationEvent, outbox.event_id)
    assert outbox.status == "published"
    assert attempt.status == "submitted"
    assert attempt.delivered_at is None
    assert event.status == "provider_accepted"


async def test_retryable_failure_schedules_retry_and_backoff_increases(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        payload = json.loads(outbox.payload_json)
        payload["test_failure"] = "retryable"
        outbox.payload_json = json.dumps(payload)
        await s.commit()
    results = await run_once(worker_id="worker-a", batch_size=1, jitter_fn=lambda _: 0)
    assert results[0].status == "retry_scheduled"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "pending"
    assert outbox.retry_count == 1
    assert outbox.available_at is not None
    assert attempt.status == "queued"
    assert calculate_retry_delay_seconds(1, jitter_fn=lambda _: 0) == 30
    assert calculate_retry_delay_seconds(2, jitter_fn=lambda _: 0) == 60


async def test_max_attempts_produces_dead_and_dead_not_retried(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        payload = json.loads(outbox.payload_json)
        payload["test_failure"] = "retryable"
        outbox.payload_json = json.dumps(payload)
        outbox.attempt_count = settings.OUTBOX_MAX_ATTEMPTS - 1
        await s.commit()
    results = await run_once(worker_id="worker-a", batch_size=1, jitter_fn=lambda _: 0)
    assert results[0].status == "dead"
    assert await _outbox_state(outbox_id) == ("dead", "failed", "failed")
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-b", batch_size=1)
        await s.commit()
    assert claimed == []


async def test_final_state_attempt_is_not_dispatched(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        attempt = (await s.execute(select(ClientCommunicationAttempt))).scalar_one()
        attempt.status = "submitted"
        attempt.provider_reference = "existing"
        await s.commit()
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-a", batch_size=1)
        await s.commit()
    assert claimed == []


async def test_cancelled_event_is_not_dispatched_and_is_audited(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        event = (await s.execute(select(ClientCommunicationEvent))).scalar_one()
        event.cancelled_at = datetime.utcnow()
        event.status = "cancelled"
        await s.commit()
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-a", batch_size=1)
        audits = (await s.execute(select(AuditLog).where(AuditLog.action_type == "communication_dispatch_cancelled"))).scalars().all()
        await s.commit()
    assert claimed == []
    assert await _outbox_state(outbox_id) == ("cancelled", "cancelled", "cancelled")
    assert audits


async def test_permanent_failure_goes_directly_dead(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        payload = json.loads(outbox.payload_json)
        payload.pop("recipient", None)
        outbox.payload_json = json.dumps(payload)
        await s.commit()
    results = await run_once(worker_id="worker-a", batch_size=1, jitter_fn=lambda _: 0)
    assert results[0].status == "dead"


async def test_lost_lock_ownership_cannot_overwrite_state(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-a", batch_size=1)
        await s.commit()
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.locked_by = "worker-b"
        await s.commit()
    result = await process_claimed_outbox(claimed[0], worker_id="worker-a")
    assert result.status == "lock_lost"
    assert await _outbox_state(outbox_id) == ("processing", "queued", "queued")


async def test_provider_retry_after_is_respected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        payload = json.loads(outbox.payload_json)
        payload["test_failure"] = "retryable"
        payload["retry_after_seconds"] = 300
        outbox.payload_json = json.dumps(payload)
        await s.commit()
    await run_once(worker_id="worker-a", batch_size=1, jitter_fn=lambda _: 0)
    assert calculate_retry_delay_seconds(1, retry_after_seconds=300, jitter_fn=lambda _: 0) == 300


async def test_provider_idempotency_key_equals_outbox_idempotency_key(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    seen = {}

    class Provider:
        async def dispatch(self, attempt, payload, *, idempotency_key):
            seen["key"] = idempotency_key
            return DispatchResult(outcome="success", provider_reference="fake-ref", provider_status="submitted", idempotency_key_used=idempotency_key)

    outbox_id = await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    monkeypatch.setattr("app.services.communication_outbox_service.provider_for", lambda payload: Provider())
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        expected = outbox.idempotency_key
    await run_once(worker_id="worker-a", batch_size=1)
    assert seen["key"] == expected


async def test_no_provider_call_occurs_while_db_transaction_is_open(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    observed = {}

    class Provider:
        async def dispatch(self, attempt, payload, *, idempotency_key):
            async with AsyncSessionLocal() as s:
                # If the worker held the claim transaction open across provider call,
                # SQLite would be prone to lock here; this independent read must work.
                observed["count"] = len((await s.execute(select(ClientCommunicationOutbox))).scalars().all())
            return DispatchResult(outcome="success", provider_reference="fake-ref", provider_status="submitted", idempotency_key_used=idempotency_key)

    await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    monkeypatch.setattr("app.services.communication_outbox_service.provider_for", lambda payload: Provider())
    await run_once(worker_id="worker-a", batch_size=1)
    assert observed["count"] == 1


async def test_one_shot_processes_only_one_batch(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch, "RCPT-ONE-1")
    await _make_outbox(client, monkeypatch, "RCPT-ONE-2")
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    results = await run_once(worker_id="worker-a", batch_size=1)
    assert len(results) == 1
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(select(ClientCommunicationOutbox))).scalars().all()
    assert [r.status for r in rows].count("published") == 1
    assert [r.status for r in rows].count("pending") == 1


async def test_disabled_worker_performs_no_dispatch(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", False)
    results = await run_once(worker_id="worker-a", batch_size=1)
    assert results == []
    assert await _outbox_state() == ("pending", "queued", "queued")


async def test_health_endpoint_exposes_no_pii_and_admin_it_denied(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch)
    bm_token = await login(client, "BM-001")
    resp = await client.get("/api/v1/client-communication/outbox/health", headers=auth(bm_token))
    assert resp.status_code == 200, resp.text
    text = resp.text
    assert PHONE not in text
    assert "message" not in text.lower()
    async with AsyncSessionLocal() as s:
        admin_it = User(
            staff_id="IT-001",
            name="IT Admin",
            role=UserRole.ADMIN.value,
            department=Department.ADMIN_IT.value,
            hashed_pin=hash_pin("1234"),
            branch_id=1,
            is_active=True,
        )
        s.add(admin_it)
        await s.commit()
    it_token = await login(client, "IT-001")
    denied = await client.get("/api/v1/client-communication/outbox/health", headers=auth(it_token))
    assert denied.status_code == 403


async def test_stale_recovery_does_not_redispatch_already_submitted_attempt(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        outbox.status = "processing"
        outbox.locked_by = "dead-worker"
        outbox.locked_at = datetime.utcnow() - timedelta(seconds=999)
        attempt.status = "submitted"
        attempt.provider_reference = "accepted-before-crash"
        attempt.submitted_at = datetime.utcnow()
        await s.commit()
    async with AsyncSessionLocal() as s:
        claimed = await claim_outbox_batch(s, worker_id="worker-b", batch_size=1, lock_timeout_seconds=1)
        await s.commit()
    assert claimed == []
    assert await _outbox_state(outbox_id) == ("processing", "submitted", "queued")


async def test_queue_health_service_has_no_payloads(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        health = await queue_health(s)
    rendered = json.dumps(health)
    assert PHONE not in rendered
    assert "payload" not in rendered.lower()
    assert health["database_reachable"] is True
