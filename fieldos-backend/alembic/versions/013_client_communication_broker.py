"""client communication broker metadata

Revision ID: 013_comm_broker
Revises: 012_comm_callbacks
Create Date: 2026-07-29
"""
from alembic import op
import sqlalchemy as sa


revision = "013_comm_broker"
down_revision = "012_comm_callbacks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("client_communication_outbox", sa.Column("broker_message_id", sa.String(length=160), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("broker_published_at", sa.DateTime(), nullable=True))
    op.create_index("ix_client_communication_outbox_broker_message_id", "client_communication_outbox", ["broker_message_id"])


def downgrade() -> None:
    op.drop_index("ix_client_communication_outbox_broker_message_id", table_name="client_communication_outbox")
    op.drop_column("client_communication_outbox", "broker_published_at")
    op.drop_column("client_communication_outbox", "broker_message_id")
