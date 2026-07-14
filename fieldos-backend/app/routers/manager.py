"""
Manager Dashboard API — aggregated views for branch managers.
All routes require a branch-manager/admin token (see router dependency below).
"""
import json
import time
import logging
from datetime import date, timedelta, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, outerjoin, case
from sqlalchemy.orm import aliased

from app.database import get_db
from app.deps.auth_deps import require_manager_or_admin
from app.utils.nepal_time import today_nepal_str, days_ago_nepal_str
from app.models.user import User, UserRole
from app.models.client import Client
from app.models.collection import Collection
from app.models.visit_checkin import VisitCheckin
from app.models.promise_to_pay import PromiseToPay
from app.models.end_of_day import EndOfDayReport
from app.models.sync_event import SyncEvent
from app.models.audit_log import AuditLog
from app.models.task import TaskAssignment
from app.models.sms_notification import SmsNotification
from app.models.day_start import DayStartRecord
from app.models.loan_account import LoanAccount
from app.models.device import Device
from app.schemas.common import ApiResponse
from app.services import auth_service
from app.services.auth_service import hash_pin

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/manager",
    tags=["Manager Dashboard"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _today_str() -> str:
    return today_nepal_str()


def _yesterday_str() -> str:
    return days_ago_nepal_str(1)


def _ts() -> int:
    return int(time.time())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_officer_for_task(
    db: AsyncSession, task_id: int | None
) -> User | None:
    """Look up the user assigned to a task."""
    if task_id is None:
        return None
    result = await db.execute(
        select(User)
        .join(TaskAssignment, TaskAssignment.user_id == User.id)
        .where(TaskAssignment.id == task_id)
    )
    return result.scalar_one_or_none()


async def _get_client_by_id(
    db: AsyncSession, client_id: int | None
) -> Client | None:
    if client_id is None:
        return None
    result = await db.execute(select(Client).where(Client.id == client_id))
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# 1. GET /manager/dashboard — all KPIs in one call
# ---------------------------------------------------------------------------

@router.get("/dashboard", response_model=ApiResponse)
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    """
    Returns all dashboard KPIs in a single call.
    """
    try:
        today = _today_str()
        yesterday = _yesterday_str()

        # 1. Staff counts
        staff_total = (await db.execute(
            select(func.count()).select_from(User).where(User.is_active == True)  # noqa: E712
        )).scalar() or 0

        # Staff who started their day (have tasks or visits today)
        started_users = (await db.execute(
            select(func.count(func.distinct(TaskAssignment.user_id)))
            .where(TaskAssignment.task_date == today)
        )).scalar() or 0

        staff_started_pct = round(started_users / staff_total * 100, 1) if staff_total else 0.0

        # 2. Visit counts
        visits_today = (await db.execute(
            select(func.count()).select_from(VisitCheckin)
            .where(VisitCheckin.checked_in_at.like(f"{today}%"))
        )).scalar() or 0

        visits_yesterday = (await db.execute(
            select(func.count()).select_from(VisitCheckin)
            .where(VisitCheckin.checked_in_at.like(f"{yesterday}%"))
        )).scalar() or 0

        visits_vs_yesterday = (
            round((visits_today - visits_yesterday) / visits_yesterday * 100, 1)
            if visits_yesterday else 0.0
        )

        # 3. Collection totals
        collections_today_npr = (await db.execute(
            select(func.coalesce(func.sum(Collection.amount), 0))
            .where(Collection.collected_at.like(f"{today}%"))
        )).scalar() or 0

        collections_yesterday_npr = (await db.execute(
            select(func.coalesce(func.sum(Collection.amount), 0))
            .where(Collection.collected_at.like(f"{yesterday}%"))
        )).scalar() or 0

        collections_vs_yesterday = (
            round((collections_today_npr - collections_yesterday_npr) / collections_yesterday_npr * 100, 1)
            if collections_yesterday_npr else 0.0
        )

        # 4. Pending verification (high-value unverified collections)
        pending_verification = (await db.execute(
            select(func.count()).select_from(Collection)
            .where(and_(
                Collection.is_high_value == True,  # noqa: E712
                Collection.cbs_verified == False,  # noqa: E712
            ))
        )).scalar() or 0

        # 5. PAR followup due (clients with overdue > 0)
        par_followup_due = (await db.execute(
            select(func.count()).select_from(Client)
            .where(and_(
                Client.overdue_days > 0,
                Client.status == "active",
            ))
        )).scalar() or 0

        # 6. Missed PTP (overdue promises not fulfilled)
        missed_ptp = (await db.execute(
            select(func.count()).select_from(PromiseToPay)
            .where(and_(
                PromiseToPay.expected_payment_date < today,
                PromiseToPay.status != "fulfilled",
            ))
        )).scalar() or 0

        # 7. Pending sync
        pending_sync = (await db.execute(
            select(func.count()).select_from(SyncEvent)
            .where(SyncEvent.status == "pending")
        )).scalar() or 0

        # 8. Exceptions count — derived from multiple sources
        #    a) High-value unverified collections
        high_val_unverified = (await db.execute(
            select(func.count()).select_from(Collection)
            .where(and_(
                Collection.is_high_value == True,  # noqa: E712
                Collection.cbs_verified == False,  # noqa: E712
            ))
        )).scalar() or 0

        #    b) EOD reports with cash-related exceptions
        eod_with_exceptions = (await db.execute(
            select(func.count()).select_from(EndOfDayReport)
            .where(EndOfDayReport.exceptions_json.isnot(None))
        )).scalar() or 0

        #    c) NPA-risk clients (overdue >= 30)
        npa_risk = (await db.execute(
            select(func.count()).select_from(Client)
            .where(Client.overdue_days >= 30)
        )).scalar() or 0

        #    d) Failed sync events
        failed_sync = (await db.execute(
            select(func.count()).select_from(SyncEvent)
            .where(SyncEvent.status == "failed")
        )).scalar() or 0

        exceptions_count = high_val_unverified + eod_with_exceptions + npa_risk + failed_sync

        # 9. Cash mismatch NPR — from EOD exceptions_json
        cash_mismatch_npr = 0
        eod_result = await db.execute(
            select(EndOfDayReport).where(EndOfDayReport.exceptions_json.isnot(None))
        )
        for eod in eod_result.scalars().all():
            try:
                exc = json.loads(eod.exceptions_json)
                if exc and isinstance(exc, list):
                    for item in exc:
                        if isinstance(item, dict) and item.get("type") == "cash_mismatch":
                            cash_mismatch_npr += abs(item.get("amount", 0))
            except (json.JSONDecodeError, TypeError):
                pass

        return ApiResponse(
            success=True,
            data={
                "staff_total": staff_total,
                "staff_started": started_users,
                "staff_started_pct": staff_started_pct,
                "visits_total": visits_today,
                "visits_vs_yesterday": visits_vs_yesterday,
                "collections_total_npr": collections_today_npr,
                "collections_vs_yesterday": collections_vs_yesterday,
                "pending_verification": pending_verification,
                "par_followup_due": par_followup_due,
                "missed_ptp": missed_ptp,
                "pending_sync": pending_sync,
                "exceptions_count": exceptions_count,
                "cash_mismatch_npr": cash_mismatch_npr,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"Dashboard error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load dashboard",
        )


# ---------------------------------------------------------------------------
# 2. GET /manager/staff — all staff with today's activity
# ---------------------------------------------------------------------------

@router.get("/staff", response_model=ApiResponse)
async def get_staff(db: AsyncSession = Depends(get_db)):
    """Returns all staff members with today's activity summary."""
    try:
        today = _today_str()

        # 1. Get all active staff
        result = await db.execute(
            select(User).where(User.is_active == True).order_by(User.staff_id)  # noqa: E712
        )
        staff_list = result.scalars().all()
        staff_ids = [s.id for s in staff_list]

        # 2. Get all tasks for today, grouped by user_id
        tasks_map: dict[int, list[TaskAssignment]] = {}
        if staff_ids:
            t_result = await db.execute(
                select(TaskAssignment)
                .where(and_(
                    TaskAssignment.task_date == today,
                    TaskAssignment.user_id.in_(staff_ids),
                ))
            )
            for t in t_result.scalars().all():
                tasks_map.setdefault(t.user_id, []).append(t)

        # 3. Get all visits today with their task's user_id or direct officer_id
        visits_by_user: dict[int, int] = {}
        v_result = await db.execute(
            select(VisitCheckin, TaskAssignment.user_id.label("officer_id"))
            .outerjoin(TaskAssignment, VisitCheckin.task_id == TaskAssignment.id)
            .where(VisitCheckin.checked_in_at.like(f"{today}%"))
        )
        for visit, officer_id in v_result.all():
            if officer_id:
                visits_by_user[officer_id] = visits_by_user.get(officer_id, 0) + 1
            elif visit.officer_id:
                visits_by_user[visit.officer_id] = visits_by_user.get(visit.officer_id, 0) + 1

        # 4. Get all collections today with their task's user_id or direct officer_id
        coll_by_user: dict[int, dict] = {}
        c_result = await db.execute(
            select(Collection, TaskAssignment.user_id.label("officer_id"))
            .outerjoin(TaskAssignment, Collection.task_id == TaskAssignment.id)
            .where(Collection.collected_at.like(f"{today}%"))
        )
        for coll, officer_id in c_result.all():
            if officer_id:
                entry = coll_by_user.setdefault(officer_id, {"count": 0, "total_npr": 0.0})
                entry["count"] += 1
                entry["total_npr"] += coll.amount or 0
            elif coll.officer_id:
                entry = coll_by_user.setdefault(coll.officer_id, {"count": 0, "total_npr": 0.0})
                entry["count"] += 1
                entry["total_npr"] += coll.amount or 0

        # 5. Get devices by user_id
        devices_by_user: dict[int, Device] = {}
        if staff_ids:
            d_result = await db.execute(
                select(Device).where(Device.user_id.in_(staff_ids))
            )
            for d in d_result.scalars().all():
                if d.user_id:
                    devices_by_user[d.user_id] = d

        # 6. Assemble response
        staff_data = []
        for staff in staff_list:
            user_tasks = tasks_map.get(staff.id, [])
            visits_count = visits_by_user.get(staff.id, 0)
            coll_info = coll_by_user.get(staff.id, {"count": 0, "total_npr": 0.0})
            device = devices_by_user.get(staff.id)

            day_started = len(user_tasks) > 0 or visits_count > 0

            staff_data.append({
                "id": staff.id,
                "staff_id": staff.staff_id,
                "name": staff.name,
                "role": staff.role,
                "day_started": day_started,
                "visits_completed": visits_count,
                "visits_total": len(user_tasks),
                "collections_count": coll_info["count"],
                "collections_total_npr": round(coll_info["total_npr"], 2),
                "last_sync": device.last_sync_at if device else None,
                "status": "active" if staff.is_active else "inactive",
            })

        return ApiResponse(success=True, data=staff_data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Staff list error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load staff",
        )


# ---------------------------------------------------------------------------
# 3. GET /manager/visits — visit records for today
# ---------------------------------------------------------------------------

@router.get("/visits", response_model=ApiResponse)
async def get_visits(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Returns visit check-in records for today."""
    try:
        today = _today_str()

        # Officer resolved from VisitCheckin.officer_id (sent on every check-in),
        # falling back to the assigned task's officer for legacy rows.
        direct_officer = aliased(User)
        task_officer = aliased(User)
        stmt = (
            select(
                VisitCheckin,
                func.coalesce(direct_officer.name, task_officer.name).label("officer_name"),
                Client.name.label("client_name"),
                Client.member_id.label("member_id"),
            )
            .outerjoin(direct_officer, VisitCheckin.officer_id == direct_officer.id)
            .outerjoin(TaskAssignment, VisitCheckin.task_id == TaskAssignment.id)
            .outerjoin(task_officer, TaskAssignment.user_id == task_officer.id)
            .outerjoin(Client, VisitCheckin.client_id == Client.id)
            .where(VisitCheckin.checked_in_at.like(f"{today}%"))
            .order_by(VisitCheckin.checked_in_at.desc())
            .limit(limit)
        )
        result = await db.execute(stmt)
        rows = result.all()

        visits_data = []
        for visit, officer_name, client_name, member_id in rows:
            visits_data.append({
                "id": visit.id,
                "client_name": client_name,
                "member_id": member_id,
                "officer_name": officer_name,
                "purpose": visit.visit_purpose,
                "gps_lat": visit.gps_latitude,
                "gps_lng": visit.gps_longitude,
                "checked_in_at": visit.checked_in_at,
                "status": "completed",
            })

        return ApiResponse(success=True, data=visits_data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Visits error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load visits",
        )


# ---------------------------------------------------------------------------
# 4. GET /manager/collections — collection records with summary
# ---------------------------------------------------------------------------

@router.get("/collections", response_model=ApiResponse)
async def get_collections(
    recent_limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Returns collection records for today with daily/weekly summary."""
    try:
        today = _today_str()

        # Weekly target: sum of all active clients' due_amounts, or a minimum
        weekly_target_npr = (await db.execute(
            select(func.coalesce(func.sum(Client.due_amount), 0))
            .where(Client.status == "active")
        )).scalar() or 0
        weekly_target_npr = max(weekly_target_npr, 500000)

        daily_target_npr = round(weekly_target_npr / 7)

        # Today's collections
        today_npr = (await db.execute(
            select(func.coalesce(func.sum(Collection.amount), 0))
            .where(Collection.collected_at.like(f"{today}%"))
        )).scalar() or 0

        # Week's collections (last 7 days)
        week_start = days_ago_nepal_str(6)
        week_npr = (await db.execute(
            select(func.coalesce(func.sum(Collection.amount), 0))
            .where(Collection.collected_at >= week_start)
        )).scalar() or 0

        week_achievement_pct = (
            round(week_npr / weekly_target_npr * 100, 1)
            if weekly_target_npr else 0.0
        )

        # Daily breakdown — last 7 days
        daily_breakdown = []
        for i in range(6, -1, -1):
            d = days_ago_nepal_str(i)
            day_total = (await db.execute(
                select(func.coalesce(func.sum(Collection.amount), 0))
                .where(Collection.collected_at.like(f"{d}%"))
            )).scalar() or 0
            daily_breakdown.append({
                "date": d,
                "target_npr": daily_target_npr,
                "collected_npr": round(day_total, 2),
            })

        # Recent collections — with client and officer info.
        # Officer is resolved from Collection.officer_id (what the mobile app
        # sends on every collection, task-linked or ad-hoc); when that is
        # missing on legacy rows, fall back to the assigned task's officer.
        direct_officer = aliased(User)
        task_officer = aliased(User)
        stmt = (
            select(
                Collection,
                Client.name.label("client_name"),
                Client.member_id.label("member_id"),
                func.coalesce(direct_officer.name, task_officer.name).label("officer_name"),
            )
            .outerjoin(Client, Collection.client_id == Client.id)
            .outerjoin(direct_officer, Collection.officer_id == direct_officer.id)
            .outerjoin(TaskAssignment, Collection.task_id == TaskAssignment.id)
            .outerjoin(task_officer, TaskAssignment.user_id == task_officer.id)
            .where(Collection.collected_at.like(f"{today}%"))
            .order_by(Collection.collected_at.desc())
            .limit(recent_limit)
        )
        result = await db.execute(stmt)
        rows = result.all()

        recent = []
        for coll, client_name, member_id, officer_name in rows:
            recent.append({
                "id": coll.id,
                "receipt_id": coll.receipt_id,
                "client_name": client_name,
                "member_id": member_id,
                "amount_npr": round(coll.amount, 2),
                "method": coll.payment_method,
                "officer_name": officer_name,
                "collected_at": coll.collected_at,
                "cbs_verified": coll.cbs_verified,
            })

        return ApiResponse(
            success=True,
            data={
                "daily_target_npr": daily_target_npr,
                "weekly_target_npr": weekly_target_npr,
                "today_collected_npr": round(today_npr, 2),
                "week_collected_npr": round(week_npr, 2),
                "week_achievement_pct": week_achievement_pct,
                "daily_breakdown": daily_breakdown,
                "recent": recent,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"Collections error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load collections",
        )


# ---------------------------------------------------------------------------
# 5. GET /manager/par-followup — PAR / overdue clients
# ---------------------------------------------------------------------------

@router.get("/par-followup", response_model=ApiResponse)
async def get_par_followup(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Returns PAR/overdue clients who need follow-up."""
    try:
        # Get overdue clients
        result = await db.execute(
            select(Client)
            .where(and_(
                Client.overdue_days > 0,
                Client.status == "active",
            ))
            .order_by(Client.overdue_days.desc())
            .limit(limit)
        )
        overdue_clients = result.scalars().all()

        par_data = []
        for client in overdue_clients:
            # Find assigned officer from most recent task
            officer_name = None
            task_result = await db.execute(
                select(TaskAssignment, User.name.label("officer_name"))
                .outerjoin(User, TaskAssignment.user_id == User.id)
                .where(TaskAssignment.client_id == client.id)
                .order_by(TaskAssignment.created_at.desc())
                .limit(1)
            )
            row = task_result.first()
            if row:
                _, officer_name = row

            par_data.append({
                "id": client.id,
                "client_name": client.name,
                "member_id": client.member_id,
                "center": client.center_name,
                "overdue_days": client.overdue_days,
                "due_amount_npr": round(client.due_amount, 2),
                "outstanding_npr": round(client.outstanding_balance, 2),
                "assigned_officer": officer_name,
                "status": "overdue",
                "npa_risk": client.overdue_days >= 30,
            })

        return ApiResponse(success=True, data=par_data, timestamp=_ts())
    except Exception as e:
        logger.error(f"PAR followup error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load PAR follow-up data",
        )


# ---------------------------------------------------------------------------
# 6. GET /manager/ptp-today — promise-to-pay due today
# ---------------------------------------------------------------------------

@router.get("/ptp-today", response_model=ApiResponse)
async def get_ptp_today(db: AsyncSession = Depends(get_db)):
    """Returns promise-to-pay records due today."""
    try:
        today = _today_str()

        stmt = (
            select(
                PromiseToPay,
                Client.name.label("client_name"),
                Client.member_id.label("member_id"),
                Client.center_name.label("center"),
                User.name.label("officer_name"),
            )
            .outerjoin(Client, PromiseToPay.client_id == Client.id)
            .outerjoin(TaskAssignment, PromiseToPay.task_id == TaskAssignment.id)
            .outerjoin(User, TaskAssignment.user_id == User.id)
            .where(PromiseToPay.expected_payment_date == today)
            .order_by(PromiseToPay.created_at.desc())
        )
        result = await db.execute(stmt)
        rows = result.all()

        ptp_data = []
        for ptp, client_name, member_id, center, officer_name in rows:
            ptp_data.append({
                "id": ptp.id,
                "client_name": client_name,
                "member_id": member_id,
                "center": center,
                "promised_amount_npr": round(ptp.promised_amount, 2),
                "officer_name": officer_name,
                "status": ptp.status,
            })

        return ApiResponse(success=True, data=ptp_data, timestamp=_ts())
    except Exception as e:
        logger.error(f"PTP today error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load PTP data",
        )


# ---------------------------------------------------------------------------
# 7. GET /manager/exceptions — exceptions queue
# ---------------------------------------------------------------------------

@router.get("/exceptions", response_model=ApiResponse)
async def get_exceptions(
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns a synthesised exceptions queue derived from:
    - High-value unverified collections
    - EOD report exceptions (cash mismatch, etc.)
    - NPA-risk clients (overdue >= 30 days)
    - Failed sync events
    """
    try:
        exceptions: list[dict[str, Any]] = []
        exc_id = 0

        # --- 1. High-value unverified collections ---
        hv_result = await db.execute(
            select(Collection, Client.name.label("client_name"), User.name.label("officer_name"))
            .outerjoin(Client, Collection.client_id == Client.id)
            .outerjoin(TaskAssignment, Collection.task_id == TaskAssignment.id)
            .outerjoin(User, TaskAssignment.user_id == User.id)
            .where(and_(
                Collection.is_high_value == True,  # noqa: E712
                Collection.cbs_verified == False,  # noqa: E712
            ))
            .order_by(Collection.created_at.desc())
        )
        for coll, client_name, officer_name in hv_result.all():
            exc_id += 1
            exceptions.append({
                "id": exc_id,
                "type": "high_value_unverified",
                "details": f"High-value collection NPR {coll.amount:,.0f} for {client_name or 'unknown'} not CBS verified",
                "issued_by": "System",
                "raised_by": officer_name or "System",
                "created_at": str(coll.created_at),
                "severity": "high",
            })

        # --- 2. EOD exceptions ---
        eod_result = await db.execute(
            select(EndOfDayReport, User.name.label("officer_name"))
            .outerjoin(User, EndOfDayReport.officer_id == User.id)
            .where(EndOfDayReport.exceptions_json.isnot(None))
            .order_by(EndOfDayReport.created_at.desc())
        )
        for eod, officer_name in eod_result.all():
            try:
                exc_list = json.loads(eod.exceptions_json)
                if isinstance(exc_list, list):
                    for item in exc_list:
                        if isinstance(item, dict):
                            exc_id += 1
                            exc_type = item.get("type", "eod_exception")
                            severity = "high" if exc_type == "cash_mismatch" else "medium"
                            exceptions.append({
                                "id": exc_id,
                                "type": exc_type,
                                "details": item.get("message", str(item)),
                                "issued_by": "System",
                                "raised_by": officer_name or "System",
                                "created_at": str(eod.created_at),
                                "severity": severity,
                            })
            except (json.JSONDecodeError, TypeError):
                exc_id += 1
                exceptions.append({
                    "id": exc_id,
                    "type": "eod_exception",
                    "details": "EOD report has unparseable exceptions",
                    "issued_by": "System",
                    "raised_by": officer_name or "System",
                    "created_at": str(eod.created_at),
                    "severity": "medium",
                })

        # --- 3. NPA-risk clients (overdue >= 30) ---
        npa_result = await db.execute(
            select(Client, User.name.label("officer_name"))
            .outerjoin(TaskAssignment, TaskAssignment.client_id == Client.id)
            .outerjoin(User, TaskAssignment.user_id == User.id)
            .where(Client.overdue_days >= 30)
            .distinct()
            .order_by(Client.overdue_days.desc())
        )
        for client, officer_name in npa_result.all():
            exc_id += 1
            exceptions.append({
                "id": exc_id,
                "type": "npa_risk",
                "details": f"{client.name} ({client.member_id}) — {client.overdue_days} days overdue, outstanding NPR {client.outstanding_balance:,.0f}",
                "issued_by": "System",
                "raised_by": officer_name or "System",
                "created_at": str(client.updated_at),
                "severity": "critical",
            })

        # --- 4. Failed sync events ---
        sync_result = await db.execute(
            select(SyncEvent)
            .where(SyncEvent.status == "failed")
            .order_by(SyncEvent.updated_at.desc())
            .limit(10)
        )
        for se in sync_result.scalars().all():
            exc_id += 1
            details = f"Sync failed for {se.entity_type}/{se.entity_id}"
            if se.last_error:
                details += f": {se.last_error}"
            exceptions.append({
                "id": exc_id,
                "type": "sync_failure",
                "details": details,
                "issued_by": "System",
                "raised_by": "System",
                "created_at": str(se.created_at),
                "severity": "medium",
            })

        # Sort by severity priority, then by created_at desc
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        exceptions.sort(key=lambda x: (severity_order.get(x["severity"], 99), x["created_at"]), reverse=True)

        return ApiResponse(success=True, data=exceptions[:limit], timestamp=_ts())
    except Exception as e:
        logger.error(f"Exceptions error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load exceptions",
        )


# ---------------------------------------------------------------------------
# 8. GET /manager/eod-reviews — EOD submission status
# ---------------------------------------------------------------------------

@router.get("/eod-reviews", response_model=ApiResponse)
async def get_eod_reviews(db: AsyncSession = Depends(get_db)):
    """Returns EOD submission status summary and report list."""
    try:
        today = _today_str()

        # Get all EOD reports
        result = await db.execute(
            select(EndOfDayReport, User.name.label("officer_name"), User.staff_id.label("staff_id"))
            .outerjoin(User, EndOfDayReport.officer_id == User.id)
            .order_by(EndOfDayReport.report_date.desc(), EndOfDayReport.created_at.desc())
        )
        rows = result.all()

        submitted_count = 0
        pending_count = 0
        overdue_count = 0
        reviews = []

        for eod, officer_name, staff_id in rows:
            # Determine status
            if eod.is_submitted:
                status = "submitted"
                submitted_count += 1
            elif eod.report_date < today:
                status = "overdue"
                overdue_count += 1
            else:
                status = "pending"
                pending_count += 1

            # Count actual collections for this officer on this date
            coll_count_result = await db.execute(
                select(func.count()).select_from(Collection)
                .join(TaskAssignment, Collection.task_id == TaskAssignment.id)
                .where(and_(
                    TaskAssignment.user_id == eod.officer_id,
                    Collection.collected_at.like(f"{eod.report_date}%"),
                ))
            )
            collections_count = coll_count_result.scalar() or 0

            reviews.append({
                "id": eod.id,
                "officer_name": officer_name,
                "staff_id": staff_id,
                "report_date": eod.report_date,
                "collections_count": collections_count,
                "collections_npr": round(eod.total_collections, 2),
                "visits_count": eod.total_visits,
                "status": status,
                "submitted_at": str(eod.created_at) if eod.is_submitted else None,
            })

        total = len(rows)

        return ApiResponse(
            success=True,
            data={
                "submitted": submitted_count,
                "pending": pending_count,
                "overdue": overdue_count,
                "total": total,
                "reviews": reviews,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"EOD reviews error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load EOD reviews",
        )


# ---------------------------------------------------------------------------
# 9. GET /manager/sync-status — sync monitoring
# ---------------------------------------------------------------------------

@router.get("/sync-status", response_model=ApiResponse)
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Returns sync monitoring data with per-device status."""
    try:
        # Total event counts by status
        total_events = (await db.execute(
            select(func.count()).select_from(SyncEvent)
        )).scalar() or 0

        synced = (await db.execute(
            select(func.count()).select_from(SyncEvent)
            .where(SyncEvent.status.in_(["completed", "synced"]))
        )).scalar() or 0

        pending = (await db.execute(
            select(func.count()).select_from(SyncEvent)
            .where(SyncEvent.status == "pending")
        )).scalar() or 0

        failed = (await db.execute(
            select(func.count()).select_from(SyncEvent)
            .where(SyncEvent.status == "failed")
        )).scalar() or 0

        # Per-device status
        devices_result = await db.execute(
            select(Device, User.name.label("user_name"))
            .outerjoin(User, Device.user_id == User.id)
            .order_by(Device.last_sync_at.desc().nullslast())
        )
        devices_data = []
        for device, user_name in devices_result.all():
            # Determine device online status based on last_sync_at
            device_status = "offline"
            if device.last_sync_at:
                try:
                    last = datetime.fromisoformat(device.last_sync_at.replace("Z", "+00:00"))
                    if last.tzinfo is None:
                        last = last.replace(tzinfo=timezone.utc)
                    delta = datetime.now(timezone.utc) - last
                    if delta.total_seconds() < 300:  # 5 minutes
                        device_status = "online"
                    elif delta.total_seconds() < 3600:  # 1 hour
                        device_status = "syncing"
                except (ValueError, TypeError):
                    pass

            # Count pending/failed sync events for this device
            # Use payload_json device_id matching as a heuristic
            dev_pending = 0
            dev_failed = 0
            if device.device_id:
                pp = (await db.execute(
                    select(func.count()).select_from(SyncEvent)
                    .where(and_(
                        SyncEvent.status == "pending",
                        SyncEvent.payload_json.like(f"%{device.device_id}%"),
                    ))
                )).scalar() or 0
                ff = (await db.execute(
                    select(func.count()).select_from(SyncEvent)
                    .where(and_(
                        SyncEvent.status == "failed",
                        SyncEvent.payload_json.like(f"%{device.device_id}%"),
                    ))
                )).scalar() or 0
                dev_pending = pp
                dev_failed = ff

            devices_data.append({
                "device_id": device.device_id,
                "user_name": user_name,
                "last_sync": device.last_sync_at,
                "pending": dev_pending,
                "failed": dev_failed,
                "status": device_status,
            })

        return ApiResponse(
            success=True,
            data={
                "total_events": total_events,
                "synced": synced,
                "pending": pending,
                "failed": failed,
                "devices": devices_data,
            },
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"Sync status error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load sync status",
        )


# ---------------------------------------------------------------------------
# 10. GET /manager/audit-logs — recent audit logs
# ---------------------------------------------------------------------------

@router.get("/audit-logs", response_model=ApiResponse)
async def get_audit_logs(
    limit: int = Query(50, ge=1, le=500),
    action_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Returns recent audit logs with user names."""
    try:
        stmt = (
            select(
                AuditLog,
                User.name.label("user_name"),
            )
            .outerjoin(User, AuditLog.user_id == User.id)
            .order_by(AuditLog.created_at.desc())
        )

        if action_type:
            stmt = stmt.where(AuditLog.action_type == action_type)

        stmt = stmt.limit(limit)
        result = await db.execute(stmt)
        rows = result.all()

        logs_data = []
        for log, user_name in rows:
            # Generate description from action_type and meta_json
            description = ""
            meta = log.get_meta()
            if meta and isinstance(meta, dict):
                description = meta.get("description", "")
            if not description:
                # Auto-generate description
                entity = log.entity_type or "resource"
                eid = log.entity_id or ""
                action_map = {
                    "collection_recorded": f"Collection recorded for {entity} {eid}",
                    "visit_checkin": f"Visit check-in for {entity} {eid}",
                    "task_completed": f"Task completed for {entity} {eid}",
                    "eod_submitted": "End-of-day report submitted",
                    "promise_recorded": f"Promise to pay recorded for {entity} {eid}",
                    "sync_completed": f"Sync completed for {entity} {eid}",
                    "login": "User logged in",
                    "logout": "User logged out",
                }
                description = action_map.get(log.action_type, f"{log.action_type} on {entity} {eid}")

            logs_data.append({
                "id": log.id,
                "action_type": log.action_type,
                "description": description,
                "user_name": user_name,
                "entity_type": log.entity_type,
                "created_at": str(log.created_at),
            })

        return ApiResponse(success=True, data=logs_data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Audit logs error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load audit logs",
        )


# ---------------------------------------------------------------------------
# GET /manager/receipts — client receipt-SMS log (anti-under-reporting proof)
# ---------------------------------------------------------------------------

@router.get("/receipts", response_model=ApiResponse)
async def get_receipt_notifications(
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Every receipt SMS the system sent to a client on a collection, with the client name.
    This is the manager's proof that clients were told the exact recorded amount."""
    try:
        stmt = (
            select(SmsNotification, Client.name.label("client_name"), Client.member_id.label("member_id"))
            .outerjoin(Client, SmsNotification.client_id == Client.id)
            .order_by(SmsNotification.created_at.desc())
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        data = [{
            "id": n.id,
            "client_name": client_name,
            "member_id": member_id,
            "phone_number": n.phone_number,
            "receipt_id": n.collection_receipt_id,
            "message": n.message,
            "status": n.status,
            "provider": n.provider,
            "created_at": str(n.created_at),
        } for n, client_name, member_id in rows]
        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Receipts error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load receipts")


# ---------------------------------------------------------------------------
# GET /manager/sync-events — full sync-queue log (not just counts)
# ---------------------------------------------------------------------------

@router.get("/sync-events", response_model=ApiResponse)
async def sync_events(
    status_filter: str | None = Query(None, alias="status", description="pending|completed|failed"),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """The full sync-queue log — every offline record's sync attempt with status, retry count,
    and error. Lets the manager see exactly what synced, what's pending, and what failed and why."""
    try:
        q = select(SyncEvent).order_by(SyncEvent.id.desc())
        if status_filter:
            q = q.where(SyncEvent.status == status_filter)
        rows = (await db.execute(q.limit(limit))).scalars().all()
        counts = {"pending": 0, "completed": 0, "failed": 0}
        for r in (await db.execute(select(SyncEvent))).scalars().all():
            counts[r.status] = counts.get(r.status, 0) + 1
        data = {
            "counts": counts,
            "events": [{
                "id": r.id,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "operation": r.operation,
                "status": r.status,
                "retry_count": r.retry_count,
                "last_error": r.last_error,
                "created_at": str(r.created_at),
                "synced_at": r.synced_at,
            } for r in rows],
        }
        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Sync events error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load sync events")


# ---------------------------------------------------------------------------
# GET /manager/pilot-metrics — the pilot success / sales-data rollup
# ---------------------------------------------------------------------------

@router.get("/pilot-metrics", response_model=ApiResponse)
async def pilot_metrics(db: AsyncSession = Depends(get_db)):
    """The numbers that decide whether the pilot succeeded and that become the sales deck:
    adoption, throughput, anti-fraud proof, and reliability."""
    try:
        today = _today_str()

        officers = (await db.execute(
            select(User).where(User.role == UserRole.FIELD_OFFICER.value)
        )).scalars().all()
        officer_ids = {o.id for o in officers}

        cols_today = (await db.execute(
            select(Collection).where(Collection.collected_at.like(f"{today}%"))
        )).scalars().all()
        visits_today = (await db.execute(
            select(VisitCheckin).where(VisitCheckin.checked_in_at.like(f"{today}%"))
        )).scalars().all()
        day_starts_today = (await db.execute(
            select(DayStartRecord).where(DayStartRecord.day_date == today)
        )).scalars().all()

        active_ids = {c.officer_id for c in cols_today} | {v.officer_id for v in visits_today} \
            | {d.officer_id for d in day_starts_today}
        active_ids &= officer_ids

        # Anti-fraud proof
        receipts_sent = (await db.execute(
            select(func.count()).select_from(SmsNotification).where(SmsNotification.status == "sent")
        )).scalar() or 0
        visited_pairs = {(v.officer_id, v.client_id) for v in visits_today}
        anomalies_today = sum(
            (1 if c.gps_latitude is None else 0) +
            (1 if (c.officer_id, c.client_id) not in visited_pairs else 0)
            for c in cols_today
        )

        collections_alltime = (await db.execute(
            select(func.coalesce(func.sum(Collection.amount), 0))
        )).scalar() or 0
        pending_sync = (await db.execute(
            select(func.count()).select_from(SyncEvent).where(SyncEvent.status == "pending")
        )).scalar() or 0

        total_officers = len(officers)
        data = {
            "date": today,
            # Adoption
            "officers_total": total_officers,
            "officers_active_today": len(active_ids),
            "officers_active_pct": round(len(active_ids) / total_officers * 100, 1) if total_officers else 0.0,
            "day_starts_today": len(day_starts_today),
            "day_starts_verified_today": sum(1 for d in day_starts_today if d.ip_verified),
            # Throughput
            "collections_today_count": len(cols_today),
            "collections_today_npr": round(sum(c.amount for c in cols_today), 2),
            "collections_alltime_npr": round(float(collections_alltime), 2),
            "visits_today_count": len(visits_today),
            # Anti-fraud proof
            "receipts_sent_total": receipts_sent,
            "anomalies_today": anomalies_today,
            # Reliability
            "pending_sync": pending_sync,
        }
        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Pilot metrics error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load pilot metrics")


# ---------------------------------------------------------------------------
# GET /manager/officer-activity — one officer's full timeline (where + what)
# ---------------------------------------------------------------------------

@router.get("/officer-activity", response_model=ApiResponse)
async def officer_activity(
    officer_id: int = Query(...),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """A single officer's complete, chronological activity — day-starts, visits (with location),
    collections (amount + location), and audited actions. This is the "select a person, see
    everywhere they were and everything they did" view."""
    try:
        officer = (await db.execute(select(User).where(User.id == officer_id))).scalar_one_or_none()
        if not officer:
            raise HTTPException(status_code=404, detail="Officer not found")
        clients = {c.id: c for c in (await db.execute(select(Client))).scalars().all()}
        cname = lambda cid: clients[cid].name if cid in clients else (f"#{cid}" if cid else None)

        events: list[dict] = []

        for r in (await db.execute(
            select(DayStartRecord).where(DayStartRecord.officer_id == officer_id)
            .order_by(DayStartRecord.id.desc()).limit(limit)
        )).scalars().all():
            events.append({"type": "day_start", "at": r.started_at,
                           "title": "Started day",
                           "detail": ("Office network verified" if r.ip_verified else "Network unverified") + (" · selfie" if r.selfie_data_uri else ""),
                           "address": r.gps_address, "amount": None})

        for v in (await db.execute(
            select(VisitCheckin).where(VisitCheckin.officer_id == officer_id)
            .order_by(VisitCheckin.id.desc()).limit(limit)
        )).scalars().all():
            events.append({"type": "visit", "at": v.checked_in_at,
                           "title": f"Visited {cname(v.client_id) or 'client'}",
                           "detail": v.visit_purpose or "visit",
                           "address": v.gps_address,
                           "lat": v.gps_latitude, "lng": v.gps_longitude, "amount": None})

        for c in (await db.execute(
            select(Collection).where(Collection.officer_id == officer_id)
            .order_by(Collection.id.desc()).limit(limit)
        )).scalars().all():
            events.append({"type": "collection", "at": c.collected_at,
                           "title": f"Collected from {cname(c.client_id) or 'client'}",
                           "detail": f"{c.payment_method or 'cash'} · {c.receipt_id}",
                           "address": c.gps_address,
                           "lat": c.gps_latitude, "lng": c.gps_longitude, "amount": c.amount})

        for a in (await db.execute(
            select(AuditLog).where(AuditLog.user_id == officer_id)
            .order_by(AuditLog.id.desc()).limit(limit)
        )).scalars().all():
            events.append({"type": "audit", "at": str(a.created_at),
                           "title": a.action_type.replace("_", " "),
                           "detail": f"{a.entity_type or ''} {a.entity_id or ''}".strip(),
                           "address": None, "amount": None})

        events.sort(key=lambda e: e["at"] or "", reverse=True)
        return ApiResponse(
            success=True,
            data={"officer": {"id": officer.id, "name": officer.name, "staff_id": officer.staff_id,
                              "role": officer.role},
                  "events": events[:limit]},
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Officer activity error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load officer activity")


# ---------------------------------------------------------------------------
# GET /manager/cash-reconciliation — expected cash vs digital per officer today
# ---------------------------------------------------------------------------

@router.get("/cash-reconciliation", response_model=ApiResponse)
async def cash_reconciliation(db: AsyncSession = Depends(get_db)):
    """Per officer today: total collected, cash (physical cash the officer should be holding),
    and digital. The manager counts the cash in hand and compares it to 'cash' here — any gap is
    leakage or a recording error. All figures are the server's truth from recorded collections."""
    try:
        today = _today_str()
        officers = (await db.execute(
            select(User).where(User.role == UserRole.FIELD_OFFICER.value)
        )).scalars().all()
        data = []
        for o in officers:
            cols = (await db.execute(
                select(Collection).where(
                    Collection.officer_id == o.id,
                    Collection.collected_at.like(f"{today}%"),
                )
            )).scalars().all()
            total = sum(c.amount for c in cols)
            cash = sum(c.amount for c in cols if (c.payment_method or "cash") == "cash")
            data.append({
                "officer_id": o.id, "name": o.name, "staff_id": o.staff_id,
                "collections": len(cols),
                "total_npr": round(total, 2),
                "cash_npr": round(cash, 2),          # physical cash the officer should hold
                "digital_npr": round(total - cash, 2),
            })
        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Cash reconciliation error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load cash reconciliation")


# ---------------------------------------------------------------------------
# GET /manager/anomalies — rule-based fraud/quality flags computed today
# ---------------------------------------------------------------------------

@router.get("/anomalies", response_model=ApiResponse)
async def anomalies(db: AsyncSession = Depends(get_db)):
    """Automatic flags on today's activity, so the manager doesn't have to eyeball everything:
      - collection_without_visit: a payment recorded with no visit check-in for that client/officer
      - collection_without_gps:   a collection saved with location off (possible mock/masking)
      - eod_mismatch:             the officer's End-of-Day total ≠ the actual sum of collections
    """
    try:
        today = _today_str()
        officers = {o.id: o for o in (await db.execute(select(User))).scalars().all()}
        clients = {c.id: c for c in (await db.execute(select(Client))).scalars().all()}

        def oname(oid): return officers[oid].name if oid in officers else f"#{oid}"
        def cname(cid): return clients[cid].name if cid in clients else f"#{cid}"

        cols = (await db.execute(
            select(Collection).where(Collection.collected_at.like(f"{today}%"))
        )).scalars().all()
        visits = (await db.execute(
            select(VisitCheckin).where(VisitCheckin.checked_in_at.like(f"{today}%"))
        )).scalars().all()
        visited = {(v.officer_id, v.client_id) for v in visits}

        flags = []
        for c in cols:
            if c.gps_latitude is None:
                flags.append({
                    "type": "collection_without_gps", "severity": "medium",
                    "officer": oname(c.officer_id), "client": cname(c.client_id),
                    "receipt_id": c.receipt_id, "amount": c.amount,
                    "detail": "Collection recorded with location off",
                })
            if c.officer_id and c.client_id and (c.officer_id, c.client_id) not in visited:
                flags.append({
                    "type": "collection_without_visit", "severity": "high",
                    "officer": oname(c.officer_id), "client": cname(c.client_id),
                    "receipt_id": c.receipt_id, "amount": c.amount,
                    "detail": "Payment recorded but no visit check-in for this client today",
                })

        # EOD declared vs actual
        eods = (await db.execute(
            select(EndOfDayReport).where(EndOfDayReport.report_date == today)
        )).scalars().all()
        actual_by_officer: dict[int, float] = {}
        for c in cols:
            actual_by_officer[c.officer_id] = actual_by_officer.get(c.officer_id, 0.0) + c.amount
        for e in eods:
            actual = actual_by_officer.get(e.officer_id, 0.0)
            if abs((e.total_collections or 0) - actual) > 1.0:
                flags.append({
                    "type": "eod_mismatch", "severity": "high",
                    "officer": oname(e.officer_id), "client": None, "receipt_id": None,
                    "amount": None,
                    "detail": f"EOD declared NPR {e.total_collections:,.0f} but actual collections were NPR {actual:,.0f}",
                })

        order = {"high": 0, "medium": 1, "low": 2}
        flags.sort(key=lambda f: order.get(f["severity"], 3))
        return ApiResponse(success=True, data=flags, timestamp=_ts())
    except Exception as e:
        logger.error(f"Anomalies error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load anomalies")


# ---------------------------------------------------------------------------
# GET /manager/staff-locations — event-based map points + last-seen per officer
# ---------------------------------------------------------------------------

@router.get("/staff-locations", response_model=ApiResponse)
async def get_staff_locations(db: AsyncSession = Depends(get_db)):
    """Each field officer's most recent GPS position plus a short trail, built from the GPS
    already captured at visit check-ins and collections. Event-based (only official actions),
    never continuous tracking — matches what field officers will accept."""
    try:
        officers = (await db.execute(
            select(User).where(User.role == UserRole.FIELD_OFFICER.value)
        )).scalars().all()

        data = []
        for o in officers:
            points: list[dict] = []
            visits = (await db.execute(
                select(VisitCheckin)
                .where(VisitCheckin.officer_id == o.id, VisitCheckin.gps_latitude.isnot(None))
                .order_by(VisitCheckin.checked_in_at.desc()).limit(20)
            )).scalars().all()
            for v in visits:
                points.append({"lat": v.gps_latitude, "lng": v.gps_longitude,
                               "address": v.gps_address, "at": v.checked_in_at, "type": "visit"})
            cols = (await db.execute(
                select(Collection)
                .where(Collection.officer_id == o.id, Collection.gps_latitude.isnot(None))
                .order_by(Collection.collected_at.desc()).limit(20)
            )).scalars().all()
            for c in cols:
                points.append({"lat": c.gps_latitude, "lng": c.gps_longitude,
                               "address": c.gps_address, "at": c.collected_at, "type": "collection"})
            points.sort(key=lambda p: p["at"] or "", reverse=True)
            data.append({
                "officer_id": o.id,
                "name": o.name,
                "staff_id": o.staff_id,
                "last_seen": points[0] if points else None,
                "points": points[:15],
            })
        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Staff locations error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load staff locations")


# ---------------------------------------------------------------------------
# GET /manager/day-starts — day-start attendance (office-network + selfie proof)
# ---------------------------------------------------------------------------

@router.get("/day-starts", response_model=ApiResponse)
async def get_day_starts(
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Recent day-start records with officer name, network-verification, and selfie — the
    manager's proof of who actually started their day at the branch."""
    try:
        stmt = (
            select(DayStartRecord, User.name.label("officer_name"), User.staff_id.label("staff_id"))
            .outerjoin(User, DayStartRecord.officer_id == User.id)
            .order_by(DayStartRecord.created_at.desc())
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        data = [{
            "id": r.id,
            "officer_name": officer_name,
            "staff_id": staff_id,
            "day_date": r.day_date,
            "started_at": r.started_at,
            "source_ip": r.source_ip,
            "ip_verified": r.ip_verified,
            "has_selfie": bool(r.selfie_data_uri),
            "selfie_data_uri": r.selfie_data_uri,
            "gps_address": r.gps_address,
        } for r, officer_name, staff_id in rows]
        return ApiResponse(success=True, data=data, timestamp=_ts())
    except Exception as e:
        logger.error(f"Day-starts error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load day-starts")


# ------ 11. POST /manager/staff — create new staff member ------

@router.post("/staff", response_model=ApiResponse)
async def create_staff(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Branch manager creates a new staff member (e.g. field officer).

    Payload:
      - staff_id: str (unique)
      - name: str
      - name_ne: str | None (optional)
      - phone_number: str | None (optional)
      - role: str (default 'field_officer')
      - branch_id: int | None (defaults to manager's branch)
      - pin: str (plain text, will be bcrypt hashed)
    """
    try:
        staff_id = body.get("staff_id", "").strip()
        name = body.get("name", "").strip()
        pin = body.get("pin", "").strip()
        name_ne = body.get("name_ne", "") or None
        phone_number = body.get("phone_number", "") or None
        role = body.get("role", "field_officer")
        branch_id = body.get("branch_id")

        if not staff_id or not name or not pin:
            raise HTTPException(status_code=400, detail="staff_id, name, and pin are required")

        if len(pin) < 4:
            raise HTTPException(status_code=400, detail="PIN must be at least 4 characters")

        # Check duplicate staff_id
        existing = await db.execute(
            select(User).where(User.staff_id == staff_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Staff ID '{staff_id}' already exists")

        # Get manager's branch if not specified
        if branch_id is None:
            # Use the requesting manager's branch from the context
            # For now, default to the first active branch
            branch_result = await db.execute(select(User.branch_id).where(User.staff_id == "BM-001"))
            bm_branch = branch_result.scalar_one_or_none()
            if bm_branch:
                branch_id = bm_branch

        hashed = hash_pin(pin)
        user = User(
            staff_id=staff_id,
            name=name,
            name_ne=name_ne,
            role=role,
            hashed_pin=hashed,
            branch_id=branch_id,
            phone_number=phone_number,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

        return ApiResponse(
            success=True,
            data={
                "id": user.id,
                "staff_id": user.staff_id,
                "name": user.name,
                "role": user.role,
                "pin": pin,  # Return PIN once for the manager to share
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create staff error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create staff",
        )


# ------ 12. POST /manager/tasks — assign a task ------

@router.post("/tasks", response_model=ApiResponse)
async def create_task(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Branch manager assigns a task to an officer.

    Payload:
      - officer_id: int | None (optional — if omitted, not assigned to a specific officer)
      - client_id: int
      - task_type: str (collection, follow_up, kyc, meeting, complaint, other)
      - task_date: str (YYYY-MM-DD)
      - priority: str (low, normal, high) — default "normal"
      - amount: float | None (optional)
      - reason: str | None (optional)
    """
    try:
        client_id = body.get("client_id")
        task_type = body.get("task_type", "collection")
        task_date = body.get("task_date", _today_str())

        if not client_id or not task_type:
            raise HTTPException(status_code=400, detail="client_id and task_type are required")

        officer_id = body.get("officer_id") or None

        # Validate task_type
        valid_types = {"collection", "follow_up", "kyc", "meeting", "complaint", "other"}
        if task_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"task_type must be one of: {valid_types}")

        # Resolve officer_id: accept numeric User.id OR staff_id string (e.g. "FO-208")
        resolved_user_id: int | None = None
        if officer_id:
            if isinstance(officer_id, int) or (isinstance(officer_id, str) and officer_id.strip().isdigit()):
                resolved_user_id = int(officer_id)
            else:
                # Treat as staff_id — look up User by staff_id
                user_result = await db.execute(select(User).where(User.staff_id == str(officer_id)))
                resolved_user = user_result.scalar_one_or_none()
                resolved_user_id = resolved_user.id if resolved_user else None

        task = TaskAssignment(
            client_id=int(client_id),
            user_id=resolved_user_id,
            task_type=task_type,
            task_date=str(task_date),
            status="pending",
            priority=body.get("priority", "normal"),
            amount=float(body["amount"]) if body.get("amount") else None,
            reason=body.get("reason") or None,
            is_completed=False,
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)

        return ApiResponse(
            success=True,
            data={
                "id": task.id,
                "client_id": task.client_id,
                "client_name": (await _get_client_by_id(db, task.client_id)).name if task.client_id else None,
                "officer_id": task.user_id,
                "task_type": task.task_type,
                "task_date": task.task_date,
                "priority": task.priority,
                "amount": task.amount,
                "status": task.status,
            },
            timestamp=_ts(),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create task error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create task",
        )


# ------ 13. GET /manager/tasks/today — list assigned tasks for today ------

@router.get("/tasks/today", response_model=ApiResponse)
async def get_today_assigned_tasks(
    officer_id: int | None = Query(None, description="Filter by officer ID"),
    db: AsyncSession = Depends(get_db),
):
    """Returns tasks assigned for today, optionally filtered by officer."""
    try:
        today = _today_str()
        query = select(TaskAssignment).where(
            and_(
                TaskAssignment.task_date == today,
                TaskAssignment.status != "completed",
            )
        )
        if officer_id:
            query = query.where(TaskAssignment.user_id == int(officer_id))

        query = query.order_by(
            case((TaskAssignment.priority == "high", 0),
                 (TaskAssignment.priority == "normal", 1),
                 (TaskAssignment.priority == "low", 2),
                 else_=3)
        )
        result = await db.execute(query)
        tasks = result.scalars().all()

        tasks_data = []
        for task in tasks:
            client = None
            if task.client_id:
                client_result = await db.execute(select(Client).where(Client.id == task.client_id))
                client = client_result.scalar_one_or_none()
            officer = None
            if task.user_id:
                officer_result = await db.execute(select(User).where(User.id == task.user_id))
                officer = officer_result.scalar_one_or_none()

            tasks_data.append({
                "id": task.id,
                "client_id": task.client_id,
                "client_name": client.name if client else None,
                "member_id": client.member_id if client else None,
                "officer_id": task.user_id,
                "officer_name": officer.staff_id if officer else None,
                "task_type": task.task_type,
                "task_date": task.task_date,
                "status": task.status,
                "priority": task.priority,
                "amount": task.amount,
                "reason": task.reason,
            })

        return ApiResponse(
            success=True,
            data=tasks_data,
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"Get today assigned tasks error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get tasks",
        )


# ------ 14. GET /manager/clients — list of all clients ----

@router.get("/clients", response_model=ApiResponse)
async def get_manager_clients(
    db: AsyncSession = Depends(get_db),
):
    """Returns all clients for the manager dashboard (used by Assign Task form)."""
    try:
        result = await db.execute(
            select(Client)
            .order_by(Client.name)
        )
        clients = result.scalars().all()

        clients_data = []
        for c in clients:
            loans_count = (await db.execute(
                select(func.count()).select_from(LoanAccount).where(LoanAccount.client_id == c.id)
            )).scalar() or 0

            clients_data.append({
                "id": c.id,
                "name": c.name,
                "member_id": c.member_id,
                "center": c.center_name,
                "outstanding_balance": round(c.outstanding_balance, 2),
                "due_amount": round(c.due_amount, 2),
                "overdue_days": c.overdue_days,
                "status": c.status,
                "loans_count": loans_count,
            })

        return ApiResponse(
            success=True,
            data=clients_data,
            timestamp=_ts(),
        )
    except Exception as e:
        logger.error(f"Get clients error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get clients",
        )
