import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.branch import Branch
from app.models.cbs import CBSLoanSnapshot, CBSScheduleItem
from app.models.center_meeting import CenterMeeting, MeetingAttendance
from app.models.client import Client
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.models.promise_to_pay import PromiseToPay
from app.models.task import TaskAssignment
from app.models.user import Department, User
from app.services.auth_service import hash_pin
from app.services import communication_reminders as reminder_module
from app.services.communication_reminders import (
    cancel_pending_reminders_for_payment,
    next_allowed_available_at,
    render_template,
    run_reminder_scheduler_once,
)
from tests.conftest import auth, login

PHONE = "+977-9800000001"
NEPAL = ZoneInfo("Asia/Kathmandu")
NOW_LOCAL = datetime(2026, 7, 29, 9, 0, tzinfo=NEPAL)


@pytest.fixture(autouse=True)
def reminder_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "REMINDERS_ENABLED", True)
    monkeypatch.setattr(settings, "SMS_PROVIDER", "log")
    monkeypatch.setattr(settings, "REMINDER_DUE_DAYS_BEFORE", 1)
    monkeypatch.setattr(settings, "REMINDER_OVERDUE_DAYS", "1,3,7")
    monkeypatch.setattr(settings, "REMINDER_QUIET_HOURS_START", "20:00")
    monkeypatch.setattr(settings, "REMINDER_QUIET_HOURS_END", "08:00")
    monkeypatch.setattr(settings, "REMINDER_MAX_PER_CLIENT_PER_DAY", 1)
    monkeypatch.setattr(settings, "REMINDER_MAX_PER_CLIENT_PER_WEEK", 3)
    monkeypatch.setattr(settings, "REMINDER_DEFAULT_LANGUAGE", "en")
    monkeypatch.setattr(settings, "REMINDER_TIMEZONE", "Asia/Kathmandu")


async def _client(client_id=1):
    async with AsyncSessionLocal() as s:
        return await s.get(Client, client_id)


async def _set_client_phone(phone: str | None, *, status="active"):
    async with AsyncSessionLocal() as s:
        c = await s.get(Client, 1)
        c.phone_number = phone
        c.status = status
        await s.commit()


async def _add_schedule(*, due_offset_days: int, status="pending", paid_amount=0.0, outstanding=45000.0, loan_status="current", client_status="active", due_amount=2500.0):
    async with AsyncSessionLocal() as s:
        c = await s.get(Client, 1)
        c.status = client_status
        loan = CBSLoanSnapshot(
            client_id=1,
            cbs_loan_id=f"CBS-{due_offset_days}-{status}-{paid_amount}-{outstanding}-{loan_status}",
            outstanding_balance=outstanding,
            installment_amount=2500.0,
            par_status=loan_status,
        )
        s.add(loan)
        await s.flush()
        sched = CBSScheduleItem(
            loan_snapshot_id=loan.id,
            installment_no=1,
            due_date=(NOW_LOCAL.date() + timedelta(days=due_offset_days)).isoformat(),
            due_amount=due_amount,
            paid_amount=paid_amount,
            status=status,
        )
        s.add(sched)
        await s.commit()
        return sched.id


async def _events():
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(select(ClientCommunicationEvent, ClientCommunicationAttempt).join(ClientCommunicationAttempt))).all()
        return rows


async def _outboxes():
    async with AsyncSessionLocal() as s:
        return (await s.execute(select(ClientCommunicationOutbox))).scalars().all()


async def _run(now=NOW_LOCAL):
    async with AsyncSessionLocal() as s:
        summary = await run_reminder_scheduler_once(s, now=now)
        await s.commit()
        return summary


async def test_due_reminder_created_at_configured_offset():
    sched_id = await _add_schedule(due_offset_days=1)
    summary = await _run()
    assert summary["created"] == 1
    rows = await _events()
    event, attempt = rows[0]
    assert event.purpose == "payment_due_reminder"
    assert event.idempotency_key == f"reminder:payment_due:1:cbs_schedule:{sched_id}:2026-07-30:due-1d"
    assert attempt.status == "queued"
    assert (await _outboxes())[0].status == "pending"


async def test_overdue_reminder_created_on_configured_overdue_day():
    await _add_schedule(due_offset_days=-3)
    summary = await _run()
    assert summary["created"] == 1
    event, _ = (await _events())[0]
    assert event.purpose == "payment_overdue_reminder"
    assert event.idempotency_key.endswith("2026-07-26:overdue-3d")


async def test_promise_to_pay_reminder_created():
    async with AsyncSessionLocal() as s:
        s.add(PromiseToPay(client_id=1, promised_amount=1200, outstanding_amount=2500, expected_payment_date=NOW_LOCAL.date().isoformat(), status="pending", branch_id=1))
        await s.commit()
    summary = await _run()
    assert summary["created"] == 1
    event, _ = (await _events())[0]
    assert event.purpose == "promise_to_pay_reminder"
    assert event.idempotency_key.startswith("promise_to_pay:1:ptp:")


async def test_center_meeting_reminder_created():
    async with AsyncSessionLocal() as s:
        meeting = CenterMeeting(center_id="C-1", center_name="Center 1", meeting_date=NOW_LOCAL.date().isoformat(), officer_id=1, status="scheduled")
        s.add(meeting)
        await s.flush()
        s.add(MeetingAttendance(meeting_id=meeting.id, client_id=1, member_id="M-001"))
        await s.commit()
    summary = await _run()
    assert summary["created"] == 1
    event, _ = (await _events())[0]
    assert event.purpose == "center_meeting_reminder"
    assert event.idempotency_key.startswith("center_meeting:1:meeting:")


async def test_repeated_scheduler_run_is_idempotent():
    await _add_schedule(due_offset_days=1)
    first = await _run()
    second = await _run()
    assert first["created"] == 1
    assert second["duplicate"] == 1
    assert len(await _events()) == 1
    assert len(await _outboxes()) == 1


async def test_paid_installment_suppresses_due_reminder():
    await _add_schedule(due_offset_days=1, status="paid", paid_amount=2500)
    summary = await _run()
    assert summary["created"] == 0
    assert len(await _events()) == 0


async def test_payment_cancels_pending_reminder():
    await _add_schedule(due_offset_days=1)
    await _run()
    async with AsyncSessionLocal() as s:
        cancelled = await cancel_pending_reminders_for_payment(s, client_id=1, branch_id=1)
        await s.commit()
    assert cancelled == 1
    event, attempt = (await _events())[0]
    assert event.status == "cancelled"
    assert attempt.status == "cancelled"
    assert (await _outboxes())[0].status == "cancelled"


async def test_payment_cancellation_scopes_branch_source_and_history():
    async with AsyncSessionLocal() as s:
        scoped = ClientCommunicationEvent(client_id=1, branch_id=1, purpose="payment_due_reminder", event_type="payment_due_reminder", status="queued", idempotency_key="due-scoped", source_reference="loan-a")
        other_source = ClientCommunicationEvent(client_id=1, branch_id=1, purpose="payment_due_reminder", event_type="payment_due_reminder", status="queued", idempotency_key="due-other-source", source_reference="loan-b")
        other_branch = ClientCommunicationEvent(client_id=1, branch_id=999, purpose="payment_overdue_reminder", event_type="payment_overdue_reminder", status="queued", idempotency_key="overdue-other-branch", source_reference="loan-a")
        meeting = ClientCommunicationEvent(client_id=1, branch_id=1, purpose="center_meeting_reminder", event_type="center_meeting_reminder", status="queued", idempotency_key="meeting-1", source_reference="meeting:1")
        submitted = ClientCommunicationEvent(client_id=1, branch_id=1, purpose="payment_due_reminder", event_type="payment_due_reminder", status="submitted", idempotency_key="due-submitted", source_reference="loan-a")
        s.add_all([scoped, other_source, other_branch, meeting, submitted])
        await s.flush()
        scoped_attempt = None
        for event, status in [(scoped, "queued"), (other_source, "queued"), (other_branch, "queued"), (meeting, "queued"), (submitted, "submitted")]:
            attempt = ClientCommunicationAttempt(event_id=event.id, channel="sms", provider="log", recipient=PHONE, status=status)
            s.add(attempt)
            if event is scoped:
                scoped_attempt = attempt
        await s.flush()
        assert scoped_attempt is not None
        s.add(ClientCommunicationOutbox(event_id=scoped.id, attempt_id=scoped_attempt.id, payload_json="{}", status="pending", idempotency_key="due-scoped:sms:1"))
        cancelled = await cancel_pending_reminders_for_payment(s, client_id=1, branch_id=1, source_reference="loan-a")
        await s.commit()
    assert cancelled == 1
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(select(ClientCommunicationEvent))).scalars().all()
        by_key = {e.idempotency_key: e.status for e in rows}
    assert by_key["due-scoped"] == "cancelled"
    assert by_key["due-other-source"] == "queued"
    assert by_key["overdue-other-branch"] == "queued"
    assert by_key["meeting-1"] == "queued"
    assert by_key["due-submitted"] == "submitted"


async def test_collection_verification_is_not_cancelled():
    async with AsyncSessionLocal() as s:
        event = ClientCommunicationEvent(client_id=1, branch_id=1, purpose="collection_verification", event_type="collection_verification", status="queued", idempotency_key="cv-1")
        s.add(event)
        await s.flush()
        s.add(ClientCommunicationAttempt(event_id=event.id, channel="sms", provider="log", recipient=PHONE, status="queued"))
        await cancel_pending_reminders_for_payment(s, client_id=1)
        await s.commit()
    event, attempt = (await _events())[0]
    assert event.status == "queued"
    assert attempt.status == "queued"


async def test_quiet_hours_rescheduling():
    await _add_schedule(due_offset_days=1)
    quiet_now = datetime(2026, 7, 29, 21, 30, tzinfo=NEPAL)
    await _run(quiet_now)
    outbox = (await _outboxes())[0]
    local_available = outbox.available_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(NEPAL)
    assert local_available.hour == 8
    assert local_available.minute == 0
    assert local_available.date().isoformat() == "2026-07-30"
    assert outbox.available_at.tzinfo is None
    assert outbox.available_at.isoformat() == "2026-07-30T02:15:00"


async def test_throttle_ignores_collection_verification_and_duplicates(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "REMINDER_MAX_PER_CLIENT_PER_DAY", 1)
    async with AsyncSessionLocal() as s:
        cv = ClientCommunicationEvent(client_id=1, branch_id=1, purpose="collection_verification", event_type="collection_verification", status="delivered", idempotency_key="cv-throttle")
        s.add(cv)
        await s.flush()
        s.add(ClientCommunicationAttempt(event_id=cv.id, channel="sms", provider="log", recipient=PHONE, status="delivered"))
        await s.commit()
    await _add_schedule(due_offset_days=1)
    first = await _run()
    second = await _run()
    assert first["created"] == 1
    assert second["duplicate"] == 1
    assert second["throttled"] == 0


async def test_daily_throttle(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "REMINDER_MAX_PER_CLIENT_PER_DAY", 1)
    await _add_schedule(due_offset_days=1)
    await _add_schedule(due_offset_days=-1)
    summary = await _run()
    assert summary["created"] == 1
    assert summary["throttled"] == 1


async def test_weekly_throttle(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "REMINDER_MAX_PER_CLIENT_PER_DAY", 99)
    monkeypatch.setattr(settings, "REMINDER_MAX_PER_CLIENT_PER_WEEK", 1)
    await _add_schedule(due_offset_days=1)
    await _add_schedule(due_offset_days=-1)
    summary = await _run()
    assert summary["created"] == 1
    assert summary["throttled"] == 1


async def test_no_phone_behavior():
    await _set_client_phone(None)
    await _add_schedule(due_offset_days=1)
    summary = await _run()
    assert summary["no_phone"] == 1
    event, attempt = (await _events())[0]
    assert event.status == "no_phone"
    assert attempt.status == "no_phone"
    assert len(await _outboxes()) == 0


async def test_closed_account_suppression():
    await _add_schedule(due_offset_days=1, client_status="closed")
    summary = await _run()
    assert summary["created"] == 0
    assert summary["suppressed"] == 1
    assert len(await _events()) == 0
    assert len(await _outboxes()) == 0
    async with AsyncSessionLocal() as s:
        audits = (await s.execute(select(AuditLog).where(AuditLog.action_type == "communication_reminder_suppressed"))).scalars().all()
    assert audits
    assert PHONE not in "\n".join(a.meta_json or "" for a in audits)


async def test_missing_authoritative_amount_suppressed_and_audited():
    await _add_schedule(due_offset_days=1, due_amount=0)
    summary = await _run()
    assert summary["created"] == 0
    assert summary["suppressed"] == 1
    assert len(await _events()) == 0
    assert len(await _outboxes()) == 0
    async with AsyncSessionLocal() as s:
        audits = (await s.execute(select(AuditLog).where(AuditLog.action_type == "communication_reminder_suppressed"))).scalars().all()
    assert any("missing_authoritative_amount" in (a.meta_json or "") for a in audits)


async def test_missing_due_date_candidate_suppresses_safely():
    candidate = reminder_module.ReminderCandidate(
        purpose="payment_due_reminder",
        client_id=1,
        branch_id=1,
        officer_id=1,
        source_reference="cbs_schedule:missing-date",
        source_system="cbs",
        amount=2500,
        due_date=None,
    )
    async with AsyncSessionLocal() as s:
        result = await reminder_module.create_reminder_event(s, candidate, local_now=NOW_LOCAL)
        await s.commit()
    assert result == "suppressed"
    assert len(await _outboxes()) == 0


async def test_invalid_communication_policy_suppresses_without_outbox():
    await _add_schedule(due_offset_days=1, loan_status="closed")
    summary = await _run()
    assert summary["created"] == 0
    assert summary["suppressed"] == 1
    assert len(await _outboxes()) == 0


async def test_branch_scoping(client: AsyncClient):
    await _add_schedule(due_offset_days=1)
    await _run()
    async with AsyncSessionLocal() as s:
        branch_b = Branch(branch_id="BR-B", name="Branch B")
        s.add(branch_b)
        await s.flush()
        s.add(User(staff_id="BM-B", name="B Manager", role="branch_manager", hashed_pin=hash_pin("1234"), branch_id=branch_b.id, is_active=True))
        await s.commit()
    token_a = await login(client, "BM-001")
    token_b = await login(client, "BM-B")
    a = await client.get("/api/v1/client-communication/reminders/upcoming", headers=auth(token_a))
    b = await client.get("/api/v1/client-communication/reminders/upcoming", headers=auth(token_b))
    assert a.status_code == 200
    assert len(a.json()["data"]) == 1
    assert b.status_code == 200
    assert b.json()["data"] == []


async def test_admin_it_forbidden(client: AsyncClient):
    async with AsyncSessionLocal() as s:
        s.add(User(staff_id="IT-1", name="IT Admin", role="admin", department=Department.ADMIN_IT.value, hashed_pin=hash_pin("1234"), is_active=True))
        await s.commit()
    token = await login(client, "IT-1")
    resp = await client.get("/api/v1/client-communication/reminders/summary", headers=auth(token))
    assert resp.status_code == 403


def test_english_template():
    msg = render_template("payment_due_reminder", "en", amount=2500, due_date=NOW_LOCAL.date())
    assert "Your payment of NPR 2500 is due on 2026-07-29" in msg


def test_nepali_template():
    msg = render_template("payment_due_reminder", "ne", amount=2500, due_date=NOW_LOCAL.date())
    assert "तपाईंको रु 2500" in msg
    assert "2026-07-29" in msg
    assert "PIN" not in msg and "OTP" not in msg


def test_missing_template_placeholder_fails_safely(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setitem(reminder_module.EN_TEMPLATES, "payment_due_reminder", "{org_name}: {missing_placeholder}")
    with pytest.raises(ValueError, match="missing reminder template placeholder"):
        render_template("payment_due_reminder", "en", amount=2500, due_date=NOW_LOCAL.date())


async def test_no_sensitive_values_in_app_logs(caplog):
    await _add_schedule(due_offset_days=1)
    with caplog.at_level("INFO"):
        await _run()
    app_log_text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app."))
    async with AsyncSessionLocal() as s:
        audits = (await s.execute(select(AuditLog))).scalars().all()
    audit_text = "\n".join(a.meta_json or "" for a in audits)
    assert PHONE not in app_log_text
    assert PHONE not in audit_text
    assert "Your payment of NPR" not in app_log_text
    assert "Your payment of NPR" not in audit_text


def test_one_shot_scheduler_exits_cleanly(monkeypatch: pytest.MonkeyPatch):
    env = os.environ.copy()
    env["DB_TYPE"] = "sqlite"
    env["SQLITE_PATH"] = "/tmp/fieldos_test.db"
    env["REMINDERS_ENABLED"] = "false"
    result = subprocess.run([sys.executable, "-m", "app.workers.communication_reminders", "--once"], cwd=os.path.dirname(os.path.dirname(__file__)), env=env, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert '"disabled": true' in result.stdout


async def test_disabled_scheduler_creates_nothing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "REMINDERS_ENABLED", False)
    await _add_schedule(due_offset_days=1)
    summary = await _run()
    assert summary["disabled"] is True
    assert len(await _events()) == 0
