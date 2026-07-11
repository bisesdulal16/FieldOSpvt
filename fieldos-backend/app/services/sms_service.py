"""
SMS delivery — pluggable provider behind one function.

Providers:
  - "log"     : dev/demo. Logs the message; sends nothing. No gateway/credits needed.
  - "sparrow" : Nepal production via Sparrow SMS (needs SMS_API_TOKEN + credits).

`send_sms` never raises — it returns (ok, error) so a gateway outage can't roll back or crash
the collection that triggered it. The caller records the attempt in `sms_notifications` either way.
"""
import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.sms_notification import SmsNotification

logger = logging.getLogger(__name__)


def compose_collection_receipt(org_name: str, amount: float, receipt_id: str) -> str:
    """The client-facing receipt text. States the exact recorded amount so the client can catch
    any under-reporting, and tells them who to call if it's wrong."""
    return (
        f"{org_name}: NPR {amount:,.0f} received from you. "
        f"Receipt {receipt_id}. If this amount is wrong, contact your branch office."
    )


async def record_and_send_receipt(
    db: AsyncSession,
    *,
    client_id: int | None,
    phone_number: str | None,
    amount: float,
    receipt_id: str,
) -> None:
    """Send the collection receipt SMS to the client and log the attempt in sms_notifications.
    Best-effort: a gateway failure is logged (status=failed), never raised."""
    org_name = settings.ORG_NAME
    message = compose_collection_receipt(org_name, amount, receipt_id)

    if not phone_number:
        status, error = "no_phone", None
    else:
        ok, error = await send_sms(phone_number, message)
        status = "sent" if ok else "failed"

    db.add(SmsNotification(
        client_id=client_id,
        collection_receipt_id=receipt_id,
        phone_number=phone_number,
        kind="collection_receipt",
        message=message,
        provider=settings.SMS_PROVIDER,
        status=status,
        error=error,
    ))
    await db.commit()


async def send_sms(to: str, message: str) -> tuple[bool, str | None]:
    provider = settings.SMS_PROVIDER
    if not to:
        return False, "no phone number"

    if provider == "log":
        logger.info("SMS[log] → %s : %s", to, message)
        return True, None

    if provider == "sparrow":
        if not settings.SMS_API_TOKEN:
            return False, "SMS_API_TOKEN not set"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    settings.SMS_SPARROW_URL,
                    data={
                        "token": settings.SMS_API_TOKEN,
                        "from": settings.SMS_SENDER,
                        "to": to,
                        "text": message,
                    },
                )
            if resp.status_code == 200:
                return True, None
            return False, f"sparrow {resp.status_code}: {resp.text[:200]}"
        except Exception as e:  # network/timeout — best-effort, never crash the caller
            return False, str(e)

    return False, f"unknown SMS provider: {provider}"
