from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal

from app.config import settings
from app.services.communication_broker import process_envelope, validate_envelope
from app.services.communication_outbox_service import build_worker_id

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)
_stop = asyncio.Event()

QUEUE_NAMES = {
    "sms": "fieldos.communication.sms",
    "reminder": "fieldos.communication.reminder",
    "ivr": "fieldos.communication.ivr",
    "escalation": "fieldos.communication.escalation",
}


def _request_stop(*_args):
    _stop.set()


async def consume_rabbitmq(*, queue_name: str, worker_id: str, once: bool = False) -> None:
    if not settings.RABBITMQ_ENABLED:
        logger.info("communication consumer disabled", extra={"worker_id": worker_id})
        return
    import aio_pika
    connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
    try:
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=settings.RABBITMQ_PREFETCH)
        queue = await channel.get_queue(queue_name, ensure=True)
        while not _stop.is_set():
            message = await queue.get(timeout=settings.RABBITMQ_RECONNECT_SECONDS, fail=False)
            if message is None:
                if once:
                    return
                continue
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
            except Exception:
                logger.exception("communication message processing failed", extra={"worker_id": worker_id})
                await message.nack(requeue=True)
            if once:
                return
    finally:
        await connection.close()


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
        await consume_rabbitmq(queue_name=QUEUE_NAMES[args.queue], worker_id=worker_id, once=args.once)
        return 0
    except Exception:
        logger.exception("communication consumer failed", extra={"worker_id": worker_id, "queue": args.queue})
        return 1


def main() -> None:
    raise SystemExit(asyncio.run(_main_async()))


if __name__ == "__main__":
    main()
