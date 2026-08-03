from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from app.config import settings

logger = logging.getLogger(__name__)

SAFE_LOG_PROVIDERS = {"log", "log_sms"}
REAL_SMS_PROVIDERS = {"sparrow", "sparrow_http"}
KNOWN_SMS_PROVIDERS = SAFE_LOG_PROVIDERS | REAL_SMS_PROVIDERS

DECISION_ALLOWED_LOG_PROVIDER = "allowed_log_provider"
DECISION_ALLOWED_REAL_PROVIDER = "allowed_real_provider"
DECISION_UNKNOWN_PROVIDER = "blocked_unknown_provider"
DECISION_MALFORMED_CONFIGURATION = "blocked_malformed_configuration"
DECISION_REAL_SMS_DISABLED = "blocked_real_sms_disabled"
DECISION_EMERGENCY_STOP = "blocked_emergency_stop"
DECISION_PROVIDER_NOT_ALLOWLISTED = "blocked_provider_not_allowlisted"
DECISION_RECIPIENT_NOT_ALLOWLISTED = "blocked_recipient_not_allowlisted"
DECISION_DAILY_LIMIT_CLOSED = "blocked_daily_limit_closed"
DECISION_PER_RECIPIENT_LIMIT_CLOSED = "blocked_per_recipient_daily_limit_closed"
DECISION_COST_LIMIT_CLOSED = "blocked_cost_limit_closed"
DECISION_IDEMPOTENCY_UNCERTAIN = "blocked_idempotency_uncertain"
DECISION_RECONCILIATION_UNAVAILABLE = "blocked_reconciliation_unavailable"
DECISION_ATOMIC_QUOTA_UNAVAILABLE = "blocked_atomic_quota_unavailable"
DECISION_TEMPLATE_SERVICE_MISSING = "blocked_template_service_missing"
DECISION_CONSENT_SERVICE_MISSING = "blocked_consent_service_missing"
DECISION_SUPPRESSION_SERVICE_MISSING = "blocked_suppression_service_missing"

SMS_SAFETY_DECISION_CODES = {
    DECISION_ALLOWED_LOG_PROVIDER,
    DECISION_ALLOWED_REAL_PROVIDER,
    DECISION_UNKNOWN_PROVIDER,
    DECISION_MALFORMED_CONFIGURATION,
    DECISION_REAL_SMS_DISABLED,
    DECISION_EMERGENCY_STOP,
    DECISION_PROVIDER_NOT_ALLOWLISTED,
    DECISION_RECIPIENT_NOT_ALLOWLISTED,
    DECISION_DAILY_LIMIT_CLOSED,
    DECISION_PER_RECIPIENT_LIMIT_CLOSED,
    DECISION_COST_LIMIT_CLOSED,
    DECISION_IDEMPOTENCY_UNCERTAIN,
    DECISION_RECONCILIATION_UNAVAILABLE,
    DECISION_TEMPLATE_SERVICE_MISSING,
    DECISION_CONSENT_SERVICE_MISSING,
    DECISION_SUPPRESSION_SERVICE_MISSING,
}

_SAFETY_METRICS = {code: 0 for code in SMS_SAFETY_DECISION_CODES}


def normalize_nepal_phone_for_safety(phone: str | None) -> str:
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


class RecipientAllowlist(Protocol):
    def is_allowed(self, recipient: str) -> bool: ...


class ConsentService(Protocol):
    def has_sms_consent(self, *, recipient: str, payload: dict) -> bool: ...


class TemplateApprovalService(Protocol):
    def is_template_approved(self, *, payload: dict) -> bool: ...


class SuppressionService(Protocol):
    def is_suppressed(self, *, recipient: str, payload: dict) -> bool: ...


@dataclass(frozen=True, slots=True)
class StaticRecipientAllowlist:
    recipients: frozenset[str]

    @classmethod
    def from_csv(cls, raw: str) -> "StaticRecipientAllowlist":
        recipients: set[str] = set()
        for item in str(raw or "").split(","):
            candidate = item.strip()
            if not candidate:
                continue
            recipients.add(normalize_nepal_phone_for_safety(candidate))
        return cls(frozenset(recipients))

    def is_allowed(self, recipient: str) -> bool:
        return normalize_nepal_phone_for_safety(recipient) in self.recipients


@dataclass(frozen=True, slots=True)
class DispatchSafetyDecision:
    allowed: bool
    code: str
    provider: str
    classification: str
    safe_message: str

    def to_result(self, *, idempotency_key: str):
        from app.services.communication_providers import DispatchResult

        return DispatchResult(
            "permanent_failure",
            provider_status="blocked",
            error_code=self.code,
            safe_error_message=self.safe_message,
            idempotency_key_used=idempotency_key,
        )


def sms_safety_metrics_snapshot() -> dict[str, int]:
    return dict(_SAFETY_METRICS)


def classify_sms_provider(provider: str | None) -> str:
    normalized = str(provider or "log").strip().lower()
    if normalized in SAFE_LOG_PROVIDERS:
        return "safe_log"
    if normalized in REAL_SMS_PROVIDERS:
        return "real_sms"
    return "unknown"


def _record(decision: DispatchSafetyDecision) -> DispatchSafetyDecision:
    _SAFETY_METRICS[decision.code] = _SAFETY_METRICS.get(decision.code, 0) + 1
    if not decision.allowed:
        logger.warning(
            "sms dispatch blocked by safety gate",
            extra={"provider": decision.provider, "classification": decision.classification, "decision_code": decision.code},
        )
    return decision


def _parse_bool(value, *, name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise ValueError(f"{name} must be boolean")


def _parse_nonnegative_int(value, *, name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be an integer")
    parsed = int(value)
    if parsed < 0:
        raise ValueError(f"{name} must be non-negative")
    return parsed


def _parse_nonnegative_float(value, *, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    parsed = float(value)
    if parsed < 0:
        raise ValueError(f"{name} must be non-negative")
    return parsed


def _provider_allowlist(raw: str) -> set[str]:
    providers = {item.strip().lower() for item in str(raw or "").split(",") if item.strip()}
    if not providers:
        return set()
    if not providers.issubset(KNOWN_SMS_PROVIDERS):
        raise ValueError("SMS_PROVIDER_ALLOWLIST contains unknown provider")
    return providers


def _block(provider: str, classification: str, code: str, message: str) -> DispatchSafetyDecision:
    return _record(DispatchSafetyDecision(False, code, provider, classification, message))


def evaluate_sms_dispatch_safety(
    payload: dict,
    *,
    recipient_allowlist: RecipientAllowlist | None = None,
    consent_service: ConsentService | None = None,
    template_service: TemplateApprovalService | None = None,
    suppression_service: SuppressionService | None = None,
) -> DispatchSafetyDecision:
    """Fail-closed provider-independent gate for real SMS dispatch.

    The safe log provider is intentionally allowed under default settings so local
    tests and demo dispatch remain usable without contacting telecom providers.
    Real providers must pass every safety gate before their adapter is invoked.
    """

    provider = str(payload.get("provider") or settings.SMS_PROVIDER or "log").strip().lower()
    classification = classify_sms_provider(provider)
    if classification == "safe_log":
        return _record(DispatchSafetyDecision(True, DECISION_ALLOWED_LOG_PROVIDER, provider, classification, "log provider allowed"))
    if classification == "unknown":
        return _block(provider, classification, DECISION_UNKNOWN_PROVIDER, "unknown SMS provider blocked")

    try:
        real_sms_enabled = _parse_bool(settings.REAL_SMS_ENABLED, name="REAL_SMS_ENABLED")
        emergency_stop = _parse_bool(settings.SMS_EMERGENCY_STOP, name="SMS_EMERGENCY_STOP")
        idempotency_enabled = _parse_bool(settings.SMS_PROVIDER_IDEMPOTENCY_ENABLED, name="SMS_PROVIDER_IDEMPOTENCY_ENABLED")
        reconciliation_enabled = _parse_bool(settings.SMS_PROVIDER_RECONCILIATION_ENABLED, name="SMS_PROVIDER_RECONCILIATION_ENABLED")
        require_template = _parse_bool(settings.SMS_REQUIRE_APPROVED_TEMPLATE, name="SMS_REQUIRE_APPROVED_TEMPLATE")
        require_consent = _parse_bool(settings.SMS_REQUIRE_CONSENT, name="SMS_REQUIRE_CONSENT")
        require_suppression = _parse_bool(settings.SMS_REQUIRE_SUPPRESSION_CHECK, name="SMS_REQUIRE_SUPPRESSION_CHECK")
        daily_limit = _parse_nonnegative_int(settings.SMS_DAILY_SEND_LIMIT, name="SMS_DAILY_SEND_LIMIT")
        recipient_daily_limit = _parse_nonnegative_int(settings.SMS_PER_RECIPIENT_DAILY_LIMIT, name="SMS_PER_RECIPIENT_DAILY_LIMIT")
        cost_limit = _parse_nonnegative_float(settings.SMS_MAX_COST_PER_DAY, name="SMS_MAX_COST_PER_DAY")
        allowlist = _provider_allowlist(settings.SMS_PROVIDER_ALLOWLIST)
        recipient_allowlist = recipient_allowlist or StaticRecipientAllowlist.from_csv(settings.SMS_ALLOWED_RECIPIENTS)
        recipient = normalize_nepal_phone_for_safety(payload.get("recipient"))
    except Exception:
        return _block(provider, classification, DECISION_MALFORMED_CONFIGURATION, "SMS safety configuration is malformed")

    if not real_sms_enabled:
        return _block(provider, classification, DECISION_REAL_SMS_DISABLED, "real SMS feature gate is disabled")
    if emergency_stop:
        return _block(provider, classification, DECISION_EMERGENCY_STOP, "SMS emergency stop is active")
    if provider not in allowlist:
        return _block(provider, classification, DECISION_PROVIDER_NOT_ALLOWLISTED, "SMS provider is not allowlisted")
    if not recipient_allowlist.is_allowed(recipient):
        return _block(provider, classification, DECISION_RECIPIENT_NOT_ALLOWLISTED, "SMS recipient is not allowlisted")
    if daily_limit <= 0:
        return _block(provider, classification, DECISION_DAILY_LIMIT_CLOSED, "SMS daily send limit is closed")
    if recipient_daily_limit <= 0:
        return _block(provider, classification, DECISION_PER_RECIPIENT_LIMIT_CLOSED, "SMS per-recipient daily limit is closed")
    if cost_limit <= 0:
        return _block(provider, classification, DECISION_COST_LIMIT_CLOSED, "SMS daily cost limit is closed")
    if not idempotency_enabled:
        return _block(provider, classification, DECISION_IDEMPOTENCY_UNCERTAIN, "provider idempotency is not enabled")
    if not reconciliation_enabled:
        return _block(provider, classification, DECISION_RECONCILIATION_UNAVAILABLE, "provider reconciliation is not enabled")
    try:
        if require_template and template_service is None:
            return _block(provider, classification, DECISION_TEMPLATE_SERVICE_MISSING, "approved-template service is unavailable")
        if require_template:
            assert template_service is not None
            if template_service.is_template_approved(payload=payload) is not True:
                return _block(provider, classification, DECISION_TEMPLATE_SERVICE_MISSING, "approved-template check failed")
        if require_consent and consent_service is None:
            return _block(provider, classification, DECISION_CONSENT_SERVICE_MISSING, "consent service is unavailable")
        if require_consent:
            assert consent_service is not None
            if consent_service.has_sms_consent(recipient=recipient, payload=payload) is not True:
                return _block(provider, classification, DECISION_CONSENT_SERVICE_MISSING, "consent check failed")
        if require_suppression and suppression_service is None:
            return _block(provider, classification, DECISION_SUPPRESSION_SERVICE_MISSING, "suppression service is unavailable")
        if require_suppression:
            assert suppression_service is not None
            if suppression_service.is_suppressed(recipient=recipient, payload=payload) is True:
                return _block(provider, classification, DECISION_SUPPRESSION_SERVICE_MISSING, "recipient is suppressed")
    except Exception:
        return _block(provider, classification, DECISION_MALFORMED_CONFIGURATION, "SMS safety service check failed closed")

    return _block(
        provider,
        classification,
        DECISION_ATOMIC_QUOTA_UNAVAILABLE,
        "persistent atomic SMS quota reservation is not implemented",
    )
