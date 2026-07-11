import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.sync_event import SyncEvent
from app.models.user import User
from app.schemas.sync import SyncBatchRequest, SyncEventResult, SyncStatusResponse
from app.schemas.common import ApiResponse
from app.services import sync_service
from app.deps.auth_deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sync", tags=["Sync"])


@router.post("/events", response_model=ApiResponse)
async def submit_sync_events(
    request: SyncBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        results = []
        for event_data in request.events:
            # Persist the sync event
            sync_event = SyncEvent(
                entity_type=event_data.entity_type,
                entity_id=event_data.entity_id,
                operation=event_data.operation,
                payload_json=__import__("json").dumps(event_data.payload) if event_data.payload else None,
                status="processing",
            )
            db.add(sync_event)
            await db.flush()

            # Process the event — attribute to the authenticated officer, not the payload.
            process_result = await sync_service.process_sync_event(
                db, {
                    "entity_type": event_data.entity_type,
                    "entity_id": event_data.entity_id,
                    "operation": event_data.operation,
                    "payload": event_data.payload,
                },
                authed_officer_id=current_user.id,
            )

            # Update sync event status
            sync_event.status = "completed" if process_result["status"] == "completed" else "failed"
            if process_result.get("error"):
                sync_event.last_error = process_result["error"]
                sync_event.retry_count = (sync_event.retry_count or 0) + 1

            results.append(SyncEventResult(**process_result))

        await db.commit()

        return ApiResponse(
            success=True,
            data={"results": [r.model_dump() for r in results]},
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Sync events error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Sync processing failed")


@router.get("/status", response_model=ApiResponse)
async def get_sync_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        pending_count = await sync_service.get_pending_sync_count(db)

        result = await db.execute(
            select(SyncEvent)
            .where(SyncEvent.status == "completed")
            .order_by(SyncEvent.updated_at.desc())
            .limit(1)
        )
        latest_sync = result.scalar_one_or_none()

        return ApiResponse(
            success=True,
            data=SyncStatusResponse(
                pending_count=pending_count,
                last_sync_at=str(latest_sync.synced_at) if latest_sync and latest_sync.synced_at else None,
            ).model_dump(),
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Sync status error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get sync status")
