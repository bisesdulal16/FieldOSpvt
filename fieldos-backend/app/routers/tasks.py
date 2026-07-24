import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.task import TaskAssignment
from app.models.client import Client
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedResponse
from app.deps.auth_deps import get_current_user, require_financial_access
from app.utils.nepal_time import today_nepal_str

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["Tasks"],
                   dependencies=[Depends(require_financial_access)])


def _task_to_dict(task: TaskAssignment, client: Client | None = None) -> dict:
    return {
        "id": task.id,
        "client_id": task.client_id,
        "client_name": client.name if client else None,
        "member_id": client.member_id if client else None,
        "task_type": task.task_type,
        "task_date": task.task_date,
        "status": task.status,
        "priority": task.priority,
        "reason": task.reason,
        # The task feed shows the client's CURRENT due (single source of truth), so it
        # matches the profile/collect screens and drops as collections reduce the balance.
        # Falls back to the task's frozen amount only when the client isn't loaded.
        "amount": (float(client.due_amount) if client and client.due_amount is not None else task.amount),
        "due_amount": (float(client.due_amount) if client else None),
        "outstanding_balance": (float(client.outstanding_balance) if client else None),
        "is_completed": task.is_completed,
        "completed_at": task.completed_at,
    }


@router.get("/today", response_model=ApiResponse)
async def get_today_tasks(
    status_filter: str | None = Query(None, alias="status", description="Filter by status"),
    type_filter: str | None = Query(None, alias="type", description="Filter by type"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        today_str = today_nepal_str()
        # Scope to the authenticated officer's own tasks.
        query = select(TaskAssignment).where(
            TaskAssignment.task_date == today_str,
            TaskAssignment.user_id == current_user.id,
        )

        if status_filter:
            query = query.where(TaskAssignment.status == status_filter)
        if type_filter:
            query = query.where(TaskAssignment.task_type == type_filter)

        query = query.order_by(TaskAssignment.priority.desc())
        result = await db.execute(query)
        tasks = result.scalars().all()

        tasks_data = []
        for task in tasks:
            client = None
            if task.client_id:
                client_result = await db.execute(select(Client).where(Client.id == task.client_id))
                client = client_result.scalar_one_or_none()
            tasks_data.append(_task_to_dict(task, client))

        return ApiResponse(
            success=True,
            data=tasks_data,
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Get today tasks error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get tasks")


def _priority_for(client: Client, has_task_today: bool) -> dict:
    """Rank one of the officer's own clients by real overdue/due signals."""
    overdue = int(client.overdue_days or 0)
    due = float(client.due_amount or 0)
    outstanding = float(client.outstanding_balance or 0)
    npa_risk = overdue >= 30
    score = overdue * 10 + (5 if due > 0 else 0) + (50 if npa_risk else 0) + (5 if has_task_today else 0)
    if npa_risk:
        tier, suggestion = "critical", "At NPA risk — escalate and visit today."
    elif overdue >= 7:
        tier, suggestion = "high", f"{overdue} days overdue — prioritise collection."
    elif overdue > 0:
        tier, suggestion = "medium", "Overdue — follow up on this installment."
    elif due > 0:
        tier, suggestion = "medium", "Installment due — collect on today's visit."
    else:
        tier, suggestion = "normal", "No dues outstanding."
    return {
        "client_id": client.id, "member_id": client.member_id, "client_name": client.name,
        "center_name": client.center_name, "assigned_officer": None, "officer_id": None,
        "overdue_days": overdue, "due_amount_npr": due, "outstanding_npr": outstanding,
        "status": client.status or "active", "promised_today": False, "missed_visit": False,
        "npa_risk": npa_risk, "missed_ptp": False, "priority_score": score,
        "priority_tier": tier, "priority_factors": [], "suggestion": suggestion,
    }


@router.get("/priority", response_model=ApiResponse)
async def get_priority_queue(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The authenticated officer's OWN clients, ranked by real overdue/due signals.
    Replaces the old mock priority feed on the app Home. Officer-scoped via the JWT."""
    try:
        today_str = today_nepal_str()
        # Clients this officer has any task for (their book of business).
        tasks = (await db.execute(
            select(TaskAssignment).where(TaskAssignment.user_id == current_user.id)
        )).scalars().all()
        today_client_ids = {t.client_id for t in tasks if t.task_date == today_str and t.client_id}
        client_ids = {t.client_id for t in tasks if t.client_id}

        queue: list[dict] = []
        for cid in client_ids:
            client = (await db.execute(select(Client).where(Client.id == cid))).scalar_one_or_none()
            if client:
                queue.append(_priority_for(client, cid in today_client_ids))
        queue.sort(key=lambda x: x["priority_score"], reverse=True)

        tier_counts: dict[str, int] = {}
        for c in queue:
            tier_counts[c["priority_tier"]] = tier_counts.get(c["priority_tier"], 0) + 1

        return ApiResponse(
            success=True,
            data={"total_clients": len(queue), "tier_counts": tier_counts, "queue": queue},
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Get priority queue error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get priority queue")


@router.get("/", response_model=ApiResponse)
async def get_tasks(
    status_filter: str | None = Query(None, alias="status"),
    type_filter: str | None = Query(None, alias="type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        query = select(TaskAssignment)
        if status_filter:
            query = query.where(TaskAssignment.status == status_filter)
        if type_filter:
            query = query.where(TaskAssignment.task_type == type_filter)

        from sqlalchemy import func
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(TaskAssignment.task_date.desc()).offset((page - 1) * page_size).limit(page_size)
        result = await db.execute(query)
        tasks = result.scalars().all()

        tasks_data = []
        for task in tasks:
            client = None
            if task.client_id:
                client_result = await db.execute(select(Client).where(Client.id == task.client_id))
                client = client_result.scalar_one_or_none()
            tasks_data.append(_task_to_dict(task, client))

        return PaginatedResponse(
            success=True,
            data=tasks_data,
            pagination={
                "page": page,
                "page_size": page_size,
                "total": total,
                "pages": (total + page_size - 1) // page_size,
            },
            timestamp=int(time.time()),
        )
    except Exception as e:
        logger.error(f"Get tasks error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get tasks")
