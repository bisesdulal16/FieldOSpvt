import time
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.common import ApiResponse
from app.services import n8n_integration as svc

router = APIRouter(prefix="/integrations/n8n", tags=["n8n Client Protection Integration"])


async def require_n8n(request: Request, db: AsyncSession = Depends(get_db)) -> svc.N8NAuthContext:
    return await svc.verify_n8n_request(request, db)


@router.post("/events/{event_id}/escalate", response_model=ApiResponse)
async def escalate_event(
    event_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _auth: svc.N8NAuthContext = Depends(require_n8n),
):
    payload: dict[str, Any] = await request.json() if (await request.body()) else {}
    reason = str(payload.get("reason") or "n8n escalation requested")[:160]
    workflow = str(payload.get("workflow") or "dispute")[:60]
    data = await svc.escalate_event(db, event_id, reason, workflow, payload)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.post("/events/{event_id}/callback-task", response_model=ApiResponse)
async def callback_task(
    event_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _auth: svc.N8NAuthContext = Depends(require_n8n),
):
    payload: dict[str, Any] = await request.json() if (await request.body()) else {}
    reason = str(payload.get("reason") or "manager callback requested")[:160]
    data = await svc.escalate_event(db, event_id, reason, "callback-task", payload)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.post("/events/{event_id}/acknowledge", response_model=ApiResponse)
async def acknowledge_event(
    event_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _auth: svc.N8NAuthContext = Depends(require_n8n),
):
    payload: dict[str, Any] = await request.json() if (await request.body()) else {}
    data = await svc.acknowledge_event(db, event_id, payload)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.post("/provider-health/alert", response_model=ApiResponse)
async def provider_health_alert(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _auth: svc.N8NAuthContext = Depends(require_n8n),
):
    payload: dict[str, Any] = await request.json() if (await request.body()) else {}
    data = await svc.provider_health_alert(db, payload)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.get("/exceptions", response_model=ApiResponse)
async def exceptions(
    branch_id: int | None = Query(None),
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _auth: svc.N8NAuthContext = Depends(require_n8n),
):
    data = await svc.exceptions_feed(db, branch_id=branch_id, limit=limit)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.get("/daily-summary", response_model=ApiResponse)
async def daily_summary(
    branch_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _auth: svc.N8NAuthContext = Depends(require_n8n),
):
    data = await svc.daily_summary(db, branch_id=branch_id)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))


@router.post("/random-sample", response_model=ApiResponse)
async def random_sample(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _auth: svc.N8NAuthContext = Depends(require_n8n),
):
    payload: dict[str, Any] = await request.json() if (await request.body()) else {}
    data = await svc.random_sample(db, payload)
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))
