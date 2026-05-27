from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


class TaskBase(BaseModel):
    client_id: int | None = None
    task_type: str
    task_date: date
    priority: str = "medium"
    reason: str | None = None
    amount: Decimal | None = None


class TaskCreate(TaskBase):
    pass


class TaskResponse(TaskBase):
    id: int
    status: str
    is_completed: bool
    completed_at: datetime | None = None
    client_name: str | None = None
    member_id: str | None = None

    model_config = ConfigDict(from_attributes=True)
