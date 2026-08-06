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


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(table_name)


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table(table_name):
        return False
    return any(col["name"] == column_name for col in sa.inspect(bind).get_columns(table_name))


def upgrade() -> None:
    """Add face-verification fields and repair clean-install day-start history.

    Historical deployments had ``day_start_records`` from app-managed ``create_all``
    before this revision ran. A truly empty Alembic-only database does not, so the
    original migration failed while adding face columns. Existing databases already
    past revision 004 never rerun this upgrade; fresh databases now receive the
    current intended day-start table in the revision that first references it.
    """
    if not _column_exists("users", "face_template"):
        op.add_column("users", sa.Column("face_template", sa.Text(), nullable=True))
    if not _column_exists("users", "face_enrolled_at"):
        op.add_column("users", sa.Column("face_enrolled_at", sa.String(length=30), nullable=True))

    if not _table_exists("day_start_records"):
        op.create_table(
            "day_start_records",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("officer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("day_date", sa.String(length=20), nullable=False),
            sa.Column("started_at", sa.String(length=30), nullable=False),
            sa.Column("source_ip", sa.String(length=64), nullable=True),
            sa.Column("ip_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("selfie_data_uri", sa.Text(), nullable=True),
            sa.Column("gps_latitude", sa.Float(), nullable=True),
            sa.Column("gps_longitude", sa.Float(), nullable=True),
            sa.Column("gps_address", sa.String(length=500), nullable=True),
            sa.Column("face_verified", sa.Boolean(), nullable=True),
            sa.Column("face_similarity", sa.Float(), nullable=True),
            comment="created_by_alembic_004_clean_install_repair",
        )
        op.create_index("ix_day_start_records_day_date", "day_start_records", ["day_date"])
    else:
        if not _column_exists("day_start_records", "face_verified"):
            op.add_column("day_start_records", sa.Column("face_verified", sa.Boolean(), nullable=True))
        if not _column_exists("day_start_records", "face_similarity"):
            op.add_column("day_start_records", sa.Column("face_similarity", sa.Float(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists("day_start_records"):
        table_comment = None
        try:
            table_comment = sa.inspect(bind).get_table_comment("day_start_records").get("text")
        except (NotImplementedError, sa.exc.SQLAlchemyError):
            table_comment = None
        if table_comment == "created_by_alembic_004_clean_install_repair":
            op.drop_index("ix_day_start_records_day_date", table_name="day_start_records")
            op.drop_table("day_start_records")
        else:
            if _column_exists("day_start_records", "face_similarity"):
                op.drop_column("day_start_records", "face_similarity")
            if _column_exists("day_start_records", "face_verified"):
                op.drop_column("day_start_records", "face_verified")
    if _column_exists("users", "face_enrolled_at"):
        op.drop_column("users", "face_enrolled_at")
    if _column_exists("users", "face_template"):
        op.drop_column("users", "face_template")
