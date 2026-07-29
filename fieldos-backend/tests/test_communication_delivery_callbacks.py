import json
import time
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.services.communication_callbacks import build_signature, canonical_json

SECRET = "callback-test-secret"
PHONE = "+977-9800000001"


async def _make_submitted_attempt(provider_reference="prov-ref-1", *, event_status="provider_accepted", attempt_status="submitted"):
    async with AsyncSessionLocal() as s:
        event = ClientCommunicationEvent(
            collection_id=None,
            client_id=1,
            branch_id=1,
            officer_id=1,
            status=event_status,
            idempotency_key=f"callback-test:{provider_reference}",
            source_reference=f"RCPT-CB-{provider_reference}",
        )
        s.add(event)
        await s.flush()
        attempt = ClientCommunicationAttempt(
            event_id=event.id,
            channel="sms",
            provider="sparrow",
            provider_reference=provider_reference,
            recipient=PHONE,
            status=attempt_status,
            submitted_at=datetime.utcnow() if attempt_status in {"submitted", "delivered", "failed", "expired"} else None,
        )
        s.add(attempt)
        await s.flush()
        outbox = ClientCommunicationOutbox(
            event_id=event.id,
            attempt_id=attempt.id,
            payload_json=json.dumps({"provider": "sparrow", "recipient": PHONE, "message": "test"}),
            status="published",
            idempotency_key=f"callback-test:{provider_reference}:sms:1",
            published_at=datetime.utcnow(),
        )
        s.add(outbox)
        await s.commit()
        return event.id, attempt.id, outbox.id


def _headers(payload: dict, monkeypatch: pytest.MonkeyPatch, *, provider="generic", offset=0, secret=SECRET):
    monkeypatch.setattr(settings, "SMS_CALLBACK_SECRET", secret)
    monkeypatch.setattr(settings, "SMS_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS", 300)
    body = canonical_json(payload)
    ts = str(int(time.time()) + offset)
    sig = build_signature(secret, provider, ts, body)
    return body, {"content-type": "application/json", "X-FieldOS-Timestamp": ts, "X-FieldOS-Signature": sig}


async def _post(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, payload: dict, provider="generic", **kw):
    body, headers = _headers(payload, monkeypatch, provider=provider, **kw)
    return await client.post(f"/api/v1/client-communication/callbacks/{provider}", content=body, headers=headers)


async def _state(attempt_id: int):
    async with AsyncSessionLocal() as s:
        attempt = await s.get(ClientCommunicationAttempt, attempt_id)
        event = await s.get(ClientCommunicationEvent, attempt.event_id)
        audits = (await s.execute(select(AuditLog))).scalars().all()
        return event, attempt, audits


async def _counts():
    async with AsyncSessionLocal() as s:
        events = (await s.execute(select(ClientCommunicationEvent))).scalars().all()
        attempts = (await s.execute(select(ClientCommunicationAttempt))).scalars().all()
        audits = (await s.execute(select(AuditLog))).scalars().all()
        return len(events), len(attempts), len(audits)


async def test_valid_delivered_callback_marks_delivered(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    event_id, attempt_id, _ = await _make_submitted_attempt("prov-delivered")
    payload = {"provider_reference": "prov-delivered", "provider_event_id": "evt-delivered", "normalized_status": "delivered"}
    resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 200, resp.text
    event, attempt, audits = await _state(attempt_id)
    assert event.status == "delivered"
    assert attempt.status == "delivered"
    assert attempt.delivered_at is not None
    assert any(a.action_type == "communication_delivered" for a in audits)
    assert resp.json()["data"]["event_id"] == event_id


async def test_valid_failed_callback_marks_failed(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    _, attempt_id, _ = await _make_submitted_attempt("prov-failed")
    payload = {"provider_reference": "prov-failed", "provider_event_id": "evt-failed", "normalized_status": "failed"}
    resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 200
    event, attempt, audits = await _state(attempt_id)
    assert event.status == "failed"
    assert attempt.status == "failed"
    assert attempt.delivery_failed_at is not None
    assert any(a.action_type == "communication_delivery_failed" for a in audits)


async def test_invalid_signature_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_submitted_attempt("prov-invalid-sig")
    payload = {"provider_reference": "prov-invalid-sig", "provider_event_id": "evt-invalid-sig", "normalized_status": "delivered"}
    body, headers = _headers(payload, monkeypatch)
    headers["X-FieldOS-Signature"] = "0" * 64
    resp = await client.post("/api/v1/client-communication/callbacks/generic", content=body, headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_signature"


async def test_expired_timestamp_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_submitted_attempt("prov-expired-ts")
    payload = {"provider_reference": "prov-expired-ts", "provider_event_id": "evt-expired-ts", "normalized_status": "delivered"}
    resp = await _post(client, monkeypatch, payload, offset=-999)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "expired_timestamp"


async def test_malformed_timestamp_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_submitted_attempt("prov-bad-ts")
    payload = {"provider_reference": "prov-bad-ts", "provider_event_id": "evt-bad-ts", "normalized_status": "delivered"}
    body, headers = _headers(payload, monkeypatch)
    headers["X-FieldOS-Timestamp"] = "not-a-timestamp"
    resp = await client.post("/api/v1/client-communication/callbacks/generic", content=body, headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_timestamp"


async def test_callback_secret_absent_fails_closed(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_submitted_attempt("prov-no-secret")
    monkeypatch.setattr(settings, "SMS_CALLBACK_SECRET", "")
    payload = {"provider_reference": "prov-no-secret", "provider_event_id": "evt-no-secret", "normalized_status": "delivered"}
    body = canonical_json(payload)
    resp = await client.post(
        "/api/v1/client-communication/callbacks/generic",
        content=body,
        headers={"content-type": "application/json", "X-FieldOS-Timestamp": str(int(time.time())), "X-FieldOS-Signature": "0" * 64},
    )
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "callback_secret_not_configured"


async def test_replay_attack_rejected_when_signature_reused_for_different_event(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    await _make_submitted_attempt("prov-replay-a")
    await _make_submitted_attempt("prov-replay-b")
    payload = {"provider_reference": "prov-replay-a", "provider_event_id": "evt-replay-a", "normalized_status": "delivered"}
    body, headers = _headers(payload, monkeypatch)
    assert (await client.post("/api/v1/client-communication/callbacks/generic", content=body, headers=headers)).status_code == 200
    tampered = {"provider_reference": "prov-replay-b", "provider_event_id": "evt-replay-b", "normalized_status": "delivered"}
    resp = await client.post("/api/v1/client-communication/callbacks/generic", content=canonical_json(tampered), headers=headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "replayed_callback"


async def test_duplicate_provider_event_id_idempotent(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    _, attempt_id, _ = await _make_submitted_attempt("prov-dupe")
    payload = {"provider_reference": "prov-dupe", "provider_event_id": "evt-dupe", "normalized_status": "delivered"}
    assert (await _post(client, monkeypatch, payload)).status_code == 200
    first_event, first_attempt, audits = await _state(attempt_id)
    first_delivered_at = first_attempt.delivered_at
    resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "duplicate"
    event, attempt, audits = await _state(attempt_id)
    assert event.status == first_event.status == "delivered"
    assert attempt.delivered_at == first_delivered_at
    assert sum(1 for a in audits if a.action_type == "communication_delivered") == 1
    assert any(a.action_type == "communication_callback_duplicate" for a in audits)


async def test_duplicate_provider_event_id_different_payload_rejected_as_conflict(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    _, attempt_id, _ = await _make_submitted_attempt("prov-conflict")
    payload = {"provider_reference": "prov-conflict", "provider_event_id": "evt-conflict", "normalized_status": "delivered"}
    assert (await _post(client, monkeypatch, payload)).status_code == 200
    conflict_payload = {"provider_reference": "prov-conflict", "provider_event_id": "evt-conflict", "normalized_status": "failed"}
    resp = await _post(client, monkeypatch, conflict_payload)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "provider_event_payload_conflict"
    event, attempt, audits = await _state(attempt_id)
    assert event.status == "delivered"
    assert attempt.status == "delivered"
    assert sum(1 for a in audits if a.action_type == "communication_delivered") == 1
    assert any("provider_event_payload_conflict" in (a.meta_json or "") for a in audits)


async def test_provider_event_id_scoped_by_provider(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    _, sparrow_attempt, _ = await _make_submitted_attempt("prov-scope-sparrow")
    _, jasmin_attempt, _ = await _make_submitted_attempt("prov-scope-jasmin")
    same_event_id = "same-provider-event-id"
    sparrow_payload = {"message_id": "prov-scope-sparrow", "event_id": same_event_id, "status": "delivered"}
    jasmin_payload = {"id_smsc": "prov-scope-jasmin", "dlr_id": same_event_id, "dlr_status": "DELIVRD"}
    assert (await _post(client, monkeypatch, sparrow_payload, provider="sparrow")).status_code == 200
    assert (await _post(client, monkeypatch, jasmin_payload, provider="jasmin")).status_code == 200
    assert (await _state(sparrow_attempt))[1].status == "delivered"
    assert (await _state(jasmin_attempt))[1].status == "delivered"


async def test_unknown_provider_reference_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    before_events, before_attempts, before_audits = await _counts()
    payload = {"provider_reference": "missing-ref", "provider_event_id": "evt-missing", "normalized_status": "delivered"}
    resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "unknown_provider_reference"
    after_events, after_attempts, after_audits = await _counts()
    assert after_events == before_events
    assert after_attempts == before_attempts
    assert after_audits == before_audits + 1


async def test_unknown_provider_status_does_not_deliver(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    _, attempt_id, _ = await _make_submitted_attempt("prov-unknown")
    payload = {"provider_reference": "prov-unknown", "provider_event_id": "evt-unknown", "status": "carrier_mystery"}
    resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 200
    event, attempt, audits = await _state(attempt_id)
    assert event.status == "provider_accepted"
    assert attempt.status == "submitted"
    assert attempt.delivered_at is None
    assert any(a.action_type == "communication_callback_out_of_order" for a in audits)


async def test_out_of_order_delivered_after_final_failed_does_not_overwrite(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    _, attempt_id, _ = await _make_submitted_attempt("prov-ooo", event_status="failed", attempt_status="failed")
    payload = {"provider_reference": "prov-ooo", "provider_event_id": "evt-ooo", "normalized_status": "delivered"}
    resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 200
    event, attempt, audits = await _state(attempt_id)
    assert event.status == "failed"
    assert attempt.status == "failed"
    assert attempt.delivered_at is None
    assert any(a.action_type == "communication_callback_out_of_order" for a in audits)


async def test_delivered_is_never_inferred_from_initial_submission():
    _, attempt_id, _ = await _make_submitted_attempt("prov-not-delivered")
    event, attempt, _ = await _state(attempt_id)
    assert event.status == "provider_accepted"
    assert attempt.status == "submitted"
    assert attempt.delivered_at is None


@pytest.mark.parametrize("event_status,attempt_status", [("confirmed", "confirmed"), ("disputed", "disputed"), ("cancelled", "cancelled")])
async def test_final_state_protections(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, event_status: str, attempt_status: str):
    _, attempt_id, _ = await _make_submitted_attempt(f"prov-final-{event_status}", event_status=event_status, attempt_status=attempt_status)
    payload = {"provider_reference": f"prov-final-{event_status}", "provider_event_id": f"evt-final-{event_status}", "normalized_status": "delivered"}
    resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 200
    event, attempt, audits = await _state(attempt_id)
    assert event.status == event_status
    assert attempt.status == attempt_status
    assert attempt.delivered_at is None
    assert any(a.action_type == "communication_callback_out_of_order" for a in audits)


async def test_sparrow_and_jasmin_simulated_payloads(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    _, sparrow_attempt, _ = await _make_submitted_attempt("sp-msg")
    _, jasmin_attempt, _ = await _make_submitted_attempt("js-msg")
    sparrow_payload = {"message_id": "sp-msg", "event_id": "sp-evt", "status": "delivered"}
    jasmin_payload = {"id_smsc": "js-msg", "dlr_id": "js-evt", "dlr_status": "DELIVRD"}
    assert (await _post(client, monkeypatch, sparrow_payload, provider="sparrow")).status_code == 200
    assert (await _post(client, monkeypatch, jasmin_payload, provider="jasmin")).status_code == 200
    assert (await _state(sparrow_attempt))[1].status == "delivered"
    assert (await _state(jasmin_attempt))[1].status == "delivered"


async def test_no_pii_or_secret_in_callback_audit_or_logs(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog):
    _, attempt_id, _ = await _make_submitted_attempt("prov-pii")
    payload = {"provider_reference": "prov-pii", "provider_event_id": "evt-pii", "normalized_status": "delivered", "recipient": PHONE, "message": "full message"}
    with caplog.at_level("INFO"):
        resp = await _post(client, monkeypatch, payload)
    assert resp.status_code == 200
    _, _, audits = await _state(attempt_id)
    audit_text = "\n".join(a.meta_json or "" for a in audits)
    log_text = "\n".join(r.getMessage() for r in caplog.records)
    assert PHONE not in audit_text
    assert PHONE not in log_text
    assert SECRET not in audit_text
    assert SECRET not in log_text
