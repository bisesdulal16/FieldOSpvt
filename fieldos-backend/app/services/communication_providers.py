from __future__ import annotations

import hashlib
import json
import logging
import random
from dataclasses import dataclass
from typing import Literal

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


class LogSmsProvider(CommunicationProvider):
    """Safe local provider for Phase 2: logs masked metadata and simulates submission only."""

    def __init__(self, *, fail_percent: float | None = None, rng: random.Random | None = None):
        self.fail_percent = settings.OUTBOX_LOG_PROVIDER_FAIL_PERCENT if fail_percent is None else fail_percent
        self.rng = rng or random.Random()

    async def dispatch(self, attempt, payload: dict, *, idempotency_key: str) -> DispatchResult:
        channel = str(payload.get("channel") or getattr(attempt, "channel", ""))
        provider = str(payload.get("provider") or getattr(attempt, "provider", ""))
        recipient = payload.get("recipient") or getattr(attempt, "recipient", None)

        if channel != "sms":
            return DispatchResult(
                outcome="permanent_failure",
                error_code="unsupported_channel",
                safe_error_message="unsupported communication channel",
                idempotency_key_used=idempotency_key,
            )
        if provider not in {"log", "log_sms"}:
            return DispatchResult(
                outcome="permanent_failure",
                error_code="unknown_provider",
                safe_error_message="unknown communication provider",
                idempotency_key_used=idempotency_key,
            )
        if not isinstance(payload, dict) or "message" not in payload:
            return DispatchResult(
                outcome="permanent_failure",
                error_code="malformed_payload",
                safe_error_message="malformed communication payload",
                idempotency_key_used=idempotency_key,
            )
        if not recipient:
            return DispatchResult(
                outcome="permanent_failure",
                error_code="no_destination",
                safe_error_message="missing destination",
                idempotency_key_used=idempotency_key,
            )
        digits = "".join(ch for ch in str(recipient) if ch.isdigit())
        if len(digits) < 7:
            return DispatchResult(
                outcome="permanent_failure",
                error_code="invalid_destination",
                safe_error_message="invalid destination",
                idempotency_key_used=idempotency_key,
            )

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
            return DispatchResult(
                outcome="retryable_failure",
                error_code="log_provider_injected_failure",
                safe_error_message="log provider injected failure",
                idempotency_key_used=idempotency_key,
            )

        digest = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:16]
        provider_reference = f"log_sms_{digest}"
        logger.info(
            "communication log provider submitted",
            extra={
                "provider": "log",
                "channel": "sms",
                "recipient_masked": mask_phone(str(recipient)),
                "idempotency_key_hash": digest,
            },
        )
        return DispatchResult(
            outcome="success",
            provider_reference=provider_reference,
            provider_status="submitted",
            idempotency_key_used=idempotency_key,
        )


def provider_for(payload: dict) -> CommunicationProvider:
    provider = str(payload.get("provider") or "log").lower()
    if provider in {"log", "log_sms"}:
        return LogSmsProvider()
    # Unknown providers are represented as permanent failures by LogSmsProvider.
    payload = dict(payload)
    payload["provider"] = provider
    return LogSmsProvider()


def parse_payload(payload_json: str | None) -> dict:
    if not payload_json:
        return {}
    parsed = json.loads(payload_json)
    return parsed if isinstance(parsed, dict) else {}
