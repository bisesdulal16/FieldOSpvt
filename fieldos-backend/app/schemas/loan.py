from pydantic import BaseModel


class BorrowerCreate(BaseModel):
    """Register a new borrower (field officer)."""
    name: str
    name_ne: str | None = None
    center_id: str | None = None
    center_name: str | None = None
    ward: str | None = None


class LoanApplicationCreate(BaseModel):
    """Submit a loan application for an existing borrower (field officer)."""
    client_id: int
    product_type: str = "micro_loan"
    principal_amount: float
    term_weeks: int = 25
    interest_rate_pct: float = 18.0  # annual flat, for schedule generation


class LoanDisburseRequest(BaseModel):
    disbursement_date: str | None = None  # defaults to Nepal today


class ScheduleItemResponse(BaseModel):
    installment_no: int
    due_date: str
    amount: float
    is_paid: bool


class LoanResponse(BaseModel):
    id: int
    loan_id: str
    client_id: int | None
    product_type: str
    principal_amount: float
    outstanding_balance: float
    installment_amount: float
    installment_frequency: str | None
    status: str
    disbursement_date: str | None
    maturity_date: str | None
