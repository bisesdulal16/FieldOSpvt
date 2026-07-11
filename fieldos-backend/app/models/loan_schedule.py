from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LoanScheduleItem(Base):
    """One installment row in a loan's repayment schedule, generated at disbursement."""
    __tablename__ = "loan_schedule_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    loan_id: Mapped[int] = mapped_column(ForeignKey("loan_accounts.id"), nullable=False, index=True)
    installment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    principal_component: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    interest_component: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
