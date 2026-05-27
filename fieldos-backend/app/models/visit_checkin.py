from datetime import datetime
from sqlalchemy import String, Float, Text, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class VisitCheckin(Base):
    __tablename__ = "visit_checkins"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("task_assignments.id"), nullable=True)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    visit_purpose: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gps_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    gps_accuracy_meters: Mapped[float | None] = mapped_column(Float, nullable=True)
    checked_in_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
    synced_at: Mapped[str | None] = mapped_column(String(30), nullable=True)
