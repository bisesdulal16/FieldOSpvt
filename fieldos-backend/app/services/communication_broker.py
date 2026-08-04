from __future__ import annotations

import asyncio
import json
import logging
import signal
import uuid
from dataclasses import dataclass
from enum import Enum
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox
from app.services.communication_outbox_service import (
    DISPATCH_BLOCKING_STATUSES,
    TERMINAL_OUTBOX_STATUSES,
    ProcessResult,
    _db_now,
    calculate_retry_delay_seconds,
    claim_outbox_batch,
    persist_dispatch_result,
)
from app.services.communication_providers import DispatchResult, provider_for
from app.services.sms_dispatch_safety import evaluate_sms_dispatch_safety, evaluate_sms_dispatch_safety_async
from app.services.audit_helper import write_audit

logger = logging.getLogger(__name__)

ACTIVE_ROUTING_KEYS = {"sms": "communication.sms", "reminder": "communication.reminder"}
DECLARED_ROUTING_KEYS = {
    "sms": "communication.sms",
    "ivr": "communication.ivr",
    "escalation": "communication.escalation",
    "reminder": "communication.reminder",
}
RETRY_HEADER = "x-fieldos-consumer-retry-count"
ORIGINAL_ROUTING_HEADER = "x-fieldos-original-routing-key"
RETRY_REASON_HEADER = "x-fieldos-retry-reason"
FINAL_OUTBOX_STATUSES = {"published", "dead", "cancelled", "skipped"}
DISPATCHABLE_BROKER_OUTBOX_STATUSES = {"broker_published"}
TEMPORARY_BROKER_OUTBOX_STATUSES = {"pending", "processing", "retryable"}
FINAL_EVENT_STATUSES = {"cancelled", "confirmed", "disputed", "failed"}


class ConsumerOutcome(str, Enum):
    PROVIDER_SUBMITTED = "provider_submitted"
    PROVIDER_RETRY_SCHEDULED = "provider_retry_scheduled"
    FINAL_STATE_DUPLICATE = "final_state_duplicate"
    RETRYABLE_CONFLICT = "retryable_conflict"
    MALFORMED_ENVELOPE = "malformed_envelope"
    PERMANENT_INVALID = "permanent_invalid"
    NOT_FOUND = "not_found"
    IDEMPOTENCY_MISMATCH = "idempotency_mismatch"
    UNEXPECTED_STATE = "unexpected_state"


class BrokerAction(str, Enum):
    ACK = "ack"
    DELAYED_RETRY = "delayed_retry"
    REJECT_DLQ = "reject_dlq"


@dataclass(slots=True)
class ConsumerProcessResult:
    outcome: ConsumerOutcome
    broker_action: BrokerAction
    outbox_id: int | None = None
    provider_called: bool = False
    committed: bool = False
    reason_code: str | None = None
    error: str | None = None

    @property
    def status(self) -> str:
        return self.reason_code or self.outcome.value


def _consumer_result(
    outcome: ConsumerOutcome,
    broker_action: BrokerAction,
    *,
    outbox_id: int | None = None,
    provider_called: bool = False,
    committed: bool = False,
    reason_code: str | None = None,
    error: str | None = None,
) -> ConsumerProcessResult:
    return ConsumerProcessResult(
        outcome=outcome,
        broker_action=broker_action,
        outbox_id=outbox_id,
        provider_called=provider_called,
        committed=committed,
        reason_code=reason_code or outcome.value,
        error=error,
    )


def _map_dispatch_persist_result(result: ProcessResult) -> ConsumerProcessResult:
    if result.status == "published":
        return _consumer_result(ConsumerOutcome.PROVIDER_SUBMITTED, BrokerAction.ACK, outbox_id=result.outbox_id, provider_called=True, committed=True, reason_code=result.status)
    if result.status == "already_submitted":
        return _consumer_result(ConsumerOutcome.FINAL_STATE_DUPLICATE, BrokerAction.ACK, outbox_id=result.outbox_id, provider_called=result.provider_called, committed=True, reason_code=result.status)
    if result.status == "retry_scheduled":
        return _consumer_result(ConsumerOutcome.PROVIDER_RETRY_SCHEDULED, BrokerAction.ACK, outbox_id=result.outbox_id, provider_called=True, committed=True, reason_code=result.status, error=result.error)
    if result.status == "dead":
        return _consumer_result(ConsumerOutcome.PERMANENT_INVALID, BrokerAction.REJECT_DLQ, outbox_id=result.outbox_id, provider_called=result.provider_called, committed=True, reason_code=result.status, error=result.error)
    if result.status == "lock_lost":
        return _consumer_result(ConsumerOutcome.RETRYABLE_CONFLICT, BrokerAction.DELAYED_RETRY, outbox_id=result.outbox_id, provider_called=result.provider_called, committed=False, reason_code=result.status, error=result.error)
    return _consumer_result(ConsumerOutcome.UNEXPECTED_STATE, BrokerAction.DELAYED_RETRY, outbox_id=result.outbox_id, provider_called=result.provider_called, committed=False, reason_code=result.status, error=result.error)


@dataclass(slots=True)
class BrokerPublishResult:
    status: str
    outbox_id: int | None = None
    message_id: str | None = None
    error: str | None = None


def routing_key_for(outbox: ClientCommunicationOutbox, payload: dict[str, Any]) -> str:
    channel = str(payload.get("channel") or "sms")
    # Delivery work routes by channel. Existing reminder scheduler creates SMS
    # outbox rows, so payment reminders go only to the SMS delivery consumer.
    # The reminder route is reserved for non-delivery reminder orchestration.
    if channel == "sms":
        return ACTIVE_ROUTING_KEYS["sms"]
    if channel == "reminder":
        return ACTIVE_ROUTING_KEYS["reminder"]
    return DECLARED_ROUTING_KEYS.get(channel, f"communication.{channel}")


def queue_key_for_routing_key(routing_key: str) -> str:
    for queue_key, declared_routing_key in DECLARED_ROUTING_KEYS.items():
        if routing_key == declared_routing_key:
            return queue_key
    if routing_key.startswith("communication."):
        return routing_key.split(".", 1)[1]
    return "sms"


def retry_routing_key_for(routing_key: str) -> str:
    return f"{routing_key}.retry"


def dead_routing_key_for(routing_key: str) -> str:
    return f"{routing_key}.dead"


def build_message_envelope(outbox: ClientCommunicationOutbox, payload: dict[str, Any], *, message_id: str | None = None) -> dict[str, Any]:
    channel = str(payload.get("channel") or "sms")
    purpose = str(payload.get("purpose") or "collection_verification")
    event_id = int(payload.get("event_id") or outbox.event_id)
    attempt_id = int(payload.get("attempt_id") or outbox.attempt_id or 0)
    return {
        "schema_version": 1,
        "message_id": message_id or str(uuid.uuid4()),
        "idempotency_key": outbox.idempotency_key,
        "outbox_id": outbox.id,
        "event_id": event_id,
        "attempt_id": attempt_id,
        "channel": channel,
        "purpose": purpose,
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "trace_id": str(payload.get("trace_id") or f"fieldos-outbox-{outbox.id}"),
    }


def validate_envelope(envelope: dict[str, Any]) -> dict[str, Any]:
    required = ["schema_version", "message_id", "idempotency_key", "outbox_id", "event_id", "attempt_id", "channel", "purpose", "created_at", "trace_id"]
    if not isinstance(envelope, dict):
        raise ValueError("message envelope must be an object")
    missing = [key for key in required if envelope.get(key) in (None, "")]
    if missing:
        raise ValueError(f"missing envelope fields: {','.join(missing)}")
    if envelope["schema_version"] != 1:
        raise ValueError("unsupported schema version")
    if envelope["channel"] not in {"sms", "reminder", "ivr", "escalation"}:
        raise ValueError("unsupported channel")
    for key in ("recipient", "phone", "message", "provider_token", "amount", "financial_payload"):
        if key in envelope:
            raise ValueError("PII or financial payload is not allowed in broker envelope")
    return envelope


class RabbitMQClient:
    def __init__(self, url: str | None = None):
        self.url = url or settings.RABBITMQ_URL
        self.connection = None
        self.channel = None
        self.exchange = None
        self.dlx = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *_args):
        await self.close()

    async def connect(self):
        if not self.url:
            raise RuntimeError("RABBITMQ_URL is required when RabbitMQ is enabled")
        import aio_pika
        self.connection = await aio_pika.connect_robust(self.url)
        self.channel = await self.connection.channel(publisher_confirms=True)
        await self.channel.set_qos(prefetch_count=settings.RABBITMQ_PREFETCH)
        self.exchange = await self.channel.declare_exchange(settings.RABBITMQ_EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
        self.dlx = await self.channel.declare_exchange(f"{settings.RABBITMQ_EXCHANGE}.dlx", aio_pika.ExchangeType.TOPIC, durable=True)
        for purpose, routing_key in DECLARED_ROUTING_KEYS.items():
            queue_name = f"fieldos.communication.{purpose}"
            queue = await self.channel.declare_queue(
                queue_name,
                durable=True,
                arguments={"x-dead-letter-exchange": f"{settings.RABBITMQ_EXCHANGE}.dlx", "x-dead-letter-routing-key": dead_routing_key_for(routing_key)},
            )
            await queue.bind(self.exchange, routing_key)
            retry = await self.channel.declare_queue(
                f"{queue_name}.retry",
                durable=True,
                arguments={
                    "x-message-ttl": int(settings.COMMUNICATION_CONSUMER_RETRY_DELAY_MS),
                    "x-dead-letter-exchange": settings.RABBITMQ_EXCHANGE,
                    "x-dead-letter-routing-key": routing_key,
                },
            )
            await retry.bind(self.exchange, retry_routing_key_for(routing_key))
            dead = await self.channel.declare_queue(f"{queue_name}.dead", durable=True)
            await dead.bind(self.dlx, dead_routing_key_for(routing_key))
        return self

    async def publish(self, envelope: dict[str, Any], routing_key: str) -> str:
        import aio_pika
        body = json.dumps(validate_envelope(envelope), separators=(",", ":")).encode("utf-8")
        msg = aio_pika.Message(
            body=body,
            message_id=envelope["message_id"],
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            content_type="application/json",
            headers={"schema_version": 1, "idempotency_key": envelope["idempotency_key"]},
        )
        await asyncio.wait_for(self.exchange.publish(msg, routing_key=routing_key, mandatory=True), timeout=settings.RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_SECONDS)
        return envelope["message_id"]

    async def publish_retry(self, envelope: dict[str, Any], *, routing_key: str, retry_count: int, reason_code: str | None = None) -> None:
        import aio_pika
        safe_headers = {
            "schema_version": 1,
            RETRY_HEADER: int(retry_count),
            ORIGINAL_ROUTING_HEADER: routing_key,
        }
        if reason_code:
            safe_headers[RETRY_REASON_HEADER] = str(reason_code)[:120]
        msg = aio_pika.Message(
            body=json.dumps(validate_envelope(envelope), separators=(",", ":")).encode("utf-8"),
            message_id=envelope["message_id"],
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            content_type="application/json",
            headers=safe_headers,
            expiration=int(settings.COMMUNICATION_CONSUMER_RETRY_DELAY_MS),
        )
        await asyncio.wait_for(self.exchange.publish(msg, routing_key=retry_routing_key_for(routing_key), mandatory=True), timeout=settings.RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_SECONDS)

    async def publish_dead_letter(self, envelope: dict[str, Any], *, routing_key: str, retry_count: int, reason_code: str | None = None) -> None:
        import aio_pika
        safe_headers = {
            "schema_version": 1,
            RETRY_HEADER: int(retry_count),
            ORIGINAL_ROUTING_HEADER: routing_key,
        }
        if reason_code:
            safe_headers[RETRY_REASON_HEADER] = str(reason_code)[:120]
        msg = aio_pika.Message(
            body=json.dumps(validate_envelope(envelope), separators=(",", ":")).encode("utf-8"),
            message_id=envelope["message_id"],
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            content_type="application/json",
            headers=safe_headers,
        )
        await asyncio.wait_for(self.dlx.publish(msg, routing_key=dead_routing_key_for(routing_key), mandatory=True), timeout=settings.RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_SECONDS)

    async def close(self):
        if self.connection:
            await self.connection.close()


async def mark_broker_published(session: AsyncSession, *, outbox_id: int, worker_id: str, broker_message_id: str) -> BrokerPublishResult:
    outbox = await session.get(ClientCommunicationOutbox, outbox_id)
    if outbox is None or outbox.locked_by != worker_id or outbox.status != "processing":
        return BrokerPublishResult("lock_lost", outbox_id=outbox_id, error="lock lost")
    now = await _db_now(session)
    outbox.status = "broker_published"
    outbox.broker_message_id = broker_message_id
    outbox.broker_published_at = now
    outbox.locked_at = None
    outbox.locked_by = None
    outbox.last_error = None
    outbox.last_error_code = None
    await write_audit(session, None, "communication_broker_published", entity_type="client_communication_outbox", entity_id=outbox.id, meta={"outbox_id": outbox.id, "event_id": outbox.event_id, "attempt_id": outbox.attempt_id, "broker_message_id": broker_message_id, "worker_id": worker_id})
    return BrokerPublishResult("broker_published", outbox_id=outbox.id, message_id=broker_message_id)


async def mark_broker_failure(session: AsyncSession, *, outbox_id: int, worker_id: str, error: str) -> BrokerPublishResult:
    outbox = await session.get(ClientCommunicationOutbox, outbox_id)
    if outbox is None or outbox.locked_by != worker_id:
        return BrokerPublishResult("lock_lost", outbox_id=outbox_id, error="lock lost")
    now = await _db_now(session)
    outbox.locked_at = None
    outbox.locked_by = None
    outbox.last_error = str(error)[:1000]
    outbox.last_error_code = "broker_publish_failed"
    # RabbitMQ publication attempts are broker retries, not SMS provider attempts.
    # Keep them separate from outbox.attempt_count, which counts provider invocations.
    broker_retry_count = (outbox.broker_retry_count or 0) + 1
    outbox.broker_retry_count = broker_retry_count
    final = broker_retry_count >= min(outbox.max_retries or settings.RABBITMQ_MAX_RETRIES, settings.RABBITMQ_MAX_RETRIES)
    if final:
        outbox.status = "dead"
    else:
        outbox.status = "pending"
        delay = calculate_retry_delay_seconds(broker_retry_count)
        # SQLite-compatible enough for tests; Postgres publisher normally uses DB now before claim.
        from datetime import timedelta
        outbox.available_at = now + timedelta(seconds=delay)
    await write_audit(session, None, "communication_broker_publish_failed", entity_type="client_communication_outbox", entity_id=outbox.id, meta={"outbox_id": outbox.id, "event_id": outbox.event_id, "attempt_id": outbox.attempt_id, "worker_id": worker_id, "final": final, "broker_retry_count": broker_retry_count})
    return BrokerPublishResult("dead" if final else "retry_scheduled", outbox_id=outbox.id, error=str(error)[:500])


async def publish_once(*, worker_id: str, broker=None, session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal, batch_size: int | None = None) -> list[BrokerPublishResult]:
    if not settings.RABBITMQ_ENABLED or settings.COMMUNICATION_DISPATCH_MODE != "rabbitmq":
        return []
    owns_broker = broker is None
    broker = broker or RabbitMQClient()
    if owns_broker:
        await broker.connect()
    async with session_factory() as session:
        claimed = await claim_outbox_batch(session, worker_id=worker_id, batch_size=batch_size, increment_provider_attempt_count=False)
        await session.commit()
    results: list[BrokerPublishResult] = []
    try:
        for item in claimed:
            async with session_factory() as session:
                outbox = await session.get(ClientCommunicationOutbox, item.id)
                if not outbox:
                    continue
                payload = json.loads(outbox.payload_json or "{}")
                envelope = build_message_envelope(outbox, payload)
                routing_key = routing_key_for(outbox, payload)
            try:
                broker_message_id = await broker.publish(envelope, routing_key)
                async with session_factory() as session:
                    result = await mark_broker_published(session, outbox_id=item.id, worker_id=worker_id, broker_message_id=broker_message_id)
                    await session.commit()
                    results.append(result)
            except Exception as exc:
                async with session_factory() as session:
                    result = await mark_broker_failure(session, outbox_id=item.id, worker_id=worker_id, error=str(exc))
                    await session.commit()
                    results.append(result)
    finally:
        if owns_broker:
            await broker.close()
    return results


async def process_envelope(envelope: dict[str, Any], *, worker_id: str, session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal) -> ConsumerProcessResult:
    envelope = validate_envelope(envelope)
    outbox_id = int(envelope["outbox_id"])
    async with session_factory() as session:
        row = (
            await session.execute(
                select(ClientCommunicationOutbox, ClientCommunicationAttempt, ClientCommunicationEvent)
                .join(ClientCommunicationAttempt, ClientCommunicationAttempt.id == ClientCommunicationOutbox.attempt_id)
                .join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationOutbox.event_id)
                .where(ClientCommunicationOutbox.id == outbox_id)
                .with_for_update()
            )
        ).first()
        if row is None:
            await session.commit()
            return _consumer_result(ConsumerOutcome.NOT_FOUND, BrokerAction.DELAYED_RETRY, outbox_id=outbox_id, committed=True, reason_code="missing_authoritative_row", error="authoritative outbox row not found")
        outbox, attempt, event = row
        if outbox.idempotency_key != envelope["idempotency_key"] or attempt.id != int(envelope["attempt_id"]) or event.id != int(envelope["event_id"]):
            await session.commit()
            return _consumer_result(ConsumerOutcome.IDEMPOTENCY_MISMATCH, BrokerAction.REJECT_DLQ, outbox_id=outbox_id, committed=True, reason_code="idempotency_mismatch", error="broker envelope does not match authoritative row")
        if outbox.status == "published" or attempt.status in DISPATCH_BLOCKING_STATUSES or attempt.provider_reference or attempt.submitted_at:
            await session.commit()
            return _consumer_result(ConsumerOutcome.FINAL_STATE_DUPLICATE, BrokerAction.ACK, outbox_id=outbox_id, committed=True, reason_code="already_submitted")
        if outbox.status in TERMINAL_OUTBOX_STATUSES or event.status in FINAL_EVENT_STATUSES:
            await session.commit()
            return _consumer_result(ConsumerOutcome.FINAL_STATE_DUPLICATE, BrokerAction.ACK, outbox_id=outbox_id, committed=True, reason_code="final_state_duplicate")
        if outbox.status in TEMPORARY_BROKER_OUTBOX_STATUSES:
            # Publisher/consumer race window: RabbitMQ delivery can occur while
            # PostgreSQL still shows publisher-owned processing/pending state.
            # Requeue so the message is redelivered after broker_published commits.
            await session.commit()
            return _consumer_result(ConsumerOutcome.RETRYABLE_CONFLICT, BrokerAction.DELAYED_RETRY, outbox_id=outbox_id, committed=True, reason_code=f"state_conflict:{outbox.status}")
        if outbox.status not in DISPATCHABLE_BROKER_OUTBOX_STATUSES:
            await session.commit()
            return _consumer_result(ConsumerOutcome.UNEXPECTED_STATE, BrokerAction.DELAYED_RETRY, outbox_id=outbox_id, committed=True, reason_code=f"unexpected_state:{outbox.status}")
        if event.status != "queued" or attempt.status != "queued":
            await session.commit()
            return _consumer_result(ConsumerOutcome.UNEXPECTED_STATE, BrokerAction.DELAYED_RETRY, outbox_id=outbox_id, committed=True, reason_code=f"unexpected_state:event={event.status}:attempt={attempt.status}")
        outbox.status = "processing"
        outbox.locked_by = worker_id
        outbox.locked_at = await _db_now(session)
        # This is the provider-attempt boundary: provider counters change only
        # when the consumer is about to invoke the provider abstraction.
        outbox.attempt_count = (outbox.attempt_count or 0) + 1
        outbox.last_attempted_at = outbox.locked_at
        await session.commit()

    async with session_factory() as session:
        row = (
            await session.execute(
                select(ClientCommunicationAttempt, ClientCommunicationEvent)
                .join(ClientCommunicationEvent, ClientCommunicationEvent.id == ClientCommunicationAttempt.event_id)
                .where(ClientCommunicationAttempt.id == int(envelope["attempt_id"]))
            )
        ).first()
        if row:
            attempt, event = row
            payload = json.loads(attempt.metadata_json or "{}")
            payload.setdefault("recipient", attempt.recipient)
            payload.update({"outbox_id": outbox_id, "event_id": event.id, "attempt_id": attempt.id, "branch_id": event.branch_id, "channel": envelope["channel"], "purpose": envelope["purpose"], "language": event.language, "provider": attempt.provider})
        else:
            attempt = None
            payload = {}
        safety_decision = await evaluate_sms_dispatch_safety_async(payload, session=session)
        if not safety_decision.allowed:
            result = safety_decision.to_result(idempotency_key=envelope["idempotency_key"])
            process_result = await persist_dispatch_result(session, outbox_id=outbox_id, worker_id=worker_id, result=result)
            await session.commit()
            return _map_dispatch_persist_result(process_result)
        payload["sms_policy_approved"] = True
        await session.commit()

    provider = provider_for(payload)
    try:
        result = await provider.dispatch(attempt=attempt, payload=payload, idempotency_key=envelope["idempotency_key"])
    except Exception:
        logger.exception("broker consumer provider outcome uncertain after provider boundary")
        result = DispatchResult("permanent_failure", error_code="provider_uncertain", safe_error_message="provider outcome uncertain; manual reconciliation required", idempotency_key_used=envelope["idempotency_key"])
    async with session_factory() as session:
        process_result = await persist_dispatch_result(session, outbox_id=outbox_id, worker_id=worker_id, result=result)
        await session.commit()
        process_result.provider_called = True
        return _map_dispatch_persist_result(process_result)


async def broker_health() -> dict[str, Any]:
    health = {"rabbitmq_enabled": settings.RABBITMQ_ENABLED, "rabbitmq_reachable": False, "redis_enabled": settings.REDIS_ENABLED, "redis_reachable": False, "redis_replay_store_mode": settings.N8N_REPLAY_STORE}
    if settings.RABBITMQ_ENABLED and settings.RABBITMQ_URL:
        try:
            client = RabbitMQClient()
            await client.connect()
            await client.close()
            health["rabbitmq_reachable"] = True
        except Exception:
            health["rabbitmq_reachable"] = False
    if settings.REDIS_ENABLED and settings.REDIS_URL:
        try:
            from redis.asyncio import Redis
            redis = Redis.from_url(settings.REDIS_URL)
            await redis.ping()
            await redis.aclose()
            health["redis_reachable"] = True
        except Exception:
            health["redis_reachable"] = False
    return health
