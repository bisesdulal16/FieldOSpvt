from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

from app.config import settings
from app.services.communication_outbox_service import build_worker_id, run_once

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

_stop = asyncio.Event()


def _request_stop(*_args):
    _stop.set()


async def _main_async(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FieldOS client communication outbox worker")
    parser.add_argument("--once", action="store_true", help="claim at most one configured batch, process it, then exit")
    parser.add_argument("--max-jobs", type=int, default=None, help="override batch size / max jobs for this run")
    parser.add_argument("--worker-id", default=None, help="stable worker id override for tests/ops")
    args = parser.parse_args(argv)

    worker_id = args.worker_id or build_worker_id()
    logger.info("communication outbox worker starting", extra={"worker_id": worker_id, "once": args.once, "enabled": settings.COMMUNICATION_WORKER_ENABLED})

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:  # pragma: no cover - Windows fallback
            signal.signal(sig, lambda *_: _request_stop())

    try:
        if args.once:
            await run_once(worker_id=worker_id, batch_size=args.max_jobs)
            return 0
        while not _stop.is_set():
            await run_once(worker_id=worker_id, batch_size=args.max_jobs)
            try:
                await asyncio.wait_for(_stop.wait(), timeout=settings.OUTBOX_POLL_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                pass
        logger.info("communication outbox worker stopping", extra={"worker_id": worker_id})
        return 0
    except Exception as exc:
        logger.exception("communication outbox worker failed", extra={"worker_id": worker_id})
        return 1


def main() -> None:
    raise SystemExit(asyncio.run(_main_async()))


if __name__ == "__main__":
    main()
