"""add org matrix: org_units table + department/scope/permission on users

Introduces the geographic org tree (`org_units`) and the three orthogonal
matrix axes on `users` (department, data_scope, permission_set) plus the
operations reporting chain (`manager_id`) and the OrgUnit link
(`org_unit_id`). See PILOT_SCOPE_V2.md §2 / §8-A. Decision 2026-07-23.

Backfills `department` from the existing `role` so no pre-existing row is
left invalid:  field_officer/branch_manager -> operations,
area_manager -> operations (data_scope=region), admin -> admin_it.

Revision ID: 005_add_org_matrix
Revises: 004_add_face_verification
Create Date: 2026-07-23 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005_add_org_matrix"
down_revision: Union[str, None] = "004_add_face_verification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "org_units",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("type", sa.String(length=20), nullable=False, server_default="branch"),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("name_ne", sa.String(length=200), nullable=True),
        sa.Column("code", sa.String(length=120), nullable=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("org_units.id"), nullable=True),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
    )
    op.create_index("ix_org_units_code", "org_units", ["code"], unique=True)
    op.create_index("ix_org_units_parent_id", "org_units", ["parent_id"], unique=False)

    op.add_column("users", sa.Column("department", sa.String(length=30), nullable=False, server_default="operations"))
    op.add_column("users", sa.Column("data_scope", sa.String(length=20), nullable=False, server_default="own"))
    op.add_column("users", sa.Column("permission_set", sa.String(length=60), nullable=False, server_default="write"))
    op.add_column("users", sa.Column("manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("users", sa.Column("org_unit_id", sa.Integer(), sa.ForeignKey("org_units.id"), nullable=True))

    # Backfill department + scope from the existing role.
    op.execute("UPDATE users SET department='operations', data_scope='branch', permission_set='write' "
               "WHERE role IN ('field_officer','branch_manager')")
    op.execute("UPDATE users SET data_scope='own', permission_set='write' WHERE role='field_officer'")
    op.execute("UPDATE users SET department='operations', data_scope='region', permission_set='read,write' "
               "WHERE role='area_manager'")
    op.execute("UPDATE users SET department='admin_it', data_scope='org', permission_set='admin' "
               "WHERE role='admin'")


def downgrade() -> None:
    op.drop_column("users", "org_unit_id")
    op.drop_column("users", "manager_id")
    op.drop_column("users", "permission_set")
    op.drop_column("users", "data_scope")
    op.drop_column("users", "department")
    op.drop_index("ix_org_units_parent_id", table_name="org_units")
    op.drop_index("ix_org_units_code", table_name="org_units")
    op.drop_table("org_units")
