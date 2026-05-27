from pydantic import BaseModel


class PromiseToPayCreate(BaseModel):
    client_id: int
    task_id: int | None = None
    promised_amount: float
    expected_payment_date: str | None = None
    reason: str | None = None
    outstanding_amount: float
