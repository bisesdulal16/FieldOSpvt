import time
from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps.auth_deps import get_current_user, require_financial_access, require_manager_or_admin
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services.communication_outbox_service import broker_published_unprocessed_summary, prometheus_metrics, queue_health
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


@router.get("/broker-published-unprocessed")
async def communication_broker_published_unprocessed(
    limit: int = Query(50, ge=1, le=100),
    threshold_seconds: int | None = Query(None, ge=0, le=86400),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Branch managers see only their branch. Area managers/admins with audit or
    # head-office financial access receive aggregate operational visibility.
    branch_id = current_user.branch_id if current_user.role == "branch_manager" else None
    data = await broker_published_unprocessed_summary(db, threshold_seconds=threshold_seconds, limit=limit, branch_id=branch_id)
    data["scope"] = "branch" if branch_id is not None else "operational"
    data["admin_it_policy"] = "denied_by_financial_access_dependency"
    return {"broker_published_unprocessed": data}
