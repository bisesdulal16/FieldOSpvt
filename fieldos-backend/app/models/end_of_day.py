import json
from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EndOfDayReport(Base):
    __tablename__ = "end_of_day_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    report_date: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    total_collections: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_visits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    pending_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exceptions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_submitted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    face_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    officer = relationship("User", back_populates="eod_reports")

    @property
    def exceptions(self) -> dict | None:
        if self.exceptions_json:
            return json.loads(self.exceptions_json)
        return None

    @exceptions.setter
    def exceptions(self, value: dict | None):
        self.exceptions_json = json.dumps(value) if value else None
