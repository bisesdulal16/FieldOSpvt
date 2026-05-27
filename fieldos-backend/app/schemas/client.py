from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


class ClientSummary(BaseModel):
    id: int
    member_id: str
    name: str
    name_ne: str | None = None
    center_id: str | None = None
    center_name: str | None = None
    ward: str | None = None
    outstanding_balance: Decimal
    due_amount: Decimal
    overdue_days: int
    status: str

    model_config = ConfigDict(from_attributes=True)


class ClientDetail(ClientSummary):
    loan_cycle: int | None = None
    next_installment_date: date | None = None
    loans: list[dict] = []
    recent_collections: list[dict] = []

    model_config = ConfigDict(from_attributes=True)
