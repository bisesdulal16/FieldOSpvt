"""client communication delivery callbacks

Revision ID: 012_comm_callbacks
Revises: 011_comm_outbox_worker
Create Date: 2026-07-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "012_comm_callbacks"
down_revision: Union[str, None] = "011_comm_outbox_worker"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("client_communication_attempts", sa.Column("provider_event_id", sa.String(length=160), nullable=True))
    op.add_column("client_communication_attempts", sa.Column("provider_status_raw", sa.String(length=120), nullable=True))
    op.add_column("client_communication_attempts", sa.Column("callback_received_at", sa.DateTime(), nullable=True))
    op.add_column("client_communication_attempts", sa.Column("delivery_failed_at", sa.DateTime(), nullable=True))
    op.add_column("client_communication_attempts", sa.Column("callback_payload_hash", sa.String(length=64), nullable=True))
    op.create_index("ix_client_comm_attempts_provider_event_id", "client_communication_attempts", ["provider_event_id"])

    op.create_table(
        "client_communication_callback_receipts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("provider_event_id", sa.String(length=160), nullable=False),
        sa.Column("provider_reference", sa.String(length=160), nullable=True),
        sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("client_communication_attempts.id"), nullable=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("client_communication_events.id"), nullable=True),
        sa.Column("normalized_status", sa.String(length=40), nullable=False),
        sa.Column("provider_status_raw", sa.String(length=120), nullable=True),
        sa.Column("signature_digest", sa.String(length=64), nullable=False),
        sa.Column("callback_payload_hash", sa.String(length=64), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("action_taken", sa.String(length=40), nullable=False, server_default="received"),
        sa.UniqueConstraint("provider", "provider_event_id", name="uq_client_comm_callback_provider_event"),
        sa.UniqueConstraint("signature_digest", name="uq_client_comm_callback_signature_digest"),
    )
    op.create_index("ix_client_comm_callback_provider_reference", "client_communication_callback_receipts", ["provider_reference"])
    op.create_index("ix_client_comm_callback_attempt_id", "client_communication_callback_receipts", ["attempt_id"])
    op.create_index("ix_client_comm_callback_event_id", "client_communication_callback_receipts", ["event_id"])
    op.create_index("ix_client_comm_callback_received_at", "client_communication_callback_receipts", ["received_at"])


def downgrade() -> None:
    op.drop_index("ix_client_comm_callback_received_at", table_name="client_communication_callback_receipts")
    op.drop_index("ix_client_comm_callback_event_id", table_name="client_communication_callback_receipts")
    op.drop_index("ix_client_comm_callback_attempt_id", table_name="client_communication_callback_receipts")
    op.drop_index("ix_client_comm_callback_provider_reference", table_name="client_communication_callback_receipts")
    op.drop_table("client_communication_callback_receipts")

    op.drop_index("ix_client_comm_attempts_provider_event_id", table_name="client_communication_attempts")
    op.drop_column("client_communication_attempts", "callback_payload_hash")
    op.drop_column("client_communication_attempts", "delivery_failed_at")
    op.drop_column("client_communication_attempts", "callback_received_at")
    op.drop_column("client_communication_attempts", "provider_status_raw")
    op.drop_column("client_communication_attempts", "provider_event_id")
