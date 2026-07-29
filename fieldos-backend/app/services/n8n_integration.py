from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException, Request, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.audit_log import AuditLog
from app.models.branch import Branch
from app.models.client import Client
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox, ClientCommunicationWorkerHeartbeat
from app.models.task import TaskAssignment
from app.models.user import Department, User, UserRole
from app.services.audit_helper import write_audit
from app.services.replay_store import ReplayStoreError, mark_n8n_nonce_seen

logger = logging.getLogger(__name__)
SERVICE_ACTOR = type("N8NServiceActor", (), {"id": None, "role": "integration:n8n", "department": "integration"})()
FINAL_EVENT_STATUSES = {"cancelled", "confirmed", "disputed", "suppressed"}
FAILED_STATUSES = {"failed", "rejected", "expired", "dead_letter", "no_phone"}
SECRET_MARKERS = ("secret", "token", "signature", "payload", "recipient", "phone", "message", "encrypted")
MAX_N8N_REQUEST_BODY_BYTES = 64 * 1024
MAX_RANDOM_SAMPLE_SIZE = 100
PROVIDER_ID_RE = re.compile(r"^[a-z0-9_.-]{1,40}$")


@dataclass(frozen=True)
class N8NAuthContext:
    timestamp: int
    nonce: str
    signature_digest: str


def _now() -> datetime:
    return datetime.utcnow()


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = "".join(ch for ch in str(phone) if ch.isdigit())
    if len(digits) < 4:
        return "******"
    return f"******{digits[-4:]}"


def sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return sanitize_mapping(value)
    if isinstance(value, list):
        return [sanitize_value(v) for v in value]
    if isinstance(value, str):
        lowered = value.lower()
        if any(marker in lowered for marker in ("bearer ", "api_key", "password", "secret=")):
            return "[REDACTED]"
    return value


def sanitize_mapping(data: dict[str, Any] | None) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, value in (data or {}).items():
        lowered = str(key).lower()
        if any(marker in lowered for marker in SECRET_MARKERS):
            continue
        safe[key] = sanitize_value(value)
    return safe


def event_idempotency_key(workflow: str, event_id: int, suffix: str | None = None) -> str:
    base = f"n8n:{workflow}:{event_id}"
    return f"{base}:{suffix}" if suffix else base


async def write_n8n_audit(db: AsyncSession, action_type: str, entity_type: str, entity_id: Any = None, meta: dict[str, Any] | None = None) -> AuditLog:
    return await write_audit(db, SERVICE_ACTOR, action_type, entity_type=entity_type, entity_id=entity_id, meta=sanitize_mapping(meta))


async def reject(db: AsyncSession, reason: str, status_code: int = status.HTTP_401_UNAUTHORIZED) -> None:
    await write_n8n_audit(db, "n8n_integration_request_rejected", "n8n_integration", meta={"reason": reason})
    await db.commit()
    raise HTTPException(status_code=status_code, detail=reason)


async def verify_n8n_request(request: Request, db: AsyncSession) -> N8NAuthContext:
    if not settings.N8N_INTEGRATION_ENABLED:
        await reject(db, "n8n integration disabled", status.HTTP_503_SERVICE_UNAVAILABLE)
    if not settings.N8N_SHARED_SECRET:
        await reject(db, "n8n integration secret not configured", status.HTTP_503_SERVICE_UNAVAILABLE)

    timestamp_raw = request.headers.get("X-FieldOS-Timestamp")
    nonce = (request.headers.get("X-FieldOS-Nonce") or "").strip()
    signature = (request.headers.get("X-FieldOS-Signature") or "").strip()
    if not timestamp_raw or not nonce or not signature:
        await reject(db, "missing n8n authentication headers")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_N8N_REQUEST_BODY_BYTES:
                await reject(db, "n8n request body too large", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        except ValueError:
            await reject(db, "invalid n8n content length")
    timestamp = 0
    try:
        timestamp = int(timestamp_raw)
    except ValueError:
        await reject(db, "invalid n8n timestamp")

    age = abs(int(time.time()) - timestamp)
    if age > settings.N8N_TIMESTAMP_TOLERANCE_SECONDS:
        await reject(db, "expired n8n timestamp")

    body = await request.body()
    if len(body) > MAX_N8N_REQUEST_BODY_BYTES:
        await reject(db, "n8n request body too large", status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    message = timestamp_raw.encode("utf-8") + b"." + nonce.encode("utf-8") + b"." + body
    expected = hmac.new(settings.N8N_SHARED_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
    supplied = signature[7:] if signature.startswith("sha256=") else signature
    if not hmac.compare_digest(expected, supplied):
        await reject(db, "invalid n8n signature")

    signature_digest = hashlib.sha256(supplied.encode()).hexdigest()[:16]
    replay_result = None
    try:
        replay_result = await mark_n8n_nonce_seen(nonce=nonce, integration_scope="n8n")
    except ReplayStoreError:
        await reject(db, "n8n replay store unavailable", status.HTTP_503_SERVICE_UNAVAILABLE)
    if replay_result is None:
        await reject(db, "n8n replay store unavailable", status.HTTP_503_SERVICE_UNAVAILABLE)
    assert replay_result is not None
    if not replay_result.accepted:
        await reject(db, "replayed n8n request")

    await write_n8n_audit(db, "n8n_integration_request_received", "n8n_integration", meta={"nonce_digest": hashlib.sha256(nonce.encode()).hexdigest()[:16], "replay_store": replay_result.store})
    return N8NAuthContext(timestamp=timestamp, nonce=nonce, signature_digest=signature_digest)


def scoped_event_query(branch_id: int | None = None):
    q = select(ClientCommunicationEvent)
    if branch_id is not None:
        q = q.where(ClientCommunicationEvent.branch_id == branch_id)
    return q


async def event_or_404(db: AsyncSession, event_id: int) -> ClientCommunicationEvent:
    event = (await db.execute(select(ClientCommunicationEvent).where(ClientCommunicationEvent.id == event_id))).scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="event not found")
    return event


async def client_for_event(db: AsyncSession, event: ClientCommunicationEvent) -> Client | None:
    if not event.client_id:
        return None
    return (await db.execute(select(Client).where(Client.id == event.client_id))).scalar_one_or_none()


async def branch_for_event(db: AsyncSession, event: ClientCommunicationEvent) -> Branch | None:
    if not event.branch_id:
        return None
    return (await db.execute(select(Branch).where(Branch.id == event.branch_id))).scalar_one_or_none()


async def manager_for_branch(db: AsyncSession, branch_id: int | None) -> User | None:
    if branch_id is not None:
        user = (await db.execute(select(User).where(User.branch_id == branch_id, User.role == UserRole.BRANCH_MANAGER.value, User.is_active.is_(True)).order_by(User.id))).scalars().first()
        if user:
            return user
    return (await db.execute(select(User).where(User.role == UserRole.ADMIN.value, User.department.in_([Department.HEAD_OFFICE.value, Department.OPERATIONS.value]), User.is_active.is_(True)).order_by(User.id))).scalars().first()


def safe_event_dict(event: ClientCommunicationEvent, client: Client | None = None, branch: Branch | None = None) -> dict[str, Any]:
    return {
        "event_id": event.id,
        "branch_id": event.branch_id,
        "branch_name": branch.name if branch else None,
        "client_id": event.client_id,
        "client_identifier_masked": f"client:{event.client_id}" if event.client_id else None,
        "member_reference": client.member_id if client else None,
        "phone_masked": mask_phone(client.phone_number if client else None),
        "purpose": event.purpose,
        "status": event.status,
        "risk_level": event.risk_level,
        "receipt_reference": event.source_reference,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "disputed_at": event.disputed_at.isoformat() if event.disputed_at else None,
    }


async def audit_exists(db: AsyncSession, action_type: str, idempotency_key: str) -> bool:
    row = (await db.execute(select(AuditLog).where(AuditLog.action_type == action_type, AuditLog.meta_json.like(f"%{idempotency_key}%")))).scalars().first()
    return row is not None


async def write_idempotent_n8n_audit(db: AsyncSession, action_type: str, entity_type: str, entity_id: Any, meta: dict[str, Any], idempotency_key: str) -> None:
    if not await audit_exists(db, action_type, idempotency_key):
        await write_n8n_audit(db, action_type, entity_type, entity_id, meta)


async def create_callback_task(db: AsyncSession, event: ClientCommunicationEvent, reason: str, due_date: str | None, idempotency_key: str) -> TaskAssignment:
    like = f"%idempotency:{idempotency_key}%"
    existing = (await db.execute(select(TaskAssignment).where(TaskAssignment.reason.like(like)))).scalars().first()
    if existing:
        return existing
    owner = await manager_for_branch(db, event.branch_id)
    task = TaskAssignment(
        client_id=event.client_id,
        user_id=owner.id if owner else None,
        branch_id=event.branch_id,
        task_type="client_protection_callback",
        task_date=due_date or date.today().isoformat(),
        status="pending",
        priority="high" if event.status == "disputed" else "medium",
        reason=f"{reason}; event:{event.id}; idempotency:{idempotency_key}",
        amount=None,
    )
    db.add(task)
    await db.flush()
    await write_n8n_audit(db, "n8n_callback_task_created", "task_assignment", task.id, {"event_id": event.id, "branch_id": event.branch_id, "idempotency_key": idempotency_key})
    return task


async def escalate_event(db: AsyncSession, event_id: int, reason: str, workflow: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    event = await event_or_404(db, event_id)
    client = await client_for_event(db, event)
    branch = await branch_for_event(db, event)
    key = event_idempotency_key(workflow, event_id, event.status if workflow == "failed-delivery" else None)
    task = await create_callback_task(db, event, reason, (payload or {}).get("due_date"), key)
    await write_idempotent_n8n_audit(db, "n8n_escalation_created", "client_communication_event", event.id, {"event_id": event.id, "branch_id": event.branch_id, "workflow": workflow, "idempotency_key": key}, key)
    await db.commit()
    return {"event": safe_event_dict(event, client, branch), "task_id": task.id, "task_status": task.status, "assigned_user_id": task.user_id, "idempotency_key": key}


async def acknowledge_event(db: AsyncSession, event_id: int, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    event = await event_or_404(db, event_id)
    key = event_idempotency_key("acknowledge", event_id, (payload or {}).get("reason", "received"))
    await write_n8n_audit(db, "n8n_escalation_created", "client_communication_event", event.id, {"event_id": event.id, "branch_id": event.branch_id, "acknowledged": True, "idempotency_key": key})
    await db.commit()
    return {"event_id": event.id, "status": "acknowledged", "idempotency_key": key}


async def exceptions_feed(db: AsyncSession, branch_id: int | None = None, limit: int = 100) -> dict[str, Any]:
    q = scoped_event_query(branch_id).where(ClientCommunicationEvent.status.in_(["disputed", "failed", "rejected", "expired", "no_phone"])).order_by(ClientCommunicationEvent.created_at.desc()).limit(min(limit, 200))
    events = (await db.execute(q)).scalars().all()
    items = []
    for event in events:
        items.append(safe_event_dict(event, await client_for_event(db, event), await branch_for_event(db, event)))
    return {"items": items, "count": len(items)}


async def daily_summary(db: AsyncSession, branch_id: int | None = None) -> dict[str, Any]:
    rows = (await db.execute(scoped_event_query(branch_id))).scalars().all()
    counts: dict[str, int] = {}
    by_branch: dict[str, int] = {}
    by_officer: dict[str, int] = {}
    for event in rows:
        counts[event.status] = counts.get(event.status, 0) + 1
        by_branch[str(event.branch_id)] = by_branch.get(str(event.branch_id), 0) + 1
        by_officer[str(event.officer_id)] = by_officer.get(str(event.officer_id), 0) + 1
    await write_n8n_audit(db, "n8n_daily_report_requested", "client_protection_daily_summary", meta={"branch_id": branch_id, "date": date.today().isoformat()})
    await db.commit()
    return {"date": date.today().isoformat(), "timezone": settings.N8N_TIMEZONE, "counts_by_status": counts, "grouped_by_branch": by_branch, "grouped_by_officer": by_officer}


async def random_sample(db: AsyncSession, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    branch_id = payload.get("branch_id")
    percent = float(payload.get("percent", settings.N8N_RANDOM_SAMPLE_PERCENT))
    percent = max(0.0, min(percent, 100.0))
    requested_version = str(payload.get("sample_version") or "v1")[:40]
    scope = branch_id or "all"
    key = f"n8n:sample:{date.today().isoformat()}:{scope}:{requested_version}"

    existing_tasks = (await db.execute(select(TaskAssignment).where(TaskAssignment.reason.like(f"%idempotency:{key}:%")))).scalars().all()
    if existing_tasks:
        existing_event_ids = []
        for task in existing_tasks:
            match = re.search(r"event:(\d+)", task.reason or "")
            if match:
                existing_event_ids.append(int(match.group(1)))
        return {"candidate_count": None, "sample_count": len(existing_tasks), "sample_version": requested_version, "idempotency_key": key, "event_ids": existing_event_ids, "existing": True}

    already_selected = select(TaskAssignment.client_id).where(TaskAssignment.reason.like("%idempotency:n8n:sample:%"), TaskAssignment.client_id.is_not(None))
    q = scoped_event_query(branch_id).where(
        ClientCommunicationEvent.status.notin_(FINAL_EVENT_STATUSES),
        ClientCommunicationEvent.purpose == "collection_verification",
        ClientCommunicationEvent.client_id.notin_(already_selected),
    ).order_by(ClientCommunicationEvent.id)
    candidates = (await db.execute(q)).scalars().all()
    sample_size = int(len(candidates) * percent / 100.0)
    if percent > 0 and candidates and sample_size == 0:
        sample_size = 1
    sample_size = min(sample_size, MAX_RANDOM_SAMPLE_SIZE, len(candidates))
    seed = f"{key}:{len(candidates)}:{percent}"
    ranked = sorted(candidates, key=lambda event: hashlib.sha256(f"{seed}:{event.id}".encode()).hexdigest())
    selected = ranked[:sample_size]
    for event in selected:
        await create_callback_task(db, event, "Random verification sample", payload.get("due_date"), f"{key}:{event.id}")
    await write_idempotent_n8n_audit(db, "n8n_random_sample_requested", "client_protection_sample", None, {"branch_id": branch_id, "candidate_count": len(candidates), "sample_count": len(selected), "sample_version": requested_version, "idempotency_key": key}, key)
    await db.commit()
    return {"candidate_count": len(candidates), "sample_count": len(selected), "sample_version": requested_version, "idempotency_key": key, "event_ids": [e.id for e in selected], "existing": False}


async def provider_health_alert(db: AsyncSession, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = sanitize_mapping(payload or {})
    provider = str(payload.get("provider", "unknown"))[:40].lower()
    if not PROVIDER_ID_RE.fullmatch(provider):
        raise HTTPException(status_code=400, detail="invalid provider identifier")
    failure_count = int(payload.get("failure_count", 0) or 0)
    oldest_age = int(payload.get("oldest_pending_age_seconds", 0) or 0)
    window_start = str(payload.get("window_start") or datetime.utcnow().strftime("%Y-%m-%dT%H:00Z"))[:40]
    dead_count = (await db.execute(select(func.count()).select_from(ClientCommunicationOutbox).where(ClientCommunicationOutbox.status == "dead"))).scalar() or 0
    heartbeat = (await db.execute(select(ClientCommunicationWorkerHeartbeat).order_by(ClientCommunicationWorkerHeartbeat.updated_at.desc()))).scalars().first()
    heartbeat_stale = not heartbeat or not heartbeat.updated_at or heartbeat.updated_at < _now() - timedelta(seconds=settings.N8N_BACKLOG_AGE_THRESHOLD_SECONDS)
    threshold_hit = failure_count >= settings.N8N_PROVIDER_FAILURE_THRESHOLD or oldest_age >= settings.N8N_BACKLOG_AGE_THRESHOLD_SECONDS or dead_count >= settings.N8N_PROVIDER_FAILURE_THRESHOLD or heartbeat_stale
    key = f"n8n:provider-alert:{provider}:{window_start}"
    if threshold_hit:
        await write_idempotent_n8n_audit(db, "n8n_provider_outage_alerted", "provider_health", None, {"provider": provider, "threshold_hit": threshold_hit, "failure_count": failure_count, "dead_count": dead_count, "heartbeat_stale": heartbeat_stale, "window_start": window_start, "idempotency_key": key}, key)
        await db.commit()
    return {"provider": provider, "threshold_hit": threshold_hit, "failure_count": failure_count, "dead_count": dead_count, "heartbeat_stale": heartbeat_stale, "window_start": window_start, "idempotency_key": key, "provider_switch_allowed": False}
