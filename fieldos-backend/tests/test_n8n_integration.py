import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.branch import Branch
from app.models.client import Client
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox, ClientCommunicationWorkerHeartbeat
from app.models.task import TaskAssignment
from app.models.user import Department, User
from app.services.auth_service import hash_pin
from tests.conftest import auth, login

SECRET = "test-n8n-secret"
PHONE = "+1" + "0000000000"
MESSAGE = "Sensitive client message body"
BASE = "/api/v1/integrations/n8n"


def _enable_n8n():
    settings.N8N_INTEGRATION_ENABLED = True
    settings.N8N_SHARED_SECRET = SECRET
    settings.N8N_TIMESTAMP_TOLERANCE_SECONDS = 300
    settings.N8N_RANDOM_SAMPLE_PERCENT = 0
    settings.N8N_PROVIDER_FAILURE_THRESHOLD = 2
    settings.N8N_BACKLOG_AGE_THRESHOLD_SECONDS = 60


def _disable_n8n():
    settings.N8N_INTEGRATION_ENABLED = False
    settings.N8N_SHARED_SECRET = ""


def signed_headers(body: bytes = b"{}", *, timestamp: int | None = None, nonce: str = "nonce-1", secret: str = SECRET) -> dict:
    ts = str(timestamp or int(time.time()))
    digest = hmac.new(secret.encode(), ts.encode() + b"." + nonce.encode() + b"." + body, hashlib.sha256).hexdigest()
    return {
        "X-FieldOS-Timestamp": ts,
        "X-FieldOS-Nonce": nonce,
        "X-FieldOS-Signature": f"sha256={digest}",
        "Content-Type": "application/json",
    }


async def _seed_n8n_rows() -> dict:
    _enable_n8n()
    async with AsyncSessionLocal() as s:
        branch2 = Branch(branch_id="BR-N8N-2", name="N8N Branch 2")
        s.add(branch2)
        await s.flush()
        bm2 = User(staff_id="BM-N8N-2", name="N8N BM 2", role="branch_manager", hashed_pin=hash_pin("1234"), branch_id=branch2.id, is_active=True)
        admin_it = User(staff_id="IT-N8N", name="IT N8N", role="admin", department=Department.ADMIN_IT.value, data_scope="org", permission_set="admin", hashed_pin=hash_pin("1234"), is_active=True)
        s.add_all([bm2, admin_it])
        client = Client(member_id="M-N8N", name="N8N Client", phone_number=PHONE, outstanding_balance=5000, due_amount=500)
        s.add(client)
        await s.flush()
        disputed = ClientCommunicationEvent(client_id=client.id, branch_id=branch2.id, officer_id=bm2.id, purpose="collection_verification", event_type="collection_verification", status="disputed", idempotency_key="n8n-event-disputed", source_reference="receipt-n8n", disputed_at=datetime.utcnow())
        failed = ClientCommunicationEvent(client_id=client.id, branch_id=branch2.id, officer_id=bm2.id, purpose="payment_overdue_reminder", event_type="payment_overdue_reminder", status="failed", idempotency_key="n8n-event-failed", source_reference="cbs_schedule:n8n")
        sample = ClientCommunicationEvent(client_id=client.id, branch_id=branch2.id, officer_id=bm2.id, purpose="collection_verification", event_type="collection_verification", status="submitted", idempotency_key="n8n-event-sample", source_reference="receipt-sample")
        no_phone = ClientCommunicationEvent(client_id=client.id, branch_id=branch2.id, officer_id=bm2.id, purpose="payment_due_reminder", event_type="payment_due_reminder", status="no_phone", idempotency_key="n8n-event-no-phone", source_reference="due-no-phone")
        s.add_all([disputed, failed, sample, no_phone])
        await s.flush()
        s.add_all([
            ClientCommunicationAttempt(event_id=disputed.id, channel="sms", provider="log", recipient=PHONE, status="delivered", metadata_json=json.dumps({"message": MESSAGE, "safe_reason": "dispute"})),
            ClientCommunicationAttempt(event_id=failed.id, channel="sms", provider="log", recipient=PHONE, status="failed", error_message=MESSAGE),
            ClientCommunicationOutbox(event_id=failed.id, queue_name="client_communication.sms", payload_json=json.dumps({"recipient": PHONE, "message": MESSAGE}), status="dead", idempotency_key="n8n-outbox-dead"),
            ClientCommunicationWorkerHeartbeat(worker_id="n8n-test-worker", process_alive=True, worker_enabled=True, last_successful_poll=datetime.utcnow() - timedelta(seconds=120), last_successful_dispatch=datetime.utcnow() - timedelta(seconds=120)),
        ])
        await s.commit()
        return {"branch_id": branch2.id, "disputed_id": disputed.id, "failed_id": failed.id, "sample_id": sample.id, "no_phone_id": no_phone.id}


@pytest.mark.asyncio
async def test_integration_fail_closed_when_disabled_or_secret_missing_without_task_mutation(client: AsyncClient):
    ids = await _seed_n8n_rows()
    _disable_n8n()
    body = b"{}"
    disabled = await client.post(f"{BASE}/events/{ids['disputed_id']}/callback-task", content=body, headers=signed_headers(body, nonce="disabled"))
    assert disabled.status_code == 503
    _enable_n8n()
    settings.N8N_SHARED_SECRET = ""
    missing_secret = await client.post(f"{BASE}/events/{ids['disputed_id']}/callback-task", content=body, headers=signed_headers(body, nonce="no-secret"))
    assert missing_secret.status_code == 503
    async with AsyncSessionLocal() as s:
        tasks = (await s.execute(select(TaskAssignment).where(TaskAssignment.reason.like("%n8n:%")))).scalars().all()
        assert tasks == []
    _enable_n8n()


@pytest.mark.asyncio
async def test_hmac_uses_raw_body_rejects_empty_nonce_malformed_timestamp_and_oversized_body(client: AsyncClient):
    ids = await _seed_n8n_rows()
    raw_body = b'{  "reason" : "utf-8 safe"  }'
    ok = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=raw_body, headers=signed_headers(raw_body, nonce="raw-body"))
    assert ok.status_code == 200
    bad_nonce = signed_headers(b"{}", nonce="   ")
    assert (await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=b"{}", headers=bad_nonce)).status_code == 401
    bad_ts = signed_headers(b"{}", nonce="bad-ts")
    bad_ts["X-FieldOS-Timestamp"] = "not-int"
    assert (await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=b"{}", headers=bad_ts)).status_code == 401
    huge = b"x" * (65 * 1024)
    assert (await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=huge, headers=signed_headers(huge, nonce="huge"))).status_code == 413


@pytest.mark.asyncio
async def test_valid_signed_n8n_request_accepted_and_admin_token_cannot_substitute(client: AsyncClient):
    ids = await _seed_n8n_rows()
    body = json.dumps({"reason": "dispute escalation"}).encode()
    resp = await client.post(f"{BASE}/events/{ids['disputed_id']}/escalate", content=body, headers=signed_headers(body, nonce="valid-1"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["idempotency_key"] == f"n8n:dispute:{ids['disputed_id']}"
    text = json.dumps(resp.json())
    assert PHONE not in text
    assert MESSAGE not in text

    admin_token = await login(client, "IT-N8N")
    rejected = await client.post(f"{BASE}/events/{ids['disputed_id']}/escalate", json={"reason": "bad"}, headers=auth(admin_token))
    assert rejected.status_code in (401, 403)


@pytest.mark.asyncio
async def test_invalid_signature_expired_timestamp_and_replay_rejected(client: AsyncClient):
    ids = await _seed_n8n_rows()
    body = b"{}"
    bad = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body, headers=signed_headers(body, nonce="bad-sig", secret="wrong"))
    assert bad.status_code == 401
    expired = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body, headers=signed_headers(body, timestamp=int(time.time()) - 9999, nonce="expired"))
    assert expired.status_code == 401
    first = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body, headers=signed_headers(body, nonce="replay"))
    second = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body, headers=signed_headers(body, nonce="replay"))
    assert first.status_code == 200
    assert second.status_code == 401


@pytest.mark.asyncio
async def test_same_nonce_rejected_even_with_new_timestamp_body_and_valid_signature(client: AsyncClient):
    ids = await _seed_n8n_rows()
    body1 = b'{"reason":"first"}'
    body2 = b'{"reason":"second body"}'
    nonce = "stable-nonce-reuse"
    first = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body1, headers=signed_headers(body1, timestamp=int(time.time()), nonce=nonce))
    reused_timestamp = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body1, headers=signed_headers(body1, timestamp=int(time.time()) + 1, nonce=nonce))
    reused_body = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body2, headers=signed_headers(body2, timestamp=int(time.time()) + 2, nonce=nonce))
    different_nonce = await client.post(f"{BASE}/events/{ids['disputed_id']}/acknowledge", content=body2, headers=signed_headers(body2, timestamp=int(time.time()) + 3, nonce="different-nonce-ok"))
    assert first.status_code == 200
    assert reused_timestamp.status_code == 401
    assert reused_body.status_code == 401
    assert different_nonce.status_code == 200


@pytest.mark.asyncio
async def test_redis_replay_store_unavailable_rejects_without_domain_mutation(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    ids = await _seed_n8n_rows()
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "redis")
    monkeypatch.setattr(settings, "REDIS_URL", "")
    body = json.dumps({"reason": "should not mutate"}).encode()
    rejected = await client.post(f"{BASE}/events/{ids['disputed_id']}/callback-task", content=body, headers=signed_headers(body, nonce="redis-down"))
    assert rejected.status_code == 503
    async with AsyncSessionLocal() as s:
        tasks = (await s.execute(select(TaskAssignment).where(TaskAssignment.reason.like("%should not mutate%")))).scalars().all()
    assert tasks == []
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "memory")


@pytest.mark.asyncio
async def test_dispute_escalation_and_callback_task_are_idempotent(client: AsyncClient):
    ids = await _seed_n8n_rows()
    body = json.dumps({"reason": "manager callback", "due_date": "2026-07-30"}).encode()
    first = await client.post(f"{BASE}/events/{ids['disputed_id']}/callback-task", content=body, headers=signed_headers(body, nonce="task-1"))
    second = await client.post(f"{BASE}/events/{ids['disputed_id']}/callback-task", content=body, headers=signed_headers(body, nonce="task-2"))
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["data"]["task_id"] == second.json()["data"]["task_id"]
    async with AsyncSessionLocal() as s:
        tasks = (await s.execute(select(TaskAssignment).where(TaskAssignment.reason.like(f"%n8n:callback-task:{ids['disputed_id']}%")))).scalars().all()
        assert len(tasks) == 1
        audits = (await s.execute(select(AuditLog).where(AuditLog.action_type == "n8n_callback_task_created"))).scalars().all()
        assert len(audits) == 1


@pytest.mark.asyncio
async def test_daily_summary_exceptions_no_phone_and_branch_scope_are_masked(client: AsyncClient):
    ids = await _seed_n8n_rows()
    exc = await client.get(f"{BASE}/exceptions?branch_id={ids['branch_id']}", headers=signed_headers(b"", nonce="exceptions"))
    summary = await client.get(f"{BASE}/daily-summary?branch_id={ids['branch_id']}", headers=signed_headers(b"", nonce="summary"))
    assert exc.status_code == 200
    assert summary.status_code == 200
    text = json.dumps({"exc": exc.json(), "summary": summary.json()})
    assert "******0000" in text
    assert PHONE not in text
    assert MESSAGE not in text
    assert summary.json()["data"]["counts_by_status"]["no_phone"] == 1


@pytest.mark.asyncio
async def test_random_sampling_generated_by_fieldos_and_no_financial_mutation(client: AsyncClient):
    ids = await _seed_n8n_rows()
    async with AsyncSessionLocal() as s:
        before = (await s.execute(select(Client).where(Client.id == 2))).scalar_one_or_none()
        before_due = before.due_amount if before else None
    body = json.dumps({"branch_id": ids["branch_id"], "percent": 100, "due_date": "2026-07-30", "sample_version": "daily-v1"}).encode()
    resp = await client.post(f"{BASE}/random-sample", content=body, headers=signed_headers(body, nonce="sample-1"))
    repeat = await client.post(f"{BASE}/random-sample", content=body, headers=signed_headers(body, nonce="sample-2"))
    assert resp.status_code == 200, resp.text
    assert repeat.status_code == 200, repeat.text
    assert resp.json()["data"]["sample_count"] >= 1
    assert repeat.json()["data"]["event_ids"] == resp.json()["data"]["event_ids"]
    assert repeat.json()["data"]["existing"] is True
    assert ids["disputed_id"] not in resp.json()["data"]["event_ids"]
    assert resp.json()["data"]["idempotency_key"].startswith("n8n:sample:")
    async with AsyncSessionLocal() as s:
        after = (await s.execute(select(Client).where(Client.id == 2))).scalar_one_or_none()
        assert (after.due_amount if after else None) == before_due


@pytest.mark.asyncio
async def test_provider_outage_threshold_handling_and_safe_audits(client: AsyncClient):
    await _seed_n8n_rows()
    body = json.dumps({"provider": "log", "failure_count": 10, "token": "must-not-log", "phone": PHONE, "window_start": "2026-07-29T08:00Z"}).encode()
    resp = await client.post(f"{BASE}/provider-health/alert", content=body, headers=signed_headers(body, nonce="provider-1"))
    repeat = await client.post(f"{BASE}/provider-health/alert", content=body, headers=signed_headers(body, nonce="provider-2"))
    bad_provider = json.dumps({"provider": "https://evil.example", "failure_count": 10}).encode()
    invalid = await client.post(f"{BASE}/provider-health/alert", content=bad_provider, headers=signed_headers(bad_provider, nonce="provider-bad"))
    assert resp.status_code == 200
    assert repeat.status_code == 200
    assert invalid.status_code == 400
    assert resp.json()["data"]["threshold_hit"] is True
    assert resp.json()["data"]["provider_switch_allowed"] is False
    async with AsyncSessionLocal() as s:
        audits = (await s.execute(select(AuditLog))).scalars().all()
        provider_audits = [a for a in audits if a.action_type == "n8n_provider_outage_alerted"]
        audit_text = "\n".join(a.meta_json or "" for a in audits)
    assert len(provider_audits) == 1
    assert PHONE not in audit_text
    assert MESSAGE not in audit_text
    assert "must-not-log" not in audit_text
