"""
Face enrollment for attendance clock-in (decision 2026-07-14).

This is attendance tooling — the same face check countless orgs use to punch in —
NOT field/GPS surveillance. At onboarding the officer enrolls a reference face:
the app computes a MobileFaceNet embedding ON-DEVICE and posts the vector here.
We store it as the officer's `face_template` so:
  - a re-installed / new device can re-fetch the template and keep verifying, and
  - a manager can confirm an officer is enrolled.

Matching itself happens on-device at clock-in (cosine similarity vs the locally
cached template + a blink/turn liveness check); the day-start record stores the
pass/fail result. We never receive raw face images here beyond an optional
enrollment selfie thumbnail for the manager.
"""
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.database import get_db
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services.audit_helper import write_audit
from app.deps.auth_deps import get_current_user
from app.utils.nepal_time import now_nepal_iso

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/face", tags=["Face Verification"])

# MobileFaceNet embeddings are typically 128 or 192-d; accept a sane range.
MIN_DIMS = 64
MAX_DIMS = 1024


class FaceEnrollRequest(BaseModel):
    embedding: list[float] = Field(..., description="On-device face embedding (unit vector)")
    selfie_data_uri: str | None = Field(None, description="Optional enrollment selfie for the manager")


@router.post("/enroll", response_model=ApiResponse)
async def enroll_face(
    body: FaceEnrollRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Store (or re-enroll) the authenticated officer's reference face embedding."""
    dims = len(body.embedding)
    if dims < MIN_DIMS or dims > MAX_DIMS:
        raise HTTPException(
            status_code=400,
            detail=f"Embedding must have between {MIN_DIMS} and {MAX_DIMS} dimensions (got {dims}).",
        )
    if not all(isinstance(x, (int, float)) for x in body.embedding):
        raise HTTPException(status_code=400, detail="Embedding must be a list of numbers.")

    current_user.face_template = json.dumps([round(float(x), 6) for x in body.embedding])
    current_user.face_enrolled_at = now_nepal_iso()
    db.add(current_user)
    await write_audit(
        db, current_user, "face_enrolled",
        entity_type="user", entity_id=str(current_user.id),
        meta={"dims": dims, "selfie": bool(body.selfie_data_uri)},
    )
    await db.commit()

    return ApiResponse(
        success=True,
        data={"enrolled": True, "dims": dims, "enrolled_at": current_user.face_enrolled_at},
        timestamp=int(time.time()),
    )


@router.get("/status", response_model=ApiResponse)
async def face_status(
    current_user: User = Depends(get_current_user),
):
    """Enrollment status for the current officer. Returns the stored template so a
    reinstalled app can re-hydrate its local copy for on-device matching."""
    template = None
    dims = 0
    if current_user.face_template:
        try:
            template = json.loads(current_user.face_template)
            dims = len(template)
        except (ValueError, TypeError):
            template = None

    return ApiResponse(
        success=True,
        data={
            "enrolled": template is not None,
            "enrolled_at": current_user.face_enrolled_at,
            "dims": dims,
            "template": template,  # the officer's own embedding only
        },
        timestamp=int(time.time()),
    )
