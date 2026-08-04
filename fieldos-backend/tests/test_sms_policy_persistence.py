import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationEvent,
    ClientCommunicationOutbox,
    SmsApprovedTemplate,
    SmsConsentEvidence,
    SmsQuotaReservation,
    SmsSuppressionRecord,
)
from app.services.communication_outbox_service import run_once
from app.services.sms_dispatch_safety import evaluate_sms_dispatch_safety_async
from app.services.sms_policy import (
    ConsentDecision,
    PersistentConsentService,
    PersistentSuppressionService,
    PersistentTemplateApprovalService,
    QuotaDecision,
    SuppressionDecision,
    template_content_hash,
    TemplateDecision,
    recipient_hash,
    reserve_sms_quota,
)

PHONE = "+977-9800000001"
MESSAGE = "private body must not be logged"
PURPOSE = "collection_verification"


def _policy_enabled(monkeypatch):
    monkeypatch.setattr(settings, "SMS_POLICY_HASH_PEPPER", "fake-test-pepper-material")
    monkeypatch.setattr(settings, "SMS_PROVIDER", "fake_verified_real_sms")
    monkeypatch.setattr(settings, "REAL_SMS_ENABLED", True)
    monkeypatch.setattr(settings, "SMS_PROVIDER_ALLOWLIST", "fake_verified_real_sms")
    monkeypatch.setattr(settings, "SMS_ALLOWED_RECIPIENTS", PHONE)
    monkeypatch.setattr(settings, "SMS_DAILY_SEND_LIMIT", 10)
    monkeypatch.setattr(settings, "SMS_PER_RECIPIENT_DAILY_LIMIT", 10)
    monkeypatch.setattr(settings, "SMS_MAX_COST_PER_DAY", 10)
    monkeypatch.setattr(settings, "SMS_ESTIMATED_COST_PER_MESSAGE", 1)
    monkeypatch.setattr(settings, "SMS_QUOTA_TIMEZONE", "Asia/Kathmandu")
    monkeypatch.setattr(settings, "SMS_EMERGENCY_STOP", False)
    monkeypatch.setattr(settings, "SMS_PROVIDER_IDEMPOTENCY_ENABLED", True)
    monkeypatch.setattr(settings, "SMS_PROVIDER_RECONCILIATION_ENABLED", True)


def _payload(**extra):
    base = {"channel": "sms", "provider": "fake_verified_real_sms", "recipient": PHONE, "message": "Hi Bishesh", "purpose": PURPOSE, "language": "en", "template_key": "receipt", "template_version": "v1", "template_variables": {"name": "Bishesh"}, "outbox_id": 100, "attempt_id": 200, "branch_id": 1}
    base.update(extra)
    return base


async def _seed_consent_template(db, *, branch_id=1, phone=PHONE):
    now = datetime.utcnow()
    db.add(SmsConsentEvidence(recipient_hash=recipient_hash(phone), purpose=PURPOSE, status="granted", consent_source="test", consent_version="v1", granted_at=now, branch_id=branch_id))
    db.add(SmsApprovedTemplate(template_key="receipt", version="v1", language="en", purpose=PURPOSE, body_template="Hi {name}", allowed_variables_json='["name"]', content_hash=template_content_hash("Hi {name}", ["name"]), active=True, approval_status="approved", approved_at=now, branch_id=branch_id))
    await db.flush()


async def test_consent_decision_matrix(monkeypatch):
    _policy_enabled(monkeypatch)
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()
        svc = PersistentConsentService(db)
        db.add(SmsConsentEvidence(recipient_hash=recipient_hash(PHONE), purpose=PURPOSE, status="granted", consent_source="test", consent_version="v1", granted_at=now, branch_id=1))
        await db.flush()
        assert (await svc.check_sms_consent(recipient=PHONE, payload=_payload())).decision == ConsentDecision.CONSENT_GRANTED.value
        db.add(SmsConsentEvidence(recipient_hash=recipient_hash(PHONE), purpose=PURPOSE, status="revoked", consent_source="test", consent_version="v2", granted_at=now, revoked_at=now, branch_id=1))
        await db.flush()
        assert (await svc.check_sms_consent(recipient=PHONE, payload=_payload())).decision == ConsentDecision.CONSENT_REVOKED.value
        other = "+977-9800000002"
        db.add(SmsConsentEvidence(recipient_hash=recipient_hash(other), purpose=PURPOSE, status="granted", consent_source="test", consent_version="v1", granted_at=now, expires_at=now - timedelta(seconds=1), branch_id=1))
        await db.flush()
        assert (await svc.check_sms_consent(recipient=other, payload=_payload())).decision == ConsentDecision.CONSENT_EXPIRED.value
        assert (await svc.check_sms_consent(recipient=PHONE, payload=_payload(purpose="wrong"))).decision in {ConsentDecision.CONSENT_SCOPE_MISMATCH.value, ConsentDecision.CONSENT_NOT_FOUND.value}
        assert (await svc.check_sms_consent(recipient="+977-9800000003", payload=_payload())).decision == ConsentDecision.CONSENT_NOT_FOUND.value


async def test_suppression_matrix_and_override(monkeypatch):
    _policy_enabled(monkeypatch)
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()
        svc = PersistentSuppressionService(db)
        db.add(SmsSuppressionRecord(recipient_hash=recipient_hash(PHONE), scope="global", reason="client_opt_out", source="test", active=True, effective_at=now - timedelta(seconds=5), branch_id=None))
        await db.flush()
        assert (await svc.check_suppression(recipient=PHONE, payload=_payload(branch_id=999))).decision == SuppressionDecision.SUPPRESSED_OPT_OUT.value
        db.add(SmsSuppressionRecord(recipient_hash=recipient_hash("+977-9800000002"), scope="global", reason="manual_suppression", source="test", active=True, effective_at=now - timedelta(days=2), expires_at=now - timedelta(days=1)))
        await db.flush()
        assert (await svc.check_suppression(recipient="+977-9800000002", payload=_payload())).decision == SuppressionDecision.NOT_SUPPRESSED.value
        await _seed_consent_template(db)
        decision = await evaluate_sms_dispatch_safety_async(_payload(outbox_id=1, attempt_id=1), session=db)
        assert decision.allowed is False
        assert decision.code == "blocked_suppressed"


async def test_template_decision_matrix_and_freeform_block(monkeypatch):
    _policy_enabled(monkeypatch)
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()
        svc = PersistentTemplateApprovalService(db)
        db.add_all([
            SmsApprovedTemplate(template_key="receipt", version="v1", language="en", purpose=PURPOSE, body_template="Hi {name}", allowed_variables_json='["name"]', content_hash=template_content_hash("Hi {name}", ["name"]), active=True, approval_status="approved", approved_at=now, branch_id=1),
            SmsApprovedTemplate(template_key="draft", version="v1", language="en", purpose=PURPOSE, body_template="Draft", active=False, approval_status="draft", branch_id=1),
            SmsApprovedTemplate(template_key="retired", version="v1", language="en", purpose=PURPOSE, body_template="Old", active=False, approval_status="retired", retired_at=now, branch_id=1),
        ])
        await db.flush()
        assert (await svc.check_template(payload=_payload())).decision == TemplateDecision.TEMPLATE_APPROVED.value
        assert (await svc.check_template(payload=_payload(template_key="draft"))).decision == TemplateDecision.TEMPLATE_NOT_APPROVED.value
        assert (await svc.check_template(payload=_payload(template_key="retired"))).decision == TemplateDecision.TEMPLATE_RETIRED.value
        assert (await svc.check_template(payload=_payload(template_version="v2"))).decision == TemplateDecision.TEMPLATE_VERSION_MISMATCH.value
        assert (await svc.check_template(payload=_payload(purpose="marketing"))).decision == TemplateDecision.TEMPLATE_SCOPE_MISMATCH.value
        assert (await svc.check_template(payload={"message": "free form", "purpose": PURPOSE, "language": "en"})).decision == TemplateDecision.TEMPLATE_NOT_FOUND.value


async def test_template_binding_blocks_unrelated_modified_unknown_missing_and_retired(monkeypatch):
    _policy_enabled(monkeypatch)
    async with AsyncSessionLocal() as db:
        now = datetime.utcnow()
        row = SmsApprovedTemplate(template_key="receipt", version="v1", language="en", purpose=PURPOSE, body_template="Hi {name}", allowed_variables_json='["name"]', content_hash=template_content_hash("Hi {name}", ["name"]), active=True, approval_status="approved", approved_at=now, branch_id=1)
        db.add(row); await db.flush()
        svc = PersistentTemplateApprovalService(db)
        assert (await svc.check_template(payload=_payload(message="unrelated body"))).decision == TemplateDecision.TEMPLATE_NOT_APPROVED.value
        row.body_template = "Tampered {name}"
        assert (await svc.check_template(payload=_payload(message="Tampered Bishesh"))).decision == TemplateDecision.TEMPLATE_NOT_APPROVED.value
        row.body_template = "Hi {name}"
        assert (await svc.check_template(payload=_payload(template_variables={"name": "Bishesh", "extra": "x"}))).decision == TemplateDecision.TEMPLATE_NOT_APPROVED.value
        assert (await svc.check_template(payload=_payload(template_variables={}))).decision == TemplateDecision.TEMPLATE_NOT_APPROVED.value
        ok_payload = _payload(message="Hi Bishesh", template_variables={"name": "Bishesh"})
        assert (await svc.check_template(payload=ok_payload)).decision == TemplateDecision.TEMPLATE_APPROVED.value
        assert ok_payload["message"] == "Hi Bishesh"
        row.approval_status = "retired"; row.active = False; row.retired_at = now
        assert (await svc.check_template(payload=_payload())).decision == TemplateDecision.TEMPLATE_RETIRED.value

async def test_missing_hash_pepper_blocks_real_provider_policy(monkeypatch):
    _policy_enabled(monkeypatch)
    monkeypatch.setattr(settings, "SMS_POLICY_HASH_PEPPER", "")
    async with AsyncSessionLocal() as db:
        decision = await evaluate_sms_dispatch_safety_async(_payload(), session=db)
        assert decision.allowed is False

async def test_sparrow_readiness_block_even_with_env_flags(monkeypatch):
    _policy_enabled(monkeypatch)
    monkeypatch.setattr(settings, "SMS_PROVIDER", "sparrow")
    monkeypatch.setattr(settings, "SMS_PROVIDER_ALLOWLIST", "sparrow")
    async with AsyncSessionLocal() as db:
        decision = await evaluate_sms_dispatch_safety_async(_payload(provider="sparrow"), session=db)
        assert decision.code == "blocked_provider_readiness_unverified"


async def test_quota_reservation_limits_reuse_release_and_uncertain(monkeypatch):
    _policy_enabled(monkeypatch)
    async with AsyncSessionLocal() as db:
        q1 = await reserve_sms_quota(db, payload=_payload(outbox_id=1, attempt_id=1), recipient=PHONE, provider="fake_verified_real_sms")
        assert q1.decision == QuotaDecision.QUOTA_RESERVED.value
        q2 = await reserve_sms_quota(db, payload=_payload(outbox_id=1, attempt_id=1), recipient=PHONE, provider="fake_verified_real_sms")
        assert q2.decision == QuotaDecision.QUOTA_REUSED.value
        assert (await db.execute(select(SmsQuotaReservation))).scalars().all().__len__() == 1
        monkeypatch.setattr(settings, "SMS_PER_RECIPIENT_DAILY_LIMIT", 1)
        q3 = await reserve_sms_quota(db, payload=_payload(outbox_id=2, attempt_id=2), recipient=PHONE, provider="fake_verified_real_sms")
        assert q3.decision == QuotaDecision.QUOTA_RECIPIENT_LIMIT.value
        monkeypatch.setattr(settings, "SMS_PER_RECIPIENT_DAILY_LIMIT", 10)
        monkeypatch.setattr(settings, "SMS_MAX_COST_PER_DAY", 1)
        q4 = await reserve_sms_quota(db, payload=_payload(outbox_id=3, attempt_id=3, recipient="+977-9800000002"), recipient="+977-9800000002", provider="fake_verified_real_sms")
        assert q4.decision == QuotaDecision.QUOTA_COST_LIMIT.value
        monkeypatch.setattr(settings, "SMS_DAILY_SEND_LIMIT", 0)
        q5 = await reserve_sms_quota(db, payload=_payload(outbox_id=4, attempt_id=4), recipient=PHONE, provider="fake_verified_real_sms")
        assert q5.decision == QuotaDecision.QUOTA_MALFORMED_LIMIT.value


async def test_real_provider_boundary_requires_all_records_and_marks_success(monkeypatch):
    _policy_enabled(monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    monkeypatch.setattr(settings, "SMS_API_TOKEN", "token")
    async with AsyncSessionLocal() as db:
        event = ClientCommunicationEvent(client_id=1, branch_id=1, purpose=PURPOSE, event_type=PURPOSE, status="queued", idempotency_key="evt-policy", language="en")
        db.add(event); await db.flush()
        attempt = ClientCommunicationAttempt(event_id=event.id, channel="sms", provider="fake_verified_real_sms", recipient=PHONE, status="queued", metadata_json=json.dumps({"message": "Hi Bishesh", "template_key": "receipt", "template_version": "v1", "template_variables": {"name": "Bishesh"}}))
        db.add(attempt); await db.flush()
        outbox = ClientCommunicationOutbox(event_id=event.id, attempt_id=attempt.id, payload_json=json.dumps({"channel": "sms", "provider": "fake_verified_real_sms", "recipient": PHONE, "message": "Hi Bishesh", "template_key": "receipt", "template_version": "v1", "template_variables": {"name": "Bishesh"}}), status="pending", idempotency_key="out-policy")
        db.add(outbox)
        await _seed_consent_template(db)
        await db.commit()
    called = {"n": 0}
    class Provider:
        async def dispatch(self, attempt, payload, *, idempotency_key):
            called["n"] += 1
            from app.services.communication_providers import DispatchResult
            return DispatchResult("success", provider_reference="ref-safe", provider_status="provider_accepted", idempotency_key_used=idempotency_key)
    monkeypatch.setattr("app.services.communication_outbox_service.provider_for", lambda payload: Provider())
    result = await run_once(worker_id="policy-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "published"
    assert called["n"] == 1
    async with AsyncSessionLocal() as db:
        reservation = (await db.execute(select(SmsQuotaReservation))).scalar_one()
        assert reservation.status == "committed"


async def test_provider_uncertain_retains_reservation_and_blocks_resend(monkeypatch):
    _policy_enabled(monkeypatch)
    monkeypatch.setattr(settings, "COMMUNICATION_WORKER_ENABLED", True)
    async with AsyncSessionLocal() as db:
        event = ClientCommunicationEvent(client_id=1, branch_id=1, purpose=PURPOSE, event_type=PURPOSE, status="queued", idempotency_key="evt-uncertain", language="en")
        db.add(event); await db.flush()
        attempt = ClientCommunicationAttempt(event_id=event.id, channel="sms", provider="fake_verified_real_sms", recipient=PHONE, status="queued", metadata_json=json.dumps({"message": "Hi Bishesh", "template_key": "receipt", "template_version": "v1", "template_variables": {"name": "Bishesh"}}))
        db.add(attempt); await db.flush()
        outbox = ClientCommunicationOutbox(event_id=event.id, attempt_id=attempt.id, payload_json=json.dumps({"channel": "sms", "provider": "fake_verified_real_sms", "recipient": PHONE, "message": "Hi Bishesh", "template_key": "receipt", "template_version": "v1", "template_variables": {"name": "Bishesh"}}), status="pending", idempotency_key="out-uncertain")
        db.add(outbox)
        await _seed_consent_template(db)
        await db.commit()
    class ExplodingProvider:
        async def dispatch(self, *args, **kwargs):
            raise RuntimeError("crash after provider boundary")
    monkeypatch.setattr("app.services.communication_outbox_service.provider_for", lambda payload: ExplodingProvider())
    result = await run_once(worker_id="uncertain-worker", batch_size=1, jitter_fn=lambda _: 0)
    assert result[0].status == "provider_uncertain"
    again = await run_once(worker_id="uncertain-worker-2", batch_size=1, jitter_fn=lambda _: 0)
    assert again == []
    async with AsyncSessionLocal() as db:
        reservation = (await db.execute(select(SmsQuotaReservation))).scalar_one()
        assert reservation.status == "provider_uncertain"


async def test_sms_policy_api_auth_branch_scope_and_redaction(client, monkeypatch):
    _policy_enabled(monkeypatch)
    from tests.conftest import login, auth
    from app.models.user import User, UserRole, Department
    from app.services.auth_service import hash_pin

    payload = {"recipient": PHONE, "purpose": PURPOSE, "status": "granted", "consent_source": "api-test", "branch_id": 999}

    unauth = await client.post("/api/v1/client-communication/sms-policy/consent", json=payload)
    assert unauth.status_code == 401

    fo_token = await login(client, "FO-208")
    fo_resp = await client.post("/api/v1/client-communication/sms-policy/consent", json=payload, headers=auth(fo_token))
    assert fo_resp.status_code == 403

    bm_token = await login(client, "BM-001")
    bm_resp = await client.post("/api/v1/client-communication/sms-policy/consent", json=payload, headers=auth(bm_token))
    assert bm_resp.status_code == 200, bm_resp.text
    assert bm_resp.json()["branch_id"] == 1
    assert "9800000001" not in bm_resp.text

    global_suppression = {"recipient": PHONE, "scope": "global", "reason": "manual", "source": "api-test"}
    denied_global = await client.post("/api/v1/client-communication/sms-policy/suppression", json=global_suppression, headers=auth(bm_token))
    assert denied_global.status_code == 403

    bad_limit = await client.get("/api/v1/client-communication/sms-policy/quota-reservations?limit=101", headers=auth(bm_token))
    assert bad_limit.status_code == 422

    async with AsyncSessionLocal() as s:
        it = User(staff_id="IT-SMS", name="IT SMS", role=UserRole.ADMIN.value, department=Department.ADMIN_IT.value, hashed_pin=hash_pin("1234"), branch_id=1, is_active=True)
        s.add(it)
        s.add(SmsConsentEvidence(recipient_hash=recipient_hash(PHONE), purpose=PURPOSE, status="granted", consent_source="x", consent_version="v1", granted_at=datetime.utcnow(), branch_id=999))
        await s.commit()

    it_token = await login(client, "IT-SMS")
    it_resp = await client.post("/api/v1/client-communication/sms-policy/consent", json=payload, headers=auth(it_token))
    assert it_resp.status_code == 403

    cross_branch = await client.post("/api/v1/client-communication/sms-policy/consent/2/revoke", headers=auth(bm_token))
    assert cross_branch.status_code == 404
