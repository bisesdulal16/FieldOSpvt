"""add face-verification fields (attendance clock-in)

Adds the officer's enrolled face template to `users` and the on-device
clock-in result to `day_start_records`. Decision 2026-07-14.

Revision ID: 004_add_face_verification
Revises: 003_add_collection_gps_fields
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004_add_face_verification"
down_revision: Union[str, None] = "003_add_collection_gps_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("face_template", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("face_enrolled_at", sa.String(length=30), nullable=True))
    op.add_column("day_start_records", sa.Column("face_verified", sa.Boolean(), nullable=True))
    op.add_column("day_start_records", sa.Column("face_similarity", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("day_start_records", "face_similarity")
    op.drop_column("day_start_records", "face_verified")
    op.drop_column("users", "face_enrolled_at")
    op.drop_column("users", "face_template")
