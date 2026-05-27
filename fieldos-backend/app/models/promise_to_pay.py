from datetime import datetime
from sqlalchemy import String, Float, ForeignKey, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from enum import Enum as PyEnum

from app.database import Base


class PromiseToPay(Base):
    __tablename__ = "promise_to_pay"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("task_assignments.id"), nullable=True)
    promised_amount: Mapped[float] = mapped_column(Float, nullable=False)
    expected_payment_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    outstanding_amount: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
