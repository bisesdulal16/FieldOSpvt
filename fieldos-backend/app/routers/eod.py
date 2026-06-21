import json
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query

from app.database import get_db
from app.models.end_of_day import EndOfDayReport
from app.schemas.eod import EODCreate
from app.schemas.common import ApiResponse
from app.services import auth_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/end-of-day", tags=["End of Day"])


@router.post("/", response_model=ApiResponse)
async def create_eod_report(
    request: EODCreate,
    authorization: str = Query(None, description="Bearer token"),
    db=Depends(get_db),
):
    try:
        officer_id = request.officer_id
        if officer_id is None and authorization:
            token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
            payload = auth_service.verify_token(token)
            if payload:
                officer_id = int(payload.get("sub", 0))

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
