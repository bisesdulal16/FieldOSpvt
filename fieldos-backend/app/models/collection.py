from datetime import datetime
from sqlalchemy import String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    receipt_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("task_assignments.id"), nullable=True)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    visit_id: Mapped[int | None] = mapped_column(ForeignKey("visit_checkins.id"), nullable=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    due_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    outstanding_after: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(30), default="cash", nullable=False)
    is_high_value: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    face_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    gps_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    collected_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cbs_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
