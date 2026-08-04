from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationOutbox,
    SmsApprovedTemplate,
    SmsConsentEvidence,
    SmsQuotaReservation,
    SmsSuppressionRecord,
)
from app.services.audit_helper import write_audit
from app.services.communication_providers import normalize_nepal_phone

logger = logging.getLogger(__name__)

CONSENT_STATUSES = {"granted", "revoked", "expired", "pending_review"}
SUPPRESSION_REASONS = {"client_opt_out", "legal_or_compliance", "invalid_recipient", "provider_complaint", "manual_suppression", "safety_hold"}
TEMPLATE_STATUSES = {"draft", "pending_approval", "approved", "rejected", "retired"}
RECIPIENT_HASH_VERSION = "hmac_sha256_v1"
ACTIVE_RESERVATION_STATUSES = {"reserved", "provider_call_started", "committed", "provider_uncertain"}

_POLICY_METRICS = {
    "fieldos_sms_consent_denied_total": 0,
    "fieldos_sms_consent_missing_total": 0,
    "fieldos_sms_suppression_blocked_total": 0,
    "fieldos_sms_template_missing_total": 0,
    "fieldos_sms_template_not_approved_total": 0,
    "fieldos_sms_quota_reservation_success_total": 0,
    "fieldos_sms_quota_limit_blocked_total": 0,
    "fieldos_sms_provider_uncertain_total": 0,
    "fieldos_sms_quota_release_total": 0,
    "fieldos_sms_quota_commit_total": 0,
}


def sms_policy_metrics_snapshot() -> dict[str, int]:
    return dict(_POLICY_METRICS)


def _inc(name: str) -> None:
    _POLICY_METRICS[name] = _POLICY_METRICS.get(name, 0) + 1


class ConsentDecision(str, Enum):
    CONSENT_GRANTED = "CONSENT_GRANTED"
    CONSENT_REVOKED = "CONSENT_REVOKED"
    CONSENT_EXPIRED = "CONSENT_EXPIRED"
    CONSENT_NOT_FOUND = "CONSENT_NOT_FOUND"
    CONSENT_SCOPE_MISMATCH = "CONSENT_SCOPE_MISMATCH"
    CONSENT_SERVICE_ERROR = "CONSENT_SERVICE_ERROR"


class SuppressionDecision(str, Enum):
    NOT_SUPPRESSED = "NOT_SUPPRESSED"
    SUPPRESSED_OPT_OUT = "SUPPRESSED_OPT_OUT"
    SUPPRESSED_COMPLIANCE = "SUPPRESSED_COMPLIANCE"
    SUPPRESSED_INVALID_RECIPIENT = "SUPPRESSED_INVALID_RECIPIENT"
    SUPPRESSED_MANUAL = "SUPPRESSED_MANUAL"
    SUPPRESSION_SERVICE_ERROR = "SUPPRESSION_SERVICE_ERROR"


class TemplateDecision(str, Enum):
    TEMPLATE_APPROVED = "TEMPLATE_APPROVED"
    TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND"
    TEMPLATE_NOT_APPROVED = "TEMPLATE_NOT_APPROVED"
    TEMPLATE_RETIRED = "TEMPLATE_RETIRED"
    TEMPLATE_SCOPE_MISMATCH = "TEMPLATE_SCOPE_MISMATCH"
    TEMPLATE_VERSION_MISMATCH = "TEMPLATE_VERSION_MISMATCH"
    TEMPLATE_SERVICE_ERROR = "TEMPLATE_SERVICE_ERROR"


class QuotaDecision(str, Enum):
    QUOTA_RESERVED = "QUOTA_RESERVED"
    QUOTA_REUSED = "QUOTA_REUSED"
    QUOTA_GLOBAL_LIMIT = "QUOTA_GLOBAL_LIMIT"
    QUOTA_RECIPIENT_LIMIT = "QUOTA_RECIPIENT_LIMIT"
    QUOTA_COST_LIMIT = "QUOTA_COST_LIMIT"
    QUOTA_MALFORMED_LIMIT = "QUOTA_MALFORMED_LIMIT"
    QUOTA_ALREADY_FINAL = "QUOTA_ALREADY_FINAL"
    QUOTA_SERVICE_ERROR = "QUOTA_SERVICE_ERROR"


@dataclass(slots=True)
class PolicyCheck:
    allowed: bool
    decision: str
    record_id: int | None = None
    safe_message: str = ""


def normalize_recipient_for_policy(recipient: str | None) -> str:
    return normalize_nepal_phone(recipient)


def _policy_pepper() -> bytes:
    raw = str(settings.SMS_POLICY_HASH_PEPPER or "")
    if len(raw) < 16:
        raise ValueError("SMS policy hash pepper unavailable")
    return raw.encode("utf-8")

def recipient_hash(recipient: str | None) -> str:
    normalized = normalize_recipient_for_policy(recipient)
    return hmac.new(_policy_pepper(), normalized.encode("utf-8"), hashlib.sha256).hexdigest()

def protected_reference_hash(protected_ref: str) -> str:
    if not protected_ref:
        raise ValueError("protected recipient reference required")
    return hmac.new(_policy_pepper(), protected_ref.encode("utf-8"), hashlib.sha256).hexdigest()

def template_content_hash(body_template: str | None, allowed_variables: list[str] | None) -> str:
    canonical = json.dumps({"body_template": body_template or "", "allowed_variables": sorted(allowed_variables or [])}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

_VAR_RE = re.compile(r"{([A-Za-z_][A-Za-z0-9_]*)}")
def _template_vars(body: str | None) -> set[str]:
    return set(_VAR_RE.findall(body or ""))

def _load_allowed_variables(row: SmsApprovedTemplate) -> list[str]:
    raw = row.allowed_variables_json or "[]"
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or not all(isinstance(x, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", x) for x in parsed):
        raise ValueError("invalid approved template variables")
    return parsed

def render_approved_template(row: SmsApprovedTemplate, variables: dict | None) -> str:
    variables = variables or {}
    if not isinstance(variables, dict):
        raise ValueError("template variables must be an object")
    allowed = set(_load_allowed_variables(row))
    required = _template_vars(row.body_template)
    supplied = set(variables.keys())
    if not required.issubset(allowed):
        raise ValueError("template contains unapproved variables")
    unknown = supplied - allowed
    missing = required - supplied
    if unknown:
        raise ValueError("unknown template variable")
    if missing:
        raise ValueError("missing template variable")
    rendered = row.body_template or ""
    for key in required:
        value = str(variables[key])
        if "{" in value or "}" in value:
            raise ValueError("template variable contains template syntax")
        rendered = rendered.replace("{" + key + "}", value)
    return rendered


def _payload_branch(payload: dict) -> int | None:
    value = payload.get("branch_id")
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _payload_purpose(payload: dict) -> str:
    return str(payload.get("purpose") or "collection_verification")[:80]


def _payload_language(payload: dict) -> str:
    return str(payload.get("language") or "en")[:12]


async def _now(session: AsyncSession) -> datetime:
    result = await session.execute(select(func.now()))
    value = result.scalar_one()
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return datetime.utcnow()


class PersistentConsentService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def check_sms_consent(self, *, recipient: str, payload: dict) -> PolicyCheck:
        try:
            rhash = recipient_hash(recipient)
            purpose = _payload_purpose(payload)
            branch_id = _payload_branch(payload)
            now = await _now(self.session)
            rows = (await self.session.execute(
                select(SmsConsentEvidence)
                .where(SmsConsentEvidence.recipient_hash == rhash)
                .where(SmsConsentEvidence.recipient_hash_version == RECIPIENT_HASH_VERSION)
                .where(SmsConsentEvidence.purpose == purpose)
                .where(or_(SmsConsentEvidence.branch_id.is_(None), SmsConsentEvidence.branch_id == branch_id))
                .order_by(SmsConsentEvidence.created_at.desc(), SmsConsentEvidence.id.desc())
            )).scalars().all()
            if not rows:
                any_scope = (await self.session.execute(select(SmsConsentEvidence.id).where(SmsConsentEvidence.recipient_hash == rhash, SmsConsentEvidence.recipient_hash_version == RECIPIENT_HASH_VERSION).limit(1))).scalar_one_or_none()
                if any_scope is not None:
                    _inc("fieldos_sms_consent_denied_total")
                    return PolicyCheck(False, ConsentDecision.CONSENT_SCOPE_MISMATCH.value, safe_message="consent scope mismatch")
                _inc("fieldos_sms_consent_missing_total")
                return PolicyCheck(False, ConsentDecision.CONSENT_NOT_FOUND.value, safe_message="consent not found")
            row = rows[0]
            if row.status == "revoked" or row.revoked_at is not None:
                _inc("fieldos_sms_consent_denied_total")
                return PolicyCheck(False, ConsentDecision.CONSENT_REVOKED.value, row.id, "consent revoked")
            if row.status == "expired" or (row.expires_at is not None and row.expires_at <= now):
                _inc("fieldos_sms_consent_denied_total")
                return PolicyCheck(False, ConsentDecision.CONSENT_EXPIRED.value, row.id, "consent expired")
            if row.status == "granted" and row.granted_at is not None:
                return PolicyCheck(True, ConsentDecision.CONSENT_GRANTED.value, row.id, "consent granted")
            _inc("fieldos_sms_consent_denied_total")
            return PolicyCheck(False, ConsentDecision.CONSENT_NOT_FOUND.value, row.id, "consent not granted")
        except Exception:
            logger.exception("sms consent service failed closed")
            _inc("fieldos_sms_consent_denied_total")
            return PolicyCheck(False, ConsentDecision.CONSENT_SERVICE_ERROR.value, safe_message="consent service error")

    async def has_sms_consent(self, *, recipient: str, payload: dict) -> bool:
        return (await self.check_sms_consent(recipient=recipient, payload=payload)).decision == ConsentDecision.CONSENT_GRANTED.value


class PersistentSuppressionService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def check_suppression(self, *, recipient: str, payload: dict) -> PolicyCheck:
        try:
            rhash = recipient_hash(recipient)
            branch_id = _payload_branch(payload)
            now = await _now(self.session)
            rows = (await self.session.execute(
                select(SmsSuppressionRecord)
                .where(SmsSuppressionRecord.recipient_hash == rhash)
                .where(SmsSuppressionRecord.recipient_hash_version == RECIPIENT_HASH_VERSION)
                .where(SmsSuppressionRecord.active.is_(True))
                .where(SmsSuppressionRecord.effective_at <= now)
                .where(or_(SmsSuppressionRecord.expires_at.is_(None), SmsSuppressionRecord.expires_at > now))
                .where(or_(SmsSuppressionRecord.branch_id.is_(None), SmsSuppressionRecord.branch_id == branch_id, SmsSuppressionRecord.scope == "global"))
                .order_by(SmsSuppressionRecord.branch_id.is_not(None), SmsSuppressionRecord.created_at.desc(), SmsSuppressionRecord.id.desc())
            )).scalars().all()
            if not rows:
                return PolicyCheck(True, SuppressionDecision.NOT_SUPPRESSED.value, safe_message="not suppressed")
            row = rows[0]
            _inc("fieldos_sms_suppression_blocked_total")
            mapping = {
                "client_opt_out": SuppressionDecision.SUPPRESSED_OPT_OUT,
                "provider_complaint": SuppressionDecision.SUPPRESSED_COMPLIANCE,
                "legal_or_compliance": SuppressionDecision.SUPPRESSED_COMPLIANCE,
                "invalid_recipient": SuppressionDecision.SUPPRESSED_INVALID_RECIPIENT,
            }
            decision = mapping.get(row.reason, SuppressionDecision.SUPPRESSED_MANUAL)
            return PolicyCheck(False, decision.value, row.id, "recipient suppressed")
        except Exception:
            logger.exception("sms suppression service failed closed")
            _inc("fieldos_sms_suppression_blocked_total")
            return PolicyCheck(False, SuppressionDecision.SUPPRESSION_SERVICE_ERROR.value, safe_message="suppression service error")

    async def is_suppressed(self, *, recipient: str, payload: dict) -> bool:
        return (await self.check_suppression(recipient=recipient, payload=payload)).decision != SuppressionDecision.NOT_SUPPRESSED.value


class PersistentTemplateApprovalService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def check_template(self, *, payload: dict) -> PolicyCheck:
        try:
            key = payload.get("template_key")
            version = payload.get("template_version") or payload.get("version")
            if not key:
                _inc("fieldos_sms_template_missing_total")
                return PolicyCheck(False, TemplateDecision.TEMPLATE_NOT_FOUND.value, safe_message="template key missing")
            if not version:
                _inc("fieldos_sms_template_not_approved_total")
                return PolicyCheck(False, TemplateDecision.TEMPLATE_VERSION_MISMATCH.value, safe_message="template version missing")
            branch_id = _payload_branch(payload)
            purpose = _payload_purpose(payload)
            language = _payload_language(payload)
            rows = (await self.session.execute(
                select(SmsApprovedTemplate)
                .where(SmsApprovedTemplate.template_key == str(key))
                .where(SmsApprovedTemplate.language == language)
                .where(or_(SmsApprovedTemplate.branch_id.is_(None), SmsApprovedTemplate.branch_id == branch_id))
                .order_by(SmsApprovedTemplate.branch_id.is_not(None).desc(), SmsApprovedTemplate.created_at.desc(), SmsApprovedTemplate.id.desc())
            )).scalars().all()
            if not rows:
                _inc("fieldos_sms_template_missing_total")
                return PolicyCheck(False, TemplateDecision.TEMPLATE_NOT_FOUND.value, safe_message="template not found")
            exact = [r for r in rows if r.version == str(version)]
            if not exact:
                _inc("fieldos_sms_template_not_approved_total")
                return PolicyCheck(False, TemplateDecision.TEMPLATE_VERSION_MISMATCH.value, safe_message="template version mismatch")
            scoped = [r for r in exact if r.purpose == purpose]
            if not scoped:
                _inc("fieldos_sms_template_not_approved_total")
                return PolicyCheck(False, TemplateDecision.TEMPLATE_SCOPE_MISMATCH.value, safe_message="template purpose/scope mismatch")
            row = scoped[0]
            if row.approval_status == "retired" or row.retired_at is not None:
                _inc("fieldos_sms_template_not_approved_total")
                return PolicyCheck(False, TemplateDecision.TEMPLATE_RETIRED.value, row.id, "template retired")
            if row.approval_status == "approved" and row.active is True:
                try:
                    allowed_vars = _load_allowed_variables(row)
                    expected_hash = template_content_hash(row.body_template, allowed_vars)
                    if row.content_hash and row.content_hash != expected_hash:
                        _inc("fieldos_sms_template_not_approved_total")
                        return PolicyCheck(False, TemplateDecision.TEMPLATE_NOT_APPROVED.value, row.id, "template content changed after approval")
                    rendered = render_approved_template(row, payload.get("template_variables") or {})
                    supplied_message = payload.get("message")
                    if supplied_message not in (None, "") and str(supplied_message) != rendered:
                        _inc("fieldos_sms_template_not_approved_total")
                        return PolicyCheck(False, TemplateDecision.TEMPLATE_NOT_APPROVED.value, row.id, "message does not match approved template")
                    payload["message"] = rendered
                    payload["approved_template_id"] = row.id
                    payload["approved_template_content_hash"] = row.content_hash or expected_hash
                except Exception as exc:
                    _inc("fieldos_sms_template_not_approved_total")
                    return PolicyCheck(False, TemplateDecision.TEMPLATE_NOT_APPROVED.value, row.id, str(exc))
                return PolicyCheck(True, TemplateDecision.TEMPLATE_APPROVED.value, row.id, "template approved")
            _inc("fieldos_sms_template_not_approved_total")
            return PolicyCheck(False, TemplateDecision.TEMPLATE_NOT_APPROVED.value, row.id, "template not approved")
        except Exception:
            logger.exception("sms template service failed closed")
            _inc("fieldos_sms_template_not_approved_total")
            return PolicyCheck(False, TemplateDecision.TEMPLATE_SERVICE_ERROR.value, safe_message="template service error")

    async def is_template_approved(self, *, payload: dict) -> bool:
        return (await self.check_template(payload=payload)).decision == TemplateDecision.TEMPLATE_APPROVED.value


def _quota_date() -> tuple[str, str]:
    tz_name = settings.SMS_QUOTA_TIMEZONE or "Asia/Kathmandu"
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        raise ValueError("invalid SMS quota timezone")
    return datetime.now(timezone.utc).astimezone(tz).date().isoformat(), tz_name


def _parse_positive_limits() -> tuple[int, int, Decimal, Decimal]:
    try:
        global_limit = int(settings.SMS_DAILY_SEND_LIMIT)
        recipient_limit = int(settings.SMS_PER_RECIPIENT_DAILY_LIMIT)
        cost_limit = Decimal(str(settings.SMS_MAX_COST_PER_DAY))
        unit_cost = Decimal(str(getattr(settings, "SMS_ESTIMATED_COST_PER_MESSAGE", 1)))
    except (TypeError, ValueError, InvalidOperation):
        raise ValueError("malformed quota limits")
    if global_limit <= 0 or recipient_limit <= 0 or cost_limit <= 0 or unit_cost < 0:
        raise ValueError("non-positive quota limits")
    return global_limit, recipient_limit, cost_limit, unit_cost


async def reserve_sms_quota(session: AsyncSession, *, payload: dict, recipient: str, provider: str) -> PolicyCheck:
    try:
        global_limit, recipient_limit, cost_limit, unit_cost = _parse_positive_limits()
    except ValueError:
        _inc("fieldos_sms_quota_limit_blocked_total")
        return PolicyCheck(False, QuotaDecision.QUOTA_MALFORMED_LIMIT.value, safe_message="quota limits malformed")
    try:
        outbox_id = int(payload.get("outbox_id") or 0) or None
        attempt_id = int(payload.get("attempt_id") or 0) or None
        rhash = recipient_hash(recipient)
        branch_id = _payload_branch(payload)
        try:
            quota_date, tz_name = _quota_date()
        except ValueError:
            _inc("fieldos_sms_quota_limit_blocked_total")
            return PolicyCheck(False, QuotaDecision.QUOTA_MALFORMED_LIMIT.value, safe_message="quota timezone invalid")
        reservation_key = str(payload.get("reservation_key") or f"sms:{outbox_id}:{provider}")[:180]
        now = await _now(session)

        existing = None
        if outbox_id:
            existing = (await session.execute(
                select(SmsQuotaReservation).where(SmsQuotaReservation.outbox_id == outbox_id).with_for_update()
            )).scalar_one_or_none()
        if existing is not None:
            if existing.status in {"reserved", "provider_call_started", "committed", "provider_uncertain"}:
                return PolicyCheck(True, QuotaDecision.QUOTA_REUSED.value, existing.id, "quota reservation reused")
            if existing.status in {"released", "cancelled"}:
                return PolicyCheck(False, QuotaDecision.QUOTA_ALREADY_FINAL.value, existing.id, "quota reservation already released")

        if session.bind is not None and session.bind.dialect.name.startswith("postgres"):
            global_lock = f"sms-quota:global:{quota_date}:{tz_name}"
            recipient_lock = f"sms-quota:recipient:{quota_date}:{tz_name}:{rhash}"
            await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock_material))"), {"lock_material": global_lock})
            await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:lock_material))"), {"lock_material": recipient_lock})
            await session.execute(
                select(SmsQuotaReservation.id)
                .where(SmsQuotaReservation.quota_date == quota_date)
                .where(SmsQuotaReservation.status.in_(list(ACTIVE_RESERVATION_STATUSES)))
                .with_for_update()
            )
        else:
            await session.execute(select(SmsQuotaReservation.id).where(SmsQuotaReservation.quota_date == quota_date).with_for_update())

        if outbox_id:
            existing = (await session.execute(
                select(SmsQuotaReservation).where(SmsQuotaReservation.outbox_id == outbox_id).with_for_update()
            )).scalar_one_or_none()
            if existing is not None:
                if existing.status in {"reserved", "provider_call_started", "committed", "provider_uncertain"}:
                    return PolicyCheck(True, QuotaDecision.QUOTA_REUSED.value, existing.id, "quota reservation reused")
                return PolicyCheck(False, QuotaDecision.QUOTA_ALREADY_FINAL.value, existing.id, "quota reservation already final")

        rows = (await session.execute(
            select(SmsQuotaReservation).where(SmsQuotaReservation.quota_date == quota_date, SmsQuotaReservation.status.in_(list(ACTIVE_RESERVATION_STATUSES)))
        )).scalars().all()
        global_used = sum(int(r.reserved_message_count or 0) for r in rows)
        recipient_used = sum(int(r.reserved_message_count or 0) for r in rows if r.recipient_hash == rhash)
        cost_used = sum(Decimal(str(r.reserved_cost or 0)) for r in rows)
        if global_used + 1 > global_limit:
            _inc("fieldos_sms_quota_limit_blocked_total")
            return PolicyCheck(False, QuotaDecision.QUOTA_GLOBAL_LIMIT.value, safe_message="global SMS quota exceeded")
        if recipient_used + 1 > recipient_limit:
            _inc("fieldos_sms_quota_limit_blocked_total")
            return PolicyCheck(False, QuotaDecision.QUOTA_RECIPIENT_LIMIT.value, safe_message="recipient SMS quota exceeded")
        if cost_used + unit_cost > cost_limit:
            _inc("fieldos_sms_quota_limit_blocked_total")
            return PolicyCheck(False, QuotaDecision.QUOTA_COST_LIMIT.value, safe_message="SMS cost quota exceeded")
        row = SmsQuotaReservation(
            reservation_key=reservation_key,
            outbox_id=outbox_id,
            attempt_id=attempt_id,
            provider=provider,
            recipient_hash=rhash,
            recipient_hash_version=RECIPIENT_HASH_VERSION,
            branch_id=branch_id,
            quota_date=quota_date,
            quota_timezone=tz_name,
            reserved_message_count=1,
            reserved_cost=unit_cost,
            status="reserved",
            reserved_at=now,
        )
        session.add(row)
        await session.flush()
        _inc("fieldos_sms_quota_reservation_success_total")
        return PolicyCheck(True, QuotaDecision.QUOTA_RESERVED.value, row.id, "quota reserved")
    except Exception:
        logger.exception("sms quota reservation failed closed")
        return PolicyCheck(False, QuotaDecision.QUOTA_SERVICE_ERROR.value, safe_message="quota service error")


async def _reservation_for(session: AsyncSession, *, outbox_id: int | None, attempt_id: int | None) -> SmsQuotaReservation | None:
    if not outbox_id:
        return None
    return (await session.execute(select(SmsQuotaReservation).where(SmsQuotaReservation.outbox_id == outbox_id).with_for_update())).scalar_one_or_none()


async def commit_quota_reservation(session: AsyncSession, *, outbox_id: int | None, attempt_id: int | None) -> None:
    row = await _reservation_for(session, outbox_id=outbox_id, attempt_id=attempt_id)
    if row and row.status in {"reserved", "provider_call_started"}:
        row.status = "committed"
        row.committed_at = await _now(session)
        row.updated_at = row.committed_at
        _inc("fieldos_sms_quota_commit_total")


async def release_quota_reservation(session: AsyncSession, *, outbox_id: int | None, attempt_id: int | None, reason: str = "pre_provider_block") -> None:
    row = await _reservation_for(session, outbox_id=outbox_id, attempt_id=attempt_id)
    if row and row.status == "reserved":
        row.status = "released"
        row.released_at = await _now(session)
        row.updated_at = row.released_at
        _inc("fieldos_sms_quota_release_total")


async def mark_provider_call_started(session: AsyncSession, *, outbox_id: int | None, attempt_id: int | None) -> None:
    row = await _reservation_for(session, outbox_id=outbox_id, attempt_id=attempt_id)
    if row and row.status == "reserved":
        row.status = "provider_call_started"
        row.provider_call_started_at = await _now(session)
        row.updated_at = row.provider_call_started_at

async def mark_quota_provider_uncertain(session: AsyncSession, *, outbox_id: int | None, attempt_id: int | None) -> None:
    row = await _reservation_for(session, outbox_id=outbox_id, attempt_id=attempt_id)
    if row and row.status in {"reserved", "provider_call_started"}:
        row.status = "provider_uncertain"
        row.uncertain_at = await _now(session)
        row.updated_at = row.uncertain_at
        _inc("fieldos_sms_provider_uncertain_total")


async def record_policy_audit(session: AsyncSession, action: str, *, user=None, entity_type: str, entity_id, meta: dict) -> None:
    safe = dict(meta or {})
    for key in ("recipient", "phone", "message", "body_template", "payload"):
        safe.pop(key, None)
    await write_audit(session, user, action, entity_type=entity_type, entity_id=entity_id, meta=safe)


def safe_template_response(row: SmsApprovedTemplate, *, include_body: bool = False) -> dict:
    data = {"id": row.id, "template_key": row.template_key, "version": row.version, "language": row.language, "purpose": row.purpose, "active": row.active, "approval_status": row.approval_status, "branch_id": row.branch_id, "tenant_scope": row.tenant_scope, "approved_at": str(row.approved_at) if row.approved_at else None, "retired_at": str(row.retired_at) if row.retired_at else None}
    if include_body:
        data["body_template"] = row.body_template
        data["managed_content_ref"] = row.managed_content_ref
    return data


def reservation_response(row: SmsQuotaReservation) -> dict:
    return {"id": row.id, "outbox_id": row.outbox_id, "attempt_id": row.attempt_id, "provider": row.provider, "branch_id": row.branch_id, "quota_date": row.quota_date, "quota_timezone": row.quota_timezone, "reserved_message_count": row.reserved_message_count, "reserved_cost": str(row.reserved_cost), "status": row.status, "reserved_at": str(row.reserved_at), "committed_at": str(row.committed_at) if row.committed_at else None, "released_at": str(row.released_at) if row.released_at else None, "uncertain_at": str(row.uncertain_at) if row.uncertain_at else None}
