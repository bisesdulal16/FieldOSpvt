from datetime import datetime
from sqlalchemy import String, Integer, Text, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DayStartRecord(Base):
    """
    Proof that an officer actually started their day at the branch.

    Two anti-fraud signals, both captured server-side:
      - ip_verified: the day-start request came from the branch's registered office IP
        (i.e. the officer was physically on the branch network — hard to spoof).
      - selfie: a photo taken at start-of-day for the manager to spot-check.
    """
    __tablename__ = "day_start_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    day_date: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    started_at: Mapped[str] = mapped_column(String(30), nullable=False)
    source_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    selfie_data_uri: Mapped[str | None] = mapped_column(Text, nullable=True)  # base64 data URI (pilot; use object storage in prod)
    gps_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
