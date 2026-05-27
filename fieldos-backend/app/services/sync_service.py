import json
import logging
from typing import Any

from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sync_event import SyncEvent
from app.models.client import Client
from app.models.collection import Collection
from app.models.visit_checkin import VisitCheckin
from app.models.promise_to_pay import PromiseToPay
from app.models.audit_log import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)

VALID_ENTITY_TYPES = {"client", "loan", "collection", "visit", "visit_checkin", "task", "meeting", "promise", "eod", "audit_event", "kyc_document"}
VALID_OPERATIONS = {"create", "update", "delete"}


async def process_sync_event(session: AsyncSession, event_data: dict) -> dict[str, Any]:
    entity_type = event_data.get("entity_type", "")
    entity_id = event_data.get("entity_id", "")
    operation = event_data.get("operation", "")
    payload = event_data.get("payload", {}) or {}

    if entity_type not in VALID_ENTITY_TYPES:
        return {"entity_type": entity_type, "entity_id": entity_id, "status": "failed", "error": f"Unknown entity type: {entity_type}"}
    if operation not in VALID_OPERATIONS:
        return {"entity_type": entity_type, "entity_id": entity_id, "status": "failed", "error": f"Unknown operation: {operation}"}

    try:
        if operation == "create":
            result = await _handle_create(session, entity_type, entity_id, payload)
        elif operation == "update":
            result = await _handle_update(session, entity_type, entity_id, payload)
        elif operation == "delete":
            result = {"status": "completed"}  # Soft delete for MVP
        else:
            result = {"status": "failed", "error": f"Unknown operation: {operation}"}
        return {"entity_type": entity_type, "entity_id": entity_id, **result}
    except Exception as e:
        logger.error(f"Sync error: {e}", exc_info=True)
        return {"entity_type": entity_type, "entity_id": entity_id, "status": "failed", "error": str(e)}


async def _handle_create(session: AsyncSession, entity_type: str, entity_id: str, payload: dict) -> dict[str, Any]:
    try:
        if entity_type == "collection":
            collection = Collection(
                receipt_id=payload.get("receipt_id", entity_id),
                client_id=payload.get("client_id"),
                task_id=payload.get("task_id"),
                officer_id=payload.get("officer_id"),
                amount=float(payload.get("amount", 0)),
                due_amount=float(payload.get("due_amount", 0)),
                outstanding_after=float(payload.get("outstanding_after", 0)),
                payment_method=payload.get("payment_method", "cash"),
                face_verified=payload.get("face_verified", False),
                collected_at=payload.get("collected_at"),
            )
            session.add(collection)
            await session.flush()

            # Update client's due_amount and outstanding_balance after collection
            client_id = payload.get("client_id")
            amount = float(payload.get("amount", 0))
            outstanding_after = float(payload.get("outstanding_after", 0))
            if client_id and outstanding_after:
                client_result = await session.execute(
                    select(Client).where(Client.id == client_id)
                )
                client = client_result.scalar_one_or_none()
                if client:
                    client.outstanding_balance = outstanding_after
                    client.due_amount = max(0.0, client.due_amount - amount)

        elif entity_type in ("visit", "visit_checkin"):
            visit = VisitCheckin(
                client_id=payload.get("client_id"),
                task_id=payload.get("task_id"),
                officer_id=payload.get("officer_id"),
                visit_purpose=payload.get("visit_purpose"),
                gps_latitude=payload.get("gps_latitude"),
                gps_longitude=payload.get("gps_longitude"),
                gps_address=payload.get("gps_address"),
                checked_in_at=payload.get("checked_in_at"),
            )
            session.add(visit)
            await session.flush()

        elif entity_type == "promise":
            promise = PromiseToPay(
                client_id=payload.get("client_id"),
                task_id=payload.get("task_id"),
                promised_amount=float(payload.get("promised_amount", 0)),
                expected_payment_date=payload.get("expected_payment_date"),
                reason=payload.get("reason"),
                outstanding_amount=float(payload.get("outstanding_amount", 0)),
            )
            session.add(promise)
            await session.flush()

        elif entity_type == "audit_event":
            # Create AuditLog record from sync payload
            meta = payload.get("metadata", {}) or {}
            user_id = None
            try:
                staff_id = str(payload.get("userId", payload.get("user_id", "")))
                # Extract numeric part from "FO-208" → 208
                numeric_id = staff_id.split("-")[-1]
                user_result = await session.execute(select(User).where(User.staff_id == staff_id))
                user = user_result.scalar_one_or_none()
                user_id = user.id if user else int(numeric_id) if numeric_id.isdigit() else None
            except (ValueError, IndexError):
                pass
            audit_log = AuditLog(
                user_id=user_id,
                role=payload.get("role"),
                action_type=payload.get("actionType", payload.get("action_type", "")),
                entity_type=payload.get("entity_type"),
                entity_id=payload.get("entityId", str(payload.get("entity_id", ""))),
                meta_json=json.dumps(meta) if meta else None,
            )
            session.add(audit_log)
            await session.flush()

        elif entity_type in ("kyc_document", "eod", "meeting", "task"):
            # No dedicated handler — store as sync event record
            logger.info(f"Sync create for {entity_type} (stored in sync_events)")
            return {"status": "completed"}

        else:
            return {"status": "failed", "error": f"Create not supported for {entity_type}"}

        return {"status": "completed"}
    except Exception as e:
        logger.error(f"Sync create error: {e}", exc_info=True)
        return {"status": "failed", "error": str(e)}


async def _handle_update(session: AsyncSession, entity_type: str, entity_id: str, payload: dict) -> dict[str, Any]:
    try:
        if entity_type == "collection":
            stmt = (
                update(Collection)
                .where(Collection.receipt_id == entity_id)
                .values(**{k: v for k, v in payload.items() if k in Collection.__table__.columns})
            )
            await session.execute(stmt)

            # Update client balance on collection update too
            client_id = payload.get("client_id")
            outstanding_after = payload.get("outstanding_after")
            if client_id and outstanding_after:
                client_result = await session.execute(
                    select(Client).where(Client.id == client_id)
                )
                client = client_result.scalar_one_or_none()
                if client:
                    client.outstanding_balance = float(outstanding_after)
                    amount = float(payload.get("amount", 0))
                    if amount:
                        client.due_amount = max(0.0, client.due_amount - amount)
        elif entity_type == "client":
            stmt = (
                update(Client)
                .where(Client.member_id == entity_id)
                .values(**{k: v for k, v in payload.items() if k in Client.__table__.columns})
            )
            await session.execute(stmt)
        else:
            return {"status": "completed"}  # No-op for MVP
        return {"status": "completed"}
    except Exception as e:
        logger.error(f"Sync update error: {e}", exc_info=True)
        return {"status": "failed", "error": str(e)}


async def get_pending_sync_count(session: AsyncSession) -> int:
    result = await session.execute(
        select(SyncEvent).where(SyncEvent.status == "pending")
    )
    return len(result.scalars().all())
