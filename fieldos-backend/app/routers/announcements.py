import time
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case as sql_case

from app.database import get_db
from app.models.announcement import Announcement
from app.models.user import User
from app.schemas.common import ApiResponse
from app.deps.auth_deps import require_manager_or_admin

logger = logging.getLogger(__name__)

# POST /manager/announcements — manager sends announcements
manager_router = APIRouter(
    prefix="/announcements",
    tags=["Announcements"],
    dependencies=[Depends(require_manager_or_admin)],
)

# GET /announcements — mobile fetches announcements
mobile_router = APIRouter(prefix="/announcements", tags=["Announcements"])


@manager_router.post("/", response_model=ApiResponse)
async def create_announcement(
    body: dict,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Branch manager sends an urgent announcement to field officers."""
    try:
        title = (body.get("title") or "").strip()
        message = (body.get("message") or "").strip()
        if not title or not message:
            raise HTTPException(status_code=400, detail="title and message are required")

        announcement = Announcement(
            branch_id=current_user.branch_id,
            title=title,
            message=message,
            priority=body.get("priority", "normal"),
            target_type=body.get("target_type", "all"),
            target_officer_id=body.get("target_officer_id"),
            created_by=current_user.id,
        )
        db.add(announcement)
        await db.commit()
        await db.refresh(announcement)

        return ApiResponse(
            success=True,
            data={
                "id": announcement.id,
                "title": announcement.title,
                "message": announcement.message,
                "priority": announcement.priority,
                "target_type": announcement.target_type,
                "target_officer_id": announcement.target_officer_id,
                "created_by": current_user.staff_id,
                "created_at": announcement.created_at.isoformat() if announcement.created_at else None,
            },
            timestamp=int(time.time()),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create announcement error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create announcement",
        )


@mobile_router.get("/", response_model=ApiResponse)
async def get_announcements(
    officer_id: int = Query(..., description="Current officer's user ID"),
    db: AsyncSession = Depends(get_db),
):
    """Return active announcements for the requesting officer."""
    try:
        now = datetime.utcnow().isoformat()

        stmt = (
            select(Announcement)
            .where(
                Announcement.expires_at.is_(None) | (Announcement.expires_at > now),
            )
            .order_by(
                sql_case(
                    (Announcement.priority == "urgent", 0),
                    else_=1,
                ),
                Announcement.created_at.desc(),
            )
        )
        result = await db.execute(stmt)
        announcements = result.scalars().all()

        data = []
        for a in announcements:
            if a.target_type == "all":
                pass
            elif a.target_officer_id == officer_id:
                pass
            else:
                continue

            data.append({
                "id": a.id,
                "title": a.title,
                "message": a.message,
                "priority": a.priority,
                "target_type": a.target_type,
                "created_by": a.created_by,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            })

        return ApiResponse(
            success=True,
            data=data,
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Get announcements error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get announcements",
        )
