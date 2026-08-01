from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
from contextlib import suppress
from typing import Any

from app.config import settings
from app.services.communication_broker import (
    BrokerAction,
    ConsumerOutcome,
    RabbitMQClient,
    ORIGINAL_ROUTING_HEADER,
    RETRY_HEADER,
    process_envelope,
    routing_key_for,
    validate_envelope,
)
from app.services.communication_outbox_service import build_worker_id

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

_CONSUMER_METRICS = {
    "provider_submitted": 0,
    "provider_retry_scheduled": 0,
    "final_duplicate": 0,
    "retryable_conflict": 0,
    "malformed_dlq": 0,
    "idempotency_mismatch": 0,
    "unexpected_state": 0,
    "permanent_invalid": 0,
    "not_found": 0,
    "ack": 0,
    "delayed_retry": 0,
    "reject_dlq": 0,
}

OUTCOME_BROKER_ACTIONS = {
    ConsumerOutcome.PROVIDER_SUBMITTED: BrokerAction.ACK,
    ConsumerOutcome.PROVIDER_RETRY_SCHEDULED: BrokerAction.ACK,
    ConsumerOutcome.FINAL_STATE_DUPLICATE: BrokerAction.ACK,
    ConsumerOutcome.RETRYABLE_CONFLICT: BrokerAction.DELAYED_RETRY,
    ConsumerOutcome.MALFORMED_ENVELOPE: BrokerAction.REJECT_DLQ,
    ConsumerOutcome.PERMANENT_INVALID: BrokerAction.REJECT_DLQ,
    ConsumerOutcome.NOT_FOUND: BrokerAction.DELAYED_RETRY,
    ConsumerOutcome.IDEMPOTENCY_MISMATCH: BrokerAction.REJECT_DLQ,
    ConsumerOutcome.UNEXPECTED_STATE: BrokerAction.DELAYED_RETRY,
}


def broker_action_for_outcome(outcome: ConsumerOutcome) -> BrokerAction:
    try:
        return OUTCOME_BROKER_ACTIONS[outcome]
    except KeyError as exc:
        raise ValueError(f"unmapped consumer outcome: {outcome!r}") from exc


def consumer_metrics_snapshot() -> dict[str, int]:
    return dict(_CONSUMER_METRICS)


def _record_result_metric(result) -> None:
    outcome = getattr(result, "outcome", None)
    if outcome == ConsumerOutcome.PROVIDER_SUBMITTED:
        _CONSUMER_METRICS["provider_submitted"] += 1
    elif outcome == ConsumerOutcome.PROVIDER_RETRY_SCHEDULED:
        _CONSUMER_METRICS["provider_retry_scheduled"] += 1
    elif outcome == ConsumerOutcome.FINAL_STATE_DUPLICATE:
        _CONSUMER_METRICS["final_duplicate"] += 1
    elif outcome == ConsumerOutcome.RETRYABLE_CONFLICT:
        _CONSUMER_METRICS["retryable_conflict"] += 1
    elif outcome == ConsumerOutcome.IDEMPOTENCY_MISMATCH:
        _CONSUMER_METRICS["idempotency_mismatch"] += 1
    elif outcome == ConsumerOutcome.UNEXPECTED_STATE:
        _CONSUMER_METRICS["unexpected_state"] += 1
    elif outcome == ConsumerOutcome.PERMANENT_INVALID:
        _CONSUMER_METRICS["permanent_invalid"] += 1
    elif outcome == ConsumerOutcome.NOT_FOUND:
        _CONSUMER_METRICS["not_found"] += 1


class _StopSignal:
    def __init__(self):
        self._event: asyncio.Event | None = None

    def _current(self) -> asyncio.Event:
        loop = asyncio.get_running_loop()
        if self._event is None or getattr(self._event, "_loop", None) not in (None, loop):
            self._event = asyncio.Event()
        return self._event

    def set(self) -> None:
        self._current().set()

    def clear(self) -> None:
        self._current().clear()

    def is_set(self) -> bool:
        return self._current().is_set()

    async def wait(self) -> None:
        await self._current().wait()


_stop = _StopSignal()

QUEUE_NAMES = {
    "sms": "fieldos.communication.sms",
    "reminder": "fieldos.communication.reminder",
    "ivr": "fieldos.communication.ivr",
    "escalation": "fieldos.communication.escalation",
}
SHUTDOWN_TIMEOUT_SECONDS = 30


def _effective_prefetch() -> int:
    """RabbitMQ prefetch=0 means unlimited; keep consumer callback concurrency bounded."""
    return max(1, int(settings.RABBITMQ_PREFETCH or 1))


def _request_stop(*_args):
    _stop.set()


def consumer_tag_for(worker_id: str, queue_key: str) -> str:
    safe_worker_id = "".join(ch if ch.isalnum() or ch in {"-", "_", ":", "."} else "-" for ch in worker_id)[:120]
    return f"fieldos-{queue_key}-consumer:{safe_worker_id}"


def _headers(message: Any) -> dict:
    return dict(getattr(message, "headers", None) or {})


def _retry_count(message: Any) -> int:
    raw = _headers(message).get(RETRY_HEADER, 0)
    try:
        return max(0, int(raw or 0))
    except (TypeError, ValueError):
        return 0


def _routing_key(message: Any, envelope: dict[str, Any]) -> str:
    headers = _headers(message)
    if headers.get(ORIGINAL_ROUTING_HEADER):
        return str(headers[ORIGINAL_ROUTING_HEADER])
    routing_key = getattr(message, "routing_key", None)
    if routing_key:
        return str(routing_key).removesuffix(".retry")
    return routing_key_for(None, {"channel": envelope.get("channel", "sms")})  # type: ignore[arg-type]


async def _publish_retry_or_dlq(message: Any, envelope: dict[str, Any], result: Any) -> str:
    retry_count = _retry_count(message)
    routing_key = _routing_key(message, envelope)
    next_retry_count = retry_count + 1
    reason_code = str(getattr(result, "reason_code", "retryable") or "retryable")[:120]
    async with RabbitMQClient() as broker:
        if next_retry_count >= int(settings.COMMUNICATION_CONSUMER_MAX_RETRIES):
            await broker.publish_dead_letter(envelope, routing_key=routing_key, retry_count=next_retry_count, reason_code=reason_code)
            await message.ack()
            _CONSUMER_METRICS["reject_dlq"] += 1
            logger.warning(
                "communication_consumer_retry_exhausted",
                extra={"worker_id": "broker", "outbox_id": envelope.get("outbox_id"), "retry_count": next_retry_count, "reason_code": reason_code},
            )
            return BrokerAction.REJECT_DLQ.value
        await broker.publish_retry(envelope, routing_key=routing_key, retry_count=next_retry_count, reason_code=reason_code)
        await message.ack()
        _CONSUMER_METRICS["delayed_retry"] += 1
        return BrokerAction.DELAYED_RETRY.value


async def _handle_message(message: Any, *, worker_id: str) -> None:
    """Process one RabbitMQ delivery with explicit broker action per outcome."""
    try:
        envelope = validate_envelope(json.loads(message.body.decode("utf-8")))
        result = await process_envelope(envelope, worker_id=worker_id)
        expected_action = broker_action_for_outcome(result.outcome)
        broker_action = getattr(result, "broker_action", None)
        # Fail closed for legacy/ambiguous process results in tests or future regressions.
        if broker_action != expected_action:
            raise ValueError("consumer outcome/action mismatch")
        if broker_action == BrokerAction.ACK:
            await message.ack()
            _CONSUMER_METRICS["ack"] += 1
            final_action = BrokerAction.ACK.value
        elif broker_action == BrokerAction.REJECT_DLQ:
            await message.reject(requeue=False)
            _CONSUMER_METRICS["reject_dlq"] += 1
            final_action = BrokerAction.REJECT_DLQ.value
        elif broker_action == BrokerAction.DELAYED_RETRY:
            final_action = await _publish_retry_or_dlq(message, envelope, result)
        else:
            raise ValueError("unknown broker action")
        _record_result_metric(result)
        logger.info(
            "communication_consumer_result",
            extra={
                "worker_id": worker_id,
                "outbox_id": getattr(result, "outbox_id", None),
                "attempt_id": envelope.get("attempt_id"),
                "event_id": envelope.get("event_id"),
                "result": getattr(getattr(result, "outcome", None), "value", str(getattr(result, "outcome", None))),
                "broker_action": final_action,
                "reason_code": getattr(result, "reason_code", "ambiguous_result"),
                "provider_called": bool(getattr(result, "provider_called", False)),
                "committed": bool(getattr(result, "committed", False)),
                "retry_count": _retry_count(message),
            },
        )
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        _CONSUMER_METRICS["malformed_dlq"] += 1
        _CONSUMER_METRICS["reject_dlq"] += 1
        logger.warning("communication_consumer_result", extra={"worker_id": worker_id, "result": "malformed_envelope", "broker_action": "reject_dlq"})
        await message.reject(requeue=False)
    except asyncio.CancelledError:
        with suppress(Exception):
            await message.nack(requeue=True)
        raise
    except Exception as exc:
        _CONSUMER_METRICS["unexpected_state"] += 1
        logger.error(
            "communication_consumer_result",
            extra={"worker_id": worker_id, "result": "unexpected_state", "broker_action": "no_ack", "error_type": type(exc).__name__},
        )
        await message.nack(requeue=True)


async def _connect_channel(queue_name: str):
    if not settings.RABBITMQ_URL:
        raise RuntimeError("RABBITMQ_URL is required when RabbitMQ is enabled")
    import aio_pika

    connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=_effective_prefetch())
    queue = await channel.get_queue(queue_name, ensure=True)
    return connection, channel, queue


async def _consume_once(*, queue_name: str, worker_id: str) -> None:
    connection, channel, queue = await _connect_channel(queue_name)
    try:
        message = await queue.get(timeout=settings.RABBITMQ_RECONNECT_SECONDS, fail=False)
        if message is not None:
            await _handle_message(message, worker_id=worker_id)
    finally:
        with suppress(Exception):
            await channel.close()
        await connection.close()


async def _consume_continuous_subscription(*, queue_name: str, queue_key: str, worker_id: str) -> None:
    """Continuous RabbitMQ mode: register a visible queue consumer subscription."""
    connection = None
    channel = None
    consumer_tag = consumer_tag_for(worker_id, queue_key)
    in_flight: set[asyncio.Task] = set()
    try:
        connection, channel, queue = await _connect_channel(queue_name)

        async def on_message(message):
            task = asyncio.create_task(_handle_message(message, worker_id=worker_id))
            in_flight.add(task)
            task.add_done_callback(in_flight.discard)

        active_tag = await queue.consume(on_message, no_ack=False, consumer_tag=consumer_tag)
        logger.info("communication consumer subscribed", extra={"worker_id": worker_id, "queue": queue_name, "consumer_tag": consumer_tag})
        try:
            await _stop.wait()
        finally:
            with suppress(Exception):
                await queue.cancel(active_tag)
            if in_flight:
                done, pending = await asyncio.wait(in_flight, timeout=SHUTDOWN_TIMEOUT_SECONDS)
                for task in done:
                    with suppress(Exception):
                        task.result()
                for task in pending:
                    task.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        await task
    finally:
        if channel is not None:
            with suppress(Exception):
                await channel.close()
        if connection is not None:
            await connection.close()


async def consume_rabbitmq(*, queue_name: str, queue_key: str = "sms", worker_id: str, once: bool = False) -> None:
    if not settings.RABBITMQ_ENABLED:
        logger.info("communication consumer disabled", extra={"worker_id": worker_id})
        return
    if once:
        await _consume_once(queue_name=queue_name, worker_id=worker_id)
        return

    while not _stop.is_set():
        try:
            await _consume_continuous_subscription(queue_name=queue_name, queue_key=queue_key, worker_id=worker_id)
        except RuntimeError as exc:
            logger.error(
                "communication consumer configuration error",
                extra={"worker_id": worker_id, "queue": queue_name, "error_type": type(exc).__name__},
            )
            raise
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if _stop.is_set():
                break
            logger.warning(
                "communication consumer connection lost; reconnecting",
                extra={"worker_id": worker_id, "queue": queue_name, "error_type": type(exc).__name__},
            )
            await asyncio.sleep(max(1, settings.RABBITMQ_RECONNECT_SECONDS))


async def _main_async(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FieldOS RabbitMQ communication consumer")
    parser.add_argument("--queue", choices=sorted(QUEUE_NAMES), default="sms")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--worker-id", default=None)
    args = parser.parse_args(argv)
    worker_id = args.worker_id or build_worker_id()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:  # pragma: no cover
            signal.signal(sig, lambda *_: _request_stop())
    try:
        await consume_rabbitmq(queue_name=QUEUE_NAMES[args.queue], queue_key=args.queue, worker_id=worker_id, once=args.once)
        return 0
    except Exception as exc:
        logger.error(
            "communication consumer failed",
            extra={"worker_id": worker_id, "queue": args.queue, "error_type": type(exc).__name__},
        )
        return 1


def main() -> None:
    raise SystemExit(asyncio.run(_main_async()))


if __name__ == "__main__":
    main()
