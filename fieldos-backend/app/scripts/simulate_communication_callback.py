"""Local simulator for Phase 4 communication delivery callbacks.

Usage example:
  SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
    --provider generic --provider-reference log-123 --event-id sim-1 --status delivered
"""
import argparse
import asyncio
import os
import time

import httpx

from app.services.communication_callbacks import build_signature, canonical_json


def build_payload(provider: str, provider_reference: str, event_id: str, status: str) -> dict:
    if provider == "sparrow":
        return {"message_id": provider_reference, "event_id": event_id, "status": status}
    if provider == "jasmin":
        return {"id_smsc": provider_reference, "dlr_id": event_id, "dlr_status": status}
    return {"provider_reference": provider_reference, "provider_event_id": event_id, "normalized_status": status}


async def main():
    parser = argparse.ArgumentParser(description="Send a signed simulated communication callback.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--provider", choices=["sparrow", "jasmin", "generic"], default="generic")
    parser.add_argument("--provider-reference", required=True)
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--status", choices=["submitted", "provider_accepted", "delivered", "failed", "expired", "rejected", "unknown"], required=True)
    parser.add_argument("--secret", default=os.getenv("SMS_CALLBACK_SECRET", ""))
    parser.add_argument("--timestamp-offset-seconds", type=int, default=0)
    parser.add_argument("--invalid-signature", action="store_true")
    parser.add_argument("--send-twice", action="store_true", help="Send duplicate provider event ID to verify idempotency.")
    args = parser.parse_args()
    if not args.secret:
        raise SystemExit("SMS_CALLBACK_SECRET or --secret is required")

    payload = build_payload(args.provider, args.provider_reference, args.event_id, args.status)
    body = canonical_json(payload)
    timestamp = str(int(time.time()) + args.timestamp_offset_seconds)
    signature = build_signature(args.secret, args.provider, timestamp, body)
    if args.invalid_signature:
        signature = "0" * 64
    headers = {
        "content-type": "application/json",
        "X-FieldOS-Timestamp": timestamp,
        "X-FieldOS-Signature": signature,
    }
    url = f"{args.base_url}/client-communication/callbacks/{args.provider}"
    async with httpx.AsyncClient(timeout=10) as client:
        for _ in range(2 if args.send_twice else 1):
            response = await client.post(url, content=body, headers=headers)
            print(response.status_code)
            print(response.text)


if __name__ == "__main__":
    asyncio.run(main())
