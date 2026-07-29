from __future__ import annotations

import argparse
import asyncio
import json
import logging

from app.config import settings
from app.database import AsyncSessionLocal
from app.services.communication_reminders import run_reminder_scheduler_once

logger = logging.getLogger(__name__)


async def run_once() -> dict:
    async with AsyncSessionLocal() as session:
        summary = await run_reminder_scheduler_once(session)
        await session.commit()
        return summary


async def run_forever() -> None:
    while True:
        try:
            summary = await run_once()
            logger.info("communication reminder scheduler run", extra={"summary": summary})
        except Exception:
            logger.exception("communication reminder scheduler failed")
        await asyncio.sleep(max(60, int(getattr(settings, "OUTBOX_POLL_INTERVAL_SECONDS", 2) * 30)))


def main() -> int:
    parser = argparse.ArgumentParser(description="FieldOS client communication reminder scheduler")
    parser.add_argument("--once", action="store_true", help="scan one configured batch, create eligible reminders, and exit")
    args = parser.parse_args()
    if args.once:
        summary = asyncio.run(run_once())
        print(json.dumps(summary, sort_keys=True))
        return 0
    asyncio.run(run_forever())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
