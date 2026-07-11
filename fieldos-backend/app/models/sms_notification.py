from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SmsNotification(Base):
    """
    Record of every receipt SMS the SYSTEM sends to a client on a collection.

    This is the anti-under-reporting control: the server (not the officer) messages the client
    the exact recorded amount, and this table is the tamper-evident proof that it happened. The
    manager can see, per collection, that the client was notified of the amount on record.
    """
    __tablename__ = "sms_notifications"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    collection_receipt_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    kind: Mapped[str] = mapped_column(String(30), default="collection_receipt", nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String(20), default="log", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)  # queued|sent|failed|no_phone
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
