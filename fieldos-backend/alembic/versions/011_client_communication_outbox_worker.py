"""client communication outbox worker fields

Revision ID: 011_comm_outbox_worker
Revises: 010_client_communication_ledger
Create Date: 2026-07-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "011_comm_outbox_worker"
down_revision: Union[str, None] = "010_client_communication_ledger"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("client_communication_outbox", sa.Column("cancelled_at", sa.DateTime(), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("client_communication_outbox", sa.Column("recovery_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("client_communication_outbox", sa.Column("last_error_code", sa.String(length=80), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("last_attempted_at", sa.DateTime(), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("last_recovered_at", sa.DateTime(), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("last_recovered_by", sa.String(length=80), nullable=True))
    op.create_index(
        "ix_client_comm_outbox_claimable",
        "client_communication_outbox",
        ["status", "available_at", "locked_at"],
    )

    op.create_table(
        "client_communication_worker_heartbeats",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("worker_id", sa.String(length=120), nullable=False),
        sa.Column("process_alive", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("worker_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_successful_poll", sa.DateTime(), nullable=True),
        sa.Column("last_successful_dispatch", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("uq_client_comm_worker_heartbeats_worker_id", "client_communication_worker_heartbeats", ["worker_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_client_comm_worker_heartbeats_worker_id", table_name="client_communication_worker_heartbeats")
    op.drop_table("client_communication_worker_heartbeats")

    op.drop_index("ix_client_comm_outbox_claimable", table_name="client_communication_outbox")
    op.drop_column("client_communication_outbox", "last_recovered_by")
    op.drop_column("client_communication_outbox", "last_recovered_at")
    op.drop_column("client_communication_outbox", "last_attempted_at")
    op.drop_column("client_communication_outbox", "last_error_code")
    op.drop_column("client_communication_outbox", "recovery_count")
    op.drop_column("client_communication_outbox", "attempt_count")
    op.drop_column("client_communication_outbox", "cancelled_at")
