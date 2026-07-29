from __future__ import annotations

import argparse
import asyncio
import logging
import signal

from app.config import settings
from app.services.communication_outbox_service import build_worker_id
from app.services.communication_broker import publish_once

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)
_stop = asyncio.Event()


def _request_stop(*_args):
    _stop.set()


async def _main_async(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FieldOS communication RabbitMQ outbox publisher")
    parser.add_argument("--once", action="store_true", help="publish one batch and exit")
    parser.add_argument("--max-jobs", type=int, default=None, help="override batch size")
    parser.add_argument("--worker-id", default=None)
    args = parser.parse_args(argv)
    worker_id = args.worker_id or build_worker_id()
    logger.info("communication publisher starting", extra={"worker_id": worker_id, "once": args.once, "dispatch_mode": settings.COMMUNICATION_DISPATCH_MODE, "rabbitmq_enabled": settings.RABBITMQ_ENABLED})
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:  # pragma: no cover
            signal.signal(sig, lambda *_: _request_stop())
    try:
        if args.once:
            await publish_once(worker_id=worker_id, batch_size=args.max_jobs)
            return 0
        while not _stop.is_set():
            await publish_once(worker_id=worker_id, batch_size=args.max_jobs)
            try:
                await asyncio.wait_for(_stop.wait(), timeout=settings.OUTBOX_POLL_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                pass
        return 0
    except Exception:
        logger.exception("communication publisher failed", extra={"worker_id": worker_id})
        return 1


def main() -> None:
    raise SystemExit(asyncio.run(_main_async()))


if __name__ == "__main__":
    main()
