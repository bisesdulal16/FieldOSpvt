from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.audit_log import AuditLog
from app.models.cbs import CBSLoanSnapshot, CBSScheduleItem
from app.models.center_meeting import CenterMeeting, MeetingAttendance
from app.models.client import Client
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.models.promise_to_pay import PromiseToPay
from app.models.task import TaskAssignment
from app.services.audit_helper import write_audit
from app.services.client_communication_service import mask_phone

logger = logging.getLogger(__name__)

REMINDER_PURPOSES = {
    "payment_due_reminder",
    "payment_overdue_reminder",
    "promise_to_pay_reminder",
    "center_meeting_reminder",
}
THROTTLE_ATTEMPT_STATUSES = {"pending", "queued", "submitted", "provider_accepted", "delivered"}
CANCELLABLE_ATTEMPT_STATUSES = {"pending", "queued"}
CANCELLABLE_OUTBOX_STATUSES = {"pending", "retryable", "processing"}
PAYMENT_REMINDER_PURPOSES = {"payment_due_reminder", "payment_overdue_reminder", "promise_to_pay_reminder"}

EN_TEMPLATES = {
    "payment_due_reminder": "{org_name}: Your payment of NPR {amount} is due on {due_date}. Contact your branch if you need help.",
    "payment_overdue_reminder": "{org_name}: Your NPR {amount} payment due on {due_date} remains unpaid. Contact your branch.",
    "promise_to_pay_reminder": "{org_name}: Reminder of your promised payment on {promise_date}. Contact your branch if plans changed.",
    "center_meeting_reminder": "{org_name}: Reminder of your center meeting on {meeting_date}. Contact your branch if plans changed.",
}
NE_TEMPLATES = {
    "payment_due_reminder": "{org_name}: तपाईंको रु {amount} किस्ता {due_date} मा तिर्न बाँकी छ। सहयोग चाहिए शाखामा सम्पर्क गर्नुहोस्।",
    "payment_overdue_reminder": "{org_name}: {due_date} मा तिर्नुपर्ने रु {amount} अझै बाँकी छ। शाखामा सम्पर्क गर्नुहोस्।",
    "promise_to_pay_reminder": "{org_name}: तपाईंले {promise_date} मा भुक्तानी गर्ने वाचा गर्नुभएको सम्झना। योजना फेरिए शाखामा सम्पर्क गर्नुहोस्।",
    "center_meeting_reminder": "{org_name}: तपाईंको केन्द्र बैठक {meeting_date} मा छ। योजना फेरिए शाखामा सम्पर्क गर्नुहोस्।",
}


@dataclass(slots=True)
class ReminderCandidate:
    purpose: str
    client_id: int | None
    branch_id: int | None
    officer_id: int | None
    source_reference: str
    source_system: str
    amount: float | None
    due_date: date | None = None
    promise_date: date | None = None
    meeting_date: date | None = None
    schedule_slot: str = "default"
    idempotency_key: str = ""
    language: str | None = None


def parse_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt).date()
        except ValueError:
            continue
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def reminder_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.REMINDER_TIMEZONE)
    except Exception:
        logger.warning("invalid reminder timezone configured; falling back to Asia/Kathmandu")
        return ZoneInfo("Asia/Kathmandu")


def now_local(now: datetime | None = None) -> datetime:
    tz = reminder_timezone()
    if now is None:
        return datetime.now(tz)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc).astimezone(tz)
    return now.astimezone(tz)


def _parse_hhmm(value: str, fallback: time) -> time:
    try:
        hh, mm = (value or "").split(":", 1)
        return time(int(hh), int(mm))
    except Exception:
        return fallback


def next_allowed_available_at(candidate_local: datetime) -> datetime:
    """Return naive UTC available_at.

    All scheduler calculations happen as timezone-aware local datetimes. Before
    persisting, values are converted to UTC and stripped to a naive datetime,
    matching the existing DateTime columns. DB comparisons therefore compare
    naive UTC to naive UTC. Nepal has no current DST; zoneinfo still records
    future rule changes if any.
    """
    tz = reminder_timezone()
    local = candidate_local.astimezone(tz) if candidate_local.tzinfo else candidate_local.replace(tzinfo=tz)
    start = _parse_hhmm(settings.REMINDER_QUIET_HOURS_START, time(20, 0))
    end = _parse_hhmm(settings.REMINDER_QUIET_HOURS_END, time(8, 0))
    quiet_wraps = start > end
    in_quiet = local.time() >= start or local.time() < end if quiet_wraps else start <= local.time() < end
    if in_quiet:
        next_day = local.date() + timedelta(days=1) if local.time() >= start and quiet_wraps else local.date()
        local = datetime.combine(next_day, end, tzinfo=tz)
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def _safe_amount(amount: float | None) -> str:
    return f"{float(amount or 0):.0f}"


def render_template(purpose: str, language: str, *, amount: float | None = None, due_date: date | None = None, promise_date: date | None = None, meeting_date: date | None = None) -> str:
    lang = (language or settings.REMINDER_DEFAULT_LANGUAGE or "ne").lower()
    templates = NE_TEMPLATES if lang.startswith("ne") else EN_TEMPLATES
    template = templates.get(purpose)
    if template is None:
        raise ValueError(f"unsupported reminder template purpose: {purpose}")
    try:
        return template.format(
            org_name=settings.ORG_NAME_NE if lang.startswith("ne") and getattr(settings, "ORG_NAME_NE", "") else settings.ORG_NAME,
            amount=_safe_amount(amount),
            due_date=due_date.isoformat() if due_date else "",
            promise_date=promise_date.isoformat() if promise_date else "",
            meeting_date=meeting_date.isoformat() if meeting_date else "",
        )
    except KeyError as exc:
        raise ValueError(f"missing reminder template placeholder: {exc.args[0]}") from exc


def idempotency_key_for(candidate: ReminderCandidate) -> str:
    if candidate.purpose == "payment_due_reminder":
        return f"reminder:payment_due:{candidate.client_id}:{candidate.source_reference}:{candidate.due_date}:{candidate.schedule_slot}"
    if candidate.purpose == "payment_overdue_reminder":
        return f"reminder:payment_overdue:{candidate.client_id}:{candidate.source_reference}:{candidate.due_date}:{candidate.schedule_slot}"
    if candidate.purpose == "promise_to_pay_reminder":
        return f"promise_to_pay:{candidate.client_id}:{candidate.source_reference}:{candidate.promise_date}:{candidate.schedule_slot}"
    if candidate.purpose == "center_meeting_reminder":
        return f"center_meeting:{candidate.client_id}:{candidate.source_reference}:{candidate.meeting_date}:{candidate.schedule_slot}"
    raise ValueError(f"unsupported reminder purpose {candidate.purpose}")


async def write_system_audit(session: AsyncSession, action_type: str, *, entity_type: str, entity_id, meta: dict | None = None) -> AuditLog:
    safe_meta = dict(meta or {})
    for key in ("recipient", "phone", "phone_number", "message", "payload"):
        safe_meta.pop(key, None)
    return await write_audit(session, None, action_type, entity_type=entity_type, entity_id=entity_id, meta=safe_meta)


async def _branch_officer_for_client(session: AsyncSession, client_id: int | None) -> tuple[int | None, int | None]:
    if not client_id:
        return None, None
    task = (await session.execute(select(TaskAssignment).where(TaskAssignment.client_id == client_id).order_by(TaskAssignment.id.desc()).limit(1))).scalar_one_or_none()
    if task:
        return task.branch_id, task.user_id
    return None, None


async def collect_due_candidates(session: AsyncSession, today: date) -> list[ReminderCandidate]:
    target = today + timedelta(days=int(settings.REMINDER_DUE_DAYS_BEFORE))
    rows = (await session.execute(
        select(CBSScheduleItem, CBSLoanSnapshot, Client)
        .join(CBSLoanSnapshot, CBSLoanSnapshot.id == CBSScheduleItem.loan_snapshot_id)
        .join(Client, Client.id == CBSLoanSnapshot.client_id)
        .where(CBSScheduleItem.due_date == target.isoformat())
        .where(CBSScheduleItem.status.not_in(["paid", "closed", "cancelled"]))
        .where(CBSLoanSnapshot.outstanding_balance > 0)
        .where(CBSLoanSnapshot.par_status.not_in(["closed", "inactive", "paid_off"]))
        .where(Client.status == "active")
    )).all()
    out: list[ReminderCandidate] = []
    for sched, loan, client in rows:
        if float(sched.paid_amount or 0) >= float(sched.due_amount or 0):
            continue
        branch_id, officer_id = await _branch_officer_for_client(session, client.id)
        out.append(ReminderCandidate("payment_due_reminder", client.id, branch_id, officer_id, f"cbs_schedule:{sched.id}", "cbs", float(sched.due_amount), target, schedule_slot=f"due-{settings.REMINDER_DUE_DAYS_BEFORE}d"))
    return out


async def collect_overdue_candidates(session: AsyncSession, today: date) -> list[ReminderCandidate]:
    days = [int(x.strip()) for x in str(settings.REMINDER_OVERDUE_DAYS).split(",") if x.strip().isdigit()]
    if not days:
        return []
    due_dates = { (today - timedelta(days=d)).isoformat(): d for d in days }
    rows = (await session.execute(
        select(CBSScheduleItem, CBSLoanSnapshot, Client)
        .join(CBSLoanSnapshot, CBSLoanSnapshot.id == CBSScheduleItem.loan_snapshot_id)
        .join(Client, Client.id == CBSLoanSnapshot.client_id)
        .where(CBSScheduleItem.due_date.in_(list(due_dates.keys())))
        .where(CBSScheduleItem.status.not_in(["paid", "closed", "cancelled"]))
        .where(CBSLoanSnapshot.outstanding_balance > 0)
        .where(Client.status == "active")
    )).all()
    out: list[ReminderCandidate] = []
    for sched, loan, client in rows:
        if float(sched.paid_amount or 0) >= float(sched.due_amount or 0):
            continue
        due = parse_date(sched.due_date)
        branch_id, officer_id = await _branch_officer_for_client(session, client.id)
        out.append(ReminderCandidate("payment_overdue_reminder", client.id, branch_id, officer_id, f"cbs_schedule:{sched.id}", "cbs", float(sched.due_amount), due, schedule_slot=f"overdue-{due_dates[sched.due_date]}d"))
    return out


async def collect_promise_candidates(session: AsyncSession, today: date) -> list[ReminderCandidate]:
    rows = (await session.execute(
        select(PromiseToPay, Client)
        .join(Client, Client.id == PromiseToPay.client_id)
        .where(PromiseToPay.expected_payment_date == today.isoformat())
        .where(PromiseToPay.status.in_(["pending", "active", "open"]))
        .where(Client.status == "active")
    )).all()
    out = []
    for ptp, client in rows:
        branch_id = ptp.branch_id
        officer_id = None
        if branch_id is None:
            branch_id, officer_id = await _branch_officer_for_client(session, client.id)
        out.append(ReminderCandidate("promise_to_pay_reminder", client.id, branch_id, officer_id, f"ptp:{ptp.id}", "fieldos", float(ptp.promised_amount), promise_date=today, schedule_slot="same-day"))
    return out


async def collect_meeting_candidates(session: AsyncSession, today: date) -> list[ReminderCandidate]:
    rows = (await session.execute(
        select(CenterMeeting, MeetingAttendance, Client)
        .join(MeetingAttendance, MeetingAttendance.meeting_id == CenterMeeting.id)
        .join(Client, Client.id == MeetingAttendance.client_id)
        .where(CenterMeeting.meeting_date == today.isoformat())
        .where(CenterMeeting.status.in_(["scheduled", "open"]))
        .where(Client.status == "active")
    )).all()
    out = []
    for meeting, attendance, client in rows:
        branch_id, officer_id = await _branch_officer_for_client(session, client.id)
        out.append(ReminderCandidate("center_meeting_reminder", client.id, branch_id, meeting.officer_id or officer_id, f"meeting:{meeting.id}", "fieldos", None, meeting_date=today, schedule_slot="same-day"))
    return out


async def _throttle_count(session: AsyncSession, *, client_id: int, start: datetime, end: datetime) -> int:
    return (await session.execute(
        select(func.count()).select_from(ClientCommunicationEvent)
        .join(ClientCommunicationAttempt, ClientCommunicationAttempt.event_id == ClientCommunicationEvent.id)
        .where(ClientCommunicationEvent.client_id == client_id)
        .where(ClientCommunicationEvent.purpose.in_(list(REMINDER_PURPOSES)))
        .where(ClientCommunicationEvent.created_at >= start.replace(tzinfo=None))
        .where(ClientCommunicationEvent.created_at < end.replace(tzinfo=None))
        .where(ClientCommunicationAttempt.status.in_(list(THROTTLE_ATTEMPT_STATUSES)))
    )).scalar_one()


async def is_throttled(session: AsyncSession, candidate: ReminderCandidate, local_now: datetime) -> str | None:
    if not candidate.client_id:
        return None
    day_start = datetime.combine(local_now.date(), time.min, tzinfo=local_now.tzinfo).astimezone(timezone.utc)
    week_start_local = datetime.combine(local_now.date() - timedelta(days=local_now.weekday()), time.min, tzinfo=local_now.tzinfo)
    week_start = week_start_local.astimezone(timezone.utc)
    next_day = day_start + timedelta(days=1)
    if await _throttle_count(session, client_id=candidate.client_id, start=day_start, end=next_day) >= int(settings.REMINDER_MAX_PER_CLIENT_PER_DAY):
        return "daily"
    if await _throttle_count(session, client_id=candidate.client_id, start=week_start, end=week_start + timedelta(days=7)) >= int(settings.REMINDER_MAX_PER_CLIENT_PER_WEEK):
        return "weekly"
    return None


async def create_reminder_event(session: AsyncSession, candidate: ReminderCandidate, *, local_now: datetime) -> str:
    candidate.idempotency_key = candidate.idempotency_key or idempotency_key_for(candidate)
    existing = (await session.execute(select(ClientCommunicationEvent).where(ClientCommunicationEvent.idempotency_key == candidate.idempotency_key))).scalar_one_or_none()
    if existing:
        return "duplicate"

    client = await session.get(Client, candidate.client_id) if candidate.client_id else None
    if not client or client.status != "active":
        await write_system_audit(session, "communication_reminder_suppressed", entity_type="client_communication_event", entity_id=candidate.idempotency_key, meta={"reason": "inactive_or_missing_client", "purpose": candidate.purpose, "client_id": candidate.client_id, "branch_id": candidate.branch_id, "source_reference": candidate.source_reference})
        return "suppressed"
    if candidate.purpose in {"payment_due_reminder", "payment_overdue_reminder"} and (candidate.due_date is None or candidate.amount is None or float(candidate.amount) <= 0):
        await write_system_audit(session, "communication_reminder_suppressed", entity_type="client_communication_event", entity_id=candidate.idempotency_key, meta={"reason": "missing_authoritative_due_data", "purpose": candidate.purpose, "client_id": candidate.client_id, "branch_id": candidate.branch_id, "source_reference": candidate.source_reference})
        return "suppressed"

    throttle = await is_throttled(session, candidate, local_now)
    if throttle:
        await write_system_audit(session, "communication_reminder_throttled", entity_type="client_communication_event", entity_id=candidate.idempotency_key, meta={"reason": throttle, "purpose": candidate.purpose, "client_id": candidate.client_id, "source_reference": candidate.source_reference})
        return "throttled"

    recipient = client.phone_number
    language = candidate.language or settings.REMINDER_DEFAULT_LANGUAGE
    message = render_template(candidate.purpose, language, amount=candidate.amount, due_date=candidate.due_date, promise_date=candidate.promise_date, meeting_date=candidate.meeting_date)
    available_at = next_allowed_available_at(local_now)
    now_utc_naive = local_now.astimezone(timezone.utc).replace(tzinfo=None)
    event_status = "no_phone" if not recipient else "queued"
    attempt_status = "no_phone" if not recipient else "queued"

    event = ClientCommunicationEvent(
        client_id=client.id,
        branch_id=candidate.branch_id,
        officer_id=candidate.officer_id,
        purpose=candidate.purpose,
        event_type=candidate.purpose,
        verification_type=None,
        risk_level="normal",
        status=event_status,
        idempotency_key=candidate.idempotency_key,
        scheduled_for=available_at,
        source_system=candidate.source_system,
        source_reference=candidate.source_reference,
        language=language,
        priority="normal",
        created_at=now_utc_naive,
        updated_at=now_utc_naive,
    )
    session.add(event)
    await session.flush()
    metadata = {
        "purpose": candidate.purpose,
        "source_reference": candidate.source_reference,
        "amount": candidate.amount,
        "due_date": candidate.due_date.isoformat() if candidate.due_date else None,
        "promise_date": candidate.promise_date.isoformat() if candidate.promise_date else None,
        "meeting_date": candidate.meeting_date.isoformat() if candidate.meeting_date else None,
        "schedule_slot": candidate.schedule_slot,
        "message": message,
        "message_unicode_chars": len(message),
        "sms_segments_estimate": 1 if len(message) <= 70 else (len(message) + 66) // 67,
    }
    attempt = ClientCommunicationAttempt(
        event_id=event.id,
        channel="sms",
        provider=settings.SMS_PROVIDER,
        recipient=recipient,
        attempt_number=1,
        status=attempt_status,
        queued_at=now_utc_naive if recipient else None,
        completed_at=now_utc_naive if not recipient else None,
        error_code="no_phone" if not recipient else None,
        error_message="client has no phone number" if not recipient else None,
        metadata_json=json.dumps(metadata, ensure_ascii=False),
        created_at=now_utc_naive,
        updated_at=now_utc_naive,
    )
    session.add(attempt)
    await session.flush()
    if recipient:
        session.add(ClientCommunicationOutbox(
            event_id=event.id,
            attempt_id=attempt.id,
            queue_name="client_communication.sms",
            payload_json=json.dumps({"event_id": event.id, "attempt_id": attempt.id, "purpose": candidate.purpose, "channel": "sms", "provider": settings.SMS_PROVIDER, "recipient": recipient, "message": message, "source_reference": candidate.source_reference}, ensure_ascii=False),
            status="pending",
            idempotency_key=f"{candidate.idempotency_key}:sms:1",
            available_at=available_at,
            max_retries=settings.OUTBOX_MAX_ATTEMPTS,
            created_at=now_utc_naive,
            updated_at=now_utc_naive,
        ))
        await write_system_audit(session, "communication_reminder_created", entity_type="client_communication_event", entity_id=event.id, meta={"purpose": candidate.purpose, "client_id": client.id, "branch_id": candidate.branch_id, "source_reference": candidate.source_reference, "recipient_masked": mask_phone(recipient), "scheduled_for": available_at.isoformat()})
        return "created"

    await write_system_audit(session, "communication_reminder_no_phone", entity_type="client_communication_event", entity_id=event.id, meta={"purpose": candidate.purpose, "client_id": client.id, "branch_id": candidate.branch_id, "source_reference": candidate.source_reference, "status": "no_phone"})
    return "no_phone"


async def audit_suppressed_payment_sources(session: AsyncSession, today: date) -> int:
    """Audit payment source rows that are intentionally not candidates.

    This preserves operator visibility for paid/closed/inactive/missing CBS data
    without creating communication events, attempts, or outbox rows.
    """
    audited = 0
    due_target = today + timedelta(days=int(settings.REMINDER_DUE_DAYS_BEFORE))
    overdue_days = [int(x.strip()) for x in str(settings.REMINDER_OVERDUE_DAYS).split(",") if x.strip().isdigit()]
    overdue_dates = [today - timedelta(days=d) for d in overdue_days]
    relevant_dates = {due_target.isoformat(), *(d.isoformat() for d in overdue_dates)}
    rows = (await session.execute(
        select(CBSScheduleItem, CBSLoanSnapshot, Client)
        .join(CBSLoanSnapshot, CBSLoanSnapshot.id == CBSScheduleItem.loan_snapshot_id)
        .join(Client, Client.id == CBSLoanSnapshot.client_id)
        .where((CBSScheduleItem.due_date.in_(list(relevant_dates))) | (CBSScheduleItem.due_date.is_(None)) | (CBSScheduleItem.due_amount.is_(None)))
    )).all()
    for sched, loan, client in rows:
        reason = None
        if not sched.due_date:
            reason = "missing_due_date"
        elif sched.due_amount is None or float(sched.due_amount or 0) <= 0:
            reason = "missing_authoritative_amount"
        elif sched.status in {"paid", "closed", "cancelled"} or float(sched.paid_amount or 0) >= float(sched.due_amount or 0):
            reason = "paid_or_closed_installment"
        elif client.status != "active":
            reason = "inactive_or_closed_client"
        elif loan.par_status in {"closed", "inactive", "paid_off"} or float(loan.outstanding_balance or 0) <= 0:
            reason = "closed_or_inactive_account"
        if reason:
            await write_system_audit(session, "communication_reminder_suppressed", entity_type="client_communication_source", entity_id=f"cbs_schedule:{sched.id}", meta={"reason": reason, "client_id": client.id, "source_reference": f"cbs_schedule:{sched.id}"})
            audited += 1
    return audited


async def run_reminder_scheduler_once(session: AsyncSession, *, now: datetime | None = None) -> dict:
    local_now = now_local(now)
    summary = {"created": 0, "duplicate": 0, "suppressed": 0, "throttled": 0, "no_phone": 0, "disabled": False}
    if not settings.REMINDERS_ENABLED:
        summary["disabled"] = True
        await write_system_audit(session, "communication_reminder_scheduler_run", entity_type="client_communication_scheduler", entity_id="once", meta={"enabled": False, "created": 0})
        return summary

    candidates = []
    today = local_now.date()
    summary["suppressed"] += await audit_suppressed_payment_sources(session, today)
    candidates.extend(await collect_due_candidates(session, today))
    candidates.extend(await collect_overdue_candidates(session, today))
    candidates.extend(await collect_promise_candidates(session, today))
    candidates.extend(await collect_meeting_candidates(session, today))
    for candidate in candidates[: int(settings.OUTBOX_BATCH_SIZE)]:
        result = await create_reminder_event(session, candidate, local_now=local_now)
        summary[result] = summary.get(result, 0) + 1
    await write_system_audit(session, "communication_reminder_scheduler_run", entity_type="client_communication_scheduler", entity_id="once", meta={"enabled": True, "candidate_count": len(candidates), **summary})
    return summary


async def cancel_pending_reminders_for_payment(session: AsyncSession, *, client_id: int, branch_id: int | None = None, source_reference: str | None = None, reason: str = "payment_recorded") -> int:
    q = (
        select(ClientCommunicationEvent)
        .where(ClientCommunicationEvent.client_id == client_id)
        .where(ClientCommunicationEvent.purpose.in_(list(PAYMENT_REMINDER_PURPOSES)))
    )
    if branch_id is not None:
        q = q.where(ClientCommunicationEvent.branch_id == branch_id)
    if source_reference:
        q = q.where(ClientCommunicationEvent.source_reference == source_reference)
    events = (await session.execute(q)).scalars().all()
    now = datetime.utcnow()
    cancelled = 0
    for event in events:
        attempts = (await session.execute(select(ClientCommunicationAttempt).where(ClientCommunicationAttempt.event_id == event.id))).scalars().all()
        mutable_attempts = [a for a in attempts if a.status in CANCELLABLE_ATTEMPT_STATUSES]
        if not mutable_attempts:
            continue
        event.status = "cancelled"
        event.cancelled_at = now
        event.cancellation_reason = reason
        event.updated_at = now
        for attempt in mutable_attempts:
            attempt.status = "cancelled"
            attempt.completed_at = now
            attempt.error_code = reason
            attempt.updated_at = now
        outboxes = (await session.execute(select(ClientCommunicationOutbox).where(ClientCommunicationOutbox.event_id == event.id).where(ClientCommunicationOutbox.status.in_(list(CANCELLABLE_OUTBOX_STATUSES))))).scalars().all()
        for outbox in outboxes:
            outbox.status = "cancelled"
            outbox.cancelled_at = now
            outbox.last_error_code = reason
            outbox.last_error = "reminder cancelled before dispatch"
            outbox.updated_at = now
        await write_system_audit(session, "communication_reminder_cancelled", entity_type="client_communication_event", entity_id=event.id, meta={"client_id": client_id, "branch_id": event.branch_id, "purpose": event.purpose, "source_reference": event.source_reference, "reason": reason})
        cancelled += 1
    return cancelled


async def reminder_rows(session: AsyncSession, *, current_user=None, client_id: int | None = None, purpose: str | None = None, include_cancelled: bool = False) -> list[dict]:
    q = select(ClientCommunicationEvent, ClientCommunicationAttempt).join(ClientCommunicationAttempt, ClientCommunicationAttempt.event_id == ClientCommunicationEvent.id).where(ClientCommunicationEvent.purpose.in_(list(REMINDER_PURPOSES)))
    if client_id is not None:
        q = q.where(ClientCommunicationEvent.client_id == client_id)
    if purpose:
        q = q.where(ClientCommunicationEvent.purpose == purpose)
    if not include_cancelled:
        q = q.where(ClientCommunicationEvent.status != "cancelled")
    if current_user is not None and getattr(current_user, "role", None) != "admin":
        if getattr(current_user, "branch_id", None) is None:
            q = q.where(ClientCommunicationEvent.branch_id == -1)
        else:
            q = q.where(ClientCommunicationEvent.branch_id == current_user.branch_id)
    rows = (await session.execute(q.order_by(ClientCommunicationEvent.scheduled_for.asc(), ClientCommunicationEvent.id.asc()).limit(200))).all()
    data = []
    for event, attempt in rows:
        data.append({
            "event_id": event.id,
            "attempt_id": attempt.id,
            "client_id": event.client_id,
            "branch_id": event.branch_id,
            "purpose": event.purpose,
            "status": event.status,
            "attempt_status": attempt.status,
            "source_reference": event.source_reference,
            "scheduled_for": event.scheduled_for.isoformat() if event.scheduled_for else None,
            "cancelled_at": event.cancelled_at.isoformat() if event.cancelled_at else None,
            "cancellation_reason": event.cancellation_reason,
            "recipient_masked": mask_phone(attempt.recipient),
            "language": event.language,
        })
    return data
