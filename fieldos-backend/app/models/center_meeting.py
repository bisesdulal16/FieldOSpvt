from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CenterMeeting(Base):
    __tablename__ = "center_meetings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    center_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    center_name: Mapped[str] = mapped_column(String(200), nullable=False)
    meeting_date: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    total_members: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    present_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    paid_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    absent_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    followup_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    collection_expected: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    collection_received: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")

    attendance_records = relationship("MeetingAttendance", back_populates="meeting", cascade="all, delete-orphan")


class MeetingAttendance(Base):
    __tablename__ = "meeting_attendance"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("center_meetings.id"), nullable=False)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    member_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    attendance_status: Mapped[str] = mapped_column(String(20), nullable=False, default="present")

    meeting = relationship("CenterMeeting", back_populates="attendance_records")
