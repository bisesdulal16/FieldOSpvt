from __future__ import annotations

import hashlib
import json
import logging
import random
from dataclasses import dataclass
from typing import Literal

import httpx

from app.config import settings
from app.services.client_communication_service import mask_phone

logger = logging.getLogger(__name__)

ProviderOutcome = Literal["success", "retryable_failure", "permanent_failure"]


@dataclass(slots=True)
class DispatchResult:
    outcome: ProviderOutcome
    provider_reference: str | None = None
    provider_status: str | None = None
    error_code: str | None = None
    safe_error_message: str | None = None
    retry_after_seconds: int | None = None
    idempotency_key_used: str | None = None

    @property
    def is_success(self) -> bool:
        return self.outcome == "success"


class CommunicationProvider:
    async def dispatch(self, attempt, payload: dict, *, idempotency_key: str) -> DispatchResult:
        raise NotImplementedError


def normalize_nepal_phone(phone: str | None) -> str:
    """Normalize approved Nepal mobile formats to national 98/97XXXXXXXX form.

    Supports: 98XXXXXXXX, 97XXXXXXXX, +97798XXXXXXXX, 97798XXXXXXXX.
    Raises ValueError for malformed or unsupported destinations.
    """
    if not phone:
        raise ValueError("missing destination")
    raw = str(phone).strip().replace(" ", "").replace("-", "")
    if raw.startswith("+"):
        raw = raw[1:]
    if not raw.isdigit():
        raise ValueError("invalid destination format")
    if len(raw) == 10 and raw.startswith(("98", "97")):
        return raw
    if len(raw) == 13 and raw.startswith(("97798", "97797")):
        return raw[3:]
    raise ValueError("unsupported destination format")


def _safe_response_reference(response_json: dict, fallback: str) -> str:
    for key in ("message_id", "messageId", "id", "reference", "ref", "response_code", "count"):
        value = response_json.get(key)
        if value not in (None, ""):
            return str(value)[:120]
    return fallback


def _retry_after_from_headers(headers) -> int | None:
    value = headers.get("retry-after") if headers else None
    if not value:
        return None
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return None


def _bounded_sender(sender: str) -> str:
    sender = str(sender or "").strip()
    if not sender:
        raise ValueError("missing sender")
    if len(sender) > 20:
        raise ValueError("sender value too long")
    return sender


class LogSmsProvider(CommunicationProvider):
    """Safe local provider: logs masked metadata and simulates submission only."""

    def __init__(self, *, fail_percent: float | None = None, rng: random.Random | None = None):
        self.fail_percent = settings.OUTBOX_LOG_PROVIDER_FAIL_PERCENT if fail_percent is None else fail_percent
        self.rng = rng or random.Random()

    async def dispatch(self, attempt, payload: dict, *, idempotency_key: str) -> DispatchResult:
        channel = str(payload.get("channel") or getattr(attempt, "channel", ""))
        provider = str(payload.get("provider") or getattr(attempt, "provider", ""))
        recipient = payload.get("recipient") or getattr(attempt, "recipient", None)

        if channel != "sms":
            return DispatchResult("permanent_failure", error_code="unsupported_channel", safe_error_message="unsupported communication channel", idempotency_key_used=idempotency_key)
        if provider not in {"log", "log_sms"}:
            return DispatchResult("permanent_failure", error_code="unknown_provider", safe_error_message="unknown communication provider", idempotency_key_used=idempotency_key)
        if not isinstance(payload, dict) or "message" not in payload:
            return DispatchResult("permanent_failure", error_code="malformed_payload", safe_error_message="malformed communication payload", idempotency_key_used=idempotency_key)
        if not recipient:
            return DispatchResult("permanent_failure", error_code="no_destination", safe_error_message="missing destination", idempotency_key_used=idempotency_key)
        digits = "".join(ch for ch in str(recipient) if ch.isdigit())
        if len(digits) < 7:
            return DispatchResult("permanent_failure", error_code="invalid_destination", safe_error_message="invalid destination", idempotency_key_used=idempotency_key)

        injection = payload.get("test_failure")
        if injection in {"retryable", "permanent"}:
            return DispatchResult(
                outcome="retryable_failure" if injection == "retryable" else "permanent_failure",
                error_code=f"log_provider_{injection}_failure",
                safe_error_message=f"log provider {injection} failure",
                retry_after_seconds=int(payload.get("retry_after_seconds") or 0) or None,
                idempotency_key_used=idempotency_key,
            )
        if self.fail_percent > 0 and self.rng.random() < (self.fail_percent / 100.0):
            return DispatchResult("retryable_failure", error_code="log_provider_injected_failure", safe_error_message="log provider injected failure", idempotency_key_used=idempotency_key)

        digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:16]
        provider_reference = f"log_sms_{digest}"
        logger.info(
            "communication log provider submitted",
            extra={"provider": "log", "channel": "sms", "recipient_masked": mask_phone(str(recipient)), "idempotency_key_hash": digest},
        )
        return DispatchResult("success", provider_reference=provider_reference, provider_status="submitted", idempotency_key_used=idempotency_key)


class SparrowSmsProvider(CommunicationProvider):
    """Sparrow SMS HTTP provider using normalized FieldOS provider results."""

    live_readiness_verified = False

    async def dispatch(self, attempt, payload: dict, *, idempotency_key: str) -> DispatchResult:
        channel = str(payload.get("channel") or getattr(attempt, "channel", ""))
        if channel != "sms":
            return DispatchResult("permanent_failure", error_code="unsupported_channel", safe_error_message="unsupported communication channel", idempotency_key_used=idempotency_key)
        if not isinstance(payload, dict) or "message" not in payload:
            return DispatchResult("permanent_failure", error_code="malformed_payload", safe_error_message="malformed communication payload", idempotency_key_used=idempotency_key)
        from app.services.sms_dispatch_safety import evaluate_sms_dispatch_safety

        if payload.get("sms_policy_approved") is not True:
            safety_decision = evaluate_sms_dispatch_safety(payload)
            if not safety_decision.allowed:
                return safety_decision.to_result(idempotency_key=idempotency_key)
        if not settings.SMS_API_TOKEN or not settings.SMS_SENDER or not settings.SMS_SPARROW_URL:
            return DispatchResult("permanent_failure", error_code="provider_configuration_error", safe_error_message="Sparrow SMS provider is not configured", idempotency_key_used=idempotency_key)
        try:
            sender = _bounded_sender(settings.SMS_SENDER)
        except ValueError as exc:
            return DispatchResult("permanent_failure", error_code="provider_configuration_error", safe_error_message=str(exc), idempotency_key_used=idempotency_key)

        recipient_raw = payload.get("recipient") or getattr(attempt, "recipient", None)
        try:
            recipient = normalize_nepal_phone(recipient_raw)
        except ValueError as exc:
            return DispatchResult("permanent_failure", error_code="invalid_destination", safe_error_message=str(exc), idempotency_key_used=idempotency_key)

        digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:16]
        logger.info(
            "communication Sparrow provider dispatching",
            extra={"provider": "sparrow", "channel": "sms", "recipient_masked": mask_phone(recipient), "idempotency_key_hash": digest},
        )
        try:
            async with httpx.AsyncClient(timeout=settings.SMS_REQUEST_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    settings.SMS_SPARROW_URL,
                    data={
                        "token": settings.SMS_API_TOKEN,
                        "from": sender,
                        "to": recipient,
                        "text": str(payload.get("message") or ""),
                    },
                    headers={"X-FieldOS-Idempotency-Key": idempotency_key},
                )
        except httpx.TimeoutException:
            return DispatchResult("retryable_failure", error_code="provider_timeout", safe_error_message="Sparrow provider request timed out", idempotency_key_used=idempotency_key)
        except (httpx.ConnectError, httpx.NetworkError, httpx.TransportError):
            return DispatchResult("retryable_failure", error_code="provider_connection_error", safe_error_message="Sparrow provider temporarily unavailable", idempotency_key_used=idempotency_key)

        retry_after = _retry_after_from_headers(response.headers)
        try:
            response_json = response.json()
            if not isinstance(response_json, dict):
                response_json = None
        except ValueError:
            response_json = None

        if 200 <= response.status_code < 300:
            if response_json is None:
                return DispatchResult("permanent_failure", error_code="provider_malformed_response", safe_error_message="Sparrow returned malformed success response", idempotency_key_used=idempotency_key)
            provider_reference = _safe_response_reference(response_json, fallback=f"sparrow_{digest}")
            return DispatchResult("success", provider_reference=provider_reference, provider_status="provider_accepted", idempotency_key_used=idempotency_key)
        if response.status_code == 408:
            return DispatchResult("retryable_failure", error_code="provider_request_timeout", safe_error_message="Sparrow request timed out", retry_after_seconds=retry_after, idempotency_key_used=idempotency_key)
        if response.status_code == 409:
            return DispatchResult("retryable_failure", error_code="provider_conflict", safe_error_message="Sparrow reported a temporary request conflict", retry_after_seconds=retry_after, idempotency_key_used=idempotency_key)
        if response.status_code == 429:
            return DispatchResult("retryable_failure", error_code="provider_rate_limited", safe_error_message="Sparrow provider rate limited request", retry_after_seconds=retry_after, idempotency_key_used=idempotency_key)
        if 500 <= response.status_code <= 599:
            return DispatchResult("retryable_failure", error_code="provider_server_error", safe_error_message="Sparrow provider server error", retry_after_seconds=retry_after, idempotency_key_used=idempotency_key)
        if response.status_code in {401, 403}:
            return DispatchResult("permanent_failure", error_code="provider_authentication_error", safe_error_message="Sparrow authentication/configuration requires operator action", idempotency_key_used=idempotency_key)
        if response.status_code == 400:
            return DispatchResult("permanent_failure", error_code="provider_rejected_payload", safe_error_message="Sparrow rejected malformed request", idempotency_key_used=idempotency_key)
        if response.status_code == 404:
            return DispatchResult("permanent_failure", error_code="provider_endpoint_not_found", safe_error_message="Sparrow endpoint/configuration requires operator action", idempotency_key_used=idempotency_key)
        if response.status_code == 422:
            return DispatchResult("permanent_failure", error_code="provider_unprocessable_payload", safe_error_message="Sparrow rejected request payload", idempotency_key_used=idempotency_key)
        return DispatchResult("permanent_failure", error_code=f"provider_http_{response.status_code}", safe_error_message="Sparrow rejected request", idempotency_key_used=idempotency_key)


class FakeVerifiedRealSmsProvider(CommunicationProvider):
    async def dispatch(self, attempt, payload: dict, *, idempotency_key: str) -> DispatchResult:
        if not isinstance(payload, dict) or "message" not in payload:
            return DispatchResult("permanent_failure", error_code="malformed_payload", safe_error_message="malformed communication payload", idempotency_key_used=idempotency_key)
        return DispatchResult("success", provider_reference=f"fake_verified_{hashlib.sha256(idempotency_key.encode()).hexdigest()[:16]}", provider_status="provider_accepted", idempotency_key_used=idempotency_key)

def provider_for(payload: dict) -> CommunicationProvider:
    provider = str(payload.get("provider") or settings.SMS_PROVIDER or "log").lower()
    if provider in {"log", "log_sms"}:
        return LogSmsProvider()
    if provider == "fake_verified_real_sms":
        return FakeVerifiedRealSmsProvider()
    if provider in {"sparrow", "sparrow_http"}:
        return SparrowSmsProvider()
    return UnknownProvider(provider)


class UnknownProvider(CommunicationProvider):
    def __init__(self, provider: str):
        self.provider = provider

    async def dispatch(self, attempt, payload: dict, *, idempotency_key: str) -> DispatchResult:
        return DispatchResult("permanent_failure", error_code="unknown_provider", safe_error_message="unknown communication provider", idempotency_key_used=idempotency_key)


def parse_payload(payload_json: str | None) -> dict:
    if not payload_json:
        return {}
    parsed = json.loads(payload_json)
    return parsed if isinstance(parsed, dict) else {}
