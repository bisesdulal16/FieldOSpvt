import logging
import time

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import ApiResponse
from app.services.communication_callbacks import CallbackRejected, process_provider_callback

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/client-communication/callbacks",
    tags=["Client Communication Callbacks"],
)


async def _handle_callback(
    provider: str,
    request: Request,
    db: AsyncSession,
    x_fieldos_signature: str | None,
    x_fieldos_timestamp: str | None,
):
    body = await request.body()
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise CallbackRejected("invalid_payload", "callback payload must be a JSON object", 400)
        result = await process_provider_callback(
            db,
            provider=provider,
            payload=payload,
            body=body,
            timestamp=x_fieldos_timestamp,
            signature=x_fieldos_signature,
        )
        return ApiResponse(success=True, data=result, timestamp=int(time.time()))
    except CallbackRejected as exc:
        logger.warning("communication callback rejected", extra={"provider": provider, "reason": exc.code})
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "data": None,
                "error": {"code": exc.code, "message": exc.message},
                "timestamp": int(time.time()),
            },
        )


@router.post("/sparrow", response_model=ApiResponse)
async def sparrow_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_fieldos_signature: str | None = Header(default=None, alias="X-FieldOS-Signature"),
    x_fieldos_timestamp: str | None = Header(default=None, alias="X-FieldOS-Timestamp"),
):
    """Authenticated Sparrow-style delivery callback endpoint.

    This endpoint is wired for simulated callbacks in Phase 4; public provider exposure
    and real callback registration happen in a later deployment phase.
    """
    return await _handle_callback("sparrow", request, db, x_fieldos_signature, x_fieldos_timestamp)


@router.post("/jasmin", response_model=ApiResponse)
async def jasmin_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_fieldos_signature: str | None = Header(default=None, alias="X-FieldOS-Signature"),
    x_fieldos_timestamp: str | None = Header(default=None, alias="X-FieldOS-Timestamp"),
):
    """Authenticated Jasmin-style DLR callback endpoint for simulated DLRs."""
    return await _handle_callback("jasmin", request, db, x_fieldos_signature, x_fieldos_timestamp)


@router.post("/generic", response_model=ApiResponse)
async def generic_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_fieldos_signature: str | None = Header(default=None, alias="X-FieldOS-Signature"),
    x_fieldos_timestamp: str | None = Header(default=None, alias="X-FieldOS-Timestamp"),
):
    """Authenticated normalized callback endpoint for local/provider-agnostic tests."""
    return await _handle_callback("generic", request, db, x_fieldos_signature, x_fieldos_timestamp)
