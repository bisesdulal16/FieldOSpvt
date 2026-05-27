import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.device import Device
from app.models.branch import Branch
from app.schemas.auth import LoginRequest, RefreshRequest, BiometricLoginRequest, LoginResponse, TokenResponse
from app.config import settings
from app.schemas.common import ApiResponse
from app.services import auth_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Authentication"])


def _get_current_user(
    token: str = None,
    db: AsyncSession = None,
) -> User:
    if not token or not db:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = auth_service.verify_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user_id = payload.get("sub")
    result = db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def _user_to_dict(user: User, branch: Branch | None = None) -> dict:
    return {
        "id": user.id,
        "staff_id": user.staff_id,
        "name": user.name,
        "name_ne": user.name_ne,
        "role": user.role,
        "phone_number": user.phone_number,
        "is_active": user.is_active,
        "branch_id": user.branch_id,
        "branch_name": branch.name if branch else None,
    }


@router.post("/login", response_model=ApiResponse)
async def login(request: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(User).where(User.staff_id == request.staff_id))
        user = result.scalar_one_or_none()

        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid staff ID or inactive account",
            )

        if not auth_service.verify_pin(request.pin, user.hashed_pin):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid PIN",
            )

        # Get branch
        branch = None
        if user.branch_id:
            branch_result = await db.execute(select(Branch).where(Branch.id == user.branch_id))
            branch = branch_result.scalar_one_or_none()

        # Register/update device
        device_dict = None
        if request.device_id:
            device_result = await db.execute(select(Device).where(Device.device_id == request.device_id))
            device = device_result.scalar_one_or_none()
            if not device:
                device = Device(
                    device_id=request.device_id,
                    user_id=user.id,
                    is_registered=True,
                )
                db.add(device)
            else:
                device.user_id = user.id
                device.is_registered = True
            await db.flush()
            device_dict = {
                "id": device.id,
                "device_id": device.device_id,
                "is_registered": device.is_registered,
            }

        # Create tokens
        token_data = {"sub": str(user.id), "staff_id": user.staff_id, "role": user.role}
        access_token = auth_service.create_access_token(token_data)
        refresh_token = auth_service.create_refresh_token(token_data)

        await db.commit()

        return ApiResponse(
            success=True,
            data=LoginResponse(
                user=_user_to_dict(user, branch),
                device=device_dict,
                tokens=TokenResponse(
                    access_token=access_token,
                    refresh_token=refresh_token,
                    expires_in=86400,
                ),
            ).model_dump(),
            timestamp=int(time.time()),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Login failed")


@router.post("/refresh", response_model=ApiResponse)
async def refresh_token(request: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = auth_service.verify_token(request.refresh_token)
        if not payload or payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token",
            )

        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )

        token_data = {"sub": str(user.id), "staff_id": user.staff_id, "role": user.role}
        new_access = auth_service.create_access_token(token_data)
        new_refresh = auth_service.create_refresh_token(token_data)

        return ApiResponse(
            success=True,
            data=TokenResponse(
                access_token=new_access,
                refresh_token=new_refresh,
                expires_in=86400,
            ).model_dump(),
            timestamp=int(time.time()),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refresh error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Token refresh failed")


@router.post("/biometric", response_model=ApiResponse)
async def biometric_login(request: BiometricLoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Device).where(Device.device_id == request.device_id))
        device = result.scalar_one_or_none()

        if not device or not device.is_registered or not device.user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Device not registered",
            )

        user_result = await db.execute(select(User).where(User.id == device.user_id))
        user = user_result.scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )

        branch = None
        if user.branch_id:
            branch_result = await db.execute(select(Branch).where(Branch.id == user.branch_id))
            branch = branch_result.scalar_one_or_none()

        token_data = {"sub": str(user.id), "staff_id": user.staff_id, "role": user.role}
        access_token = auth_service.create_access_token(token_data)
        refresh_token = auth_service.create_refresh_token(token_data)

        return ApiResponse(
            success=True,
            data=LoginResponse(
                user=_user_to_dict(user, branch),
                device={
                    "id": device.id,
                    "device_id": device.device_id,
                    "is_registered": device.is_registered,
                },
                tokens=TokenResponse(
                    access_token=access_token,
                    refresh_token=refresh_token,
                    expires_in=86400,
                ),
            ).model_dump(),
            timestamp=int(time.time()),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Biometric login error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Biometric login failed")
