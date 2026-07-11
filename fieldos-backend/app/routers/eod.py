import json
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_db
from app.models.end_of_day import EndOfDayReport
from app.models.user import User
from app.schemas.eod import EODCreate
from app.schemas.common import ApiResponse
from app.services.audit_helper import write_audit
from app.deps.auth_deps import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/end-of-day", tags=["End of Day"])


@router.post("/", response_model=ApiResponse)
async def create_eod_report(
    request: EODCreate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        officer_id = current_user.id  # from the authenticated token

        exceptions_json = json.dumps(request.exceptions) if request.exceptions else None

        report = EndOfDayReport(
            report_date=request.report_date,
            officer_id=officer_id,
            total_collections=float(request.total_collections),
            total_visits=request.total_visits,
            pending_count=request.pending_count,
            exceptions_json=exceptions_json,
            is_confirmed=True,
            is_submitted=True,
            face_verified=request.face_verified,
        )
        db.add(report)
        await db.flush()

        await write_audit(
            db, current_user, "end_of_day_submitted",
            entity_type="end_of_day_report", entity_id=report.id,
            meta={"report_date": request.report_date,
                  "total_collections": float(request.total_collections)},
        )

        return ApiResponse(
            success=True,
            data={
                "id": report.id,
                "report_date": report.report_date,
                "officer_id": report.officer_id,
                "total_collections": report.total_collections,
                "total_visits": report.total_visits,
                "pending_count": report.pending_count,
                "is_confirmed": report.is_confirmed,
                "is_submitted": report.is_submitted,
                "face_verified": report.face_verified,
            },
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Create EOD error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="EOD report creation failed")
