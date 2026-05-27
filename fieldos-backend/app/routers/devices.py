import time
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.database import get_db
from app.models.device import Device
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/devices", tags=["Devices"])


@router.post("/register", response_model=ApiResponse)
async def register_device(
    device_id: str,
    device_name: str | None = None,
    device_model: str | None = None,
    os_version: str | None = None,
    app_version: str | None = None,
    user_id: int | None = None,
    db=Depends(get_db),
):
    try:
        result = await db.execute(select(Device).where(Device.device_id == device_id))
        device = result.scalar_one_or_none()

        if device:
            device.device_name = device_name or device.device_name
            device.device_model = device_model or device.device_model
            device.os_version = os_version or device.os_version
            device.app_version = app_version or device.app_version
            device.is_registered = True
            if user_id:
                device.user_id = user_id
        else:
            device = Device(
                device_id=device_id,
                user_id=user_id,
                device_name=device_name,
                device_model=device_model,
                os_version=os_version,
                app_version=app_version,
                is_registered=True,
            )
            db.add(device)

        await db.flush()

        return ApiResponse(
            success=True,
            data={
                "id": device.id,
                "device_id": device.device_id,
                "is_registered": device.is_registered,
            },
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Device register error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Device registration failed")


@router.post("/heartbeat", response_model=ApiResponse)
async def device_heartbeat(
    device_id: str,
    db=Depends(get_db),
):
    try:
        result = await db.execute(select(Device).where(Device.device_id == device_id))
        device = result.scalar_one_or_none()

        if not device:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

        device.last_sync_at = datetime.now(timezone.utc).isoformat()
        await db.flush()

        return ApiResponse(
            success=True,
            data={"device_id": device.device_id, "last_sync_at": device.last_sync_at},
            timestamp=int(time.time()),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Heartbeat error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Heartbeat failed")
