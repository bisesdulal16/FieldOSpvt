"""initial schema

Revision ID: 001_initial
Revises:
Create Date: 2025-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "branches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("branch_id", sa.String(50), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_ne", sa.String(200), nullable=True),
        sa.Column("address", sa.String(500), nullable=True),
        sa.Column("office_ip", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id"),
    )
    op.create_index("ix_branches_branch_id", "branches", ["branch_id"])

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("staff_id", sa.String(50), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_ne", sa.String(200), nullable=True),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("hashed_pin", sa.String(200), nullable=False),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("phone_number", sa.String(20), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("staff_id"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
    )
    op.create_index("ix_users_staff_id", "users", ["staff_id"])

    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("device_id", sa.String(100), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("device_name", sa.String(100), nullable=True),
        sa.Column("device_model", sa.String(100), nullable=True),
        sa.Column("os_version", sa.String(50), nullable=True),
        sa.Column("app_version", sa.String(50), nullable=True),
        sa.Column("is_registered", sa.Boolean(), nullable=False, default=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_devices_device_id", "devices", ["device_id"])

    op.create_table(
        "clients",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("member_id", sa.String(50), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("name_ne", sa.String(200), nullable=True),
        sa.Column("phone_number", sa.String(20), nullable=True),
        sa.Column("center_id", sa.String(50), nullable=True),
        sa.Column("center_name", sa.String(200), nullable=True),
        sa.Column("ward", sa.String(50), nullable=True),
        sa.Column("loan_cycle", sa.Integer(), nullable=True),
        sa.Column("outstanding_balance", sa.Float(), nullable=False, default=0),
        sa.Column("due_amount", sa.Float(), nullable=False, default=0),
        sa.Column("next_installment_date", sa.String(20), nullable=True),
        sa.Column("overdue_days", sa.Integer(), nullable=False, default=0),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("member_id"),
    )
    op.create_index("ix_clients_member_id", "clients", ["member_id"])

    op.create_table(
        "loan_accounts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("loan_id", sa.String(50), nullable=False),
        sa.Column("product_type", sa.String(30), nullable=False),
        sa.Column("disbursement_date", sa.String(20), nullable=True),
        sa.Column("maturity_date", sa.String(20), nullable=True),
        sa.Column("principal_amount", sa.Float(), nullable=False),
        sa.Column("outstanding_balance", sa.Float(), nullable=False, default=0),
        sa.Column("installment_amount", sa.Float(), nullable=False, default=0),
        sa.Column("installment_frequency", sa.String(20), nullable=False, default="weekly"),
        sa.Column("term_weeks", sa.Integer(), nullable=False, default=25),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("loan_id"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
    )
    op.create_index("ix_loan_accounts_loan_id", "loan_accounts", ["loan_id"])

    op.create_table(
        "task_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("task_type", sa.String(30), nullable=False),
        sa.Column("task_date", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("priority", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("is_completed", sa.Boolean(), nullable=False, default=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_task_assignments_task_date", "task_assignments", ["task_date"])

    op.create_table(
        "visit_checkins",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("visit_purpose", sa.String(100), nullable=True),
        sa.Column("gps_latitude", sa.Float(), nullable=True),
        sa.Column("gps_longitude", sa.Float(), nullable=True),
        sa.Column("gps_address", sa.Text(), nullable=True),
        sa.Column("gps_accuracy_meters", sa.Float(), nullable=True),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["task_assignments.id"]),
    )

    op.create_table(
        "collections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("receipt_id", sa.String(50), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("visit_id", sa.Integer(), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("due_amount", sa.Float(), nullable=False, default=0),
        sa.Column("outstanding_after", sa.Float(), nullable=False, default=0),
        sa.Column("payment_method", sa.String(30), nullable=False, default="cash"),
        sa.Column("is_high_value", sa.Boolean(), nullable=False, default=False),
        sa.Column("face_verified", sa.Boolean(), nullable=False, default=False),
        sa.Column("gps_latitude", sa.Float(), nullable=True),
        sa.Column("gps_longitude", sa.Float(), nullable=True),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cbs_verified", sa.Boolean(), nullable=False, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("receipt_id"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["task_assignments.id"]),
        sa.ForeignKeyConstraint(["visit_id"], ["visit_checkins.id"]),
    )
    op.create_index("ix_collections_receipt_id", "collections", ["receipt_id"])

    op.create_table(
        "promise_to_pay",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("promised_amount", sa.Float(), nullable=False),
        sa.Column("expected_payment_date", sa.String(20), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("outstanding_amount", sa.Float(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["task_assignments.id"]),
    )

    op.create_table(
        "center_meetings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("center_id", sa.String(50), nullable=False),
        sa.Column("center_name", sa.String(200), nullable=False),
        sa.Column("meeting_date", sa.String(20), nullable=False),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column("officer_id", sa.Integer(), nullable=True),
        sa.Column("total_members", sa.Integer(), nullable=False, default=0),
        sa.Column("present_count", sa.Integer(), nullable=False, default=0),
        sa.Column("paid_count", sa.Integer(), nullable=False, default=0),
        sa.Column("absent_count", sa.Integer(), nullable=False, default=0),
        sa.Column("followup_count", sa.Integer(), nullable=False, default=0),
        sa.Column("collection_expected", sa.Float(), nullable=False, default=0),
        sa.Column("collection_received", sa.Float(), nullable=False, default=0),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"]),
    )
    op.create_index("ix_center_meetings_center_id", "center_meetings", ["center_id"])
    op.create_index("ix_center_meetings_meeting_date", "center_meetings", ["meeting_date"])

    op.create_table(
        "meeting_attendance",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("meeting_id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("member_id", sa.String(50), nullable=True),
        sa.Column("attendance_status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["meeting_id"], ["center_meetings.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
    )

    op.create_table(
        "end_of_day_reports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("report_date", sa.String(20), nullable=False),
        sa.Column("officer_id", sa.Integer(), nullable=True),
        sa.Column("total_collections", sa.Float(), nullable=False, default=0),
        sa.Column("total_visits", sa.Integer(), nullable=False, default=0),
        sa.Column("pending_count", sa.Integer(), nullable=False, default=0),
        sa.Column("exceptions_json", postgresql.JSONB(), nullable=True),
        sa.Column("is_confirmed", sa.Boolean(), nullable=False, default=False),
        sa.Column("is_submitted", sa.Boolean(), nullable=False, default=False),
        sa.Column("face_verified", sa.Boolean(), nullable=False, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"]),
    )
    op.create_index("ix_end_of_day_reports_report_date", "end_of_day_reports", ["report_date"])

    op.create_table(
        "sync_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.String(100), nullable=False),
        sa.Column("operation", sa.String(20), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False, default=0),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sync_events_entity_id", "sync_events", ["entity_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("role", sa.String(50), nullable=True),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("device_id", sa.String(100), nullable=True),
        sa.Column("action_type", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=True),
        sa.Column("entity_id", sa.String(100), nullable=True),
        sa.Column("meta_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_action_type", "audit_logs", ["action_type"])

    # These app-managed pilot tables existed historically via Base.metadata.create_all
    # but were missing from the Alembic clean-install path. Keep them in the base
    # migration for fresh databases; deployed databases already past 001 are not
    # affected because historical migrations are not rerun.
    op.create_table(
        "loan_schedule_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("loan_id", sa.Integer(), sa.ForeignKey("loan_accounts.id"), nullable=False),
        sa.Column("installment_no", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("principal_component", sa.Float(), nullable=False, server_default="0"),
        sa.Column("interest_component", sa.Float(), nullable=False, server_default="0"),
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_loan_schedule_items_loan_id", "loan_schedule_items", ["loan_id"])

    op.create_table(
        "sms_notifications",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=True),
        sa.Column("collection_receipt_id", sa.String(length=50), nullable=True),
        sa.Column("phone_number", sa.String(length=20), nullable=True),
        sa.Column("kind", sa.String(length=30), nullable=False, server_default="collection_receipt"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False, server_default="log"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_index("ix_sms_notifications_collection_receipt_id", "sms_notifications", ["collection_receipt_id"])

    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("branch_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("priority", sa.String(length=10), nullable=False, server_default="normal"),
        sa.Column("target_type", sa.String(length=20), nullable=False, server_default="all"),
        sa.Column("target_officer_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.String(length=30), nullable=True),
    )

    op.create_table(
        "cbs_import_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="csv"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("record_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "cbs_client_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cbs_member_id", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("name_ne", sa.String(length=200), nullable=True),
        sa.Column("center_id", sa.String(length=50), nullable=True),
        sa.Column("center_name", sa.String(length=200), nullable=True),
        sa.Column("ward", sa.String(length=50), nullable=True),
        sa.Column("loan_cycle", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("outstanding_balance", sa.Float(), nullable=False, server_default="0"),
        sa.Column("due_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("overdue_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_installment_date", sa.String(length=20), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="cbs"),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("cbs_member_id", name="uq_cbs_client_snapshots_cbs_member_id"),
    )
    op.create_index("ix_cbs_client_snapshots_cbs_member_id", "cbs_client_snapshots", ["cbs_member_id"])

    op.create_table(
        "cbs_loan_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=True),
        sa.Column("cbs_loan_id", sa.String(length=50), nullable=False),
        sa.Column("product_type", sa.String(length=30), nullable=False, server_default="micro_loan"),
        sa.Column("principal_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("outstanding_balance", sa.Float(), nullable=False, server_default="0"),
        sa.Column("installment_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("installment_frequency", sa.String(length=20), nullable=True),
        sa.Column("disbursement_date", sa.String(length=20), nullable=True),
        sa.Column("maturity_date", sa.String(length=20), nullable=True),
        sa.Column("par_status", sa.String(length=30), nullable=False, server_default="current"),
        sa.Column("total_installments", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paid_installments", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_payment_date", sa.String(length=20), nullable=True),
        sa.Column("last_payment_amount", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="cbs"),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("cbs_loan_id", name="uq_cbs_loan_snapshots_cbs_loan_id"),
    )
    op.create_index("ix_cbs_loan_snapshots_cbs_loan_id", "cbs_loan_snapshots", ["cbs_loan_id"])

    op.create_table(
        "cbs_schedule_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("loan_snapshot_id", sa.Integer(), sa.ForeignKey("cbs_loan_snapshots.id"), nullable=False),
        sa.Column("installment_no", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.String(length=20), nullable=False),
        sa.Column("due_amount", sa.Float(), nullable=False),
        sa.Column("paid_amount", sa.Float(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("paid_date", sa.String(length=20), nullable=True),
        sa.Column("days_overdue", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_cbs_schedule_items_loan_snapshot_id", "cbs_schedule_items", ["loan_snapshot_id"])

    op.create_table(
        "collection_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("collection_id", sa.Integer(), nullable=True),
        sa.Column("receipt_id", sa.String(length=50), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("member_id", sa.String(length=50), nullable=True),
        sa.Column("client_name", sa.String(length=200), nullable=True),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("officer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("officer_name", sa.String(length=200), nullable=True),
        sa.Column("event_status", sa.String(length=30), nullable=False, server_default="pending_review"),
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("posted_at", sa.DateTime(), nullable=True),
        sa.Column("cbs_posting_ref", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_collection_events_idempotency_key"),
    )
    op.create_index("ix_collection_events_idempotency_key", "collection_events", ["idempotency_key"])

    op.create_table(
        "cbs_posting_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("collection_events.id"), nullable=True),
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=True),
        sa.Column("receipt_id", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("request_payload", sa.Text(), nullable=True),
        sa.Column("response_payload", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("reconciled_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_cbs_posting_logs_idempotency_key", "cbs_posting_logs", ["idempotency_key"])


def downgrade() -> None:
    op.drop_index("ix_cbs_posting_logs_idempotency_key", table_name="cbs_posting_logs")
    op.drop_table("cbs_posting_logs")
    op.drop_index("ix_collection_events_idempotency_key", table_name="collection_events")
    op.drop_table("collection_events")
    op.drop_index("ix_cbs_schedule_items_loan_snapshot_id", table_name="cbs_schedule_items")
    op.drop_table("cbs_schedule_items")
    op.drop_index("ix_cbs_loan_snapshots_cbs_loan_id", table_name="cbs_loan_snapshots")
    op.drop_table("cbs_loan_snapshots")
    op.drop_index("ix_cbs_client_snapshots_cbs_member_id", table_name="cbs_client_snapshots")
    op.drop_table("cbs_client_snapshots")
    op.drop_table("cbs_import_logs")
    op.drop_table("announcements")
    op.drop_index("ix_sms_notifications_collection_receipt_id", table_name="sms_notifications")
    op.drop_table("sms_notifications")
    op.drop_index("ix_loan_schedule_items_loan_id", table_name="loan_schedule_items")
    op.drop_table("loan_schedule_items")

    op.drop_index("ix_audit_logs_action_type", table_name="audit_logs")
    op.drop_index("ix_sync_events_entity_id", table_name="sync_events")
    op.drop_index("ix_end_of_day_reports_report_date", table_name="end_of_day_reports")
    op.drop_index("ix_center_meetings_meeting_date", table_name="center_meetings")
    op.drop_index("ix_center_meetings_center_id", table_name="center_meetings")
    op.drop_index("ix_collections_receipt_id", table_name="collections")
    op.drop_index("ix_task_assignments_task_date", table_name="task_assignments")
    op.drop_index("ix_loan_accounts_loan_id", table_name="loan_accounts")
    op.drop_index("ix_clients_member_id", table_name="clients")
    op.drop_index("ix_devices_device_id", table_name="devices")
    op.drop_index("ix_users_staff_id", table_name="users")
    op.drop_index("ix_branches_branch_id", table_name="branches")

    op.drop_table("audit_logs")
    op.drop_table("sync_events")
    op.drop_table("end_of_day_reports")
    op.drop_table("meeting_attendance")
    op.drop_table("center_meetings")
    op.drop_table("promise_to_pay")
    op.drop_table("collections")
    op.drop_table("visit_checkins")
    op.drop_table("task_assignments")
    op.drop_table("loan_accounts")
    op.drop_table("clients")
    op.drop_table("devices")
    op.drop_table("users")
    op.drop_table("branches")
