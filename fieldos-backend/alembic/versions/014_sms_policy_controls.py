"""sms policy controls

Revision ID: 014_sms_policy_controls
Revises: 013_comm_broker
Create Date: 2026-08-03
"""
from alembic import op
import sqlalchemy as sa

revision = "014_sms_policy_controls"
down_revision = "013_comm_broker"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("client_communication_events", sa.Column("sms_template_key", sa.String(120), nullable=True))
    op.add_column("client_communication_events", sa.Column("sms_template_version", sa.String(40), nullable=True))
    op.add_column("client_communication_attempts", sa.Column("sms_template_key", sa.String(120), nullable=True))
    op.add_column("client_communication_attempts", sa.Column("sms_template_version", sa.String(40), nullable=True))
    op.add_column("client_communication_attempts", sa.Column("provider_call_started_at", sa.DateTime(), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("sms_template_key", sa.String(120), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("sms_template_version", sa.String(40), nullable=True))
    op.add_column("client_communication_outbox", sa.Column("provider_call_started_at", sa.DateTime(), nullable=True))
    op.create_table(
        "sms_consent_evidence",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("client_id", sa.Integer(), sa.ForeignKey("clients.id"), nullable=True),
        sa.Column("recipient_hash", sa.String(64), nullable=False),
        sa.Column("recipient_hash_version", sa.String(40), nullable=False, server_default="hmac_sha256_v1"),
        sa.Column("protected_recipient_ref", sa.String(160), nullable=True),
        sa.Column("purpose", sa.String(80), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("consent_source", sa.String(80), nullable=False),
        sa.Column("consent_version", sa.String(40), nullable=False, server_default="v1"),
        sa.Column("granted_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("recorded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("evidence_reference", sa.String(240), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('granted','revoked','expired','pending_review')", name="ck_sms_consent_status"),
        sa.UniqueConstraint("recipient_hash", "purpose", "consent_version", "branch_id", "status", name="uq_sms_consent_record_scope"),
    )
    op.create_index("ix_sms_consent_lookup", "sms_consent_evidence", ["recipient_hash", "purpose", "branch_id", "status"])

    op.create_table(
        "sms_suppression_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("recipient_hash", sa.String(64), nullable=False),
        sa.Column("recipient_hash_version", sa.String(40), nullable=False, server_default="hmac_sha256_v1"),
        sa.Column("protected_recipient_ref", sa.String(160), nullable=True),
        sa.Column("scope", sa.String(40), nullable=False, server_default="global"),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column("source", sa.String(80), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("effective_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("recorded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("reason IN ('client_opt_out','legal_or_compliance','invalid_recipient','provider_complaint','manual_suppression','safety_hold')", name="ck_sms_suppression_reason"),
    )
    op.create_index("ix_sms_suppression_lookup", "sms_suppression_records", ["recipient_hash", "active", "branch_id", "scope"])

    op.create_table(
        "sms_approved_templates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("template_key", sa.String(120), nullable=False),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("language", sa.String(12), nullable=False, server_default="en"),
        sa.Column("purpose", sa.String(80), nullable=False),
        sa.Column("body_template", sa.Text(), nullable=True),
        sa.Column("managed_content_ref", sa.String(240), nullable=True),
        sa.Column("allowed_variables_json", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("approval_status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("retired_at", sa.DateTime(), nullable=True),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("tenant_scope", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("approval_status IN ('draft','pending_approval','approved','rejected','retired')", name="ck_sms_template_status"),
        sa.UniqueConstraint("template_key", "version", "language", "branch_id", name="uq_sms_template_version_scope"),
    )
    op.create_index("ix_sms_template_lookup", "sms_approved_templates", ["template_key", "version", "language", "purpose", "branch_id"])

    op.create_table(
        "sms_quota_reservations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("reservation_key", sa.String(180), nullable=False),
        sa.Column("outbox_id", sa.Integer(), sa.ForeignKey("client_communication_outbox.id"), nullable=True),
        sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("client_communication_attempts.id"), nullable=True),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("recipient_hash", sa.String(64), nullable=False),
        sa.Column("recipient_hash_version", sa.String(40), nullable=False, server_default="hmac_sha256_v1"),
        sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("quota_date", sa.String(10), nullable=False),
        sa.Column("quota_timezone", sa.String(80), nullable=False),
        sa.Column("reserved_message_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reserved_cost", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("status", sa.String(30), nullable=False, server_default="reserved"),
        sa.Column("reserved_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("committed_at", sa.DateTime(), nullable=True),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.Column("provider_call_started_at", sa.DateTime(), nullable=True),
        sa.Column("uncertain_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('reserved','provider_call_started','committed','released','provider_uncertain','cancelled')", name="ck_sms_quota_status"),
        sa.UniqueConstraint("reservation_key", name="uq_sms_quota_reservation_key"),
        sa.UniqueConstraint("outbox_id", name="uq_sms_quota_outbox"),
    )
    op.create_index("ix_sms_quota_day", "sms_quota_reservations", ["quota_date", "quota_timezone", "status"])
    op.create_index("ix_sms_quota_recipient_day", "sms_quota_reservations", ["recipient_hash", "quota_date", "status"])


def downgrade() -> None:
    op.drop_index("ix_sms_quota_recipient_day", table_name="sms_quota_reservations")
    op.drop_index("ix_sms_quota_day", table_name="sms_quota_reservations")
    op.drop_table("sms_quota_reservations")
    op.drop_index("ix_sms_template_lookup", table_name="sms_approved_templates")
    op.drop_table("sms_approved_templates")
    op.drop_index("ix_sms_suppression_lookup", table_name="sms_suppression_records")
    op.drop_table("sms_suppression_records")
    op.drop_index("ix_sms_consent_lookup", table_name="sms_consent_evidence")
    op.drop_table("sms_consent_evidence")
    op.drop_column("client_communication_outbox", "provider_call_started_at")
    op.drop_column("client_communication_outbox", "sms_template_version")
    op.drop_column("client_communication_outbox", "sms_template_key")
    op.drop_column("client_communication_attempts", "provider_call_started_at")
    op.drop_column("client_communication_attempts", "sms_template_version")
    op.drop_column("client_communication_attempts", "sms_template_key")
    op.drop_column("client_communication_events", "sms_template_version")
    op.drop_column("client_communication_events", "sms_template_key")
