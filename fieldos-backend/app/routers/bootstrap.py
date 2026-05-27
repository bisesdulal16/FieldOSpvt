import time
import logging
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.user import User
from app.models.branch import Branch
from app.models.client import Client
from app.models.task import TaskAssignment
from app.schemas.common import ApiResponse
from app.services import auth_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mobile", tags=["Mobile Bootstrap"])


@router.get("/bootstrap", response_model=ApiResponse)
async def bootstrap(
    authorization: str = Query(..., description="Bearer token"),
    db: AsyncSession = Depends(get_db),
):
    try:
        token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
        payload = auth_service.verify_token(token)
        if not payload or payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

        user_id = payload.get("sub")
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

        # Get branch
        branch = None
        if user.branch_id:
            branch_result = await db.execute(select(Branch).where(Branch.id == user.branch_id))
            branch = branch_result.scalar_one_or_none()

        # Get clients
        clients_result = await db.execute(
            select(Client).where(Client.status == "active").order_by(Client.name)
        )
        clients = clients_result.scalars().all()
        clients_data = [
            {
                "id": c.id,
                "member_id": c.member_id,
                "name": c.name,
                "name_ne": c.name_ne,
                "center_id": c.center_id,
                "center_name": c.center_name,
                "ward": c.ward,
                "outstanding_balance": c.outstanding_balance,
                "due_amount": c.due_amount,
                "overdue_days": c.overdue_days,
                "status": c.status,
                "next_installment_date": c.next_installment_date,
                "loan_cycle": c.loan_cycle,
            }
            for c in clients
        ]

        # Get today's tasks
        today_str = str(date.today())
        tasks_result = await db.execute(
            select(TaskAssignment)
            .where(TaskAssignment.user_id == user.id, TaskAssignment.task_date == today_str)
            .order_by(TaskAssignment.priority.desc())
        )
        tasks = tasks_result.scalars().all()
        tasks_data = [
            {
                "id": t.id,
                "client_id": t.client_id,
                "task_type": t.task_type,
                "task_date": t.task_date,
                "status": t.status,
                "priority": t.priority,
                "reason": t.reason,
                "amount": t.amount,
                "is_completed": t.is_completed,
            }
            for t in tasks
        ]

        return ApiResponse(
            success=True,
            data={
                "user": {
                    "id": user.id,
                    "staff_id": user.staff_id,
                    "name": user.name,
                    "name_ne": user.name_ne,
                    "role": user.role,
                    "branch_id": user.branch_id,
                    "branch_name": branch.name if branch else None,
                },
                "branch": {
                    "id": branch.id,
                    "branch_id": branch.branch_id,
                    "name": branch.name,
                    "name_ne": branch.name_ne,
                    "address": branch.address,
                } if branch else None,
                "clients": clients_data,
                "tasks": tasks_data,
                "app_settings": {
                    "gps_accuracy_threshold": 50,
                    "face_verification_required": True,
                    "high_value_threshold": 50000,
                    "max_daily_collection": 500000,
                    "sync_interval_seconds": 300,
                    "offline_mode_enabled": True,
                },
            },
            timestamp=int(time.time()),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bootstrap error: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Bootstrap failed")
