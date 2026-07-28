"""client communication ledger and transactional outbox

Revision ID: 010_client_communication_ledger
Revises: 009_p3_branch_scoping_ptp_eod
Create Date: 2026-07-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "010_client_communication_ledger"
down_revision: Union[str, None] = "009_p3_branch_scoping_ptp_eod"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "client_communication_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("collection_id", sa.Integer(), sa.ForeignKey("collections.id"), nullable=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=True),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("officer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("purpose", sa.String(length=50), nullable=False, server_default="collection_verification"),
        sa.Column("event_type", sa.String(length=50), nullable=False, server_default="collection_verification"),
        sa.Column("verification_type", sa.String(length=30), nullable=True),
        sa.Column("risk_level", sa.String(length=20), nullable=False, server_default="normal"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("idempotency_key", sa.String(length=160), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("source_system", sa.String(length=50), nullable=False, server_default="fieldos"),
        sa.Column("source_reference", sa.String(length=120), nullable=True),
        sa.Column("language", sa.String(length=12), nullable=False, server_default="en"),
        sa.Column("priority", sa.String(length=20), nullable=False, server_default="normal"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("disputed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_client_comm_events_collection_id", "client_communication_events", ["collection_id"])
    op.create_index("ix_client_comm_events_client_id", "client_communication_events", ["client_id"])
    op.create_index("ix_client_comm_events_branch_id", "client_communication_events", ["branch_id"])
    op.create_index("ix_client_comm_events_officer_id", "client_communication_events", ["officer_id"])
    op.create_index("ix_client_comm_events_purpose", "client_communication_events", ["purpose"])
    op.create_index("ix_client_comm_events_event_type", "client_communication_events", ["event_type"])
    op.create_index("ix_client_comm_events_risk_level", "client_communication_events", ["risk_level"])
    op.create_index("ix_client_comm_events_status", "client_communication_events", ["status"])
    op.create_index("ix_client_comm_events_scheduled_for", "client_communication_events", ["scheduled_for"])
    op.create_index("ix_client_comm_events_source_reference", "client_communication_events", ["source_reference"])
    op.create_index("ix_client_comm_events_priority", "client_communication_events", ["priority"])
    op.create_index("uq_client_comm_events_idempotency_key", "client_communication_events", ["idempotency_key"], unique=True)
    op.create_index("uq_client_comm_events_collection_verification", "client_communication_events", ["collection_id"], unique=True, postgresql_where=sa.text("purpose = 'collection_verification' AND collection_id IS NOT NULL"))

    op.create_table(
        "client_communication_attempts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("client_communication_events.id"), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False, server_default="log"),
        sa.Column("provider_reference", sa.String(length=160), nullable=True),
        sa.Column("recipient", sa.String(length=80), nullable=True),
        sa.Column("attempt_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="queued"),
        sa.Column("queued_at", sa.DateTime(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("answered_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("client_response", sa.String(length=40), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_client_comm_attempts_event_id", "client_communication_attempts", ["event_id"])
    op.create_index("ix_client_comm_attempts_channel", "client_communication_attempts", ["channel"])
    op.create_index("ix_client_comm_attempts_provider", "client_communication_attempts", ["provider"])
    op.create_index("ix_client_comm_attempts_provider_reference", "client_communication_attempts", ["provider_reference"])
    op.create_index("ix_client_comm_attempts_status", "client_communication_attempts", ["status"])
    op.create_index("uq_client_comm_attempt_event_channel_number", "client_communication_attempts", ["event_id", "channel", "attempt_number"], unique=True)

    op.create_table(
        "client_communication_outbox",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("client_communication_events.id"), nullable=False),
        sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("client_communication_attempts.id"), nullable=True),
        sa.Column("queue_name", sa.String(length=80), nullable=False, server_default="client_communication.sms"),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("idempotency_key", sa.String(length=180), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=True),
        sa.Column("locked_at", sa.DateTime(), nullable=True),
        sa.Column("locked_by", sa.String(length=80), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_client_comm_outbox_event_id", "client_communication_outbox", ["event_id"])
    op.create_index("ix_client_comm_outbox_attempt_id", "client_communication_outbox", ["attempt_id"])
    op.create_index("ix_client_comm_outbox_queue_name", "client_communication_outbox", ["queue_name"])
    op.create_index("ix_client_comm_outbox_status", "client_communication_outbox", ["status"])
    op.create_index("ix_client_comm_outbox_available_at", "client_communication_outbox", ["available_at"])
    op.create_index("uq_client_comm_outbox_idempotency_key", "client_communication_outbox", ["idempotency_key"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_client_comm_outbox_idempotency_key", table_name="client_communication_outbox")
    op.drop_index("ix_client_comm_outbox_available_at", table_name="client_communication_outbox")
    op.drop_index("ix_client_comm_outbox_status", table_name="client_communication_outbox")
    op.drop_index("ix_client_comm_outbox_queue_name", table_name="client_communication_outbox")
    op.drop_index("ix_client_comm_outbox_attempt_id", table_name="client_communication_outbox")
    op.drop_index("ix_client_comm_outbox_event_id", table_name="client_communication_outbox")
    op.drop_table("client_communication_outbox")

    op.drop_index("uq_client_comm_attempt_event_channel_number", table_name="client_communication_attempts")
    op.drop_index("ix_client_comm_attempts_status", table_name="client_communication_attempts")
    op.drop_index("ix_client_comm_attempts_provider_reference", table_name="client_communication_attempts")
    op.drop_index("ix_client_comm_attempts_provider", table_name="client_communication_attempts")
    op.drop_index("ix_client_comm_attempts_channel", table_name="client_communication_attempts")
    op.drop_index("ix_client_comm_attempts_event_id", table_name="client_communication_attempts")
    op.drop_table("client_communication_attempts")

    op.drop_index("uq_client_comm_events_collection_verification", table_name="client_communication_events")
    op.drop_index("uq_client_comm_events_idempotency_key", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_priority", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_source_reference", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_scheduled_for", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_status", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_risk_level", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_event_type", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_purpose", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_officer_id", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_branch_id", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_client_id", table_name="client_communication_events")
    op.drop_index("ix_client_comm_events_collection_id", table_name="client_communication_events")
    op.drop_table("client_communication_events")
