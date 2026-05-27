from datetime import datetime
from sqlalchemy import String, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import DateTime
from enum import Enum as PyEnum

from app.database import Base


class UserRole(str, PyEnum):
    FIELD_OFFICER = "field_officer"
    BRANCH_MANAGER = "branch_manager"
    AREA_MANAGER = "area_manager"
    ADMIN = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    staff_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_ne: Mapped[str | None] = mapped_column(String(200), nullable=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default=UserRole.FIELD_OFFICER.value)
    hashed_pin: Mapped[str] = mapped_column(String(200), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    branch = relationship("Branch", back_populates="users")
    devices = relationship("Device", back_populates="user")
    tasks = relationship("TaskAssignment", back_populates="assigned_user")
    eod_reports = relationship("EndOfDayReport", back_populates="officer")
