import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_db
from app.models.center_meeting import CenterMeeting, MeetingAttendance
from app.models.user import User
from app.schemas.meeting import MeetingCreate
from app.schemas.common import ApiResponse
from app.deps.auth_deps import get_current_user, require_financial_access

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/meetings", tags=["Meetings"],
                   dependencies=[Depends(require_financial_access)])


@router.post("/", response_model=ApiResponse)
async def create_meeting(
    request: MeetingCreate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        meeting = CenterMeeting(
            center_id=request.center_id,
            center_name=request.center_name,
            meeting_date=request.meeting_date,
            location=request.location,
            officer_id=current_user.id,
            total_members=request.total_members,
            present_count=request.present_count,
            paid_count=request.paid_count,
            absent_count=request.absent_count,
            followup_count=request.followup_count,
            collection_expected=float(request.collection_expected),
            collection_received=float(request.collection_received),
            status="completed",
        )
        db.add(meeting)
        await db.flush()

        for att in request.attendance:
            attendance = MeetingAttendance(
                meeting_id=meeting.id,
                client_id=att.client_id,
                member_id=att.member_id,
                attendance_status=att.attendance_status,
            )
            db.add(attendance)

        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "id": meeting.id,
                "center_id": meeting.center_id,
                "center_name": meeting.center_name,
                "meeting_date": meeting.meeting_date,
                "total_members": meeting.total_members,
                "present_count": meeting.present_count,
                "paid_count": meeting.paid_count,
                "status": meeting.status,
            },
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Create meeting error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Meeting creation failed")
