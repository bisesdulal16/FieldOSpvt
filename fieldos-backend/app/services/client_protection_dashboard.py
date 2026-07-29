from __future__ import annotations

import csv
import io
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps.auth_deps import can_see_all_branches
from app.models.audit_log import AuditLog
from app.models.branch import Branch
from app.models.cbs import CBSScheduleItem
from app.models.client import Client
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationCallbackReceipt,
    ClientCommunicationEvent,
    ClientCommunicationOutbox,
    ClientCommunicationWorkerHeartbeat,
)
from app.models.collection import Collection
from app.models.task import TaskAssignment
from app.models.user import Department, User
from app.services.audit_helper import write_audit


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) < 4:
        return "******"
    return f"******{digits[-4:]}"

REMINDER_PURPOSES = {
    "payment_due_reminder",
    "payment_overdue_reminder",
    "promise_to_pay_reminder",
    "center_meeting_reminder",
}
COLLECTION_PURPOSE = "collection_verification"
ALL_PROTECTION_PURPOSES = REMINDER_PURPOSES | {COLLECTION_PURPOSE}
EXPORT_ROW_LIMIT = 5000
EXPORT_MAX_DATE_RANGE_DAYS = 366
MAX_PAGE_SIZE = 100
DASHBOARD_AUDIT_THROTTLE_SECONDS = 300


@dataclass(slots=True)
class ProtectionFilters:
    start_date: str | None = None
    end_date: str | None = None
    branch_id: int | None = None
    officer_id: int | None = None
    client_id: int | None = None
    purpose: str | None = None
    channel: str | None = None
    event_status: str | None = None
    attempt_status: str | None = None
    provider: str | None = None
    risk_level: str | None = None
    exception_severity: str | None = None
    due_state: str | None = None
    page: int = 1
    page_size: int = 50


def percent(numerator: int | float, denominator: int | float) -> float:
    return round((float(numerator) / float(denominator) * 100), 2) if denominator else 0.0


def safe_page_size(value: int) -> int:
    return min(max(int(value or 50), 1), MAX_PAGE_SIZE)


def user_can_access_financial_dashboard(user: User) -> bool:
    if getattr(user, "department", None) == Department.ADMIN_IT.value:
        return False
    return getattr(user, "role", None) in {"branch_manager", "area_manager", "admin"}


def sanitize_filters_for_audit(filters: ProtectionFilters) -> dict[str, Any]:
    data = {k: v for k, v in asdict(filters).items() if v not in (None, "")}
    for blocked in ("phone", "phone_number", "recipient", "message", "payload"):
        data.pop(blocked, None)
    return data


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in (
        "phone",
        "recipient",
        "message",
        "payload",
        "callback",
        "signature",
        "token",
        "secret",
        "encrypted",
        "provider_response",
        "raw",
    ))


def sanitize_mapping(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: sanitize_mapping(v) for k, v in value.items() if not _is_sensitive_key(str(k))}
    if isinstance(value, list):
        return [sanitize_mapping(v) for v in value]
    return value


def csv_safe(value: Any) -> Any:
    if value is None:
        return ""
    text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def validate_export_filters(filters: ProtectionFilters) -> None:
    if filters.start_date and filters.end_date:
        start = _parse_date_start(filters.start_date)
        end = _parse_date_start(filters.end_date)
        if end < start:
            raise ValueError("end_date must be on or after start_date")
        if (end - start).days > EXPORT_MAX_DATE_RANGE_DAYS:
            raise ValueError(f"CSV export date range cannot exceed {EXPORT_MAX_DATE_RANGE_DAYS} days")


def scoped_event_query(user: User, filters: ProtectionFilters | None = None):
    q = select(ClientCommunicationEvent, ClientCommunicationAttempt).join(
        ClientCommunicationAttempt,
        ClientCommunicationAttempt.event_id == ClientCommunicationEvent.id,
        isouter=True,
    )
    if not can_see_all_branches(user):
        q = q.where(ClientCommunicationEvent.branch_id == (user.branch_id if user.branch_id is not None else -1))
    if filters:
        if filters.branch_id is not None:
            if can_see_all_branches(user):
                q = q.where(ClientCommunicationEvent.branch_id == filters.branch_id)
            else:
                q = q.where(ClientCommunicationEvent.branch_id == user.branch_id)
        if filters.officer_id is not None:
            q = q.where(ClientCommunicationEvent.officer_id == filters.officer_id)
        if filters.client_id is not None:
            q = q.where(ClientCommunicationEvent.client_id == filters.client_id)
        if filters.purpose:
            q = q.where(ClientCommunicationEvent.purpose == filters.purpose)
        if filters.event_status:
            q = q.where(ClientCommunicationEvent.status == filters.event_status)
        if filters.attempt_status:
            q = q.where(ClientCommunicationAttempt.status == filters.attempt_status)
        if filters.provider:
            q = q.where(ClientCommunicationAttempt.provider == filters.provider)
        if filters.channel:
            q = q.where(ClientCommunicationAttempt.channel == filters.channel)
        if filters.risk_level:
            q = q.where(ClientCommunicationEvent.risk_level == filters.risk_level)
        if filters.start_date:
            q = q.where(ClientCommunicationEvent.created_at >= _parse_date_start(filters.start_date))
        if filters.end_date:
            q = q.where(ClientCommunicationEvent.created_at < _parse_date_end(filters.end_date))
        if filters.due_state == "overdue":
            q = q.where(ClientCommunicationEvent.purpose == "payment_overdue_reminder")
        elif filters.due_state == "due":
            q = q.where(ClientCommunicationEvent.purpose == "payment_due_reminder")
    return q


def _parse_date_start(value: str) -> datetime:
    return datetime.fromisoformat(value[:10])


def _parse_date_end(value: str) -> datetime:
    return datetime.fromisoformat(value[:10]) + timedelta(days=1)


def sanitize_attempt_metadata(attempt: ClientCommunicationAttempt | None) -> dict[str, Any]:
    if not attempt or not attempt.metadata_json:
        return {}
    try:
        meta = json.loads(attempt.metadata_json)
    except Exception:
        return {}
    return sanitize_mapping(meta)


def event_row(event: ClientCommunicationEvent, attempt: ClientCommunicationAttempt | None, *, include_metadata: bool = False) -> dict[str, Any]:
    row = {
        "event_id": event.id,
        "attempt_id": getattr(attempt, "id", None),
        "client_id": event.client_id,
        "branch_id": event.branch_id,
        "officer_id": event.officer_id,
        "collection_id": event.collection_id,
        "purpose": event.purpose,
        "event_type": event.event_type,
        "risk_level": event.risk_level,
        "event_status": event.status,
        "attempt_status": getattr(attempt, "status", None),
        "channel": getattr(attempt, "channel", None),
        "provider": getattr(attempt, "provider", None),
        "provider_reference": getattr(attempt, "provider_reference", None),
        "recipient_masked": mask_phone(getattr(attempt, "recipient", None)),
        "scheduled_for": event.scheduled_for.isoformat() if event.scheduled_for else None,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "updated_at": event.updated_at.isoformat() if event.updated_at else None,
        "confirmed_at": event.confirmed_at.isoformat() if event.confirmed_at else None,
        "disputed_at": event.disputed_at.isoformat() if event.disputed_at else None,
        "cancelled_at": event.cancelled_at.isoformat() if event.cancelled_at else None,
        "source_system": event.source_system,
        "source_reference": event.source_reference,
    }
    if include_metadata:
        row["metadata"] = sanitize_attempt_metadata(attempt)
    return row


async def audit_dashboard_view(db: AsyncSession, user: User, action: str, entity_type: str, entity_id: Any = None, filters: ProtectionFilters | None = None) -> None:
    if action == "client_protection_dashboard_viewed" and entity_id is None:
        recent_cutoff = datetime.utcnow() - timedelta(seconds=DASHBOARD_AUDIT_THROTTLE_SECONDS)
        existing = (await db.execute(
            select(AuditLog.id)
            .where(
                AuditLog.user_id == getattr(user, "id", None),
                AuditLog.action_type == action,
                AuditLog.entity_type == entity_type,
                AuditLog.created_at >= recent_cutoff,
            )
            .limit(1)
        )).scalar_one_or_none()
        if existing:
            return
    await write_audit(
        db,
        user,
        action,
        entity_type=entity_type,
        entity_id=entity_id,
        meta={"filters": sanitize_filters_for_audit(filters)} if filters else None,
    )
    await db.commit()


async def summary_metrics(db: AsyncSession, user: User, filters: ProtectionFilters) -> dict[str, Any]:
    rows = (await db.execute(scoped_event_query(user, filters))).all()
    event_ids_seen: set[int] = set()
    events: list[ClientCommunicationEvent] = []
    attempts: list[ClientCommunicationAttempt] = []
    for event, attempt in rows:
        if event.id not in event_ids_seen:
            event_ids_seen.add(event.id)
            events.append(event)
        if attempt:
            attempts.append(attempt)
    total_events = len(events)
    by_purpose = {purpose: sum(1 for e in events if e.purpose == purpose) for purpose in ALL_PROTECTION_PURPOSES}
    by_event_status = {status: sum(1 for e in events if e.status == status) for status in ["queued", "submitted", "provider_accepted", "delivered", "failed", "expired", "rejected", "no_phone", "cancelled", "confirmed", "disputed"]}
    by_attempt_status = {status: sum(1 for a in attempts if a.status == status) for status in ["queued", "submitted", "provider_accepted", "delivered", "failed", "expired", "rejected", "no_phone", "cancelled", "confirmed", "disputed"]}
    eligible_verification_ids = {e.id for e in events if e.purpose == COLLECTION_PURPOSE and e.status not in {"cancelled", "suppressed"}}
    confirmed_event_ids = ({e.id for e in events if e.id in eligible_verification_ids and e.status == "confirmed"} |
                           {a.event_id for a in attempts if a.event_id in eligible_verification_ids and a.client_response == "confirmed"})
    disputed_event_ids = ({e.id for e in events if e.id in eligible_verification_ids and e.status == "disputed"} |
                          {a.event_id for a in attempts if a.event_id in eligible_verification_ids and a.client_response == "disputed"})
    confirmed = len(confirmed_event_ids)
    disputed = len(disputed_event_ids)
    eligible_delivery_attempts = [a for a in attempts if a.status in {"submitted", "provider_accepted", "delivered"}]
    delivered = len([a for a in eligible_delivery_attempts if a.status == "delivered"])
    eligible_events = [e for e in events if e.status not in {"cancelled", "suppressed"}]
    no_phone = len({e.id for e in eligible_events if e.status == "no_phone"} | {a.event_id for a in attempts if a.status == "no_phone"})

    outbox_q = select(func.count()).select_from(ClientCommunicationOutbox).join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationOutbox.event_id)
    if not can_see_all_branches(user):
        outbox_q = outbox_q.where(ClientCommunicationEvent.branch_id == (user.branch_id if user.branch_id is not None else -1))
    dead_letter_count = (await db.execute(outbox_q.where(ClientCommunicationOutbox.status.in_(["dead", "dead_letter"])))) .scalar() or 0

    audit_q = select(AuditLog.action_type, func.count()).where(AuditLog.action_type.in_(["communication_reminder_suppressed", "communication_reminder_throttled"]))
    if not can_see_all_branches(user):
        audit_q = audit_q.where(AuditLog.branch_id == (user.branch_id if user.branch_id is not None else -1))
    audit_counts = dict((await db.execute(audit_q.group_by(AuditLog.action_type))).all())

    return {
        "counts": {
            "total_communication_events": total_events,
            "collection_verification_count": by_purpose.get(COLLECTION_PURPOSE, 0),
            "due_reminder_count": by_purpose.get("payment_due_reminder", 0),
            "overdue_reminder_count": by_purpose.get("payment_overdue_reminder", 0),
            "promise_to_pay_reminder_count": by_purpose.get("promise_to_pay_reminder", 0),
            "center_meeting_reminder_count": by_purpose.get("center_meeting_reminder", 0),
            "queued_count": by_event_status.get("queued", 0) + by_attempt_status.get("queued", 0),
            "submitted_count": by_event_status.get("submitted", 0) + by_attempt_status.get("submitted", 0),
            "provider_accepted_count": by_event_status.get("provider_accepted", 0) + by_attempt_status.get("provider_accepted", 0),
            "delivered_count": delivered,
            "failed_count": by_event_status.get("failed", 0) + by_attempt_status.get("failed", 0),
            "expired_count": by_event_status.get("expired", 0) + by_attempt_status.get("expired", 0),
            "rejected_count": by_event_status.get("rejected", 0) + by_attempt_status.get("rejected", 0),
            "no_phone_count": no_phone,
            "cancelled_count": by_event_status.get("cancelled", 0) + by_attempt_status.get("cancelled", 0),
            "dead_letter_count": dead_letter_count,
            "confirmed_count": confirmed,
            "disputed_count": disputed,
            "reminder_suppression_count": audit_counts.get("communication_reminder_suppressed", 0),
            "reminder_throttle_count": audit_counts.get("communication_reminder_throttled", 0),
        },
        "rates": {
            "verification_rate": percent(confirmed, len(eligible_verification_ids)),
            "verification_rate_denominator": "eligible collection verification events excluding cancelled/suppressed",
            "delivery_rate": percent(delivered, len(eligible_delivery_attempts)),
            "delivery_rate_denominator": "attempts with submitted/provider_accepted/delivered status; cancelled/queued/no_phone/suppressed excluded",
            "dispute_rate": percent(disputed, len(eligible_verification_ids)),
            "dispute_rate_denominator": "eligible collection verification events excluding cancelled/suppressed",
            "no_phone_rate": percent(no_phone, len(eligible_events)),
            "no_phone_rate_denominator": "eligible communication events excluding cancelled/suppressed",
        },
    }


async def paginated_events(db: AsyncSession, user: User, filters: ProtectionFilters) -> dict[str, Any]:
    page_size = safe_page_size(filters.page_size)
    page = max(int(filters.page or 1), 1)
    base = scoped_event_query(user, filters)
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0
    rows = (await db.execute(base.order_by(ClientCommunicationEvent.created_at.desc(), ClientCommunicationEvent.id.desc()).offset((page - 1) * page_size).limit(page_size))).all()
    return {
        "items": [event_row(event, attempt) for event, attempt in rows],
        "pagination": {"page": page, "page_size": page_size, "total": total, "has_next": page * page_size < total},
    }


async def paginated_reminders(db: AsyncSession, user: User, filters: ProtectionFilters) -> dict[str, Any]:
    if filters.purpose and filters.purpose not in REMINDER_PURPOSES:
        filters.purpose = "__none__"
    base = scoped_event_query(user, filters)
    if not filters.purpose:
        base = base.where(ClientCommunicationEvent.purpose.in_(REMINDER_PURPOSES))
    return await _paginate_query(db, base, filters)


async def _paginate_query(db: AsyncSession, base, filters: ProtectionFilters) -> dict[str, Any]:
    page_size = safe_page_size(filters.page_size)
    page = max(int(filters.page or 1), 1)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    rows = (await db.execute(base.order_by(ClientCommunicationEvent.created_at.desc(), ClientCommunicationEvent.id.desc()).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [event_row(event, attempt) for event, attempt in rows], "pagination": {"page": page, "page_size": page_size, "total": total, "has_next": page * page_size < total}}


async def event_detail(db: AsyncSession, user: User, event_id: int) -> dict[str, Any] | None:
    q = scoped_event_query(user, ProtectionFilters()).where(ClientCommunicationEvent.id == event_id)
    rows = (await db.execute(q)).all()
    if not rows:
        return None
    event = rows[0][0]
    attempts = [event_row(e, a, include_metadata=True) for e, a in rows]
    callbacks = (await db.execute(select(ClientCommunicationCallbackReceipt).where(ClientCommunicationCallbackReceipt.event_id == event_id).order_by(ClientCommunicationCallbackReceipt.received_at.asc()))).scalars().all()
    outboxes = (await db.execute(select(ClientCommunicationOutbox).where(ClientCommunicationOutbox.event_id == event_id).order_by(ClientCommunicationOutbox.created_at.asc()))).scalars().all()
    return {
        "event": event_row(event, rows[0][1], include_metadata=True),
        "attempts": attempts,
        "callbacks": [{"id": c.id, "provider": c.provider, "provider_event_id": c.provider_event_id, "normalized_status": c.normalized_status, "action_taken": c.action_taken, "received_at": c.received_at.isoformat() if c.received_at else None} for c in callbacks],
        "outbox": [{"id": o.id, "status": o.status, "retry_count": o.retry_count, "attempt_count": o.attempt_count, "available_at": o.available_at.isoformat() if o.available_at else None, "last_error_code": o.last_error_code} for o in outboxes],
    }


def exception_item(kind: str, severity: str, event: ClientCommunicationEvent | None = None, attempt: ClientCommunicationAttempt | None = None, detail: str = "") -> dict[str, Any]:
    return {
        "type": kind,
        "severity": severity,
        "event_id": getattr(event, "id", None),
        "attempt_id": getattr(attempt, "id", None),
        "client_id": getattr(event, "client_id", None),
        "branch_id": getattr(event, "branch_id", None),
        "officer_id": getattr(event, "officer_id", None),
        "purpose": getattr(event, "purpose", None),
        "event_status": getattr(event, "status", None),
        "attempt_status": getattr(attempt, "status", None),
        "recipient_masked": mask_phone(getattr(attempt, "recipient", None)),
        "detail": detail,
        "created_at": event.created_at.isoformat() if event and event.created_at else None,
    }


async def _has_authoritative_unpaid_obligation(db: AsyncSession, event: ClientCommunicationEvent) -> bool:
    reference = event.source_reference or ""
    if not reference.startswith("cbs_schedule:"):
        return False
    try:
        schedule_id = int(reference.split(":", 1)[1])
    except (TypeError, ValueError, IndexError):
        return False
    schedule = await db.get(CBSScheduleItem, schedule_id)
    if not schedule:
        return False
    return schedule.status != "paid" and float(schedule.paid_amount or 0) < float(schedule.due_amount or 0)


async def exceptions(db: AsyncSession, user: User, filters: ProtectionFilters) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    rows = (await db.execute(scoped_event_query(user, filters))).all()
    now = datetime.utcnow()
    for event, attempt in rows:
        if event.status == "no_phone" or (attempt and attempt.status == "no_phone"):
            items.append(exception_item("no_phone", "warning", event, attempt, "Client communication has no usable phone number."))
        if attempt and attempt.status in {"failed", "expired", "rejected"}:
            severity = "high" if attempt.status == "failed" else "warning"
            items.append(exception_item(f"{attempt.status}_delivery", severity, event, attempt, f"Attempt status is {attempt.status}."))
        if event.status == "disputed" or (attempt and attempt.client_response == "disputed"):
            items.append(exception_item("disputed_collection", "critical", event, attempt, "Client disputed a collection verification."))
        if event.purpose == "payment_overdue_reminder" and attempt and attempt.status not in {"delivered", "confirmed"} and await _has_authoritative_unpaid_obligation(db, event):
            items.append(exception_item("overdue_reminder_not_delivered", "high", event, attempt, "Overdue reminder is not delivered and the CBS schedule remains unpaid."))
    outbox_q = select(ClientCommunicationOutbox, ClientCommunicationEvent, ClientCommunicationAttempt).join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationOutbox.event_id).join(ClientCommunicationAttempt, ClientCommunicationAttempt.id == ClientCommunicationOutbox.attempt_id, isouter=True)
    if not can_see_all_branches(user):
        outbox_q = outbox_q.where(ClientCommunicationEvent.branch_id == (user.branch_id if user.branch_id is not None else -1))
    outbox_rows = (await db.execute(outbox_q)).all()
    for outbox, event, attempt in outbox_rows:
        if outbox.status in {"dead", "dead_letter"}:
            items.append(exception_item("dead_letter_outbox", "critical", event, attempt, "Outbox row is dead-lettered."))
        if outbox.status == "processing" and outbox.locked_at and outbox.locked_at < now - timedelta(seconds=settings.OUTBOX_LOCK_TIMEOUT_SECONDS):
            items.append(exception_item("stale_processing_outbox", "high", event, attempt, "Outbox row is processing beyond configured lock timeout."))
    callback_q = select(ClientCommunicationCallbackReceipt).join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationCallbackReceipt.event_id).where(ClientCommunicationCallbackReceipt.action_taken.in_(["conflict", "replay_rejected", "duplicate_conflict", "rejected"]))
    if not can_see_all_branches(user):
        callback_q = callback_q.where(ClientCommunicationEvent.branch_id == (user.branch_id if user.branch_id is not None else -1))
    for receipt in (await db.execute(callback_q)).scalars().all():
        items.append({"type": "callback_conflict_or_replay", "severity": "high", "event_id": receipt.event_id, "attempt_id": receipt.attempt_id, "provider": receipt.provider, "detail": "callback conflict/replay rejected", "created_at": receipt.received_at.isoformat() if receipt.received_at else None})
    if filters.exception_severity:
        items = [i for i in items if i.get("severity") == filters.exception_severity]
    total = len(items)
    page_size = safe_page_size(filters.page_size)
    page = max(filters.page, 1)
    return {"items": items[(page - 1) * page_size: page * page_size], "pagination": {"page": page, "page_size": page_size, "total": total, "has_next": page * page_size < total}}


async def client_history(db: AsyncSession, user: User, client_id: int, filters: ProtectionFilters) -> list[dict[str, Any]]:
    filters.client_id = client_id
    rows = (await db.execute(scoped_event_query(user, filters).order_by(ClientCommunicationEvent.created_at.asc(), ClientCommunicationAttempt.created_at.asc()))).all()
    history = []
    for event, attempt in rows:
        history.append({"timestamp": event.created_at.isoformat() if event.created_at else None, "type": "communication_event", "description": f"{event.purpose} event {event.status}", **event_row(event, attempt)})
        if attempt:
            for field, label in [("queued_at", "SMS queued"), ("submitted_at", "SMS submitted"), ("accepted_at", "provider accepted"), ("delivered_at", "delivered"), ("completed_at", "completed")]:
                value = getattr(attempt, field, None)
                if value:
                    history.append({"timestamp": value.isoformat(), "type": field, "description": label, "event_id": event.id, "attempt_id": attempt.id, "recipient_masked": mask_phone(attempt.recipient)})
    return sorted(history, key=lambda x: x.get("timestamp") or "")


async def officer_summary(db: AsyncSession, user: User, officer_id: int, filters: ProtectionFilters) -> dict[str, Any]:
    filters.officer_id = officer_id
    metrics = await summary_metrics(db, user, filters)
    collections_q = select(func.count()).select_from(Collection).where(Collection.officer_id == officer_id)
    if not can_see_all_branches(user):
        collections_q = collections_q.where(Collection.branch_id == (user.branch_id if user.branch_id is not None else -1))
    collections_handled = (await db.execute(collections_q)).scalar() or 0
    return {"officer_id": officer_id, "collections_handled": collections_handled, **metrics, "risk_indicators_only": True, "punitive_score": None}


async def branch_summary(db: AsyncSession, user: User, branch_id: int, filters: ProtectionFilters) -> dict[str, Any]:
    if not can_see_all_branches(user) and user.branch_id != branch_id:
        return {"forbidden": True}
    filters.branch_id = branch_id
    branch = await db.get(Branch, branch_id)
    return {"branch_id": branch_id, "branch_name": getattr(branch, "name", None), **(await summary_metrics(db, user, filters))}


async def worker_health(db: AsyncSession, user: User) -> dict[str, Any]:
    pending = (await db.execute(select(func.count()).select_from(ClientCommunicationOutbox).where(ClientCommunicationOutbox.status == "pending"))).scalar() or 0
    processing = (await db.execute(select(func.count()).select_from(ClientCommunicationOutbox).where(ClientCommunicationOutbox.status == "processing"))).scalar() or 0
    retryable = (await db.execute(select(func.count()).select_from(ClientCommunicationOutbox).where(ClientCommunicationOutbox.status.in_(["retry", "retryable", "retryable_failure"])))).scalar() or 0
    dead = (await db.execute(select(func.count()).select_from(ClientCommunicationOutbox).where(ClientCommunicationOutbox.status.in_(["dead", "dead_letter"])))) .scalar() or 0
    oldest = (await db.execute(select(func.min(ClientCommunicationOutbox.available_at)).where(ClientCommunicationOutbox.status == "pending"))).scalar_one_or_none()
    provider_rows = (await db.execute(
        select(ClientCommunicationAttempt.provider, ClientCommunicationAttempt.status, func.count())
        .group_by(ClientCommunicationAttempt.provider, ClientCommunicationAttempt.status)
    )).all()
    latest = (await db.execute(select(ClientCommunicationWorkerHeartbeat).order_by(ClientCommunicationWorkerHeartbeat.updated_at.desc()).limit(1))).scalar_one_or_none()
    now = datetime.utcnow()
    provider_summary: dict[str, dict[str, int]] = {}
    for provider, status, count in provider_rows:
        provider_key = provider or "unknown"
        provider_summary.setdefault(provider_key, {})[status or "unknown"] = int(count or 0)
    return {
        "worker_enabled": bool(getattr(latest, "worker_enabled", settings.COMMUNICATION_WORKER_ENABLED)),
        "database_reachable": True,
        "recently_polled": bool(latest and latest.last_successful_poll and latest.last_successful_poll >= now - timedelta(seconds=settings.OUTBOX_LOCK_TIMEOUT_SECONDS)),
        "recently_dispatched": bool(latest and latest.last_successful_dispatch and latest.last_successful_dispatch >= now - timedelta(seconds=settings.OUTBOX_LOCK_TIMEOUT_SECONDS)),
        "pending_count": pending,
        "processing_count": processing,
        "retryable_count": retryable,
        "dead_count": dead,
        "oldest_pending_age_seconds": int((now - oldest).total_seconds()) if oldest else None,
        "safe_provider_summary": provider_summary,
    }


async def export_events_csv(db: AsyncSession, user: User, filters: ProtectionFilters) -> str:
    validate_export_filters(filters)
    filters.page = 1
    filters.page_size = EXPORT_ROW_LIMIT
    rows = (await db.execute(scoped_event_query(user, filters).order_by(ClientCommunicationEvent.created_at.desc()).limit(EXPORT_ROW_LIMIT))).all()
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["event_id", "client_id", "branch_id", "officer_id", "purpose", "event_status", "attempt_status", "channel", "provider", "recipient_masked", "created_at", "scheduled_for", "source_reference"])
    writer.writeheader()
    for event, attempt in rows:
        row = event_row(event, attempt)
        writer.writerow({k: csv_safe(row.get(k)) for k in writer.fieldnames})
    return buf.getvalue()
