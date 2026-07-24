"""
Day-start attendance with an office-network gate.

When the officer's branch has a registered `office_ip`, the day can only be started from that
network (the request's source IP must match) — proving the officer physically came to the
branch. A start-of-day selfie is captured for manager spot-checks. When no office_ip is set,
the gate is disabled (ip_verified=None) so institutions can opt in.
"""
import time
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.branch import Branch
from app.models.day_start import DayStartRecord
from app.schemas.common import ApiResponse
from app.services.audit_helper import write_audit
from app.deps.auth_deps import get_current_user
from app.utils.nepal_time import now_nepal_iso, today_nepal_str
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/day-start", tags=["Day Start"])


class DayStartRequest(BaseModel):
    selfie_data_uri: str | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    gps_address: str | None = None
    # On-device face clock-in result (None when the device fell back to photo-proof).
    face_verified: bool | None = None
    face_similarity: float | None = None


def _client_ip(request: Request) -> str | None:
    """Real client IP, honoring the proxy/load-balancer header used in production."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


@router.post("/", response_model=ApiResponse)
async def start_day(
    body: DayStartRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    source_ip = _client_ip(request)

    branch = None
    if current_user.branch_id:
        branch = (await db.execute(select(Branch).where(Branch.id == current_user.branch_id))).scalar_one_or_none()

    office_ip = (branch.office_ip if branch else None) or ""
    # Master switch (config): OFF for the pilot so officers can start their day from
    # any network. Only when explicitly enabled does the per-branch office_ip apply.
    gate_enabled = settings.DAY_START_IP_GATE and bool(office_ip.strip())
    if gate_enabled:
        allowed = {ip.strip() for ip in office_ip.split(",") if ip.strip()}
        ip_ok = source_ip in allowed
        if not ip_ok:
            # Blocked: officer is not on the branch network.
            await write_audit(
                db, current_user, "day_start_blocked",
                entity_type="day_start", entity_id=today_nepal_str(),
                meta={"source_ip": source_ip, "reason": "not_on_office_network"},
            )
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only start your day from the branch office network.",
            )
        ip_verified = True
    else:
        ip_verified = False  # gate disabled for this branch

    record = DayStartRecord(
        officer_id=current_user.id,
        branch_id=current_user.branch_id,
        day_date=today_nepal_str(),
        started_at=now_nepal_iso(),
        source_ip=source_ip,
        ip_verified=ip_verified,
        selfie_data_uri=body.selfie_data_uri,
        gps_latitude=body.gps_latitude,
        gps_longitude=body.gps_longitude,
        gps_address=body.gps_address,
        face_verified=body.face_verified,
        face_similarity=body.face_similarity,
    )
    db.add(record)
    await write_audit(
        db, current_user, "day_started",
        entity_type="day_start", entity_id=today_nepal_str(),
        meta={"source_ip": source_ip, "ip_verified": ip_verified,
              "selfie": bool(body.selfie_data_uri),
              "face_verified": body.face_verified,
              "face_similarity": body.face_similarity},
    )
    await db.commit()

    return ApiResponse(
        success=True,
        data={
            "day_started": True,
            "ip_verified": ip_verified,
            "gate_enabled": gate_enabled,
            "face_verified": body.face_verified,
            "started_at": record.started_at,
        },
        timestamp=int(time.time()),
    )
