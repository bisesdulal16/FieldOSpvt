import csv
import io
import json
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.branch import Branch
from app.models.client import Client
from app.models.cbs import CBSLoanSnapshot, CBSScheduleItem
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox, ClientCommunicationCallbackReceipt, ClientCommunicationWorkerHeartbeat
from app.models.collection import Collection
from app.models.sms_notification import SmsNotification
from app.models.user import Department, User
from app.services.auth_service import hash_pin
from tests.conftest import auth, login

PHONE = "+977-" + "9800000001"
OTHER_PHONE = "+977-" + "9800007844"
MESSAGE = "Full sensitive " + "SMS body should not be returned"


async def _seed_comm_rows():
    async with AsyncSessionLocal() as s:
        branch2 = Branch(branch_id="BR-2", name="Other Branch")
        s.add(branch2)
        await s.flush()
        other_officer = User(staff_id="FO-209", name="Other FO", role="field_officer", hashed_pin=hash_pin("1234"), branch_id=branch2.id, is_active=True)
        s.add(User(staff_id="BM-002", name="Other BM", role="branch_manager", hashed_pin=hash_pin("1234"), branch_id=branch2.id, is_active=True))
        s.add(other_officer)
        s.add(User(staff_id="HO-001", name="Head Office", role="admin", department=Department.HEAD_OFFICE.value, data_scope="org", permission_set="read", hashed_pin=hash_pin("1234"), is_active=True))
        s.add(User(staff_id="AUD-001", name="Audit", role="admin", department=Department.AUDIT.value, data_scope="org", permission_set="read,flag", hashed_pin=hash_pin("1234"), is_active=True))
        s.add(User(staff_id="IT-001", name="IT Admin", role="admin", department=Department.ADMIN_IT.value, data_scope="org", permission_set="admin", hashed_pin=hash_pin("1234"), is_active=True))
        await s.flush()
        other_client = Client(member_id="M-CP-2", name="Other Branch Client", phone_number=OTHER_PHONE, outstanding_balance=1000, due_amount=100)
        s.add(other_client)
        await s.flush()

        collection = Collection(receipt_id="R-CP-1", client_id=1, officer_id=1, branch_id=1, amount=5000, due_amount=5000, is_high_value=True, cbs_verified=False, collected_at="2026-07-29T09:00:00")
        s.add(collection)
        await s.flush()

        loan = CBSLoanSnapshot(client_id=1, cbs_loan_id="LN-CP-1", outstanding_balance=5000, installment_amount=500, par_status="overdue")
        s.add(loan)
        await s.flush()
        schedule = CBSScheduleItem(loan_snapshot_id=loan.id, installment_no=1, due_date="2026-07-01", due_amount=500, paid_amount=0, status="pending", days_overdue=28)
        s.add(schedule)
        await s.flush()

        events = [
            ClientCommunicationEvent(collection_id=collection.id, client_id=1, branch_id=1, officer_id=1, purpose="collection_verification", event_type="collection_verification", status="confirmed", idempotency_key="cp-cv-1", confirmed_at=datetime.utcnow(), risk_level="high"),
            ClientCommunicationEvent(client_id=1, branch_id=1, officer_id=1, purpose="payment_due_reminder", event_type="payment_due_reminder", status="queued", idempotency_key="cp-due-1", source_reference="cbs_schedule:1"),
            ClientCommunicationEvent(client_id=1, branch_id=1, officer_id=1, purpose="payment_overdue_reminder", event_type="payment_overdue_reminder", status="queued", idempotency_key="cp-overdue-1", source_reference=f"cbs_schedule:{schedule.id}"),
            ClientCommunicationEvent(client_id=1, branch_id=1, officer_id=1, purpose="promise_to_pay_reminder", event_type="promise_to_pay_reminder", status="no_phone", idempotency_key="cp-ptp-1", source_reference="ptp:1"),
            ClientCommunicationEvent(client_id=1, branch_id=1, officer_id=1, purpose="center_meeting_reminder", event_type="center_meeting_reminder", status="cancelled", idempotency_key="cp-meeting-1", source_reference="meeting:1"),
            ClientCommunicationEvent(collection_id=collection.id, client_id=1, branch_id=1, officer_id=1, purpose="collection_verification", event_type="collection_verification", status="disputed", idempotency_key="cp-dispute-1", disputed_at=datetime.utcnow(), risk_level="high"),
            ClientCommunicationEvent(client_id=other_client.id, branch_id=branch2.id, officer_id=other_officer.id, purpose="payment_due_reminder", event_type="payment_due_reminder", status="queued", idempotency_key="cp-other-branch", source_reference="=cbs_schedule:99"),
        ]
        s.add_all(events)
        await s.flush()
        attempts = [
            ClientCommunicationAttempt(event_id=events[0].id, channel="sms", provider="log", recipient=PHONE, status="delivered", client_response="confirmed", metadata_json=json.dumps({"message": MESSAGE, "safe": "ok"})),
            ClientCommunicationAttempt(event_id=events[1].id, channel="sms", provider="log", recipient=PHONE, status="queued", metadata_json=json.dumps({"message": MESSAGE})),
            ClientCommunicationAttempt(event_id=events[2].id, channel="sms", provider="sparrow", recipient=PHONE, status="failed", error_code="provider_error", error_message="masked failure"),
            ClientCommunicationAttempt(event_id=events[3].id, channel="sms", provider="log", recipient=None, status="no_phone"),
            ClientCommunicationAttempt(event_id=events[4].id, channel="sms", provider="log", recipient=PHONE, status="cancelled"),
            ClientCommunicationAttempt(event_id=events[5].id, channel="sms", provider="log", recipient=PHONE, status="delivered", client_response="disputed"),
            ClientCommunicationAttempt(event_id=events[6].id, channel="sms", provider="log", recipient=PHONE, status="queued"),
        ]
        s.add_all(attempts)
        await s.flush()
        s.add(ClientCommunicationOutbox(event_id=events[2].id, attempt_id=attempts[2].id, payload_json=json.dumps({"message": MESSAGE, "recipient": PHONE}), status="dead", idempotency_key="dead-1"))
        s.add(ClientCommunicationOutbox(event_id=events[1].id, attempt_id=attempts[1].id, payload_json=json.dumps({"message": MESSAGE}), status="processing", locked_at=datetime.utcnow() - timedelta(minutes=30), idempotency_key="stale-1"))
        s.add(ClientCommunicationCallbackReceipt(provider="sparrow", provider_event_id="ev-conflict", provider_reference="ref", event_id=events[2].id, attempt_id=attempts[2].id, normalized_status="failed", signature_digest="a" * 64, callback_payload_hash="b" * 64, action_taken="replay_rejected"))
        s.add(ClientCommunicationWorkerHeartbeat(worker_id="worker-test", worker_enabled=False, process_alive=True, last_successful_poll=datetime.utcnow(), last_successful_dispatch=datetime.utcnow()))
        s.add(AuditLog(action_type="communication_reminder_suppressed", branch_id=1, entity_type="client_communication_source", entity_id="cbs_schedule:4"))
        s.add(AuditLog(action_type="communication_reminder_throttled", branch_id=1, entity_type="client_communication_event", entity_id="due-4"))
        s.add(SmsNotification(client_id=1, collection_receipt_id="R-CP-1", phone_number=PHONE, message=MESSAGE, status="sent", provider="log"))
        await s.commit()
        return {"branch2_id": branch2.id, "event_id": events[0].id, "other_event_id": events[6].id, "officer_id": 1, "other_officer_id": other_officer.id, "client_id": 1, "other_client_id": other_client.id}


async def _get(client: AsyncClient, staff_id: str, path: str):
    token = await login(client, staff_id)
    return await client.get(path, headers=auth(token))


@pytest.mark.asyncio
async def test_branch_manager_sees_own_branch_only_and_summary_denominators(client: AsyncClient):
    ids = await _seed_comm_rows()
    resp = await _get(client, "BM-001", "/api/v1/manager/client-protection/summary")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    counts = data["counts"]
    assert counts["total_communication_events"] == 6
    assert counts["collection_verification_count"] == 2
    assert counts["due_reminder_count"] == 1
    assert counts["overdue_reminder_count"] == 1
    assert counts["promise_to_pay_reminder_count"] == 1
    assert counts["center_meeting_reminder_count"] == 1
    assert counts["dead_letter_count"] == 1
    assert counts["reminder_suppression_count"] == 1
    assert data["rates"]["verification_rate_denominator"] == "eligible collection verification events excluding cancelled/suppressed"
    assert data["rates"]["delivery_rate_denominator"] == "attempts with submitted/provider_accepted/delivered status; cancelled/queued/no_phone/suppressed excluded"
    assert data["rates"]["verification_rate"] == 50.0
    assert data["rates"]["dispute_rate"] == 50.0

    forced_other = await _get(client, "BM-001", f"/api/v1/manager/client-protection/summary?branch_id={ids['branch2_id']}")
    assert forced_other.status_code == 200
    assert forced_other.json()["data"]["counts"]["total_communication_events"] == 6

    other = await _get(client, "BM-001", f"/api/v1/manager/client-protection/branches/{ids['branch2_id']}/summary")
    assert other.status_code == 403


@pytest.mark.asyncio
async def test_head_office_and_audit_access_admin_it_forbidden(client: AsyncClient):
    await _seed_comm_rows()
    ho = await _get(client, "HO-001", "/api/v1/manager/client-protection/summary")
    audit = await _get(client, "AUD-001", "/api/v1/manager/client-protection/summary")
    it = await _get(client, "IT-001", "/api/v1/manager/client-protection/summary")
    assert ho.status_code == 200
    assert audit.status_code == 200
    assert ho.json()["data"]["counts"]["total_communication_events"] == 7
    assert audit.json()["data"]["counts"]["total_communication_events"] == 7
    assert it.status_code == 403


@pytest.mark.asyncio
async def test_admin_it_forbidden_for_all_client_protection_financial_history_export_endpoints(client: AsyncClient):
    ids = await _seed_comm_rows()
    token = await login(client, "IT-001")
    paths = [
        "/api/v1/manager/client-protection/summary",
        "/api/v1/manager/client-protection/events",
        f"/api/v1/manager/client-protection/events/{ids['event_id']}",
        "/api/v1/manager/client-protection/exceptions",
        "/api/v1/manager/client-protection/reminders",
        f"/api/v1/manager/client-protection/clients/{ids['client_id']}/history",
        f"/api/v1/manager/client-protection/officers/{ids['officer_id']}/summary",
        "/api/v1/manager/client-protection/export.csv",
    ]
    for path in paths:
        resp = await client.get(path, headers=auth(token))
        assert resp.status_code == 403, path


@pytest.mark.asyncio
async def test_events_filters_pagination_masking_and_no_message_body(client: AsyncClient):
    await _seed_comm_rows()
    resp = await _get(client, "BM-001", "/api/v1/manager/client-protection/events?page=1&page_size=2&purpose=payment_overdue_reminder")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["pagination"]["page_size"] == 2
    assert len(data["items"]) == 1
    text = json.dumps(data)
    assert "******0001" in text
    assert PHONE not in text
    assert MESSAGE not in text


@pytest.mark.asyncio
async def test_event_detail_sanitizes_metadata_and_audits_view(client: AsyncClient):
    ids = await _seed_comm_rows()
    resp = await _get(client, "BM-001", f"/api/v1/manager/client-protection/events/{ids['event_id']}")
    assert resp.status_code == 200
    text = json.dumps(resp.json()["data"])
    assert PHONE not in text
    assert MESSAGE not in text
    assert "safe" in text
    for forbidden in ("callback_payload_hash", "signature_digest", "provider_status_raw", "provider_response", "encrypted_recipient", "token", "secret"):
        assert forbidden not in text
    async with AsyncSessionLocal() as s:
        audits = (await s.execute(select(AuditLog).where(AuditLog.action_type == "client_protection_event_viewed"))).scalars().all()
    assert audits


@pytest.mark.asyncio
async def test_direct_id_routes_do_not_bypass_scope(client: AsyncClient):
    ids = await _seed_comm_rows()
    event = await _get(client, "BM-001", f"/api/v1/manager/client-protection/events/{ids['other_event_id']}")
    history = await _get(client, "BM-001", f"/api/v1/manager/client-protection/clients/{ids['other_client_id']}/history")
    officer = await _get(client, "BM-001", f"/api/v1/manager/client-protection/officers/{ids['other_officer_id']}/summary")
    branch = await _get(client, "BM-001", f"/api/v1/manager/client-protection/branches/{ids['branch2_id']}/summary")
    assert event.status_code == 404
    assert history.status_code == 200
    assert history.json()["data"] == []
    assert officer.status_code == 200
    assert officer.json()["data"]["counts"]["total_communication_events"] == 0
    assert branch.status_code == 403


@pytest.mark.asyncio
async def test_exceptions_classification_and_severity_filter(client: AsyncClient):
    await _seed_comm_rows()
    resp = await _get(client, "BM-001", "/api/v1/manager/client-protection/exceptions?exception_severity=critical")
    assert resp.status_code == 200
    types = {i["type"] for i in resp.json()["data"]["items"]}
    text = json.dumps(resp.json()["data"])
    assert "disputed_collection" in types
    assert "dead_letter_outbox" in types
    assert PHONE not in text
    assert MESSAGE not in text
    assert "callback_payload_hash" not in text
    assert "signature_digest" not in text

    high = await _get(client, "BM-001", "/api/v1/manager/client-protection/exceptions?exception_severity=high")
    high_types = {i["type"] for i in high.json()["data"]["items"]}
    assert "overdue_reminder_not_delivered" in high_types
    assert "stale_processing_outbox" in high_types


@pytest.mark.asyncio
async def test_client_history_ordering_and_sanitized_descriptions(client: AsyncClient):
    await _seed_comm_rows()
    resp = await _get(client, "BM-001", "/api/v1/manager/client-protection/clients/1/history")
    assert resp.status_code == 200
    data = resp.json()["data"]
    stamps = [x["timestamp"] for x in data if x.get("timestamp")]
    assert stamps == sorted(stamps)
    text = json.dumps(data)
    assert PHONE not in text
    assert MESSAGE not in text


@pytest.mark.asyncio
async def test_officer_summary_and_worker_health(client: AsyncClient):
    await _seed_comm_rows()
    officer = await _get(client, "BM-001", "/api/v1/manager/client-protection/officers/1/summary")
    health = await _get(client, "BM-001", "/api/v1/manager/client-protection/worker-health")
    assert officer.status_code == 200
    assert officer.json()["data"]["punitive_score"] is None
    assert health.status_code == 200
    health_data = health.json()["data"]
    assert set(health_data) == {
        "worker_enabled",
        "database_reachable",
        "recently_polled",
        "recently_dispatched",
        "pending_count",
        "processing_count",
        "retryable_count",
        "dead_count",
        "oldest_pending_age_seconds",
        "safe_provider_summary",
    }
    assert health_data["database_reachable"] is True
    assert MESSAGE not in json.dumps(health_data)
    assert PHONE not in json.dumps(health_data)


@pytest.mark.asyncio
async def test_audit_events_are_safe_throttled_and_worker_health_not_polled(client: AsyncClient):
    ids = await _seed_comm_rows()
    token = await login(client, "BM-001")
    await client.get("/api/v1/manager/client-protection/summary", headers=auth(token))
    await client.get("/api/v1/manager/client-protection/summary", headers=auth(token))
    await client.get(f"/api/v1/manager/client-protection/events/{ids['event_id']}", headers=auth(token))
    await client.get(f"/api/v1/manager/client-protection/clients/{ids['client_id']}/history", headers=auth(token))
    await client.get("/api/v1/manager/client-protection/worker-health", headers=auth(token))
    await client.get("/api/v1/manager/client-protection/export.csv?client_id=1", headers=auth(token))
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(select(AuditLog).where(AuditLog.action_type.in_([
            "client_protection_dashboard_viewed",
            "client_protection_event_viewed",
            "client_communication_history_viewed",
            "client_protection_export_requested",
        ])))).scalars().all()
    by_action = {}
    for row in rows:
        by_action[row.action_type] = by_action.get(row.action_type, 0) + 1
        text = row.meta_json or ""
        assert PHONE not in text
        assert MESSAGE not in text
    assert by_action.get("client_protection_dashboard_viewed", 0) == 1
    assert by_action.get("client_protection_event_viewed", 0) == 1
    assert by_action.get("client_communication_history_viewed", 0) == 1
    assert by_action.get("client_protection_export_requested", 0) == 1


@pytest.mark.asyncio
async def test_csv_export_authorized_masked_and_audited(client: AsyncClient):
    await _seed_comm_rows()
    token = await login(client, "BM-001")
    resp = await client.get("/api/v1/manager/client-protection/export.csv", headers=auth(token))
    assert resp.status_code == 200
    assert PHONE not in resp.text
    assert MESSAGE not in resp.text
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert rows
    assert rows[0]["recipient_masked"].startswith("******")
    assert all(row["branch_id"] == "1" for row in rows)
    assert all(row["source_reference"][:1] not in {"=", "+", "-", "@"} for row in rows)

    ho_token = await login(client, "HO-001")
    ho_all = await client.get("/api/v1/manager/client-protection/export.csv", headers=auth(ho_token))
    ho_rows = list(csv.DictReader(io.StringIO(ho_all.text)))
    assert any(row["source_reference"].startswith("'=") for row in ho_rows)
    ho_export = await client.get("/api/v1/manager/client-protection/export.csv?branch_id=999999", headers=auth(ho_token))
    assert ho_export.status_code == 200
    assert len(list(csv.DictReader(io.StringIO(ho_export.text)))) == 0

    too_wide = await client.get("/api/v1/manager/client-protection/export.csv?start_date=2025-01-01&end_date=2026-12-31", headers=auth(token))
    assert too_wide.status_code == 400
    assert "date range" in too_wide.json()["detail"].lower()

    async with AsyncSessionLocal() as s:
        audits = (await s.execute(select(AuditLog).where(AuditLog.action_type == "client_protection_export_requested"))).scalars().all()
        audit_text = "\n".join(a.meta_json or "" for a in audits)
    assert audits
    assert PHONE not in audit_text
    assert MESSAGE not in audit_text
