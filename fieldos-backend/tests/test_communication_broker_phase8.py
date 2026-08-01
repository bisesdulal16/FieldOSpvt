import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.branch import Branch
from app.models.user import Department, User
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.services.auth_service import hash_pin
from app.services.communication_broker import BrokerAction, ConsumerOutcome, build_message_envelope, process_envelope, publish_once, routing_key_for, validate_envelope
from app.services.communication_outbox_service import run_once
from app.services.communication_providers import DispatchResult
from tests.conftest import auth, login

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
    assert outbox.attempt_count == 1
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
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "broker_published"
    assert outbox.broker_message_id == envelope["message_id"]
    assert (outbox.attempt_count or 0) == 0
    assert outbox.last_attempted_at is None
    assert attempt.status == "queued"
    assert attempt.submitted_at is None
    assert attempt.provider_reference is None


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
    assert outbox.broker_retry_count == 1
    assert (outbox.retry_count or 0) == 0
    assert (outbox.attempt_count or 0) == 0
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
    assert first.outcome == ConsumerOutcome.PROVIDER_SUBMITTED
    assert first.broker_action == BrokerAction.ACK
    assert first.status == "published"
    assert second.outcome == ConsumerOutcome.FINAL_STATE_DUPLICATE
    assert second.broker_action == BrokerAction.ACK
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
    assert result.outcome == ConsumerOutcome.FINAL_STATE_DUPLICATE
    assert result.broker_action == BrokerAction.ACK
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


@pytest.mark.asyncio
async def test_duplicate_broker_publication_does_not_count_as_provider_attempt(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox()
    monkeypatch.setattr(settings, "COMMUNICATION_DISPATCH_MODE", "rabbitmq")
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    broker = FakeBroker()
    first = await publish_once(worker_id="publisher-dupe-a", broker=broker, batch_size=1)
    second = await publish_once(worker_id="publisher-dupe-b", broker=broker, batch_size=1)
    assert first[0].status == "broker_published"
    assert second == []
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert (outbox.attempt_count or 0) == 0
    assert (outbox.broker_retry_count or 0) == 0
    assert (outbox.retry_count or 0) == 0


@pytest.mark.asyncio
async def test_consumer_provider_invocation_increments_provider_attempt_once(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    calls = {"count": 0}

    class Provider:
        async def dispatch(self, attempt, payload, *, idempotency_key):
            calls["count"] += 1
            return DispatchResult("success", provider_reference="once-ref", provider_status="submitted", idempotency_key_used=idempotency_key)

    monkeypatch.setattr("app.services.communication_broker.provider_for", lambda payload: Provider())
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
    result = await process_envelope(envelope, worker_id="consumer-once")
    assert result.outcome == ConsumerOutcome.PROVIDER_SUBMITTED
    assert result.broker_action == BrokerAction.ACK
    assert result.status == "published"
    assert calls["count"] == 1
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.attempt_count == 1
    assert (outbox.broker_retry_count or 0) == 0
    assert attempt.submitted_at is not None


@pytest.mark.asyncio
async def test_final_state_duplicate_delivery_does_not_increment_provider_attempt(client):
    outbox_id = await _seed_authoritative_outbox(status="broker_published", attempt_status="submitted")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.attempt_count = 1
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        attempt.provider_reference = "existing-ref"
        attempt.submitted_at = datetime.utcnow()
        await s.commit()
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
    result = await process_envelope(envelope, worker_id="consumer-final-dupe")
    assert result.status == "already_submitted"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.attempt_count == 1


@pytest.mark.asyncio
async def test_broker_and_provider_retry_counters_remain_distinct(client, monkeypatch):
    outbox_id = await _seed_authoritative_outbox()
    monkeypatch.setattr(settings, "COMMUNICATION_DISPATCH_MODE", "rabbitmq")
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    await publish_once(worker_id="publisher-broker-fail", broker=FakeBroker(fail=True), batch_size=1)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.available_at = None
        await s.commit()
    assert outbox.broker_retry_count == 1
    assert outbox.retry_count == 0
    assert outbox.attempt_count == 0

    ok_results = await publish_once(worker_id="publisher-broker-ok", broker=FakeBroker(), batch_size=1)
    assert ok_results[0].status == "broker_published"

    class RetryProvider:
        async def dispatch(self, attempt, payload, *, idempotency_key):
            return DispatchResult("retryable_failure", safe_error_message="temporary provider failure", error_code="provider_temp")

    monkeypatch.setattr("app.services.communication_broker.provider_for", lambda payload: RetryProvider())
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
    result = await process_envelope(envelope, worker_id="consumer-provider-retry")
    assert result.outcome == ConsumerOutcome.PROVIDER_RETRY_SCHEDULED
    assert result.broker_action == BrokerAction.ACK
    assert result.status == "retry_scheduled"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.broker_retry_count == 1
    assert outbox.retry_count == 1
    assert outbox.attempt_count == 1


@pytest.mark.asyncio
async def test_processing_state_conflict_nacks_for_publisher_consumer_race(client):
    outbox_id = await _seed_authoritative_outbox(status="processing")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.locked_by = "publisher-race"
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
        await s.commit()
    result = await process_envelope(envelope, worker_id="consumer-race")
    assert result.outcome == ConsumerOutcome.RETRYABLE_CONFLICT
    assert result.broker_action == BrokerAction.DELAYED_RETRY
    assert result.provider_called is False
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.status == "processing"
    assert outbox.attempt_count == 0


@pytest.mark.asyncio
async def test_unexpected_non_final_state_does_not_ack(client):
    outbox_id = await _seed_authoritative_outbox(status="weird")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
    result = await process_envelope(envelope, worker_id="consumer-weird")
    assert result.outcome == ConsumerOutcome.UNEXPECTED_STATE
    assert result.broker_action == BrokerAction.DELAYED_RETRY
    assert result.provider_called is False


@pytest.mark.asyncio
async def test_idempotency_mismatch_returns_dlq_result(client):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
    envelope["idempotency_key"] = "wrong-key"
    result = await process_envelope(envelope, worker_id="consumer-mismatch")
    assert result.outcome == ConsumerOutcome.IDEMPOTENCY_MISMATCH
    assert result.broker_action == BrokerAction.REJECT_DLQ
    assert result.provider_called is False


@pytest.mark.asyncio
async def test_missing_authoritative_row_requeues_for_bounded_retry_policy(client):
    envelope = {"schema_version": 1, "message_id": "m-missing", "idempotency_key": "missing", "outbox_id": 999999, "event_id": 999999, "attempt_id": 999999, "channel": "sms", "purpose": "collection_verification", "created_at": "2026-07-30T00:00:00Z", "trace_id": "t-missing"}
    result = await process_envelope(envelope, worker_id="consumer-missing")
    assert result.outcome == ConsumerOutcome.NOT_FOUND
    assert result.broker_action == BrokerAction.DELAYED_RETRY
    assert result.status == "missing_authoritative_row"


@pytest.mark.asyncio
async def test_provider_resolution_failure_does_not_ack_silently(client):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        attempt.provider = "not_real"
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
        await s.commit()
    result = await process_envelope(envelope, worker_id="consumer-provider-missing")
    assert result.outcome == ConsumerOutcome.PERMANENT_INVALID
    assert result.broker_action == BrokerAction.REJECT_DLQ
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "dead"
    assert attempt.status == "failed"


@pytest.mark.asyncio
async def test_broker_published_unprocessed_endpoint_auth_scope_and_sanitization(client):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.broker_published_at = datetime.utcnow() - timedelta(minutes=10)
        outbox.broker_message_id = "broker-message-safe-id"
        await s.commit()

    assert (await client.get("/api/v1/client-communication/outbox/broker-published-unprocessed")).status_code == 401
    fo_token = await login(client, "FO-208")
    assert (await client.get("/api/v1/client-communication/outbox/broker-published-unprocessed", headers=auth(fo_token))).status_code == 403

    bm_token = await login(client, "BM-001")
    resp = await client.get("/api/v1/client-communication/outbox/broker-published-unprocessed?limit=1&threshold_seconds=1", headers=auth(bm_token))
    assert resp.status_code == 200, resp.text
    data = resp.json()["broker_published_unprocessed"]
    assert data["scope"] == "branch"
    assert data["count"] == 1
    assert data["limit"] == 1
    assert data["items"][0]["outbox_id"] == outbox_id
    rendered = json.dumps(data)
    assert PHONE not in rendered
    assert MESSAGE not in rendered
    assert "broker-message-safe-id" not in rendered
    assert "idempotency" not in rendered.lower()


@pytest.mark.asyncio
async def test_broker_published_unprocessed_branch_scoping_and_admin_it_denied(client):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.broker_published_at = datetime.utcnow() - timedelta(minutes=10)
        branch_b = Branch(branch_id="BR-BROKER-B", name="Broker Branch B", office_ip="127.0.0.1")
        s.add(branch_b)
        await s.flush()
        s.add(User(staff_id="BM-BROKER-B", name="Broker B Manager", role="branch_manager", department=Department.OPERATIONS.value, hashed_pin=hash_pin("1234"), branch_id=branch_b.id, is_active=True))
        s.add(User(staff_id="IT-BROKER", name="IT Broker Admin", role="admin", department=Department.ADMIN_IT.value, hashed_pin=hash_pin("1234"), is_active=True))
        await s.commit()

    bm_b_token = await login(client, "BM-BROKER-B")
    resp = await client.get("/api/v1/client-communication/outbox/broker-published-unprocessed?threshold_seconds=1", headers=auth(bm_b_token))
    assert resp.status_code == 200
    assert resp.json()["broker_published_unprocessed"]["count"] == 0

    it_token = await login(client, "IT-BROKER")
    assert (await client.get("/api/v1/client-communication/outbox/broker-published-unprocessed", headers=auth(it_token))).status_code == 403


@pytest.mark.asyncio
async def test_broker_published_unprocessed_metric_name_threshold_and_no_ids(client):
    outbox_id = await _seed_authoritative_outbox(status="broker_published")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        outbox.broker_published_at = datetime.utcnow() - timedelta(minutes=10)
        await s.commit()
    bm_token = await login(client, "BM-001")
    resp = await client.get("/api/v1/client-communication/outbox/metrics", headers=auth(bm_token))
    assert resp.status_code == 200
    text = resp.text
    assert "# TYPE fieldos_communication_broker_published_unprocessed gauge" in text
    assert "fieldos_communication_broker_published_unprocessed 1" in text
    assert "\nbroker_published_unprocessed " not in text
    assert PHONE not in text
    assert MESSAGE not in text
