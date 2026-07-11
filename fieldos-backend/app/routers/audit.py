import json
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.audit import AuditBatchRequest
from app.schemas.common import ApiResponse
from app.deps.auth_deps import get_current_user, require_manager_or_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/audit-events", tags=["Audit"])


@router.post("/", response_model=ApiResponse)
async def submit_audit_events(
    request: AuditBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        # Attribution comes from the authenticated token, never the payload.
        user_id = current_user.id
        role = current_user.role
        branch_id = current_user.branch_id
        device_id = None

        created_count = 0
        for event in request.events:
            meta_json = json.dumps(event.metadata) if event.metadata else None
            audit_log = AuditLog(
                user_id=user_id,
                role=role,
                branch_id=branch_id,
                device_id=device_id,
                action_type=event.action_type,
                entity_type=event.entity_type,
                entity_id=event.entity_id,
                meta_json=meta_json,
            )
            db.add(audit_log)
            created_count += 1

        await db.commit()

        return ApiResponse(
            success=True,
            data={"created_count": created_count},
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Submit audit events error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Audit event submission failed")


@router.get("/", response_model=ApiResponse, dependencies=[Depends(require_manager_or_admin)])
async def get_audit_events(
    action_type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    try:
        query = select(AuditLog)
        if action_type:
            query = query.where(AuditLog.action_type == action_type)
        query = query.order_by(AuditLog.created_at.desc()).limit(limit)

        result = await db.execute(query)
        events = result.scalars().all()

        events_data = []
        for ev in events:
            d = {
                "id": ev.id,
                "user_id": ev.user_id,
                "role": ev.role,
                "branch_id": ev.branch_id,
                "device_id": ev.device_id,
                "action_type": ev.action_type,
                "entity_type": ev.entity_type,
                "entity_id": ev.entity_id,
                "metadata": ev.get_meta(),
                "created_at": str(ev.created_at),
            }
            events_data.append(d)

        return ApiResponse(
            success=True,
            data=events_data,
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Get audit events error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get audit events")
