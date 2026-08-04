from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps.auth_deps import get_current_user, require_financial_access, require_manager_or_admin, scope_to_branch
from app.models.client_communication import SmsApprovedTemplate, SmsConsentEvidence, SmsQuotaReservation, SmsSuppressionRecord
from app.models.user import User
from app.services.sms_policy import (
    CONSENT_STATUSES,
    SUPPRESSION_REASONS,
    TEMPLATE_STATUSES,
    protected_reference_hash,
    recipient_hash,
    template_content_hash,
    record_policy_audit,
    reservation_response,
    safe_template_response,
)

router = APIRouter(
    prefix="/client-communication/sms-policy",
    tags=["SMS Policy Controls"],
    dependencies=[Depends(require_manager_or_admin), Depends(require_financial_access)],
)


class ConsentRequest(BaseModel):
    recipient: str | None = None
    client_id: int | None = None
    purpose: str = Field(default="collection_verification", max_length=80)
    status: str = Field(default="granted")
    consent_source: str = Field(max_length=80)
    consent_version: str = Field(default="v1", max_length=40)
    granted_at: datetime | None = None
    revoked_at: datetime | None = None
    expires_at: datetime | None = None
    evidence_reference: str | None = Field(default=None, max_length=240)
    branch_id: int | None = None
    protected_recipient_ref: str | None = Field(default=None, max_length=160)


class SuppressionRequest(BaseModel):
    recipient: str | None = None
    scope: str = Field(default="global", max_length=40)
    branch_id: int | None = None
    reason: str
    source: str = Field(max_length=80)
    active: bool = True
    effective_at: datetime | None = None
    expires_at: datetime | None = None
    protected_recipient_ref: str | None = Field(default=None, max_length=160)


class TemplateRequest(BaseModel):
    template_key: str = Field(max_length=120)
    version: str = Field(max_length=40)
    language: str = Field(default="en", max_length=12)
    purpose: str = Field(default="collection_verification", max_length=80)
    body_template: str | None = None
    allowed_variables: list[str] = Field(default_factory=list, max_length=20)
    managed_content_ref: str | None = Field(default=None, max_length=240)
    branch_id: int | None = None
    tenant_scope: str | None = Field(default=None, max_length=80)


def _effective_branch(current_user: User, requested: int | None) -> int | None:
    if current_user.role == "branch_manager":
        return current_user.branch_id
    return requested


def _require_recipient_or_ref(recipient: str | None, protected_ref: str | None) -> str:
    if recipient:
        return recipient_hash(recipient)
    if protected_ref:
        # Protected references are already non-plaintext tokens. Hash the token so
        # broad lists still expose only prefixes and not the reference itself.
        return protected_reference_hash(protected_ref)
    raise HTTPException(status_code=400, detail="recipient or protected_recipient_ref required")


@router.post("/consent")
async def record_consent(req: ConsentRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.status not in CONSENT_STATUSES:
        raise HTTPException(status_code=400, detail="invalid consent status")
    row = SmsConsentEvidence(
        client_id=req.client_id,
        recipient_hash=_require_recipient_or_ref(req.recipient, req.protected_recipient_ref),
        protected_recipient_ref=req.protected_recipient_ref,
        purpose=req.purpose,
        status=req.status,
        consent_source=req.consent_source,
        consent_version=req.consent_version,
        granted_at=req.granted_at or (datetime.utcnow() if req.status == "granted" else None),
        revoked_at=req.revoked_at,
        expires_at=req.expires_at,
        recorded_by=current_user.id,
        branch_id=_effective_branch(current_user, req.branch_id),
        evidence_reference=req.evidence_reference,
    )
    db.add(row)
    await db.flush()
    await record_policy_audit(db, "sms_consent_recorded", user=current_user, entity_type="sms_consent_evidence", entity_id=row.id, meta={"purpose": row.purpose, "status": row.status, "branch_id": row.branch_id})
    return {"id": row.id, "status": row.status, "branch_id": row.branch_id}


@router.post("/consent/{consent_id}/revoke")
async def revoke_consent(consent_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = await db.get(SmsConsentEvidence, consent_id)
    if row is None or (current_user.role == "branch_manager" and row.branch_id != current_user.branch_id):
        raise HTTPException(status_code=404, detail="consent record not found")
    row.status = "revoked"
    row.revoked_at = datetime.utcnow()
    row.recorded_by = current_user.id
    await record_policy_audit(db, "sms_consent_revoked", user=current_user, entity_type="sms_consent_evidence", entity_id=row.id, meta={"purpose": row.purpose, "branch_id": row.branch_id})
    return {"id": row.id, "status": row.status}


@router.post("/suppression")
async def create_suppression(req: SuppressionRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "branch_manager" and req.scope == "global":
        raise HTTPException(status_code=403, detail="global suppression requires central authorization")
    if req.reason not in SUPPRESSION_REASONS:
        raise HTTPException(status_code=400, detail="invalid suppression reason")
    row = SmsSuppressionRecord(
        recipient_hash=_require_recipient_or_ref(req.recipient, req.protected_recipient_ref),
        protected_recipient_ref=req.protected_recipient_ref,
        scope=req.scope,
        branch_id=_effective_branch(current_user, req.branch_id) if req.scope != "global" else None,
        reason=req.reason,
        source=req.source,
        active=req.active,
        effective_at=req.effective_at or datetime.utcnow(),
        expires_at=req.expires_at,
        recorded_by=current_user.id,
    )
    db.add(row)
    await db.flush()
    await record_policy_audit(db, "sms_suppression_created", user=current_user, entity_type="sms_suppression_record", entity_id=row.id, meta={"reason": row.reason, "scope": row.scope, "branch_id": row.branch_id})
    return {"id": row.id, "reason": row.reason, "active": row.active, "branch_id": row.branch_id}


@router.delete("/suppression/{suppression_id}")
async def remove_suppression(suppression_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = await db.get(SmsSuppressionRecord, suppression_id)
    if row is None or (current_user.role == "branch_manager" and row.branch_id != current_user.branch_id):
        raise HTTPException(status_code=404, detail="suppression not found")
    row.active = False
    await record_policy_audit(db, "sms_suppression_removed", user=current_user, entity_type="sms_suppression_record", entity_id=row.id, meta={"reason": row.reason, "scope": row.scope, "branch_id": row.branch_id})
    return {"id": row.id, "active": row.active}


@router.post("/templates")
async def create_template_draft(req: TemplateRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    import json
    if current_user.role == "branch_manager" and req.branch_id is None:
        # branch managers may create only branch-scoped templates
        req.branch_id = current_user.branch_id
    row = SmsApprovedTemplate(template_key=req.template_key, version=req.version, language=req.language, purpose=req.purpose, body_template=req.body_template, managed_content_ref=req.managed_content_ref, allowed_variables_json=json.dumps(req.allowed_variables), content_hash=template_content_hash(req.body_template, req.allowed_variables), active=False, approval_status="draft", branch_id=_effective_branch(current_user, req.branch_id), tenant_scope=req.tenant_scope)
    db.add(row)
    await db.flush()
    await record_policy_audit(db, "sms_template_draft_created", user=current_user, entity_type="sms_approved_template", entity_id=row.id, meta={"template_key": row.template_key, "version": row.version, "purpose": row.purpose, "branch_id": row.branch_id})
    return safe_template_response(row, include_body=True)


@router.post("/templates/{template_id}/approve")
async def approve_template(template_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = await db.get(SmsApprovedTemplate, template_id)
    if row is None or (current_user.role == "branch_manager" and row.branch_id != current_user.branch_id):
        raise HTTPException(status_code=404, detail="template not found")
    if row.approval_status not in {"draft", "pending_approval", "rejected"}:
        raise HTTPException(status_code=409, detail="template version is immutable after approval")
    if current_user.role == "branch_manager" and row.branch_id is None:
        raise HTTPException(status_code=403, detail="global template approval requires central authorization")
    row.approval_status = "approved"
    row.active = True
    row.approved_by = current_user.id
    row.approved_at = datetime.utcnow()
    await record_policy_audit(db, "sms_template_approved", user=current_user, entity_type="sms_approved_template", entity_id=row.id, meta={"template_key": row.template_key, "version": row.version, "purpose": row.purpose, "branch_id": row.branch_id})
    return safe_template_response(row, include_body=True)


@router.post("/templates/{template_id}/retire")
async def retire_template(template_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = await db.get(SmsApprovedTemplate, template_id)
    if row is None or (current_user.role == "branch_manager" and row.branch_id != current_user.branch_id):
        raise HTTPException(status_code=404, detail="template not found")
    row.approval_status = "retired"
    row.active = False
    row.retired_at = datetime.utcnow()
    await record_policy_audit(db, "sms_template_retired", user=current_user, entity_type="sms_approved_template", entity_id=row.id, meta={"template_key": row.template_key, "version": row.version, "branch_id": row.branch_id})
    return safe_template_response(row, include_body=False)


@router.get("/quota-reservations")
async def list_quota_reservations(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=10000), status: str | None = Query(None), db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = select(SmsQuotaReservation).order_by(SmsQuotaReservation.id.desc()).offset(offset).limit(limit)
    if status:
        q = q.where(SmsQuotaReservation.status == status)
    q = scope_to_branch(q, SmsQuotaReservation, current_user)
    rows = (await db.execute(q)).scalars().all()
    return {"items": [reservation_response(r) for r in rows], "limit": limit, "offset": offset}


@router.get("/provider-uncertain")
async def list_provider_uncertain(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=10000), db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = select(SmsQuotaReservation).where(SmsQuotaReservation.status == "provider_uncertain").order_by(SmsQuotaReservation.uncertain_at.desc()).offset(offset).limit(limit)
    q = scope_to_branch(q, SmsQuotaReservation, current_user)
    rows = (await db.execute(q)).scalars().all()
    return {"items": [reservation_response(r) for r in rows], "limit": limit, "offset": offset, "manual_review_required": True}
