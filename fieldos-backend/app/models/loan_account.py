from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from enum import Enum as PyEnum

from app.database import Base


class LoanAccount(Base):
    __tablename__ = "loan_accounts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    loan_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    product_type: Mapped[str] = mapped_column(String(30), nullable=False, default="micro_loan")
    disbursement_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    maturity_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    principal_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    outstanding_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    installment_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    installment_frequency: Mapped[str | None] = mapped_column(String(20), nullable=True)
    term_weeks: Mapped[int] = mapped_column(Integer, default=25, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
