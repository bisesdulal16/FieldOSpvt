"""add branch_id to promise_to_pay and end_of_day_reports (P3 branch scoping)

Multi-branch pilot P3: PromiseToPay and EndOfDayReport tables have no branch_id
column, so every manager/dashboard query that reads from them returns org-wide data —
a Branch A manager can see Branch B's promises and EOD reports.

This adds the denormalized branch_id column to both tables and backfills from the
recording officer's user.branch_id (same pattern as migration 008 for collections/visits).

Revision ID: 009_p3_branch_scoping_ptp_eod
Revises: 008_add_branch_scoping
Create Date: 2026-07-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "009_p3_branch_scoping_ptp_eod"
down_revision: Union[str, None] = "008_add_branch_scoping"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add columns (nullable — pre-migration rows backfilled below).
    op.add_column("promise_to_pay", sa.Column("branch_id", sa.Integer(), nullable=True))
    op.add_column("end_of_day_reports", sa.Column("branch_id", sa.Integer(), nullable=True))

    op.create_index("ix_promise_to_pay_branch_id", "promise_to_pay", ["branch_id"])
    op.create_index("ix_end_of_day_reports_branch_id", "end_of_day_reports", ["branch_id"])

    # 2. Backfill from the recording officer's branch (correlated UPDATE).
    # PTP has no officer_id — resolve through task_assignment.user_id.
    op.execute(
        """
        UPDATE promise_to_pay
        SET branch_id = (SELECT u.branch_id FROM users u
                         JOIN task_assignments ta ON ta.user_id = u.id
                         WHERE ta.id = promise_to_pay.task_id)
        WHERE task_id IS NOT NULL
        """
    )

    op.execute(
        """
        UPDATE end_of_day_reports
        SET branch_id = (SELECT u.branch_id FROM users u WHERE u.id = end_of_day_reports.officer_id)
        WHERE officer_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_end_of_day_reports_branch_id", table_name="end_of_day_reports")
    op.drop_index("ix_promise_to_pay_branch_id", table_name="promise_to_pay")
    op.drop_column("end_of_day_reports", "branch_id")
    op.drop_column("promise_to_pay", "branch_id")
