import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.audit_log import AuditLog
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationCallbackReceipt,
    ClientCommunicationEvent,
)

logger = logging.getLogger(__name__)

NORMALIZED_STATUSES = {
    "submitted",
    "provider_accepted",
    "delivered",
    "failed",
    "expired",
    "rejected",
    "unknown",
}

FINAL_PROTECTED_EVENT_STATUSES = {"confirmed", "disputed", "cancelled"}
FINAL_PROTECTED_ATTEMPT_STATUSES = {"confirmed", "disputed", "cancelled"}
TERMINAL_DELIVERY_ATTEMPT_STATUSES = {"delivered", "failed", "expired", "rejected", "confirmed", "disputed", "cancelled"}

STATUS_ALIASES = {
    "submitted": {"submitted", "sent", "queued", "enroute", "accepted_for_delivery"},
    "provider_accepted": {"accepted", "provider_accepted", "accepted by provider", "ack", "success"},
    "delivered": {"delivered", "delivrd", "delivery_success", "success_delivered"},
    "failed": {"failed", "undeliv", "undelivered", "error", "delivery_failed", "failure"},
    "expired": {"expired", "expd", "timeout", "ttl_expired"},
    "rejected": {"rejected", "rejectd", "invalid", "invalid_dst", "blacklisted"},
}

SPARROW_STATUS_FIELD_CANDIDATES = ("status", "delivery_status", "state")
JASMIN_STATUS_FIELD_CANDIDATES = ("dlr_status", "status", "stat")


class CallbackRejected(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


@dataclass(frozen=True)
class NormalizedCallback:
    provider: str
    provider_reference: str
    provider_event_id: str
    normalized_status: str
    provider_status_raw: str
    occurred_at: datetime | None = None


def canonical_json(data: dict[str, Any]) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def payload_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def signature_digest(signature: str) -> str:
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()


def build_signature(secret: str, provider: str, timestamp: str, body: bytes) -> str:
    """Build provider-bound callback signature over deterministic canonical bytes.

    Signed input is: provider + "." + timestamp + "." + body.
    In FieldOS simulators/tests, body is canonical JSON from canonical_json().
    For real providers, ingress adapters must pass the exact raw request body bytes.
    """
    signing_input = provider.lower().strip().encode("utf-8") + b"." + timestamp.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).hexdigest()


def verify_callback_signature(*, provider: str, body: bytes, timestamp: str | None, signature: str | None) -> str:
    if not settings.SMS_CALLBACK_SECRET:
        raise CallbackRejected("callback_secret_not_configured", "callback secret is not configured", 503)
    if not timestamp:
        raise CallbackRejected("missing_timestamp", "missing callback timestamp", 401)
    if not signature:
        raise CallbackRejected("missing_signature", "missing callback signature", 401)
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        raise CallbackRejected("invalid_timestamp", "invalid callback timestamp", 401)
    now = int(time.time())
    if abs(now - ts) > settings.SMS_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS:
        raise CallbackRejected("expired_timestamp", "expired callback timestamp", 401)
    expected = build_signature(settings.SMS_CALLBACK_SECRET, provider, timestamp, body)
    if not hmac.compare_digest(expected, signature):
        raise CallbackRejected("invalid_signature", "invalid callback signature", 401)
    return signature_digest(signature)


def normalize_provider_status(provider: str, raw_status: str | None) -> str:
    if raw_status is None:
        return "unknown"
    value = str(raw_status).strip().lower()
    if not value:
        return "unknown"
    for normalized, aliases in STATUS_ALIASES.items():
        if value in aliases:
            return normalized
    return "unknown"


def _first_value(payload: dict[str, Any], names: tuple[str, ...]) -> str | None:
    for name in names:
        value = payload.get(name)
        if value not in (None, ""):
            return str(value)
    return None


def normalize_callback_payload(provider: str, payload: dict[str, Any]) -> NormalizedCallback:
    provider = provider.lower().strip()
    if provider == "sparrow":
        provider_reference = _first_value(payload, ("message_id", "provider_reference", "ref", "sms_id"))
        provider_event_id = _first_value(payload, ("event_id", "callback_id", "dlr_id")) or f"sparrow:{provider_reference}:{_first_value(payload, SPARROW_STATUS_FIELD_CANDIDATES)}"
        raw = _first_value(payload, SPARROW_STATUS_FIELD_CANDIDATES)
    elif provider == "jasmin":
        provider_reference = _first_value(payload, ("message_id", "id_smsc", "provider_reference", "msgid"))
        provider_event_id = _first_value(payload, ("event_id", "dlr_id", "callback_id")) or f"jasmin:{provider_reference}:{_first_value(payload, JASMIN_STATUS_FIELD_CANDIDATES)}"
        raw = _first_value(payload, JASMIN_STATUS_FIELD_CANDIDATES)
    elif provider == "generic":
        provider_reference = _first_value(payload, ("provider_reference", "message_id"))
        provider_event_id = _first_value(payload, ("provider_event_id", "event_id"))
        raw = _first_value(payload, ("normalized_status", "status"))
    else:
        raise CallbackRejected("unsupported_provider", "unsupported callback provider", 400)
    if not provider_reference:
        raise CallbackRejected("missing_provider_reference", "missing provider reference", 400)
    if not provider_event_id:
        raise CallbackRejected("missing_provider_event_id", "missing provider event id", 400)
    normalized = normalize_provider_status(provider, raw)
    if provider == "generic" and raw in NORMALIZED_STATUSES:
        normalized = raw
    return NormalizedCallback(
        provider=provider,
        provider_reference=provider_reference[:160],
        provider_event_id=provider_event_id[:160],
        normalized_status=normalized,
        provider_status_raw=(str(raw) if raw is not None else "")[:120],
    )


async def _write_callback_audit(
    session: AsyncSession,
    action_type: str,
    *,
    attempt: ClientCommunicationAttempt | None = None,
    event: ClientCommunicationEvent | None = None,
    meta: dict[str, Any] | None = None,
):
    safe_meta = dict(meta or {})
    safe_meta.pop("recipient", None)
    safe_meta.pop("message", None)
    row = AuditLog(
        action_type=action_type,
        entity_type="client_communication_attempt" if attempt else "client_communication_callback",
        entity_id=str(attempt.id) if attempt else None,
        branch_id=getattr(event, "branch_id", None),
    )
    if safe_meta:
        row.set_meta(safe_meta)
    session.add(row)


def _transition_allowed(current_event: str, current_attempt: str, callback_status: str) -> tuple[bool, str]:
    if current_event in FINAL_PROTECTED_EVENT_STATUSES or current_attempt in FINAL_PROTECTED_ATTEMPT_STATUSES:
        return False, "final_state_protected"
    if current_attempt == "delivered" and callback_status in {"submitted", "provider_accepted"}:
        return False, "out_of_order_after_delivered"
    if current_attempt in {"failed", "expired", "rejected"} and callback_status in {"submitted", "provider_accepted", "delivered"}:
        return False, "out_of_order_after_terminal_failure"
    if callback_status == "unknown":
        return False, "unknown_status_no_state_change"
    return True, "accepted"


def _apply_status(event: ClientCommunicationEvent, attempt: ClientCommunicationAttempt, status: str, now: datetime):
    if status == "submitted":
        attempt.status = "submitted"
        attempt.submitted_at = attempt.submitted_at or now
        event.status = "provider_accepted" if event.status in {"queued", "pending", "submitted"} else event.status
    elif status == "provider_accepted":
        attempt.status = "submitted"
        attempt.submitted_at = attempt.submitted_at or now
        attempt.accepted_at = attempt.accepted_at or now
        event.status = "provider_accepted"
    elif status == "delivered":
        attempt.status = "delivered"
        attempt.delivered_at = attempt.delivered_at or now
        attempt.completed_at = attempt.completed_at or now
        event.status = "delivered"
    elif status in {"failed", "expired", "rejected"}:
        attempt.status = status
        attempt.delivery_failed_at = attempt.delivery_failed_at or now
        attempt.completed_at = attempt.completed_at or now
        event.status = status
        attempt.error_code = f"provider_{status}"


async def process_provider_callback(
    session: AsyncSession,
    *,
    provider: str,
    payload: dict[str, Any],
    body: bytes,
    timestamp: str | None,
    signature: str | None,
) -> dict[str, Any]:
    try:
        sig_digest = verify_callback_signature(provider=provider, body=body, timestamp=timestamp, signature=signature)
    except CallbackRejected as exc:
        if exc.code == "invalid_signature" and signature:
            replay_digest = signature_digest(signature)
            replay = (
                await session.execute(
                    select(ClientCommunicationCallbackReceipt).where(ClientCommunicationCallbackReceipt.signature_digest == replay_digest)
                )
            ).scalar_one_or_none()
            if replay:
                await _write_callback_audit(session, "communication_callback_rejected", meta={"reason": "replayed_callback", "provider": provider})
                await session.commit()
                raise CallbackRejected("replayed_callback", "replayed callback", 409)
        raise
    normalized = normalize_callback_payload(provider, payload)
    body_hash = payload_hash(body)

    duplicate_receipt = (
        await session.execute(
            select(ClientCommunicationCallbackReceipt).where(
                ClientCommunicationCallbackReceipt.provider == normalized.provider,
                ClientCommunicationCallbackReceipt.provider_event_id == normalized.provider_event_id,
            )
        )
    ).scalar_one_or_none()
    if duplicate_receipt:
        attempt = (
            await session.execute(
                select(ClientCommunicationAttempt).where(ClientCommunicationAttempt.provider_reference == normalized.provider_reference)
            )
        ).scalar_one_or_none()
        event = await session.get(ClientCommunicationEvent, attempt.event_id) if attempt else None
        if duplicate_receipt.callback_payload_hash != body_hash:
            await _write_callback_audit(session, "communication_callback_rejected", attempt=attempt, event=event, meta={
                "reason": "provider_event_payload_conflict",
                "provider": normalized.provider,
                "provider_event_id": normalized.provider_event_id,
            })
            await session.commit()
            raise CallbackRejected("provider_event_payload_conflict", "provider event id replayed with different payload", 409)
        await _write_callback_audit(session, "communication_callback_duplicate", attempt=attempt, event=event, meta={
            "provider": normalized.provider,
            "provider_event_id": normalized.provider_event_id,
            "provider_reference": normalized.provider_reference,
        })
        await session.commit()
        return {"status": "duplicate", "normalized_status": duplicate_receipt.normalized_status, "attempt_id": getattr(attempt, "id", None)}

    replay = (
        await session.execute(
            select(ClientCommunicationCallbackReceipt).where(ClientCommunicationCallbackReceipt.signature_digest == sig_digest)
        )
    ).scalar_one_or_none()
    if replay:
        await _write_callback_audit(session, "communication_callback_rejected", meta={"reason": "replayed_callback", "provider": normalized.provider})
        await session.commit()
        raise CallbackRejected("replayed_callback", "replayed callback", 409)

    attempt = (
        await session.execute(
            select(ClientCommunicationAttempt).where(ClientCommunicationAttempt.provider_reference == normalized.provider_reference)
        )
    ).scalar_one_or_none()
    if not attempt:
        await _write_callback_audit(session, "communication_callback_rejected", meta={
            "reason": "unknown_provider_reference",
            "provider": normalized.provider,
            "provider_reference_hash": hashlib.sha256(normalized.provider_reference.encode()).hexdigest(),
        })
        await session.commit()
        raise CallbackRejected("unknown_provider_reference", "unknown provider reference", 404)

    event = await session.get(ClientCommunicationEvent, attempt.event_id)
    now = datetime.utcnow()
    receipt = ClientCommunicationCallbackReceipt(
        provider=normalized.provider,
        provider_event_id=normalized.provider_event_id,
        provider_reference=normalized.provider_reference,
        attempt_id=attempt.id,
        event_id=event.id,
        normalized_status=normalized.normalized_status,
        provider_status_raw=normalized.provider_status_raw,
        signature_digest=sig_digest,
        callback_payload_hash=body_hash,
        received_at=now,
        action_taken="received",
    )
    session.add(receipt)

    attempt.provider_event_id = normalized.provider_event_id
    attempt.provider_status_raw = normalized.provider_status_raw
    attempt.callback_received_at = attempt.callback_received_at or now
    attempt.callback_payload_hash = body_hash

    await _write_callback_audit(session, "communication_callback_received", attempt=attempt, event=event, meta={
        "provider": normalized.provider,
        "provider_event_id": normalized.provider_event_id,
        "normalized_status": normalized.normalized_status,
    })

    allowed, reason = _transition_allowed(event.status, attempt.status, normalized.normalized_status)
    if not allowed:
        receipt.action_taken = reason
        await _write_callback_audit(session, "communication_callback_out_of_order", attempt=attempt, event=event, meta={
            "provider": normalized.provider,
            "provider_event_id": normalized.provider_event_id,
            "normalized_status": normalized.normalized_status,
            "reason": reason,
        })
        await session.commit()
        return {"status": reason, "normalized_status": normalized.normalized_status, "attempt_id": attempt.id, "event_id": event.id}

    before_attempt = attempt.status
    before_event = event.status
    _apply_status(event, attempt, normalized.normalized_status, now)
    receipt.action_taken = "state_updated"
    if normalized.normalized_status == "delivered":
        await _write_callback_audit(session, "communication_delivered", attempt=attempt, event=event, meta={"provider": normalized.provider, "provider_event_id": normalized.provider_event_id})
    elif normalized.normalized_status in {"failed", "expired", "rejected"}:
        await _write_callback_audit(session, "communication_delivery_failed", attempt=attempt, event=event, meta={"provider": normalized.provider, "provider_event_id": normalized.provider_event_id, "normalized_status": normalized.normalized_status})
    await session.commit()
    logger.info("communication callback processed", extra={"provider": normalized.provider, "normalized_status": normalized.normalized_status, "attempt_id": attempt.id})
    return {
        "status": "processed",
        "normalized_status": normalized.normalized_status,
        "attempt_id": attempt.id,
        "event_id": event.id,
        "before_attempt_status": before_attempt,
        "after_attempt_status": attempt.status,
        "before_event_status": before_event,
        "after_event_status": event.status,
    }
