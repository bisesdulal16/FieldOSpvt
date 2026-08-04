import json
import logging
from datetime import datetime

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationOutbox, SmsApprovedTemplate, SmsConsentEvidence
from app.models.sms_notification import SmsNotification
from app.services.communication_outbox_service import run_once
from app.services.communication_providers import LogSmsProvider, SparrowSmsProvider, normalize_nepal_phone
from app.services.sms_dispatch_safety import DispatchSafetyDecision
from app.services.sms_policy import recipient_hash, template_content_hash
from tests.test_communication_outbox_worker import _make_outbox

PHONE = "+977-9800000001"
TOKEN = "secret-sparrow-token"


class FakeResponse:
    def __init__(self, status_code=200, json_body=None, text="", headers=None):
        self.status_code = status_code
        self._json_body = json_body if json_body is not None else {}
        self.text = text
        self.headers = headers or {}

    def json(self):
        if self._json_body == "MALFORMED":
            raise ValueError("malformed json")
        return self._json_body


def _patch_sparrow_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "SMS_POLICY_HASH_PEPPER", "fake-test-pepper-material")
    monkeypatch.setattr(settings, "SMS_PROVIDER", "sparrow")
    monkeypatch.setattr(settings, "REAL_SMS_ENABLED", True)
    monkeypatch.setattr(settings, "SMS_PROVIDER_ALLOWLIST", "sparrow")
    monkeypatch.setattr(settings, "SMS_ALLOWED_RECIPIENTS", PHONE)
    monkeypatch.setattr(settings, "SMS_DAILY_SEND_LIMIT", 1)
    monkeypatch.setattr(settings, "SMS_PER_RECIPIENT_DAILY_LIMIT", 1)
    monkeypatch.setattr(settings, "SMS_MAX_COST_PER_DAY", 1)
    monkeypatch.setattr(settings, "SMS_EMERGENCY_STOP", False)
    monkeypatch.setattr(settings, "SMS_PROVIDER_IDEMPOTENCY_ENABLED", True)
    monkeypatch.setattr(settings, "SMS_PROVIDER_RECONCILIATION_ENABLED", True)
    monkeypatch.setattr(settings, "SMS_REQUIRE_APPROVED_TEMPLATE", False)
    monkeypatch.setattr(settings, "SMS_REQUIRE_CONSENT", False)
    monkeypatch.setattr(settings, "SMS_REQUIRE_SUPPRESSION_CHECK", False)
    monkeypatch.setattr(settings, "SMS_API_TOKEN", TOKEN)
    monkeypatch.setattr(settings, "SMS_SENDER", "FieldOS")
    monkeypatch.setattr(settings, "SMS_SPARROW_URL", "https://sparrow.test/sms")
    monkeypatch.setattr(settings, "SMS_REQUEST_TIMEOUT_SECONDS", 10)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    allow = DispatchSafetyDecision(True, "allowed_real_provider", "sparrow", "real_sms", "test override")
    monkeypatch.setattr("app.services.communication_outbox_service.evaluate_sms_dispatch_safety", lambda payload: allow)
    async def allow_async(payload, *, session, recipient_allowlist=None):
        return allow
    monkeypatch.setattr("app.services.communication_outbox_service.evaluate_sms_dispatch_safety_async", allow_async)
    monkeypatch.setattr("app.services.sms_dispatch_safety.evaluate_sms_dispatch_safety", lambda payload: allow)


async def _make_sparrow_outbox(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, receipt_id="RCPT-SPARROW-001"):
    _patch_sparrow_settings(monkeypatch)
    outbox_id = await _make_outbox(client, monkeypatch, receipt_id)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        payload = json.loads(outbox.payload_json)
        payload["provider"] = "sparrow"
        payload["template_key"] = "receipt"
        payload["template_version"] = "v1"
        payload["purpose"] = "collection_verification"
        payload["language"] = "en"
        outbox.payload_json = json.dumps(payload)
        attempt.provider = "sparrow"
        now = datetime.utcnow()
        s.add(SmsConsentEvidence(recipient_hash=recipient_hash(PHONE), purpose="collection_verification", status="granted", consent_source="test", consent_version="v1", granted_at=now, branch_id=1))
        s.add(SmsApprovedTemplate(template_key="receipt", version="v1", language="en", purpose="collection_verification", body_template=payload.get("message") or "test", allowed_variables_json="[]", content_hash=template_content_hash(payload.get("message") or "test", []), active=True, approval_status="approved", approved_at=now, branch_id=1))
        await s.commit()
    return outbox_id


def _mock_async_client(monkeypatch: pytest.MonkeyPatch, *, response: FakeResponse | None = None, exc: Exception | None = None, seen: dict | None = None):
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            self.kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            return False

        async def post(self, url, *, data=None, headers=None):
            if seen is not None:
                seen["url"] = url
                seen["data"] = data or {}
                seen["headers"] = headers or {}
            if exc is not None:
                raise exc
            return response or FakeResponse(200, {"message_id": "spw-123"})

    monkeypatch.setattr("app.services.communication_providers.httpx.AsyncClient", FakeAsyncClient)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("9800000001", "9800000001"),
        ("9700000001", "9700000001"),
        ("+9779800000001", "9800000001"),
        ("9779800000001", "9800000001"),
        ("98-0000-0001", "9800000001"),
    ],
)
def test_nepal_number_normalization(raw, expected):
    assert normalize_nepal_phone(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "9600000001", "980000001", "+919800000001", "abcd"])
def test_nepal_number_normalization_rejects_invalid(raw):
    with pytest.raises(ValueError):
        normalize_nepal_phone(raw)


async def test_successful_sparrow_response_marks_submitted_not_delivered_and_stores_reference(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch)
    _mock_async_client(monkeypatch, response=FakeResponse(200, {"message_id": "spw-abc"}))

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "published"

    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        legacy_rows = (await s.execute(select(SmsNotification).where(SmsNotification.collection_receipt_id == "RCPT-SPARROW-001"))).scalars().all()
    assert outbox.status == "published"
    assert attempt.status == "submitted"
    assert attempt.delivered_at is None
    assert attempt.provider_reference == "spw-abc"
    assert len(legacy_rows) == 1
    assert legacy_rows[0].status == "submitted"


async def test_sparrow_timeout_is_retryable(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch)
    _mock_async_client(monkeypatch, exc=httpx.TimeoutException("timeout"))

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "retry_scheduled"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "pending"
    assert attempt.status == "queued"


@pytest.mark.parametrize("status", [408, 409, 429, 500])
async def test_sparrow_retryable_http_statuses(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, status: int):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch, f"RCPT-SPARROW-{status}")
    _mock_async_client(monkeypatch, response=FakeResponse(status, text="temporary failure", headers={"retry-after": "90"}))

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "retry_scheduled"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "pending"
    assert outbox.available_at is not None
    assert attempt.status == "queued"


@pytest.mark.parametrize(
    "status,error_code",
    [
        (400, "provider_rejected_payload"),
        (401, "provider_authentication_error"),
        (403, "provider_authentication_error"),
        (404, "provider_endpoint_not_found"),
        (422, "provider_unprocessable_payload"),
    ],
)
async def test_sparrow_permanent_http_statuses(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, status: int, error_code: str):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch, f"RCPT-SPARROW-PERM-{status}")
    _mock_async_client(monkeypatch, response=FakeResponse(status, text="operator action"))

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "dead"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "dead"
    assert outbox.last_error_code == error_code
    assert attempt.status == "failed"


async def test_sparrow_malformed_success_response_is_permanent(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch, "RCPT-SPARROW-MALFORMED")
    _mock_async_client(monkeypatch, response=FakeResponse(200, "MALFORMED", text="not json"))

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "dead"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.last_error_code == "provider_malformed_response"


async def test_sparrow_connection_error_is_retryable(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch, "RCPT-SPARROW-CONNECTION")
    _mock_async_client(monkeypatch, exc=httpx.ConnectError("connection failed"))

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "retry_scheduled"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.status == "pending"


async def test_sparrow_auth_error_is_permanent(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch)
    _mock_async_client(monkeypatch, response=FakeResponse(401, text="bad token"))

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "dead"
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "dead"
    assert outbox.last_error_code == "provider_authentication_error"
    assert attempt.status == "failed"


async def test_sparrow_invalid_recipient_is_permanent(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        payload = json.loads(outbox.payload_json)
        payload["recipient"] = "12345"
        outbox.payload_json = json.dumps(payload)
        attempt.recipient = "12345"
        await s.commit()

    result = await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "dead"


async def test_sparrow_token_and_full_phone_absent_from_logs(client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog):
    await _make_sparrow_outbox(client, monkeypatch)
    _mock_async_client(monkeypatch, response=FakeResponse(200, {"message_id": "spw-log"}))
    caplog.set_level(logging.INFO)

    await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    app_logs = "\n".join(record.getMessage() for record in caplog.records if not record.name.startswith("sqlalchemy.engine"))
    assert TOKEN not in app_logs
    assert PHONE not in app_logs
    assert "9800000001" not in app_logs


async def test_sparrow_uses_outbox_idempotency_key_header(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    seen = {}
    outbox_id = await _make_sparrow_outbox(client, monkeypatch)
    _mock_async_client(monkeypatch, response=FakeResponse(200, {"message_id": "spw-idem"}), seen=seen)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        expected = outbox.idempotency_key

    await run_once(worker_id="sparrow-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert seen["headers"]["X-FieldOS-Idempotency-Key"] == expected
    assert seen["data"]["token"] == TOKEN
    assert seen["data"]["to"] == "9800000001"


async def test_duplicate_worker_retry_respects_existing_submitted_reference(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    outbox_id = await _make_sparrow_outbox(client, monkeypatch)
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        outbox.status = "processing"
        outbox.locked_by = "worker-a"
        attempt.status = "submitted"
        attempt.provider_reference = "already-submitted"
        await s.commit()

    result = await run_once(worker_id="worker-a", batch_size=1, jitter_fn=lambda _: 0)
    assert result == []
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
    assert outbox.status == "processing"
    assert attempt.provider_reference == "already-submitted"


async def test_log_provider_remains_functional(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "SMS_PROVIDER", "log")
    provider = LogSmsProvider(fail_percent=0)
    result = await provider.dispatch(
        type("Attempt", (), {"channel": "sms", "provider": "log", "recipient": PHONE})(),
        {"channel": "sms", "provider": "log", "recipient": PHONE, "message": "test"},
        idempotency_key="client_comm:test",
    )
    assert result.outcome == "success"
    assert result.provider_status == "submitted"
