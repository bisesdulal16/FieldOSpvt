import json
import logging

import pytest
from sqlalchemy import select, func
from httpx import AsyncClient

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationEvent,
    ClientCommunicationOutbox,
)
from app.models.sms_notification import SmsNotification
from tests.conftest import auth, login


async def _count(model, where=None):
    async with AsyncSessionLocal() as s:
        stmt = select(func.count()).select_from(model)
        if where is not None:
            stmt = stmt.where(where)
        res = await s.execute(stmt)
        return res.scalar_one()


async def test_phone_with_client_protection_disabled_creates_pending_attempt_without_outbox_or_provider_call(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    monkeypatch.setattr(settings, "CLIENT_PROTECTION_ENABLED", False)
    monkeypatch.setattr(settings, "VERIFICATION_SMS_ENABLED", True)

    async def fail_if_called(*args, **kwargs):  # pragma: no cover - only runs on regression
        raise AssertionError("provider must not be called synchronously in Phase 1")

    import app.services.sms_service as sms_service

    monkeypatch.setattr(sms_service, "send_sms", fail_if_called)
    caplog.set_level(logging.INFO)

    token = await login(client, "FO-208")
    resp = await client.post(
        "/api/v1/collections/",
        headers=auth(token),
        json={"client_id": 1, "amount": 2500, "payment_method": "cash", "receipt_id": "RCPT-COMM-001"},
    )
    assert resp.status_code == 200, resp.text

    async with AsyncSessionLocal() as s:
        event = (await s.execute(select(ClientCommunicationEvent))).scalar_one()
        attempt = (await s.execute(select(ClientCommunicationAttempt))).scalar_one()
        legacy_sms = (await s.execute(select(SmsNotification))).scalar_one()
        audit = (
            await s.execute(
                select(AuditLog).where(AuditLog.action_type == "client_communication_event_created")
            )
        ).scalar_one()

    assert event.purpose == "collection_verification"
    assert event.event_type == "collection_verification"
    assert event.idempotency_key == "client_comm:collection_verification:RCPT-COMM-001"
    assert event.collection_id == resp.json()["data"]["id"]
    assert event.client_id == 1
    assert event.branch_id is not None
    assert event.officer_id is not None
    assert event.scheduled_for is None  # immediate event
    assert event.cancelled_at is None
    assert event.source_system == "fieldos"
    assert event.source_reference == "RCPT-COMM-001"
    assert event.language == "en"
    assert event.priority == "normal"
    assert event.status == "pending"

    assert attempt.event_id == event.id
    assert attempt.channel == "sms"
    assert attempt.provider == "log"
    assert attempt.status == "pending"
    assert attempt.queued_at is None
    assert "RCPT-COMM-001" in (attempt.metadata_json or "")

    assert legacy_sms.collection_receipt_id == "RCPT-COMM-001"
    assert legacy_sms.status == "pending"
    assert await _count(ClientCommunicationOutbox) == 0

    assert "+977-9800000001" not in (audit.meta_json or "")
    assert "9800000001" not in (audit.meta_json or "")
    assert "***0001" in (audit.meta_json or "")
    assert "+977-9800000001" not in caplog.text
    assert "9800000001" not in caplog.text


async def test_phone_with_client_protection_and_sms_enabled_creates_queued_attempt_and_one_outbox_without_provider_call(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "CLIENT_PROTECTION_ENABLED", True)
    monkeypatch.setattr(settings, "VERIFICATION_SMS_ENABLED", True)

    async def fail_if_called(*args, **kwargs):  # pragma: no cover - only runs on regression
        raise AssertionError("provider must not be called synchronously in Phase 1")

    import app.services.sms_service as sms_service

    monkeypatch.setattr(sms_service, "send_sms", fail_if_called)

    token = await login(client, "FO-208")
    resp = await client.post(
        "/api/v1/collections/",
        headers=auth(token),
        json={"client_id": 1, "amount": 2500, "payment_method": "cash", "receipt_id": "RCPT-QUEUED-001"},
    )
    assert resp.status_code == 200, resp.text

    async with AsyncSessionLocal() as s:
        event = (await s.execute(select(ClientCommunicationEvent))).scalar_one()
        attempt = (await s.execute(select(ClientCommunicationAttempt))).scalar_one()
        outbox = (await s.execute(select(ClientCommunicationOutbox))).scalar_one()

    assert event.status == "queued"
    assert attempt.status == "queued"
    assert attempt.queued_at is not None
    assert outbox.event_id == event.id
    assert outbox.attempt_id == attempt.id
    assert outbox.status == "pending"
    assert outbox.idempotency_key == "client_comm:collection_verification:RCPT-QUEUED-001:sms:1"
    payload = json.loads(outbox.payload_json)
    assert payload["recipient"] == "+977-9800000001"


async def test_no_phone_collection_records_no_phone_without_blocking_commit(client: AsyncClient):
    # Remove phone from seeded client; collection should still commit and ledger should record no_phone.
    async with AsyncSessionLocal() as s:
        from app.models.client import Client

        db_client = await s.get(Client, 1)
        db_client.phone_number = None
        await s.commit()

    token = await login(client, "FO-208")
    resp = await client.post(
        "/api/v1/collections/",
        headers=auth(token),
        json={"client_id": 1, "amount": 2500, "payment_method": "cash", "receipt_id": "RCPT-NOPHONE-001"},
    )
    assert resp.status_code == 200, resp.text

    async with AsyncSessionLocal() as s:
        event = (await s.execute(select(ClientCommunicationEvent))).scalar_one()
        attempt = (await s.execute(select(ClientCommunicationAttempt))).scalar_one()

    assert event.status == "no_phone"
    assert attempt.status == "no_phone"
    assert attempt.error_code == "no_phone"
    assert await _count(ClientCommunicationOutbox) == 0


async def test_offline_sync_duplicate_receipt_returns_existing_collection_without_duplicate_ledgers(client: AsyncClient):
    token = await login(client, "FO-208")
    payload = {
        "events": [
            {
                "entity_type": "collection",
                "entity_id": "RCPT-SYNC-001",
                "operation": "create",
                "payload": {
                    "receipt_id": "RCPT-SYNC-001",
                    "client_id": 1,
                    "amount": 2500,
                    "payment_method": "cash",
                },
            }
        ]
    }

    first = await client.post("/api/v1/sync/events", headers=auth(token), json=payload)
    assert first.status_code == 200, first.text
    second = await client.post("/api/v1/sync/events", headers=auth(token), json=payload)
    assert second.status_code == 200, second.text
    first_result = first.json()["data"]["results"][0]
    second_result = second.json()["data"]["results"][0]
    assert second_result["status"] == "completed"
    assert second_result["duplicate"] is True
    assert first_result["id"] == second_result["id"]

    assert await _count(ClientCommunicationEvent) == 1
    assert await _count(ClientCommunicationAttempt) == 1
    assert await _count(ClientCommunicationOutbox) == 0
    assert await _count(SmsNotification) == 1


async def test_communication_idempotency_keys_do_not_contain_full_phone_numbers(client: AsyncClient):
    token = await login(client, "FO-208")
    resp = await client.post(
        "/api/v1/collections/",
        headers=auth(token),
        json={"client_id": 1, "amount": 2500, "payment_method": "cash", "receipt_id": "RCPT-NOPII-001"},
    )
    assert resp.status_code == 200, resp.text

    async with AsyncSessionLocal() as s:
        event = (await s.execute(select(ClientCommunicationEvent))).scalar_one()
        outboxes = (await s.execute(select(ClientCommunicationOutbox))).scalars().all()

    keys = [event.idempotency_key] + [outbox.idempotency_key for outbox in outboxes]
    for key in keys:
        assert "+977-9800000001" not in key
        assert "9800000001" not in key


@pytest.mark.parametrize(
    "purpose",
    [
        "collection_verification",
        "payment_due_reminder",
        "payment_overdue_reminder",
        "promise_to_pay_reminder",
        "dispute_acknowledgement",
        "client_protection_alert",
    ],
)
async def test_schema_supports_future_purposes_without_assuming_post_payment_only(purpose: str):
    async with AsyncSessionLocal() as s:
        event = ClientCommunicationEvent(
            purpose=purpose,
            event_type=purpose,
            status="pending",
            idempotency_key=f"client_comm:{purpose}:test",
            source_system="test",
            source_reference="test",
            language="ne",
            priority="high",
        )
        s.add(event)
        await s.commit()

    assert await _count(ClientCommunicationEvent, ClientCommunicationEvent.purpose == purpose) == 1
