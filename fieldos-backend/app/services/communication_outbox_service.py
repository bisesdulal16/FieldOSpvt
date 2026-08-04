from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import secrets
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.audit_log import AuditLog
from app.models.client_communication import (
    ClientCommunicationAttempt,
    ClientCommunicationEvent,
    ClientCommunicationOutbox,
    ClientCommunicationWorkerHeartbeat,
)
from app.models.sms_notification import SmsNotification
from app.services.audit_helper import write_audit
from app.services.communication_providers import DispatchResult, parse_payload, provider_for
from app.services.sms_dispatch_safety import evaluate_sms_dispatch_safety, evaluate_sms_dispatch_safety_async, sms_safety_metrics_snapshot
from app.services.sms_policy import commit_quota_reservation, mark_provider_call_started, mark_quota_provider_uncertain, release_quota_reservation, sms_policy_metrics_snapshot

logger = logging.getLogger(__name__)

FINAL_ATTEMPT_STATUSES = {
    "submitted",
    "provider_accepted",
    "delivered",
    "confirmed",
    "disputed",
    "cancelled",
    "failed",
}
DISPATCH_BLOCKING_STATUSES = FINAL_ATTEMPT_STATUSES - {"failed"}
CLAIMABLE_OUTBOX_STATUSES = {"pending", "retryable", "broker_published"}
TERMINAL_OUTBOX_STATUSES = {"published", "dead", "cancelled", "skipped", "provider_uncertain", "provider_call_started"}

_METRICS = {
    "outbox_dispatch_success_total": 0,
    "outbox_dispatch_failure_total": 0,
    "outbox_retry_total": 0,
    "outbox_dispatch_duration_seconds_sum": 0.0,
    "outbox_dispatch_duration_seconds_count": 0,
    "fieldos_communication_broker_published_unprocessed": 0,
}


@dataclass(slots=True)
class ClaimedOutbox:
    id: int
    attempt_id: int | None
    event_id: int
    payload_json: str
    idempotency_key: str
    attempt_count: int
    locked_by: str


@dataclass(slots=True)
class ProcessResult:
    status: str
    outbox_id: int | None = None
    provider_called: bool = False
    error: str | None = None


def build_worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{secrets.token_hex(4)}"


def _is_postgres(session: AsyncSession) -> bool:
    return session.bind is not None and session.bind.dialect.name.startswith("postgres")


async def _db_now(session: AsyncSession):
    result = await session.execute(select(func.now()))
    now = result.scalar_one()
    if isinstance(now, datetime) and now.tzinfo is not None:
        return now.replace(tzinfo=None)
    return now


def calculate_retry_delay_seconds(
    attempt_number: int,
    *,
    base_seconds: int | None = None,
    max_seconds: int | None = None,
    retry_after_seconds: int | None = None,
    jitter_fn=None,
) -> int:
    base = max(1, base_seconds or settings.OUTBOX_BASE_RETRY_SECONDS)
    cap = max(base, max_seconds or settings.OUTBOX_MAX_RETRY_SECONDS)
    raw = min(cap, base * (2 ** max(0, attempt_number - 1)))
    if retry_after_seconds is not None:
        raw = min(cap, max(raw, retry_after_seconds))
    jitter = jitter_fn(raw) if jitter_fn else random.uniform(0, raw * 0.1)
    return int(min(cap, max(1, raw + jitter)))


async def write_system_audit(session: AsyncSession, action_type: str, *, entity_type: str, entity_id, meta: dict) -> AuditLog:
    safe_meta = dict(meta)
    safe_meta.pop("recipient", None)
    safe_meta.pop("phone", None)
    safe_meta.pop("message", None)
    safe_meta.pop("payload", None)
    return await write_audit(session, None, action_type, entity_type=entity_type, entity_id=entity_id, meta=safe_meta)


def _attempt_metadata(attempt: ClientCommunicationAttempt) -> dict:
    try:
        parsed = json.loads(attempt.metadata_json or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


async def upsert_legacy_sms_notification(
    session: AsyncSession,
    *,
    event: ClientCommunicationEvent,
    attempt: ClientCommunicationAttempt,
    status: str,
    error: str | None = None,
) -> None:
    """Maintain legacy receipt compatibility without creating duplicate receipt rows."""
    receipt_id = event.source_reference
    if not receipt_id:
        return
    existing = (
        await session.execute(
            select(SmsNotification)
            .where(SmsNotification.collection_receipt_id == receipt_id)
            .where(SmsNotification.kind.in_(["collection_verification", "collection_receipt"]))
            .order_by(SmsNotification.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    metadata = _attempt_metadata(attempt)
    message = str(metadata.get("message") or "")
    if existing is None:
        session.add(
            SmsNotification(
                client_id=event.client_id,
                collection_receipt_id=receipt_id,
                phone_number=attempt.recipient,
                kind="collection_verification",
                message=message,
                provider=attempt.provider or settings.SMS_PROVIDER,
                status=status,
                error=error,
            )
        )
        return
    existing.provider = attempt.provider or settings.SMS_PROVIDER
    existing.status = status
    existing.error = error
    if message and not existing.message:
        existing.message = message


async def upsert_worker_heartbeat(
    session: AsyncSession,
    *,
    worker_id: str,
    worker_enabled: bool,
    process_alive: bool = True,
    successful_poll: bool = False,
    successful_dispatch: bool = False,
    last_error: str | None = None,
) -> None:
    now = await _db_now(session)
    existing = (
        await session.execute(
            select(ClientCommunicationWorkerHeartbeat).where(ClientCommunicationWorkerHeartbeat.worker_id == worker_id)
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = ClientCommunicationWorkerHeartbeat(worker_id=worker_id)
        session.add(existing)
    existing.process_alive = process_alive
    existing.worker_enabled = worker_enabled
    existing.updated_at = now
    if successful_poll:
        existing.last_successful_poll = now
    if successful_dispatch:
        existing.last_successful_dispatch = now
    if last_error is not None:
        existing.last_error = last_error[:500]


async def recover_provider_call_started(session: AsyncSession, worker_id: str, *, lock_timeout_seconds: int | None = None) -> int:
    timeout_seconds = lock_timeout_seconds or settings.OUTBOX_LOCK_TIMEOUT_SECONDS
    now = await _db_now(session)
    if _is_postgres(session):
        rows = (await session.execute(text("""
            SELECT o.id
            FROM client_communication_outbox o
            JOIN client_communication_attempts a ON a.id = o.attempt_id
            WHERE (o.status = 'provider_call_started' OR a.status = 'provider_call_started')
              AND COALESCE(o.provider_call_started_at, a.provider_call_started_at, o.updated_at) <= (NOW() - (:timeout_seconds * INTERVAL '1 second'))
              AND a.provider_reference IS NULL
              AND a.submitted_at IS NULL
            FOR UPDATE OF o SKIP LOCKED
        """), {"timeout_seconds": timeout_seconds})).mappings().all()
    else:
        rows = (await session.execute(text("""
            SELECT o.id
            FROM client_communication_outbox o
            JOIN client_communication_attempts a ON a.id = o.attempt_id
            WHERE (o.status = 'provider_call_started' OR a.status = 'provider_call_started')
              AND COALESCE(o.provider_call_started_at, a.provider_call_started_at, o.updated_at) <= datetime(CURRENT_TIMESTAMP, '-' || :timeout_seconds || ' seconds')
              AND a.provider_reference IS NULL
              AND a.submitted_at IS NULL
        """), {"timeout_seconds": timeout_seconds})).mappings().all()
    recovered = 0
    for row in rows:
        loaded = await session.execute(
            select(ClientCommunicationOutbox, ClientCommunicationAttempt, ClientCommunicationEvent)
            .join(ClientCommunicationAttempt, ClientCommunicationAttempt.id == ClientCommunicationOutbox.attempt_id)
            .join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationOutbox.event_id)
            .where(ClientCommunicationOutbox.id == row["id"])
        )
        found = loaded.first()
        if not found:
            continue
        outbox, attempt, event = found
        outbox.status = "provider_uncertain"
        outbox.locked_at = None
        outbox.locked_by = None
        outbox.last_error_code = "provider_uncertain"
        outbox.last_error = "provider call started before crash; manual reconciliation required"
        attempt.status = "provider_uncertain"
        attempt.error_code = "provider_uncertain"
        attempt.error_message = "provider call started before crash; automatic resend prohibited"
        event.status = "provider_uncertain"
        await mark_quota_provider_uncertain(session, outbox_id=outbox.id, attempt_id=attempt.id)
        await write_system_audit(session, "communication_provider_uncertain_recovered", entity_type="client_communication_outbox", entity_id=outbox.id, meta={"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "worker_id": worker_id})
        recovered += 1
    return recovered

async def recover_cancelled_outbox(session: AsyncSession, worker_id: str) -> int:
    now = await _db_now(session)
    rows = (
        await session.execute(
            select(ClientCommunicationOutbox, ClientCommunicationAttempt, ClientCommunicationEvent)
            .join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationOutbox.event_id)
            .join(ClientCommunicationAttempt, ClientCommunicationAttempt.id == ClientCommunicationOutbox.attempt_id)
            .where(ClientCommunicationEvent.cancelled_at.is_not(None))
            .where(ClientCommunicationOutbox.status.not_in(list(TERMINAL_OUTBOX_STATUSES)))
        )
    ).all()
    count = 0
    for outbox, attempt, event in rows:
        outbox.status = "cancelled"
        outbox.cancelled_at = now
        outbox.locked_at = None
        outbox.locked_by = None
        outbox.last_error_code = "event_cancelled"
        outbox.last_error = "communication event was cancelled before dispatch"
        attempt.status = "cancelled"
        attempt.completed_at = now
        event.status = "cancelled"
        await write_system_audit(
            session,
            "communication_dispatch_cancelled",
            entity_type="client_communication_outbox",
            entity_id=outbox.id,
            meta={"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "worker_id": worker_id},
        )
        count += 1
    return count


async def recover_stale_locks(session: AsyncSession, worker_id: str, *, lock_timeout_seconds: int | None = None) -> int:
    timeout_seconds = lock_timeout_seconds or settings.OUTBOX_LOCK_TIMEOUT_SECONDS
    now = await _db_now(session)
    if _is_postgres(session):
        stale = (
            await session.execute(
                text(
                    """
                    SELECT o.id, o.locked_by, o.locked_at
                    FROM client_communication_outbox o
                    LEFT JOIN client_communication_attempts a ON a.id = o.attempt_id
                    WHERE o.status = 'processing'
                      AND o.locked_at <= (NOW() - (:timeout_seconds * INTERVAL '1 second'))
                      AND (a.id IS NULL OR (a.provider_reference IS NULL AND a.submitted_at IS NULL))
                    FOR UPDATE OF o SKIP LOCKED
                    """
                ),
                {"timeout_seconds": timeout_seconds},
            )
        ).mappings().all()
    else:
        stale = (
            await session.execute(
                text(
                    """
                    SELECT o.id, o.locked_by, o.locked_at
                    FROM client_communication_outbox o
                    LEFT JOIN client_communication_attempts a ON a.id = o.attempt_id
                    WHERE o.status = 'processing'
                      AND o.locked_at <= datetime(CURRENT_TIMESTAMP, '-' || :timeout_seconds || ' seconds')
                      AND (a.id IS NULL OR (a.provider_reference IS NULL AND a.submitted_at IS NULL))
                    """
                ),
                {"timeout_seconds": timeout_seconds},
            )
        ).mappings().all()
    recovered = 0
    for row in stale:
        outbox = await session.get(ClientCommunicationOutbox, row["id"])
        if outbox is None or outbox.status != "processing":
            continue
        prior_locked_by = row["locked_by"]
        prior_locked_at = str(row["locked_at"])
        outbox.status = "pending"
        outbox.locked_at = None
        outbox.locked_by = None
        outbox.recovery_count = (outbox.recovery_count or 0) + 1
        outbox.last_recovered_at = now
        outbox.last_recovered_by = worker_id
        await write_system_audit(
            session,
            "communication_stale_lock_recovered",
            entity_type="client_communication_outbox",
            entity_id=outbox.id,
            meta={
                "outbox_id": outbox.id,
                "attempt_id": outbox.attempt_id,
                "event_id": outbox.event_id,
                "worker_id": worker_id,
                "prior_locked_by": prior_locked_by,
                "prior_locked_at": prior_locked_at,
                "recovery_count": outbox.recovery_count,
            },
        )
        recovered += 1
    return recovered


async def claim_outbox_batch(
    session: AsyncSession,
    *,
    worker_id: str,
    batch_size: int | None = None,
    lock_timeout_seconds: int | None = None,
    increment_provider_attempt_count: bool = True,
) -> list[ClaimedOutbox]:
    limit = max(1, batch_size or settings.OUTBOX_BATCH_SIZE)
    timeout_seconds = lock_timeout_seconds or settings.OUTBOX_LOCK_TIMEOUT_SECONDS
    await recover_provider_call_started(session, worker_id, lock_timeout_seconds=timeout_seconds)
    await recover_cancelled_outbox(session, worker_id)
    await recover_stale_locks(session, worker_id, lock_timeout_seconds=timeout_seconds)
    await session.flush()
    now = await _db_now(session)
    allow_broker_published = settings.COMMUNICATION_DISPATCH_MODE == "postgres"

    if _is_postgres(session):
        rows = (
            await session.execute(
                text(
                    """
                    WITH claimable AS (
                        SELECT o.id
                        FROM client_communication_outbox o
                        JOIN client_communication_events e ON e.id = o.event_id
                        JOIN client_communication_attempts a ON a.id = o.attempt_id
                        WHERE (o.status IN ('pending', 'retryable') OR (:allow_broker_published AND o.status = 'broker_published'))
                          AND (o.available_at IS NULL OR o.available_at <= NOW())
                          AND (o.locked_at IS NULL OR o.locked_at <= (NOW() - (:timeout_seconds * INTERVAL '1 second')))
                          AND e.cancelled_at IS NULL
                          AND e.status NOT IN ('cancelled', 'disputed', 'confirmed')
                          AND a.status NOT IN ('submitted', 'provider_accepted', 'delivered', 'confirmed', 'disputed', 'cancelled')
                          AND a.provider_reference IS NULL
                          AND a.submitted_at IS NULL
                        ORDER BY o.available_at NULLS FIRST, o.id
                        FOR UPDATE SKIP LOCKED
                        LIMIT :limit
                    )
                    UPDATE client_communication_outbox o
                    SET status = 'processing',
                        locked_at = NOW(),
                        locked_by = :worker_id,
                        attempt_count = CASE WHEN :increment_provider_attempt_count THEN COALESCE(o.attempt_count, 0) + 1 ELSE COALESCE(o.attempt_count, 0) END,
                        last_attempted_at = CASE WHEN :increment_provider_attempt_count THEN NOW() ELSE o.last_attempted_at END,
                        updated_at = NOW()
                    FROM claimable
                    WHERE o.id = claimable.id
                    RETURNING o.id, o.attempt_id, o.event_id, o.payload_json, o.idempotency_key, o.attempt_count, o.locked_by
                    """
                ),
                {"worker_id": worker_id, "limit": limit, "timeout_seconds": timeout_seconds, "allow_broker_published": allow_broker_published, "increment_provider_attempt_count": increment_provider_attempt_count},
            )
        ).mappings().all()
    else:
        candidate_ids = (
            await session.execute(
                text(
                    """
                    SELECT o.id
                    FROM client_communication_outbox o
                    JOIN client_communication_events e ON e.id = o.event_id
                    JOIN client_communication_attempts a ON a.id = o.attempt_id
                    WHERE (o.status IN ('pending', 'retryable') OR (:allow_broker_published = 1 AND o.status = 'broker_published'))
                      AND (o.available_at IS NULL OR o.available_at <= CURRENT_TIMESTAMP)
                      AND (o.locked_at IS NULL OR o.locked_at <= datetime(CURRENT_TIMESTAMP, '-' || :timeout_seconds || ' seconds'))
                      AND e.cancelled_at IS NULL
                      AND e.status NOT IN ('cancelled', 'disputed', 'confirmed')
                      AND a.status NOT IN ('submitted', 'provider_accepted', 'delivered', 'confirmed', 'disputed', 'cancelled')
                      AND a.provider_reference IS NULL
                      AND a.submitted_at IS NULL
                    ORDER BY o.available_at, o.id
                    LIMIT :limit
                    """
                ),
                {"limit": limit, "timeout_seconds": timeout_seconds, "allow_broker_published": 1 if allow_broker_published else 0},
            )
        ).scalars().all()
        rows = []
        for oid in candidate_ids:
            outbox = await session.get(ClientCommunicationOutbox, oid)
            if not outbox or outbox.status not in CLAIMABLE_OUTBOX_STATUSES:
                continue
            outbox.status = "processing"
            outbox.locked_at = now
            outbox.locked_by = worker_id
            if increment_provider_attempt_count:
                outbox.attempt_count = (outbox.attempt_count or 0) + 1
                outbox.last_attempted_at = now
            outbox.updated_at = now
            rows.append(
                {
                    "id": outbox.id,
                    "attempt_id": outbox.attempt_id,
                    "event_id": outbox.event_id,
                    "payload_json": outbox.payload_json,
                    "idempotency_key": outbox.idempotency_key,
                    "attempt_count": outbox.attempt_count,
                    "locked_by": outbox.locked_by,
                }
            )
    claimed = [ClaimedOutbox(**dict(row)) for row in rows]
    for row in claimed:
        await write_system_audit(
            session,
            "communication_outbox_claimed",
            entity_type="client_communication_outbox",
            entity_id=row.id,
            meta={
                "outbox_id": row.id,
                "attempt_id": row.attempt_id,
                "event_id": row.event_id,
                "worker_id": worker_id,
                "provider_attempt_count": row.attempt_count,
                "claim_kind": "provider_dispatch" if increment_provider_attempt_count else "broker_publication",
            },
        )
    await upsert_worker_heartbeat(session, worker_id=worker_id, worker_enabled=settings.COMMUNICATION_WORKER_ENABLED, successful_poll=True)
    return claimed


async def _load_processing_owned(session: AsyncSession, outbox_id: int, worker_id: str):
    row = (
        await session.execute(
            select(ClientCommunicationOutbox, ClientCommunicationAttempt, ClientCommunicationEvent)
            .join(ClientCommunicationAttempt, ClientCommunicationAttempt.id == ClientCommunicationOutbox.attempt_id)
            .join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationOutbox.event_id)
            .where(ClientCommunicationOutbox.id == outbox_id)
            .where(ClientCommunicationOutbox.status.in_(["processing", "provider_call_started"]))
            .where(ClientCommunicationOutbox.locked_by == worker_id)
        )
    ).first()
    return row


async def persist_dispatch_result(
    session: AsyncSession,
    *,
    outbox_id: int,
    worker_id: str,
    result: DispatchResult,
    jitter_fn=None,
) -> ProcessResult:
    row = await _load_processing_owned(session, outbox_id, worker_id)
    if row is None:
        logger.warning("communication outbox lock lost", extra={"outbox_id": outbox_id, "worker_id": worker_id})
        return ProcessResult(status="lock_lost", outbox_id=outbox_id, error="lock lost")
    outbox, attempt, event = row
    now = await _db_now(session)

    if attempt.provider_reference or attempt.submitted_at or attempt.status in DISPATCH_BLOCKING_STATUSES:
        outbox.status = "published"
        outbox.published_at = now
        outbox.locked_at = None
        outbox.locked_by = None
        await write_system_audit(
            session,
            "communication_dispatch_submitted",
            entity_type="client_communication_outbox",
            entity_id=outbox.id,
            meta={"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "worker_id": worker_id, "idempotent": True},
        )
        return ProcessResult(status="already_submitted", outbox_id=outbox.id)

    if result.outcome == "success":
        outbox.status = "published"
        outbox.published_at = now
        outbox.locked_at = None
        outbox.locked_by = None
        outbox.last_error = None
        outbox.last_error_code = None
        attempt.status = "submitted"
        attempt.provider_reference = result.provider_reference
        attempt.submitted_at = now
        event.status = "provider_accepted"
        await commit_quota_reservation(session, outbox_id=outbox.id, attempt_id=attempt.id)
        await upsert_legacy_sms_notification(session, event=event, attempt=attempt, status="submitted", error=None)
        _METRICS["outbox_dispatch_success_total"] += 1
        await upsert_worker_heartbeat(session, worker_id=worker_id, worker_enabled=settings.COMMUNICATION_WORKER_ENABLED, successful_dispatch=True)
        await write_system_audit(
            session,
            "communication_dispatch_submitted",
            entity_type="client_communication_outbox",
            entity_id=outbox.id,
            meta={"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "worker_id": worker_id, "provider_status": result.provider_status, "idempotency_key_used": result.idempotency_key_used},
        )
        return ProcessResult(status="published", outbox_id=outbox.id)

    if result.error_code == "provider_uncertain":
        outbox.status = "provider_uncertain"
        outbox.locked_at = None
        outbox.locked_by = None
        outbox.last_error = "provider outcome uncertain; manual reconciliation required"
        outbox.last_error_code = "provider_uncertain"
        attempt.status = "provider_uncertain"
        attempt.error_code = "provider_uncertain"
        attempt.error_message = "provider outcome uncertain; automatic resend prohibited"
        event.status = "provider_uncertain"
        await mark_quota_provider_uncertain(session, outbox_id=outbox.id, attempt_id=attempt.id)
        await write_system_audit(
            session,
            "communication_provider_uncertain",
            entity_type="client_communication_outbox",
            entity_id=outbox.id,
            meta={"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "worker_id": worker_id, "manual_review_required": True},
        )
        return ProcessResult(status="provider_uncertain", outbox_id=outbox.id, error="provider outcome uncertain")

    _METRICS["outbox_dispatch_failure_total"] += 1
    final = result.outcome == "permanent_failure" or (outbox.attempt_count or 0) >= min(outbox.max_retries or settings.OUTBOX_MAX_ATTEMPTS, settings.OUTBOX_MAX_ATTEMPTS)
    outbox.last_error = (result.safe_error_message or "dispatch failed")[:1000]
    outbox.last_error_code = result.error_code
    outbox.locked_at = None
    outbox.locked_by = None
    if final:
        outbox.status = "dead"
        attempt.status = "failed"
        attempt.completed_at = now
        attempt.error_code = result.error_code
        attempt.error_message = result.safe_error_message
        event.status = "failed"
        await release_quota_reservation(session, outbox_id=outbox.id, attempt_id=attempt.id, reason=result.error_code or "pre_provider_failure")
        await upsert_legacy_sms_notification(session, event=event, attempt=attempt, status="failed", error=result.safe_error_message)
        await write_system_audit(
            session,
            "communication_dispatch_dead_lettered",
            entity_type="client_communication_outbox",
            entity_id=outbox.id,
            meta={"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "worker_id": worker_id, "error_code": result.error_code, "attempt_count": outbox.attempt_count},
        )
        return ProcessResult(status="dead", outbox_id=outbox.id, error=result.safe_error_message)

    delay = calculate_retry_delay_seconds(
        outbox.attempt_count or 1,
        retry_after_seconds=result.retry_after_seconds,
        jitter_fn=jitter_fn,
    )
    outbox.status = "pending"
    attempt.status = "queued"
    attempt.provider_call_started_at = None
    outbox.retry_count = (outbox.retry_count or 0) + 1
    if _is_postgres(session):
        await session.flush()
        await session.execute(
            text("UPDATE client_communication_outbox SET available_at = NOW() + (:delay * INTERVAL '1 second') WHERE id = :id"),
            {"delay": delay, "id": outbox.id},
        )
    else:
        await session.flush()
        await session.execute(
            text("UPDATE client_communication_outbox SET available_at = datetime(CURRENT_TIMESTAMP, '+' || :delay || ' seconds') WHERE id = :id"),
            {"delay": delay, "id": outbox.id},
        )
    _METRICS["outbox_retry_total"] += 1
    await write_system_audit(
        session,
        "communication_dispatch_retry_scheduled",
        entity_type="client_communication_outbox",
        entity_id=outbox.id,
        meta={"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "worker_id": worker_id, "error_code": result.error_code, "retry_delay_seconds": delay, "attempt_count": outbox.attempt_count},
    )
    return ProcessResult(status="retry_scheduled", outbox_id=outbox.id, error=result.safe_error_message)


async def process_claimed_outbox(
    claimed: ClaimedOutbox,
    *,
    worker_id: str,
    session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
    jitter_fn=None,
) -> ProcessResult:
    payload = parse_payload(claimed.payload_json)
    async with session_factory() as session:
        row = await _load_processing_owned(session, claimed.id, worker_id)
        if row is None:
            return ProcessResult(status="lock_lost", outbox_id=claimed.id, error="lock lost")
        outbox, attempt, event = row
        if outbox.status in TERMINAL_OUTBOX_STATUSES:
            return ProcessResult(status="terminal", outbox_id=outbox.id)
        if event.cancelled_at is not None or event.status == "cancelled":
            await recover_cancelled_outbox(session, worker_id)
            await session.commit()
            return ProcessResult(status="cancelled", outbox_id=outbox.id)
        if attempt.status in DISPATCH_BLOCKING_STATUSES or attempt.provider_reference or attempt.submitted_at:
            outbox.status = "published"
            outbox.published_at = await _db_now(session)
            outbox.locked_at = None
            outbox.locked_by = None
            await session.commit()
            return ProcessResult(status="already_submitted", outbox_id=outbox.id)
        payload.update({"outbox_id": outbox.id, "attempt_id": attempt.id, "event_id": event.id, "branch_id": event.branch_id, "purpose": payload.get("purpose") or event.purpose, "language": payload.get("language") or event.language, "provider": payload.get("provider") or attempt.provider})
        safety_decision = await evaluate_sms_dispatch_safety_async(payload, session=session)
        if not safety_decision.allowed:
            result = safety_decision.to_result(idempotency_key=claimed.idempotency_key)
            process_result = await persist_dispatch_result(session, outbox_id=claimed.id, worker_id=worker_id, result=result, jitter_fn=jitter_fn)
            await session.commit()
            return process_result
        now = await _db_now(session)
        outbox.status = "provider_call_started"
        outbox.provider_call_started_at = now
        outbox.sms_template_key = payload.get("template_key")
        outbox.sms_template_version = payload.get("template_version")
        attempt.status = "provider_call_started"
        attempt.provider_call_started_at = now
        attempt.sms_template_key = payload.get("template_key")
        attempt.sms_template_version = payload.get("template_version")
        event.sms_template_key = payload.get("template_key")
        event.sms_template_version = payload.get("template_version")
        await mark_provider_call_started(session, outbox_id=outbox.id, attempt_id=attempt.id)
        payload["sms_policy_approved"] = True
        await session.commit()

    provider = provider_for(payload)
    start = monotonic()
    try:
        result = await provider.dispatch(attempt=type("AttemptSnapshot", (), {"channel": "sms", "provider": payload.get("provider", "log"), "recipient": payload.get("recipient")})(), payload=payload, idempotency_key=claimed.idempotency_key)
    except Exception:
        logger.exception("provider outcome uncertain after provider boundary")
        result = DispatchResult("permanent_failure", error_code="provider_uncertain", safe_error_message="provider outcome uncertain; manual reconciliation required", idempotency_key_used=claimed.idempotency_key)
    elapsed = monotonic() - start
    _METRICS["outbox_dispatch_duration_seconds_sum"] += elapsed
    _METRICS["outbox_dispatch_duration_seconds_count"] += 1

    async with session_factory() as session:
        process_result = await persist_dispatch_result(session, outbox_id=claimed.id, worker_id=worker_id, result=result, jitter_fn=jitter_fn)
        await session.commit()
        process_result.provider_called = True
        return process_result


async def run_once(
    *,
    worker_id: str | None = None,
    session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
    batch_size: int | None = None,
    jitter_fn=None,
) -> list[ProcessResult]:
    worker_id = worker_id or build_worker_id()
    if settings.COMMUNICATION_DISPATCH_MODE != "postgres":
        logger.info("communication postgres worker skipped by dispatch mode", extra={"worker_id": worker_id, "dispatch_mode": settings.COMMUNICATION_DISPATCH_MODE})
        return []
    if not settings.COMMUNICATION_WORKER_ENABLED:
        async with session_factory() as session:
            await upsert_worker_heartbeat(session, worker_id=worker_id, worker_enabled=False, process_alive=True, successful_poll=False)
            await session.commit()
        logger.info("communication worker disabled", extra={"worker_id": worker_id})
        return []
    async with session_factory() as session:
        claimed = await claim_outbox_batch(session, worker_id=worker_id, batch_size=batch_size)
        await session.commit()
    results = []
    for item in claimed:
        results.append(await process_claimed_outbox(item, worker_id=worker_id, session_factory=session_factory, jitter_fn=jitter_fn))
    return results


async def broker_published_unprocessed(session: AsyncSession, *, threshold_seconds: int | None = None, limit: int = 50, branch_id: int | None = None) -> list[dict]:
    """Read-only sanitized visibility for broker-published rows with no provider outcome.

    RabbitMQ observability is deployment-specific; this DB-side check reports
    sanitized operational IDs only and never republishes/mutates financial or
    communication data.
    """
    threshold_seconds = threshold_seconds or settings.BROKER_PUBLISHED_UNPROCESSED_THRESHOLD_SECONDS
    limit = max(1, min(int(limit or 50), 100))
    branch_filter = "AND e.branch_id = :branch_id" if branch_id is not None else ""
    params = {"threshold_seconds": threshold_seconds, "limit": limit, "branch_id": branch_id}
    if _is_postgres(session):
        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT o.id AS outbox_id, o.broker_published_at, o.attempt_count,
                           a.status AS attempt_status, e.status AS event_status, e.branch_id AS branch_id
                    FROM client_communication_outbox o
                    JOIN client_communication_attempts a ON a.id = o.attempt_id
                    JOIN client_communication_events e ON e.id = o.event_id
                    WHERE o.status = 'broker_published'
                      AND o.broker_published_at <= (NOW() - (:threshold_seconds * INTERVAL '1 second'))
                      AND a.status NOT IN ('submitted', 'provider_accepted', 'delivered', 'confirmed', 'disputed', 'cancelled', 'failed')
                      AND a.provider_reference IS NULL
                      AND a.submitted_at IS NULL
                      {branch_filter}
                    ORDER BY o.broker_published_at, o.id
                    LIMIT :limit
                    """
                ),
                params,
            )
        ).mappings().all()
    else:
        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT o.id AS outbox_id, o.broker_published_at, o.attempt_count,
                           a.status AS attempt_status, e.status AS event_status, e.branch_id AS branch_id
                    FROM client_communication_outbox o
                    JOIN client_communication_attempts a ON a.id = o.attempt_id
                    JOIN client_communication_events e ON e.id = o.event_id
                    WHERE o.status = 'broker_published'
                      AND o.broker_published_at <= datetime(CURRENT_TIMESTAMP, '-' || :threshold_seconds || ' seconds')
                      AND a.status NOT IN ('submitted', 'provider_accepted', 'delivered', 'confirmed', 'disputed', 'cancelled', 'failed')
                      AND a.provider_reference IS NULL
                      AND a.submitted_at IS NULL
                      {branch_filter}
                    ORDER BY o.broker_published_at, o.id
                    LIMIT :limit
                    """
                ),
                params,
            )
        ).mappings().all()
    return [dict(row) for row in rows]


async def broker_published_unprocessed_summary(session: AsyncSession, *, threshold_seconds: int | None = None, limit: int = 50, branch_id: int | None = None) -> dict:
    rows = await broker_published_unprocessed(session, threshold_seconds=threshold_seconds, limit=limit, branch_id=branch_id)
    oldest = min((row.get("broker_published_at") for row in rows if row.get("broker_published_at")), default=None)
    return {
        "count": len(rows),
        "oldest_broker_published_at": str(oldest) if oldest else None,
        "threshold_seconds": threshold_seconds or settings.BROKER_PUBLISHED_UNPROCESSED_THRESHOLD_SECONDS,
        "limit": max(1, min(int(limit or 50), 100)),
        "branch_id": branch_id,
        "items": [
            {
                "outbox_id": row.get("outbox_id"),
                "branch_id": row.get("branch_id"),
                "broker_published_at": str(row.get("broker_published_at")) if row.get("broker_published_at") else None,
                "attempt_count": row.get("attempt_count"),
                "attempt_status": row.get("attempt_status"),
                "event_status": row.get("event_status"),
            }
            for row in rows
        ],
    }


async def queue_health(session: AsyncSession) -> dict:
    db_reachable = True
    now = await _db_now(session)
    counts = {}
    for status in ["pending", "processing", "retryable", "broker_published", "dead"]:
        counts[status] = (
            await session.execute(select(func.count()).select_from(ClientCommunicationOutbox).where(ClientCommunicationOutbox.status == status))
        ).scalar_one()
    oldest = (
        await session.execute(
            select(func.min(ClientCommunicationOutbox.available_at)).where(ClientCommunicationOutbox.status.in_(["pending", "retryable"])))
    ).scalar_one_or_none()
    heartbeats = (await session.execute(select(ClientCommunicationWorkerHeartbeat))).scalars().all()
    last_poll = max((h.last_successful_poll for h in heartbeats if h.last_successful_poll), default=None)
    last_dispatch = max((h.last_successful_dispatch for h in heartbeats if h.last_successful_dispatch), default=None)

    def age_seconds(dt):
        if not dt:
            return None
        if isinstance(now, str):
            return None
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        ref = now.replace(tzinfo=None) if isinstance(now, datetime) else datetime.now(timezone.utc).replace(tzinfo=None)
        return max(0, int((ref - dt).total_seconds()))

    pending_age = age_seconds(oldest)
    stranded = await broker_published_unprocessed(session)
    _METRICS["fieldos_communication_broker_published_unprocessed"] = len(stranded)
    if stranded:
        logger.warning("broker_published_unprocessed", extra={"count": len(stranded), "outbox_ids": [row["outbox_id"] for row in stranded[:20]]})
    return {
        "process_alive": any(h.process_alive for h in heartbeats),
        "worker_enabled": settings.COMMUNICATION_WORKER_ENABLED,
        "dispatch_mode": settings.COMMUNICATION_DISPATCH_MODE,
        "database_reachable": db_reachable,
        "worker_recently_polled": age_seconds(last_poll) is not None and age_seconds(last_poll) <= max(60, settings.OUTBOX_POLL_INTERVAL_SECONDS * 5),
        "worker_recently_dispatched_successfully": age_seconds(last_dispatch) is not None and age_seconds(last_dispatch) <= 3600,
        "backlog_degraded": bool(counts["pending"] and pending_age is not None and pending_age > 300),
        "dead_letter_backlog_present": counts["dead"] > 0,
        "last_successful_poll": str(last_poll) if last_poll else None,
        "last_successful_dispatch": str(last_dispatch) if last_dispatch else None,
        "pending_count": counts["pending"],
        "processing_count": counts["processing"],
        "retryable_count": counts["retryable"],
        "broker_published_count": counts["broker_published"],
        "dead_count": counts["dead"],
        "oldest_pending_age_seconds": pending_age,
        "broker_published_unprocessed_count": len(stranded),
    }


async def prometheus_metrics(session: AsyncSession) -> str:
    health = await queue_health(session)
    lines = [
        f"outbox_pending_total {health['pending_count']}",
        f"outbox_processing_total {health['processing_count']}",
        f"outbox_broker_published_total {health['broker_published_count']}",
        f"outbox_dead_total {health['dead_count']}",
        f"outbox_dispatch_success_total {_METRICS['outbox_dispatch_success_total']}",
        f"outbox_dispatch_failure_total {_METRICS['outbox_dispatch_failure_total']}",
        f"outbox_retry_total {_METRICS['outbox_retry_total']}",
        f"outbox_oldest_pending_seconds {health['oldest_pending_age_seconds'] or 0}",
        f"outbox_dispatch_duration_seconds_sum {_METRICS['outbox_dispatch_duration_seconds_sum']}",
        f"outbox_dispatch_duration_seconds_count {_METRICS['outbox_dispatch_duration_seconds_count']}",
        f"# HELP fieldos_communication_broker_published_unprocessed Broker-published communication outbox rows older than {settings.BROKER_PUBLISHED_UNPROCESSED_THRESHOLD_SECONDS} seconds with no provider outcome.",
        "# TYPE fieldos_communication_broker_published_unprocessed gauge",
        f"fieldos_communication_broker_published_unprocessed {_METRICS['fieldos_communication_broker_published_unprocessed']}",
        "# HELP fieldos_sms_dispatch_safety_block_total SMS dispatches blocked by fail-closed safety decision.",
        "# TYPE fieldos_sms_dispatch_safety_block_total counter",
    ]
    for decision_code, count in sorted(sms_safety_metrics_snapshot().items()):
        if decision_code.startswith("blocked_"):
            lines.append(f'fieldos_sms_dispatch_safety_block_total{{decision="{decision_code}"}} {count}')
    for name, count in sorted(sms_policy_metrics_snapshot().items()):
        lines.append(f"{name} {count}")
    return "\n".join(lines) + "\n"
