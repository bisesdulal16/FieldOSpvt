"""add face_photo profile picture to users

The officer's first face enrollment doubles as their profile picture (the aligned
enrollment selfie). Stored as a data URI for the pilot. Set once — not overwritten
on re-enroll.

Revision ID: 007_add_face_photo
Revises: 006_add_feedback
Create Date: 2026-07-27 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "007_add_face_photo"
down_revision: Union[str, None] = "006_add_feedback"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("face_photo", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "face_photo")
