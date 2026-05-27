"""
CBS (Core Banking System) Integration Models — Phase 12A/12B/12C

6 tables:
  - CBSImportLog: tracks CBS data imports
  - CBSClientSnapshot: client data pulled from CBS
  - CBSLoanSnapshot: loan account data from CBS
  - CBSScheduleItem: installment due schedule from CBS
  - CollectionEvent: collection events for reconciliation (Phase 12B)
  - CBSPostingLog: CBS write-back log (Phase 12C)
"""
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CBSImportLog(Base):
    __tablename__ = "cbs_import_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="csv")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    record_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CBSClientSnapshot(Base):
    __tablename__ = "cbs_client_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    cbs_member_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_ne: Mapped[str | None] = mapped_column(String(200), nullable=True)
    center_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    center_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ward: Mapped[str | None] = mapped_column(String(50), nullable=True)
    loan_cycle: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    outstanding_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    due_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    overdue_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_installment_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="cbs")
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CBSLoanSnapshot(Base):
    __tablename__ = "cbs_loan_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True)
    cbs_loan_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    product_type: Mapped[str] = mapped_column(String(30), nullable=False, default="micro_loan")
    principal_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    outstanding_balance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    installment_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    installment_frequency: Mapped[str | None] = mapped_column(String(20), nullable=True)
    disbursement_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    maturity_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    par_status: Mapped[str] = mapped_column(String(30), nullable=False, default="current")
    total_installments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    paid_installments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_payment_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_payment_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="cbs")
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CBSScheduleItem(Base):
    __tablename__ = "cbs_schedule_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    loan_snapshot_id: Mapped[int] = mapped_column(ForeignKey("cbs_loan_snapshots.id"), nullable=False, index=True)
    installment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[str] = mapped_column(String(20), nullable=False)
    due_amount: Mapped[float] = mapped_column(Float, nullable=False)
    paid_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    paid_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    days_overdue: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CollectionEvent(Base):
    __tablename__ = "collection_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    collection_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    receipt_id: Mapped[str] = mapped_column(String(50), nullable=False)
    client_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    member_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    officer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    event_status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending_review")
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cbs_posting_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CBSPostingLog(Base):
    __tablename__ = "cbs_posting_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("collection_events.id"), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    client_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    receipt_id: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    request_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
