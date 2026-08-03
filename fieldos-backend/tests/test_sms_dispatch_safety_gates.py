import json
import logging

import pytest

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.services.communication_broker import ConsumerOutcome, process_envelope
from app.services.communication_outbox_service import run_once
from app.services.communication_providers import DispatchResult, LogSmsProvider, SparrowSmsProvider, provider_for
from app.services.sms_dispatch_safety import classify_sms_provider, evaluate_sms_dispatch_safety
from app.services.sms_service import send_sms
from tests.test_communication_outbox_worker import _make_outbox

PHONE = "+977-9800000001"
MESSAGE = "private body must not be logged"


def _safe_defaults(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "SMS_PROVIDER", "log")
    monkeypatch.setattr(settings, "REAL_SMS_ENABLED", False)
    monkeypatch.setattr(settings, "SMS_PROVIDER_ALLOWLIST", "log")
    monkeypatch.setattr(settings, "SMS_ALLOWED_RECIPIENTS", "")
    monkeypatch.setattr(settings, "SMS_DAILY_SEND_LIMIT", 0)
    monkeypatch.setattr(settings, "SMS_PER_RECIPIENT_DAILY_LIMIT", 0)
    monkeypatch.setattr(settings, "SMS_MAX_COST_PER_DAY", 0)
    monkeypatch.setattr(settings, "SMS_EMERGENCY_STOP", True)
    monkeypatch.setattr(settings, "SMS_PROVIDER_IDEMPOTENCY_ENABLED", False)
    monkeypatch.setattr(settings, "SMS_PROVIDER_RECONCILIATION_ENABLED", False)
    monkeypatch.setattr(settings, "SMS_REQUIRE_APPROVED_TEMPLATE", True)
    monkeypatch.setattr(settings, "SMS_REQUIRE_CONSENT", True)
    monkeypatch.setattr(settings, "SMS_REQUIRE_SUPPRESSION_CHECK", True)
    monkeypatch.setattr(settings, "SMS_API_TOKEN", "")


def _real_sms_baseline(monkeypatch: pytest.MonkeyPatch):
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


def _sparrow_payload():
    return {"channel": "sms", "provider": "sparrow", "recipient": PHONE, "message": MESSAGE}


async def _make_real_provider_outbox(client, monkeypatch, provider="sparrow"):
    outbox_id = await _make_outbox(client, monkeypatch, "RCPT-SAFETY-001")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        payload = json.loads(outbox.payload_json)
        payload.update({"provider": provider, "message": MESSAGE})
        outbox.payload_json = json.dumps(payload)
        attempt.provider = provider
        await s.commit()
    return outbox_id


async def test_log_sms_provider_works_under_safe_defaults(client, monkeypatch):
    _safe_defaults(monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    await _make_outbox(client, monkeypatch, "RCPT-SAFE-LOG")

    results = await run_once(worker_id="safe-log", batch_size=1, jitter_fn=lambda _: 0)

    assert results[0].status == "published"
    assert results[0].provider_called is True


async def test_sparrow_is_blocked_under_safe_defaults_and_provider_not_invoked(client, monkeypatch):
    _safe_defaults(monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    outbox_id = await _make_real_provider_outbox(client, monkeypatch)

    def fail_provider_for(payload):
        raise AssertionError("provider adapter must not be selected for blocked real SMS")

    monkeypatch.setattr("app.services.communication_outbox_service.provider_for", fail_provider_for)
    results = await run_once(worker_id="safe-sparrow", batch_size=1, jitter_fn=lambda _: 0)

    assert results[0].status == "dead"
    assert results[0].provider_called is False
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.last_error_code == "blocked_real_sms_disabled"


async def test_sms_provider_sparrow_alone_cannot_send(monkeypatch):
    _safe_defaults(monkeypatch)
    monkeypatch.setattr(settings, "SMS_PROVIDER", "sparrow")
    seen = {"called": False}

    class FailAsyncClient:
        async def __aenter__(self):
            seen["called"] = True
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            return False

    monkeypatch.setattr("app.services.communication_providers.httpx.AsyncClient", FailAsyncClient)
    result = await SparrowSmsProvider().dispatch(
        type("Attempt", (), {"channel": "sms", "provider": "sparrow", "recipient": PHONE})(),
        {"channel": "sms", "recipient": PHONE, "message": MESSAGE},
        idempotency_key="safety:sparrow-alone",
    )

    assert result.outcome == "permanent_failure"
    assert result.error_code == "blocked_real_sms_disabled"
    assert seen["called"] is False


@pytest.mark.parametrize(
    "setting,value,expected_code",
    [
        ("REAL_SMS_ENABLED", True, "blocked_emergency_stop"),
        ("SMS_EMERGENCY_STOP", True, "blocked_emergency_stop"),
        ("SMS_PROVIDER_ALLOWLIST", "log", "blocked_provider_not_allowlisted"),
        ("SMS_ALLOWED_RECIPIENTS", "", "blocked_recipient_not_allowlisted"),
        ("SMS_DAILY_SEND_LIMIT", 0, "blocked_daily_limit_closed"),
        ("SMS_PER_RECIPIENT_DAILY_LIMIT", 0, "blocked_per_recipient_daily_limit_closed"),
        ("SMS_MAX_COST_PER_DAY", 0, "blocked_cost_limit_closed"),
    ],
)
def test_individual_safety_gates_fail_closed(monkeypatch, setting, value, expected_code):
    _real_sms_baseline(monkeypatch)
    if setting == "REAL_SMS_ENABLED":
        # REAL_SMS_ENABLED=true alone still cannot send because emergency stop remains active.
        _safe_defaults(monkeypatch)
        monkeypatch.setattr(settings, "REAL_SMS_ENABLED", value)
    elif setting == "SMS_EMERGENCY_STOP":
        monkeypatch.setattr(settings, setting, value)
    elif setting == "SMS_PROVIDER_ALLOWLIST":
        monkeypatch.setattr(settings, setting, value)
    elif setting == "SMS_ALLOWED_RECIPIENTS":
        monkeypatch.setattr(settings, setting, value)
    elif setting == "SMS_DAILY_SEND_LIMIT":
        monkeypatch.setattr(settings, setting, value)
    elif setting == "SMS_PER_RECIPIENT_DAILY_LIMIT":
        monkeypatch.setattr(settings, setting, value)
    elif setting == "SMS_MAX_COST_PER_DAY":
        monkeypatch.setattr(settings, setting, value)

    decision = evaluate_sms_dispatch_safety(_sparrow_payload())
    assert decision.allowed is False
    assert decision.code == expected_code


def test_missing_future_services_block_real_providers(monkeypatch):
    _real_sms_baseline(monkeypatch)
    monkeypatch.setattr(settings, "SMS_REQUIRE_APPROVED_TEMPLATE", True)
    monkeypatch.setattr(settings, "SMS_REQUIRE_CONSENT", True)
    monkeypatch.setattr(settings, "SMS_REQUIRE_SUPPRESSION_CHECK", True)

    decision = evaluate_sms_dispatch_safety(_sparrow_payload())

    assert decision.allowed is False
    assert decision.code == "blocked_template_service_missing"


def test_unknown_provider_fails_closed(monkeypatch):
    _safe_defaults(monkeypatch)
    decision = evaluate_sms_dispatch_safety({"channel": "sms", "provider": "rogue", "recipient": PHONE, "message": MESSAGE})

    assert decision.allowed is False
    assert decision.code == "blocked_unknown_provider"


def test_malformed_configuration_fails_closed(monkeypatch):
    _real_sms_baseline(monkeypatch)
    monkeypatch.setattr(settings, "SMS_DAILY_SEND_LIMIT", "not-an-int")

    decision = evaluate_sms_dispatch_safety(_sparrow_payload())

    assert decision.allowed is False
    assert decision.code == "blocked_malformed_configuration"


async def test_blocked_path_logs_exclude_recipient_and_message_body(client, monkeypatch, caplog):
    _safe_defaults(monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    await _make_real_provider_outbox(client, monkeypatch)
    caplog.set_level(logging.WARNING)

    await run_once(worker_id="safe-log-redaction", batch_size=1, jitter_fn=lambda _: 0)

    app_logs = "\n".join(record.getMessage() for record in caplog.records if not record.name.startswith("sqlalchemy.engine"))
    assert PHONE not in app_logs
    assert "9800000001" not in app_logs
    assert MESSAGE not in app_logs


async def test_log_sms_provider_direct_dispatch_remains_usable(monkeypatch):
    _safe_defaults(monkeypatch)
    result = await LogSmsProvider(fail_percent=0).dispatch(
        type("Attempt", (), {"channel": "sms", "provider": "log", "recipient": PHONE})(),
        {"channel": "sms", "provider": "log", "recipient": PHONE, "message": MESSAGE},
        idempotency_key="safety:log-direct",
    )

    assert result.outcome == "success"
    assert result.provider_status == "submitted"



def test_provider_classification_aliases_casing_and_unknowns(monkeypatch):
    assert classify_sms_provider("log") == "safe_log"
    assert classify_sms_provider("LOG_SMS") == "safe_log"
    assert classify_sms_provider("sparrow") == "real_sms"
    assert classify_sms_provider("SPARROW_HTTP") == "real_sms"
    assert classify_sms_provider(" sparrow ") == "real_sms"
    assert classify_sms_provider("custom") == "unknown"
    assert type(provider_for({"provider": "custom"})).__name__ == "UnknownProvider"
    assert type(provider_for({"provider": "LOG"})).__name__ == "LogSmsProvider"
    assert type(provider_for({"provider": "SPARROW"})).__name__ == "SparrowSmsProvider"


def test_provider_substitution_cannot_inherit_safe_log(monkeypatch):
    _real_sms_baseline(monkeypatch)
    payload = {"channel": "sms", "provider": "log-sparrow", "recipient": PHONE, "message": MESSAGE, "is_safe": True}

    decision = evaluate_sms_dispatch_safety(payload)

    assert decision.allowed is False
    assert decision.code == "blocked_unknown_provider"


@pytest.mark.parametrize("recipient", ["9800000001", "+9779800000001", "9779800000001", "98-0000-0001"])
def test_recipient_allowlist_normalizes_equivalent_nepal_formats(monkeypatch, recipient):
    _real_sms_baseline(monkeypatch)
    monkeypatch.setattr(settings, "SMS_ALLOWED_RECIPIENTS", "+977-9800000001")
    payload = {"channel": "sms", "provider": "sparrow", "recipient": recipient, "message": MESSAGE}

    decision = evaluate_sms_dispatch_safety(payload)

    assert decision.code != "blocked_recipient_not_allowlisted"


def test_recipient_allowlist_uses_exact_normalized_match_not_suffix(monkeypatch):
    _real_sms_baseline(monkeypatch)
    monkeypatch.setattr(settings, "SMS_ALLOWED_RECIPIENTS", "+977-9800000001")
    payload = {"channel": "sms", "provider": "sparrow", "recipient": "+977-9700000001", "message": MESSAGE}

    decision = evaluate_sms_dispatch_safety(payload)

    assert decision.allowed is False
    assert decision.code == "blocked_recipient_not_allowlisted"


def test_malformed_allowlist_fails_closed(monkeypatch):
    _real_sms_baseline(monkeypatch)
    monkeypatch.setattr(settings, "SMS_ALLOWED_RECIPIENTS", "not-a-number")

    decision = evaluate_sms_dispatch_safety(_sparrow_payload())

    assert decision.allowed is False
    assert decision.code == "blocked_malformed_configuration"


def test_positive_limits_still_block_without_atomic_quota_reservation(monkeypatch):
    _real_sms_baseline(monkeypatch)

    decision = evaluate_sms_dispatch_safety(_sparrow_payload())

    assert decision.allowed is False
    assert decision.code == "blocked_atomic_quota_unavailable"


def test_suppression_check_takes_priority_after_all_other_approvals(monkeypatch):
    _real_sms_baseline(monkeypatch)
    monkeypatch.setattr(settings, "SMS_REQUIRE_APPROVED_TEMPLATE", True)
    monkeypatch.setattr(settings, "SMS_REQUIRE_CONSENT", True)
    monkeypatch.setattr(settings, "SMS_REQUIRE_SUPPRESSION_CHECK", True)

    class Template:
        def is_template_approved(self, *, payload):
            return True

    class Consent:
        def has_sms_consent(self, *, recipient, payload):
            return True

    class Suppression:
        def is_suppressed(self, *, recipient, payload):
            return True

    decision = evaluate_sms_dispatch_safety(
        _sparrow_payload(),
        template_service=Template(),
        consent_service=Consent(),
        suppression_service=Suppression(),
    )

    assert decision.allowed is False
    assert decision.code == "blocked_suppression_service_missing"


@pytest.mark.parametrize("service_name", ["template", "consent", "suppression"])
def test_service_exception_fails_closed_as_malformed_configuration(monkeypatch, service_name):
    _real_sms_baseline(monkeypatch)
    monkeypatch.setattr(settings, "SMS_REQUIRE_APPROVED_TEMPLATE", service_name == "template")
    monkeypatch.setattr(settings, "SMS_REQUIRE_CONSENT", service_name == "consent")
    monkeypatch.setattr(settings, "SMS_REQUIRE_SUPPRESSION_CHECK", service_name == "suppression")

    class ExplodingTemplate:
        def is_template_approved(self, *, payload):
            raise TimeoutError("template down")

    class ExplodingConsent:
        def has_sms_consent(self, *, recipient, payload):
            raise TimeoutError("consent down")

    class ExplodingSuppression:
        def is_suppressed(self, *, recipient, payload):
            raise TimeoutError("suppression down")

    decision = evaluate_sms_dispatch_safety(
        _sparrow_payload(),
        template_service=ExplodingTemplate() if service_name == "template" else None,
        consent_service=ExplodingConsent() if service_name == "consent" else None,
        suppression_service=ExplodingSuppression() if service_name == "suppression" else None,
    )

    assert decision.allowed is False
    assert decision.code == "blocked_malformed_configuration"


async def test_legacy_send_sms_path_blocks_before_http(monkeypatch):
    _safe_defaults(monkeypatch)
    monkeypatch.setattr(settings, "SMS_PROVIDER", "sparrow")
    seen = {"called": False}

    class FailAsyncClient:
        async def __aenter__(self):
            seen["called"] = True
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            return False

    monkeypatch.setattr("app.services.sms_service.httpx.AsyncClient", FailAsyncClient)
    ok, error = await send_sms(PHONE, MESSAGE)

    assert ok is False
    assert error == "blocked_real_sms_disabled"
    assert seen["called"] is False


async def test_rabbitmq_consumer_process_envelope_blocks_before_provider(client, monkeypatch):
    _safe_defaults(monkeypatch)
    outbox_id = await _make_real_provider_outbox(client, monkeypatch, provider="sparrow")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
        attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
        event = await s.get(ClientCommunicationEvent, outbox.event_id)
        outbox.status = "broker_published"
        attempt.status = "queued"
        event.status = "queued"
        await s.commit()
        envelope = {
            "schema_version": 1,
            "message_id": "m-safety",
            "idempotency_key": outbox.idempotency_key,
            "outbox_id": outbox.id,
            "event_id": event.id,
            "attempt_id": attempt.id,
            "channel": "sms",
            "purpose": event.purpose,
            "created_at": "2026-08-03T00:00:00Z",
            "trace_id": "trace-safety",
        }

    def fail_provider_for(payload):
        raise AssertionError("RabbitMQ consumer must block before selecting provider")

    monkeypatch.setattr("app.services.communication_broker.provider_for", fail_provider_for)
    result = await process_envelope(envelope, worker_id="safety-consumer")

    assert result.outcome == ConsumerOutcome.PERMANENT_INVALID
    assert result.provider_called is False
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, outbox_id)
    assert outbox.last_error_code == "blocked_real_sms_disabled"
