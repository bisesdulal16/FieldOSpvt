import time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps.auth_deps import get_current_user, require_financial_access, require_manager_or_admin
from app.models.audit_log import AuditLog
from app.models.client_communication import ClientCommunicationEvent
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services.communication_reminders import REMINDER_PURPOSES, reminder_rows

router = APIRouter(
    prefix="/client-communication/reminders",
    tags=["Client Communication Reminders"],
    dependencies=[Depends(require_manager_or_admin), Depends(require_financial_access)],
)


def _assert_allowed(user: User) -> None:
    if getattr(user, "department", None) == "admin_it":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_it accounts cannot access client reminder data")


@router.get("/upcoming", response_model=ApiResponse)
async def upcoming_reminders(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _assert_allowed(current_user)
    rows = await reminder_rows(db, current_user=current_user, include_cancelled=False)
    return ApiResponse(success=True, data=rows, timestamp=int(time.time()))


@router.get("/overdue-exceptions", response_model=ApiResponse)
async def overdue_reminder_exceptions(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _assert_allowed(current_user)
    rows = await reminder_rows(db, current_user=current_user, purpose="payment_overdue_reminder", include_cancelled=False)
    exceptions = [r for r in rows if r["status"] in {"no_phone", "failed", "cancelled"} or r["attempt_status"] in {"no_phone", "failed", "cancelled"}]
    return ApiResponse(success=True, data=exceptions, timestamp=int(time.time()))


@router.get("/summary", response_model=ApiResponse)
async def reminder_summary(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _assert_allowed(current_user)
    rows = await reminder_rows(db, current_user=current_user, include_cancelled=True)
    by_status: dict[str, int] = {}
    by_purpose: dict[str, int] = {}
    for row in rows:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
        by_purpose[row["purpose"]] = by_purpose.get(row["purpose"], 0) + 1
    return ApiResponse(success=True, data={"total": len(rows), "by_status": by_status, "by_purpose": by_purpose}, timestamp=int(time.time()))


@router.get("/by-client/{client_id}", response_model=ApiResponse)
async def reminders_by_client(client_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _assert_allowed(current_user)
    rows = await reminder_rows(db, current_user=current_user, client_id=client_id, include_cancelled=True)
    return ApiResponse(success=True, data=rows, timestamp=int(time.time()))


@router.get("/cancellation-history", response_model=ApiResponse)
async def reminder_cancellation_history(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _assert_allowed(current_user)
    q = select(AuditLog).where(AuditLog.action_type == "communication_reminder_cancelled").order_by(AuditLog.created_at.desc()).limit(200)
    if getattr(current_user, "role", None) != "admin":
        if current_user.branch_id is None:
            q = q.where(AuditLog.branch_id == -1)
        else:
            q = q.where(AuditLog.branch_id == current_user.branch_id)
    rows = (await db.execute(q)).scalars().all()
    data = [{"audit_id": a.id, "created_at": a.created_at.isoformat() if a.created_at else None, "entity_id": a.entity_id, "meta": a.meta_json} for a in rows]
    return ApiResponse(success=True, data=data, timestamp=int(time.time()))
