"""
White-label branding — public endpoint so the login screens can render the
institution's name/logo/colors before a user authenticates.
"""
import time

from fastapi import APIRouter

from app.config import settings
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/branding", tags=["Branding"])


@router.get("/", response_model=ApiResponse)
async def get_branding():
    return ApiResponse(success=True, data=settings.branding, timestamp=int(time.time()))
