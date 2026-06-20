"""add gps_address and gps_accuracy_meters to collections

Revision ID: 003_add_collection_gps_fields
Revises: 002_add_officer_id
Create Date: 2026-06-20 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003_add_collection_gps_fields"
down_revision: Union[str, None] = "002_add_officer_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("collections", sa.Column("gps_address", sa.String(length=500), nullable=True))
    op.add_column("collections", sa.Column("gps_accuracy_meters", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("collections", "gps_accuracy_meters")
    op.drop_column("collections", "gps_address")
