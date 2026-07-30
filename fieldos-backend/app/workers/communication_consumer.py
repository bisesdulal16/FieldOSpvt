from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
from contextlib import suppress
from typing import Any

from app.config import settings
from app.services.communication_broker import process_envelope, validate_envelope
from app.services.communication_outbox_service import build_worker_id

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


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


async def _handle_message(message: Any, *, worker_id: str) -> None:
    """Process one RabbitMQ delivery with manual ACK only after committed work."""
    try:
        envelope = validate_envelope(json.loads(message.body.decode("utf-8")))
        result = await process_envelope(envelope, worker_id=worker_id)
        if result.status in {"missing_authoritative_row", "idempotency_mismatch"}:
            await message.reject(requeue=False)
        else:
            await message.ack()
        logger.info("communication message processed", extra={"worker_id": worker_id, "outbox_id": result.outbox_id, "status": result.status})
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        logger.warning("malformed communication message dead-lettered", extra={"worker_id": worker_id})
        await message.reject(requeue=False)
    except asyncio.CancelledError:
        with suppress(Exception):
            await message.nack(requeue=True)
        raise
    except Exception as exc:
        logger.error(
            "communication message processing failed; requeueing",
            extra={"worker_id": worker_id, "error_type": type(exc).__name__},
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
