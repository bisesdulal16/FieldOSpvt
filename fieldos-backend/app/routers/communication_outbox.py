import time
from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps.auth_deps import require_financial_access, require_manager_or_admin
from app.schemas.common import ApiResponse
from app.services.communication_outbox_service import prometheus_metrics, queue_health
from app.services.communication_broker import broker_health

router = APIRouter(
    prefix="/client-communication/outbox",
    tags=["Client Communication Outbox"],
    dependencies=[Depends(require_manager_or_admin), Depends(require_financial_access)],
)


@router.get("/health", response_model=ApiResponse)
async def communication_outbox_health(db: AsyncSession = Depends(get_db)):
    data = await queue_health(db)
    data.update(await broker_health())
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.get("/metrics", response_class=PlainTextResponse)
async def communication_outbox_metrics(db: AsyncSession = Depends(get_db)):
    return PlainTextResponse(await prometheus_metrics(db), media_type="text/plain; version=0.0.4")
