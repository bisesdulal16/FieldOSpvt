import time
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_db
from app.models.visit_checkin import VisitCheckin
from app.schemas.visit import VisitCheckinCreate
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/visit-checkins", tags=["Visit Check-ins"])


@router.post("/", response_model=ApiResponse)
async def create_visit_checkin(
    request: VisitCheckinCreate,
    db=Depends(get_db),
):
    try:
        now_str = datetime.now(timezone.utc).isoformat()
        visit = VisitCheckin(
            client_id=request.client_id,
            task_id=request.task_id,
            officer_id=request.officer_id,
            visit_purpose=request.visit_purpose,
            gps_latitude=request.gps_latitude,
            gps_longitude=request.gps_longitude,
            gps_address=request.gps_address,
            gps_accuracy_meters=request.gps_accuracy_meters,
            checked_in_at=request.checked_in_at or now_str,
            synced_at=now_str,
        )
        db.add(visit)
        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "id": visit.id,
                "client_id": visit.client_id,
                "visit_purpose": visit.visit_purpose,
                "gps_latitude": visit.gps_latitude,
                "gps_longitude": visit.gps_longitude,
                "checked_in_at": visit.checked_in_at,
            },
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Create visit checkin error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visit checkin creation failed")
