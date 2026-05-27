from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from enum import Enum as PyEnum

from app.database import Base


class ClientStatus(str, PyEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    CLOSED = "closed"
    WRITTEN_OFF = "written_off"


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    member_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_ne: Mapped[str | None] = mapped_column(String(200), nullable=True)
    center_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    center_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ward: Mapped[str | None] = mapped_column(String(50), nullable=True)
    loan_cycle: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outstanding_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    due_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    next_installment_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    overdue_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
