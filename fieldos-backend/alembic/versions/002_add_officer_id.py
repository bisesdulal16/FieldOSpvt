"""add officer_id to collections and visit_checkins

Revision ID: 002_add_officer_id
Revises: 001_initial
Create Date: 2026-05-12 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_add_officer_id"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("collections", sa.Column("officer_id", sa.Integer(), nullable=True))
    op.create_index("ix_collections_officer_id", "collections", ["officer_id"])
    op.create_foreign_key("collections_officer_id_fkey", "collections", "users", ["officer_id"], ["id"])

    op.add_column("visit_checkins", sa.Column("officer_id", sa.Integer(), nullable=True))
    op.create_index("ix_visit_checkins_officer_id", "visit_checkins", ["officer_id"])
    op.create_foreign_key("visit_checkins_officer_id_fkey", "visit_checkins", "users", ["officer_id"], ["id"])


def downgrade() -> None:
    op.drop_column("visit_checkins", "officer_id")
    op.drop_column("collections", "officer_id")
