import json
from datetime import datetime

import pytest
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.services.communication_broker import build_message_envelope, process_envelope, publish_once, routing_key_for, validate_envelope
from app.services.communication_outbox_service import run_once
from app.services.communication_providers import DispatchResult

PHONE = "+10000000000"
MESSAGE = "Sensitive SMS body"


async def _seed_authoritative_outbox(*, status="pending", attempt_status="queued") -> int:
    async with AsyncSessionLocal() as s:
        event = ClientCommunicationEvent(client_id=1, branch_id=1, officer_id=1, purpose="collection_verification", event_type="collection_verification", status="queued", idempotency_key=f"phase8-event-{datetime.utcnow().timestamp()}", source_reference="RCPT-P8")
        s.add(event)
        await s.flush()
        attempt = ClientCommunicationAttempt(event_id=event.id, channel="sms", provider="log", recipient=PHONE, status=attempt_status, metadata_json=json.dumps({"purpose": "collection_verification", "receipt_id": "RCPT-P8", "message": MESSAGE}))
        s.add(attempt)
        await s.flush()
        outbox = ClientCommunicationOutbox(event_id=event.id, attempt_id=attempt.id, queue_name="client_communication.sms", payload_json=json.dumps({"event_id": event.id, "attempt_id": attempt.id, "purpose": "collection_verification", "channel": "sms", "recipient": PHONE, "message": MESSAGE}), status=status, idempotency_key=f"phase8-outbox-{event.id}:sms:1", max_retries=5)
        s.add(outbox)
        await s.commit()
        return outbox.id


class FakeBroker:
    def __init__(self, fail=False):
        self.fail = fail
        self.published = []

    async def publish(self, envelope, routing_key):
        validate_envelope(envelope)
        self.published.append((envelope, routing_key))
        if self.fail:
            raise RuntimeError("broker unavailable")
        return envelope["message_id"]


@pytest.mark.asyncio
async def test_dispatch_mode_defaults_to_postgres_and_rabbitmq_disabled_no_behavior_change(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox()
    assert settings.COMMUNICATION_DISPATCH_MODE == "postgres"
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", False)
    results = await run_once(worker_id="postgres-worker", batch_size=1)
    assert results[0].status == "published"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "published"
    assert attempt.status == "submitted"


@pytest.mark.asyncio
async def test_rabbitmq_mode_skips_postgres_worker_and_postgres_mode_can_rollback_broker_published(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    monkeypatch.setattr(settings, "COMMUNICATION_DISPATCH_MODE", "rabbitmq")
    assert await run_once(worker_id="postgres-worker", batch_size=1) == []
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        assert outbox.status == "broker_published"
    monkeypatch.setattr(settings, "COMMUNICATION_DISPATCH_MODE", "postgres")
    results = await run_once(worker_id="postgres-rollback", batch_size=1)
    assert results[0].status == "published"


@pytest.mark.asyncio
async def test_rabbitmq_publisher_confirms_before_marking_broker_published(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox()
    monkeypatch.setattr(settings, "COMMUNICATION_DISPATCH_MODE", "rabbitmq")
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    broker = FakeBroker()
    results = await publish_once(worker_id="publisher-a", broker=broker, batch_size=1)
    assert results[0].status == "broker_published"
    assert broker.published[0][1] == "communication.sms"
    envelope = broker.published[0][0]
    rendered = json.dumps(envelope)
    assert PHONE not in rendered
    assert MESSAGE not in rendered
    assert "recipient" not in envelope and "message" not in envelope
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.status == "broker_published"
    assert outbox.broker_message_id == envelope["message_id"]


@pytest.mark.asyncio
async def test_broker_failure_leaves_postgres_retryable(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox()
    monkeypatch.setattr(settings, "COMMUNICATION_DISPATCH_MODE", "rabbitmq")
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    results = await publish_once(worker_id="publisher-fail", broker=FakeBroker(fail=True), batch_size=1)
    assert results[0].status == "retry_scheduled"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.status == "pending"
    assert outbox.retry_count == 1
    assert outbox.broker_message_id is None


@pytest.mark.asyncio
async def test_consumer_fetches_authoritative_payload_and_duplicate_does_not_duplicate_provider_call(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    calls = {"count": 0}

    class Provider:
        async def dispatch(self, attempt, payload, *, idempotency_key):
            calls["count"] += 1
            assert payload["message"] == MESSAGE
            assert payload["recipient"] == PHONE
            return DispatchResult("success", provider_reference="broker-log-ref", provider_status="submitted", idempotency_key_used=idempotency_key)

    monkeypatch.setattr("app.services.communication_broker.provider_for", lambda payload: Provider())
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
    first = await process_envelope(envelope, worker_id="consumer-a")
    second = await process_envelope(envelope, worker_id="consumer-b")
    assert first.status == "published"
    assert second.status == "already_submitted"
    assert calls["count"] == 1
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "published"
    assert attempt.status == "submitted"


@pytest.mark.asyncio
async def test_consumer_ignores_final_state_attempt(client):
    outbox_id = await _seed_authoritative_outbox(status="broker_published", attempt_status="delivered")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
    result = await process_envelope(envelope, worker_id="consumer-final")
    assert result.status == "already_submitted"


def test_malformed_or_pii_envelope_rejected():
    with pytest.raises(ValueError):
        validate_envelope({"schema_version": 1})
    valid = {"schema_version": 1, "message_id": "m1", "idempotency_key": "k1", "outbox_id": 1, "event_id": 1, "attempt_id": 1, "channel": "sms", "purpose": "collection_verification", "created_at": "2026-07-29T00:00:00Z", "trace_id": "t1", "message": "body"}
    with pytest.raises(ValueError):
        validate_envelope(valid)


def test_sms_reminder_routes_only_to_sms_delivery_queue():
    outbox = ClientCommunicationOutbox(id=1, event_id=1, attempt_id=1, queue_name="client_communication.sms", payload_json="{}", idempotency_key="k")
    assert routing_key_for(outbox, {"channel": "sms", "purpose": "payment_due_reminder"}) == "communication.sms"
    assert routing_key_for(outbox, {"channel": "reminder", "purpose": "orchestration"}) == "communication.reminder"


def test_worker_module_imports():
    import app.workers.communication_publisher  # noqa: F401
    import app.workers.communication_consumer  # noqa: F401
