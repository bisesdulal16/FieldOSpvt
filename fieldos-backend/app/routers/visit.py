import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_db
from app.models.visit_checkin import VisitCheckin
from app.models.user import User
from app.schemas.visit import VisitCheckinCreate
from app.schemas.common import ApiResponse
from app.services.audit_helper import write_audit
from app.deps.auth_deps import get_current_user, require_financial_access, can_see_all_branches
from app.utils.nepal_time import now_nepal_iso

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/visit-checkins", tags=["Visit Check-ins"],
                   dependencies=[Depends(require_financial_access)])


@router.post("/", response_model=ApiResponse)
async def create_visit_checkin(
    request: VisitCheckinCreate,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        now_str = now_nepal_iso()

        # Branch validation: a scoped user (branch manager) can only check in at clients
        # whose tasks belong to their branch. Admin/HO sees nothing here (pass-through).
        if not can_see_all_branches(current_user) and current_user.branch_id is not None:
            from app.models.client import Client as _Client
            from app.models.task import TaskAssignment as _TA
            from sqlalchemy import func, select as _sel

            # Check client exists
            client_check = await db.execute(
                _sel(_Client.id).where(_Client.id == request.client_id)
            )
            if not client_check.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Client not found — cannot record a visit.",
                )

            # Check the client has task assignments in this officer's branch.
            # Zero task assignments total = officer has no book yet (new officer), allow pass-through.
            from sqlalchemy import and_ as _and_
            has_any_ta = await db.execute(
                _sel(func.count()).select_from(_TA)
                .where(_TA.user_id == current_user.id)
            )
            if has_any_ta.scalar_one_or_none():
                branch_check = await db.execute(
                    _sel(_TA.client_id).where(_and_(
                        _TA.client_id == request.client_id,
                        _TA.branch_id == current_user.branch_id,
                    )).limit(1)
                )
                if not branch_check.scalar_one_or_none():
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="This client does not belong to your branch.",
                    )
            else:
                # No tasks assigned → reject (branch managers without tasks cannot collect cross-branch)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This client does not belong to your branch.",
                )

        visit = VisitCheckin(
            client_id=request.client_id,
            task_id=request.task_id,
            officer_id=current_user.id,  # from the authenticated token
            branch_id=current_user.branch_id,  # stamp the officer's branch for scoping
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

        await write_audit(
            db, current_user, "visit_checkin",
            entity_type="visit_checkin", entity_id=visit.id,
            meta={"client_id": request.client_id, "gps_address": request.gps_address},
        )
        await db.commit()

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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create visit checkin error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visit checkin creation failed")
