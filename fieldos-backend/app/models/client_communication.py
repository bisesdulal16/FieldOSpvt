from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, UniqueConstraint, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ClientCommunicationEvent(Base):
    """Official ledger event for client-facing protection/communication.

    This is intentionally broader than post-payment verification so the same
    ledger can later support due reminders, overdue reminders, PTP reminders,
    dispute acknowledgements, and protection alerts without inventing a second
    queue/state model. Phase 1 implements only collection_verification.
    """

    __tablename__ = "client_communication_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    collection_id: Mapped[int | None] = mapped_column(ForeignKey("collections.id"), nullable=True, index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    purpose: Mapped[str] = mapped_column(String(50), nullable=False, default="collection_verification", index=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, default="collection_verification", index=True)
    verification_type: Mapped[str | None] = mapped_column(String(30), nullable=True, default="receipt")
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False, default="normal", index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)

    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    source_system: Mapped[str] = mapped_column(String(50), nullable=False, default="fieldos")
    source_reference: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    language: Mapped[str] = mapped_column(String(12), nullable=False, default="en")
    sms_template_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    sms_template_version: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="normal", index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    disputed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ClientCommunicationAttempt(Base):
    """One channel/provider attempt for a client communication event."""

    __tablename__ = "client_communication_attempts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("client_communication_events.id"), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="log", index=True)
    provider_reference: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    recipient: Mapped[str | None] = mapped_column(String(80), nullable=True)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="queued", index=True)

    queued_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_event_id: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    provider_status_raw: Mapped[str | None] = mapped_column(String(120), nullable=True)
    callback_received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivery_failed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    callback_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_response: Mapped[str | None] = mapped_column(String(40), nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    sms_template_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    sms_template_version: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    provider_call_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ClientCommunicationOutbox(Base):
    """Transactional outbox row created with the official ledger event."""

    __tablename__ = "client_communication_outbox"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("client_communication_events.id"), nullable=False, index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("client_communication_attempts.id"), nullable=True, index=True)
    queue_name: Mapped[str] = mapped_column(String(80), nullable=False, default="client_communication.sms", index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(180), nullable=False, unique=True, index=True)
    available_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    broker_message_id: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    broker_published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    broker_retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recovery_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_attempted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_recovered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_recovered_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sms_template_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    sms_template_version: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    provider_call_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ClientCommunicationWorkerHeartbeat(Base):
    """Last known status for a communication outbox worker process."""

    __tablename__ = "client_communication_worker_heartbeats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    worker_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    process_alive: Mapped[bool] = mapped_column(default=True, nullable=False)
    worker_enabled: Mapped[bool] = mapped_column(default=False, nullable=False)
    last_successful_poll: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_successful_dispatch: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ClientCommunicationCallbackReceipt(Base):
    """Authenticated provider callback receipt for idempotency and replay protection."""

    __tablename__ = "client_communication_callback_receipts"
    __table_args__ = (
        UniqueConstraint("provider", "provider_event_id", name="uq_client_comm_callback_provider_event"),
        UniqueConstraint("signature_digest", name="uq_client_comm_callback_signature_digest"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_event_id: Mapped[str] = mapped_column(String(160), nullable=False)
    provider_reference: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("client_communication_attempts.id"), nullable=True, index=True)
    event_id: Mapped[int | None] = mapped_column(ForeignKey("client_communication_events.id"), nullable=True, index=True)
    normalized_status: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_status_raw: Mapped[str | None] = mapped_column(String(120), nullable=True)
    signature_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    callback_payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    action_taken: Mapped[str] = mapped_column(String(40), nullable=False, default="received")



class SmsConsentEvidence(Base):
    __tablename__ = "sms_consent_evidence"
    __table_args__ = (
        UniqueConstraint("recipient_hash", "purpose", "consent_version", "branch_id", "status", name="uq_sms_consent_record_scope"),
    )
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)
    recipient_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recipient_hash_version: Mapped[str] = mapped_column(String(40), nullable=False, default="hmac_sha256_v1", index=True)
    protected_recipient_ref: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    purpose: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    consent_source: Mapped[str] = mapped_column(String(80), nullable=False)
    consent_version: Mapped[str] = mapped_column(String(40), nullable=False, default="v1")
    granted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    evidence_reference: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class SmsSuppressionRecord(Base):
    __tablename__ = "sms_suppression_records"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    recipient_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recipient_hash_version: Mapped[str] = mapped_column(String(40), nullable=False, default="hmac_sha256_v1", index=True)
    protected_recipient_ref: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    scope: Mapped[str] = mapped_column(String(40), nullable=False, default="global", index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False, index=True)
    effective_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class SmsApprovedTemplate(Base):
    __tablename__ = "sms_approved_templates"
    __table_args__ = (UniqueConstraint("template_key", "version", "language", "branch_id", name="uq_sms_template_version_scope"),)
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    template_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(12), nullable=False, default="en", index=True)
    purpose: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    body_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    managed_content_ref: Mapped[str | None] = mapped_column(String(240), nullable=True)
    allowed_variables_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    active: Mapped[bool] = mapped_column(default=False, nullable=False, index=True)
    approval_status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft", index=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    tenant_scope: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class SmsQuotaReservation(Base):
    __tablename__ = "sms_quota_reservations"
    __table_args__ = (
        UniqueConstraint("reservation_key", name="uq_sms_quota_reservation_key"),
        UniqueConstraint("outbox_id", name="uq_sms_quota_outbox"),
    )
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    reservation_key: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    outbox_id: Mapped[int | None] = mapped_column(ForeignKey("client_communication_outbox.id"), nullable=True, index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("client_communication_attempts.id"), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    recipient_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    recipient_hash_version: Mapped[str] = mapped_column(String(40), nullable=False, default="hmac_sha256_v1", index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True, index=True)
    quota_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    quota_timezone: Mapped[str] = mapped_column(String(80), nullable=False)
    reserved_message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reserved_cost: Mapped[float] = mapped_column(Numeric(12, 4), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="reserved", index=True)
    reserved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    provider_call_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    uncertain_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
