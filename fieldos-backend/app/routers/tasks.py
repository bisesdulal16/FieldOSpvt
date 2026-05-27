import time
import logging
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.task import TaskAssignment
from app.models.client import Client
from app.schemas.common import ApiResponse, PaginatedResponse
from app.services import auth_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["Tasks"])


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
        "amount": task.amount,
        "is_completed": task.is_completed,
        "completed_at": task.completed_at,
    }


@router.get("/today", response_model=ApiResponse)
async def get_today_tasks(
    status_filter: str | None = Query(None, alias="status", description="Filter by status"),
    type_filter: str | None = Query(None, alias="type", description="Filter by type"),
    authorization: str = Query(None, description="Bearer token"),
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = None
        if authorization:
            token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
            payload = auth_service.verify_token(token)
            if payload:
                user_id = int(payload.get("sub", 0))

        today_str = str(date.today())
        query = select(TaskAssignment).where(TaskAssignment.task_date == today_str)

        if user_id:
            query = query.where(TaskAssignment.user_id == user_id)
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


@router.get("/", response_model=ApiResponse)
async def get_tasks(
    status_filter: str | None = Query(None, alias="status"),
    type_filter: str | None = Query(None, alias="type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
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
