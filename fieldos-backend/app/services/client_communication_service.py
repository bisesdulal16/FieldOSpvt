import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationEvent,
    ClientCommunicationOutbox,
)
from app.models.sms_notification import SmsNotification
from app.services.audit_helper import write_audit
from app.services.sms_service import compose_collection_receipt

SUPPORTED_PURPOSES = {
    "collection_verification",
    "payment_due_reminder",
    "payment_overdue_reminder",
    "promise_to_pay_reminder",
    "dispute_acknowledgement",
    "client_protection_alert",
}

TERMINAL_EVENT_STATUSES = {"confirmed", "disputed", "expired", "cancelled"}


def communication_idempotency_key(*, purpose: str, source_reference: str) -> str:
    return f"client_comm:{purpose}:{source_reference}"


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return phone
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 4:
        return "****"
    return f"***{digits[-4:]}"


async def ensure_collection_verification_event(
    db: AsyncSession,
    *,
    collection,
    client,
    actor,
) -> ClientCommunicationEvent:
    """Create the official collection verification ledger event idempotently.

    Must be called inside the same DB transaction that creates the collection.
    It never sends SMS/calls and never raises because a provider is unavailable.
    """

    receipt_id = collection.receipt_id
    key = communication_idempotency_key(
        purpose="collection_verification",
        source_reference=receipt_id,
    )

    existing = await db.execute(
        select(ClientCommunicationEvent).where(ClientCommunicationEvent.idempotency_key == key)
    )
    event = existing.scalar_one_or_none()
    if event:
        return event

    amount = float(collection.amount or 0)
    risk_level = "high" if getattr(collection, "is_high_value", False) or amount >= settings.VERIFICATION_HIGH_VALUE_THRESHOLD > 0 else "normal"
    priority = "high" if risk_level == "high" else settings.VERIFICATION_DEFAULT_PRIORITY
    language = getattr(client, "language_preference", None) or settings.VERIFICATION_DEFAULT_LANGUAGE
    recipient = getattr(client, "phone_number", None) if client else None
    now = datetime.utcnow()

    if not recipient:
        event_status = "no_phone"
        attempt_status = "no_phone"
    elif not settings.CLIENT_PROTECTION_ENABLED:
        # Ledger exists, but dispatch is safely disabled by default.
        event_status = "pending"
        attempt_status = "pending"
    elif settings.VERIFICATION_SMS_ENABLED:
        event_status = "queued"
        attempt_status = "queued"
    else:
        event_status = "pending"
        attempt_status = "pending"

    event = ClientCommunicationEvent(
        collection_id=collection.id,
        client_id=collection.client_id,
        branch_id=collection.branch_id,
        officer_id=collection.officer_id,
        purpose="collection_verification",
        event_type="collection_verification",
        verification_type="receipt_sms",
        risk_level=risk_level,
        status=event_status,
        idempotency_key=key,
        scheduled_for=None,
        source_system="fieldos",
        source_reference=receipt_id,
        language=language,
        priority=priority,
    )
    db.add(event)
    await db.flush()

    message = compose_collection_receipt(settings.ORG_NAME, amount, receipt_id)
    attempt = ClientCommunicationAttempt(
        event_id=event.id,
        channel="sms",
        provider=settings.SMS_PROVIDER,
        recipient=recipient,
        attempt_number=1,
        status=attempt_status,
        queued_at=now if attempt_status == "queued" else None,
        completed_at=now if attempt_status == "no_phone" else None,
        error_code="no_phone" if not recipient else None,
        error_message="client has no phone number" if not recipient else None,
        metadata_json=json.dumps({
            "purpose": "collection_verification",
            "receipt_id": receipt_id,
            "amount": amount,
            "message": message,
        }),
    )
    db.add(attempt)
    await db.flush()

    # Compatibility mirror for existing manager receipts views. Status is no
    # longer delivery-confirmation; it reflects queued/no_phone only in Phase 1.
    db.add(SmsNotification(
        client_id=collection.client_id,
        collection_receipt_id=receipt_id,
        phone_number=recipient,
        kind="collection_verification",
        message=message,
        provider=settings.SMS_PROVIDER,
        status=attempt_status,
        error="client has no phone number" if not recipient else None,
    ))

    if recipient and settings.CLIENT_PROTECTION_ENABLED and settings.VERIFICATION_SMS_ENABLED:
        outbox_key = f"{key}:sms:1"
        db.add(ClientCommunicationOutbox(
            event_id=event.id,
            attempt_id=attempt.id,
            queue_name="client_communication.sms",
            payload_json=json.dumps({
                "event_id": event.id,
                "attempt_id": attempt.id,
                "purpose": "collection_verification",
                "channel": "sms",
                "provider": settings.SMS_PROVIDER,
                "recipient": recipient,
                "message": message,
                "receipt_id": receipt_id,
                "amount": amount,
            }),
            status="pending",
            idempotency_key=outbox_key,
            available_at=event.scheduled_for,
            max_retries=settings.VERIFICATION_MAX_SMS_ATTEMPTS,
        ))

    await write_audit(
        db,
        actor,
        "client_communication_event_created",
        entity_type="client_communication_event",
        entity_id=str(event.id),
        meta={
            "purpose": "collection_verification",
            "collection_id": collection.id,
            "receipt_id": receipt_id,
            "status": event.status,
            "risk_level": risk_level,
            "recipient_masked": mask_phone(recipient),
        },
    )
    return event
