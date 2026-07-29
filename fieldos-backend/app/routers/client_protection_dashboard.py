from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps.auth_deps import get_current_user, require_financial_access, require_manager_or_admin
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services import client_protection_dashboard as svc

router = APIRouter(
    prefix="/manager/client-protection",
    tags=["Client Protection Dashboard"],
    dependencies=[Depends(require_manager_or_admin), Depends(require_financial_access)],
)


def _ts() -> int:
    return int(time.time())


def _filters(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    filter_branch_id: int | None = Query(None, alias="branch_id"),
    filter_officer_id: int | None = Query(None, alias="officer_id"),
    filter_client_id: int | None = Query(None, alias="client_id"),
    purpose: str | None = Query(None),
    channel: str | None = Query(None),
    event_status: str | None = Query(None),
    attempt_status: str | None = Query(None),
    provider: str | None = Query(None),
    risk_level: str | None = Query(None),
    exception_severity: str | None = Query(None),
    due_state: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
) -> svc.ProtectionFilters:
    return svc.ProtectionFilters(
        start_date=start_date,
        end_date=end_date,
        branch_id=filter_branch_id,
        officer_id=filter_officer_id,
        client_id=filter_client_id,
        purpose=purpose,
        channel=channel,
        event_status=event_status,
        attempt_status=attempt_status,
        provider=provider,
        risk_level=risk_level,
        exception_severity=exception_severity,
        due_state=due_state,
        page=page,
        page_size=page_size,
    )


async def _require_access(current_user: User) -> None:
    if not svc.user_can_access_financial_dashboard(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Client financial/protection data access denied")


@router.get("/summary", response_model=ApiResponse)
async def summary(
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.summary_metrics(db, current_user, filters)
    await svc.audit_dashboard_view(db, current_user, "client_protection_dashboard_viewed", "client_protection_dashboard", filters=filters)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/events", response_model=ApiResponse)
async def events(
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.paginated_events(db, current_user, filters)
    await svc.audit_dashboard_view(db, current_user, "client_protection_dashboard_viewed", "client_protection_events", filters=filters)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/events/{event_id}", response_model=ApiResponse)
async def event_detail(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.event_detail(db, current_user, event_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await svc.audit_dashboard_view(db, current_user, "client_protection_event_viewed", "client_communication_event", event_id)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/exceptions", response_model=ApiResponse)
async def exceptions(
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.exceptions(db, current_user, filters)
    await svc.audit_dashboard_view(db, current_user, "client_protection_dashboard_viewed", "client_protection_exceptions", filters=filters)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/reminders", response_model=ApiResponse)
async def reminders(
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.paginated_reminders(db, current_user, filters)
    await svc.audit_dashboard_view(db, current_user, "client_protection_dashboard_viewed", "client_protection_reminders", filters=filters)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/clients/{client_id}/history", response_model=ApiResponse)
async def client_history(
    client_id: int,
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.client_history(db, current_user, client_id, filters)
    await svc.audit_dashboard_view(db, current_user, "client_communication_history_viewed", "client", client_id, filters)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/officers/{officer_id}/summary", response_model=ApiResponse)
async def officer_summary(
    officer_id: int,
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.officer_summary(db, current_user, officer_id, filters)
    await svc.audit_dashboard_view(db, current_user, "client_protection_dashboard_viewed", "officer", officer_id, filters)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/branches/{branch_id}/summary", response_model=ApiResponse)
async def branch_summary(
    branch_id: int,
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    data = await svc.branch_summary(db, current_user, branch_id, filters)
    if data.get("forbidden"):
        raise HTTPException(status_code=403, detail="Branch scope denied")
    await svc.audit_dashboard_view(db, current_user, "client_protection_dashboard_viewed", "branch", branch_id, filters)
    return ApiResponse(data=data, timestamp=_ts())


@router.get("/worker-health", response_model=ApiResponse)
async def worker_health(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    return ApiResponse(data=await svc.worker_health(db, current_user), timestamp=_ts())


@router.get("/export.csv")
async def export_csv(
    filters: svc.ProtectionFilters = Depends(_filters),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_access(current_user)
    try:
        content = await svc.export_events_csv(db, current_user, filters)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await svc.audit_dashboard_view(db, current_user, "client_protection_export_requested", "client_protection_export", filters=filters)
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=client-protection-events.csv"},
    )
