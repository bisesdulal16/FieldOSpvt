"""add branch_id to collections, visit_checkins, task_assignments (branch scoping)

Multi-branch pilot: money/activity rows carried no branch dimension, so every
manager/dashboard query was institution-wide — a Branch A manager could read
Branch B's collections and staff (the cross-branch leak CLAUDE.md hard-rule #5
warns about). This denormalizes branch_id onto the three field tables so it can
be filtered in one enforced place (deps.auth_deps.scope_to_branch).

Backfill derives each row's branch from the recording officer's branch:
  - collections.officer_id     → users.branch_id
  - visit_checkins.officer_id  → users.branch_id
  - task_assignments.user_id   → users.branch_id (assignee = where work happens)

Rows whose officer has no branch (or no officer) stay NULL — those predate the
multi-branch model and are treated as unscoped; the seed for the pilot assigns
every officer a branch, so new rows are always stamped.

Revision ID: 008_add_branch_scoping
Revises: 007_add_face_photo
Create Date: 2026-07-27 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "008_add_branch_scoping"
down_revision: Union[str, None] = "007_add_face_photo"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add the columns (nullable — existing rows backfilled below; a NULL means
    #    "predates multi-branch", handled as unscoped by the scoping helper).
    op.add_column("collections", sa.Column("branch_id", sa.Integer(), nullable=True))
    op.add_column("visit_checkins", sa.Column("branch_id", sa.Integer(), nullable=True))
    op.add_column("task_assignments", sa.Column("branch_id", sa.Integer(), nullable=True))

    op.create_index("ix_collections_branch_id", "collections", ["branch_id"])
    op.create_index("ix_visit_checkins_branch_id", "visit_checkins", ["branch_id"])
    op.create_index("ix_task_assignments_branch_id", "task_assignments", ["branch_id"])

    # 2. Backfill from the recording officer's branch. Correlated UPDATE works on
    #    both SQLite (pilot dev) and Postgres (pilot prod).
    op.execute(
        """
        UPDATE collections
        SET branch_id = (SELECT u.branch_id FROM users u WHERE u.id = collections.officer_id)
        WHERE officer_id IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE visit_checkins
        SET branch_id = (SELECT u.branch_id FROM users u WHERE u.id = visit_checkins.officer_id)
        WHERE officer_id IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE task_assignments
        SET branch_id = (SELECT u.branch_id FROM users u WHERE u.id = task_assignments.user_id)
        WHERE user_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_task_assignments_branch_id", table_name="task_assignments")
    op.drop_index("ix_visit_checkins_branch_id", table_name="visit_checkins")
    op.drop_index("ix_collections_branch_id", table_name="collections")
    op.drop_column("task_assignments", "branch_id")
    op.drop_column("visit_checkins", "branch_id")
    op.drop_column("collections", "branch_id")
