"""add hierarchical feedback: feedback, feedback_events, feedback_campaigns

The pilot star feature (PILOT_SCOPE_V2.md §3). These are NEW tables so the
app's boot-time create_all builds them automatically; this migration covers
the clean/prod (alembic) path. Decision 2026-07-23.

Revision ID: 006_add_feedback
Revises: 005_add_org_matrix
Create Date: 2026-07-23 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006_add_feedback"
down_revision: Union[str, None] = "005_add_org_matrix"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feedback_campaigns",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("prompt_text", sa.Text(), nullable=False),
        sa.Column("prompt_ne", sa.Text(), nullable=True),
        sa.Column("target_role", sa.String(length=50), nullable=True),
        sa.Column("is_open", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("opened_at", sa.String(length=30), nullable=True),
        sa.Column("closed_at", sa.String(length=30), nullable=True),
    )
    op.create_table(
        "feedback",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("submitted_at", sa.String(length=30), nullable=True),
        sa.Column("author_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("author_role", sa.String(length=50), nullable=True),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("subject_type", sa.String(length=20), nullable=False, server_default="general"),
        sa.Column("subject_ref", sa.String(length=200), nullable=True),
        sa.Column("category", sa.String(length=20), nullable=False, server_default="request"),
        sa.Column("severity", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("body_ne", sa.Text(), nullable=True),
        sa.Column("voice_note_ref", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("visibility_scope", sa.String(length=20), nullable=False, server_default="branch"),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("feedback_campaigns.id"), nullable=True),
    )
    op.create_table(
        "feedback_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("at", sa.String(length=30), nullable=True),
        sa.Column("feedback_id", sa.Integer(), sa.ForeignKey("feedback.id"), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(length=30), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("routed_to", sa.String(length=60), nullable=True),
    )
    op.create_index("ix_feedback_events_feedback_id", "feedback_events", ["feedback_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_events_feedback_id", table_name="feedback_events")
    op.drop_table("feedback_events")
    op.drop_table("feedback")
    op.drop_table("feedback_campaigns")
