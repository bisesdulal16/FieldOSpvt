"""schema parity alignment

Revision ID: 015_schema_parity_alignment
Revises: 014_sms_policy_controls
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "015_schema_parity_alignment"
down_revision = "014_sms_policy_controls"
branch_labels = None
depends_on = None

_TIMESTAMP_TO_NAIVE = [
    ("audit_logs", "created_at"),
    ("audit_logs", "updated_at"),
    ("branches", "created_at"),
    ("branches", "updated_at"),
    ("center_meetings", "created_at"),
    ("center_meetings", "updated_at"),
    ("clients", "created_at"),
    ("clients", "updated_at"),
    ("collections", "created_at"),
    ("collections", "updated_at"),
    ("devices", "created_at"),
    ("devices", "updated_at"),
    ("end_of_day_reports", "created_at"),
    ("end_of_day_reports", "updated_at"),
    ("loan_accounts", "created_at"),
    ("loan_accounts", "updated_at"),
    ("meeting_attendance", "created_at"),
    ("meeting_attendance", "updated_at"),
    ("promise_to_pay", "created_at"),
    ("promise_to_pay", "updated_at"),
    ("sync_events", "created_at"),
    ("sync_events", "updated_at"),
    ("task_assignments", "created_at"),
    ("task_assignments", "updated_at"),
    ("users", "created_at"),
    ("users", "updated_at"),
    ("visit_checkins", "created_at"),
    ("visit_checkins", "updated_at"),
]

_NOT_NULL_WITH_NOW = [
    ("announcements", "created_at"),
    ("announcements", "updated_at"),
    ("collection_events", "updated_at"),
    ("day_start_records", "created_at"),
    ("feedback", "created_at"),
    ("feedback", "updated_at"),
    ("feedback_campaigns", "created_at"),
    ("feedback_events", "created_at"),
    ("loan_schedule_items", "created_at"),
    ("org_units", "created_at"),
    ("org_units", "updated_at"),
    ("sms_notifications", "created_at"),
]

_SINGLE_COLUMN_INDEXES = [
    ("client_communication_attempts", "provider_call_started_at"),
    ("client_communication_attempts", "sms_template_key"),
    ("client_communication_attempts", "sms_template_version"),
    ("client_communication_events", "sms_template_key"),
    ("client_communication_events", "sms_template_version"),
    ("client_communication_outbox", "provider_call_started_at"),
    ("client_communication_outbox", "sms_template_key"),
    ("client_communication_outbox", "sms_template_version"),
    ("sms_approved_templates", "active"),
    ("sms_approved_templates", "approval_status"),
    ("sms_approved_templates", "approved_at"),
    ("sms_approved_templates", "approved_by"),
    ("sms_approved_templates", "branch_id"),
    ("sms_approved_templates", "content_hash"),
    ("sms_approved_templates", "language"),
    ("sms_approved_templates", "purpose"),
    ("sms_approved_templates", "retired_at"),
    ("sms_approved_templates", "template_key"),
    ("sms_approved_templates", "tenant_scope"),
    ("sms_approved_templates", "version"),
    ("sms_consent_evidence", "branch_id"),
    ("sms_consent_evidence", "client_id"),
    ("sms_consent_evidence", "expires_at"),
    ("sms_consent_evidence", "granted_at"),
    ("sms_consent_evidence", "protected_recipient_ref"),
    ("sms_consent_evidence", "purpose"),
    ("sms_consent_evidence", "recipient_hash"),
    ("sms_consent_evidence", "recipient_hash_version"),
    ("sms_consent_evidence", "recorded_by"),
    ("sms_consent_evidence", "revoked_at"),
    ("sms_consent_evidence", "status"),
    ("sms_quota_reservations", "attempt_id"),
    ("sms_quota_reservations", "branch_id"),
    ("sms_quota_reservations", "committed_at"),
    ("sms_quota_reservations", "provider"),
    ("sms_quota_reservations", "provider_call_started_at"),
    ("sms_quota_reservations", "quota_date"),
    ("sms_quota_reservations", "recipient_hash"),
    ("sms_quota_reservations", "recipient_hash_version"),
    ("sms_quota_reservations", "released_at"),
    ("sms_quota_reservations", "reserved_at"),
    ("sms_quota_reservations", "status"),
    ("sms_quota_reservations", "uncertain_at"),
    ("sms_suppression_records", "active"),
    ("sms_suppression_records", "branch_id"),
    ("sms_suppression_records", "effective_at"),
    ("sms_suppression_records", "expires_at"),
    ("sms_suppression_records", "protected_recipient_ref"),
    ("sms_suppression_records", "reason"),
    ("sms_suppression_records", "recipient_hash"),
    ("sms_suppression_records", "recipient_hash_version"),
    ("sms_suppression_records", "recorded_by"),
    ("sms_suppression_records", "scope"),
    ("sync_events", "entity_type"),
]

_UNIQUE_CONSTRAINTS = [
    ("client_communication_events", "uq_client_communication_events_idempotency_key", ["idempotency_key"]),
    ("client_communication_outbox", "uq_client_communication_outbox_idempotency_key", ["idempotency_key"]),
    ("client_communication_worker_heartbeats", "uq_client_communication_worker_heartbeats_worker_id", ["worker_id"]),
    ("org_units", "uq_org_units_code", ["code"]),
]

_FOREIGN_KEYS = [
    ("collections", "fk_collections_branch_id_branches", "branch_id", "branches", "id"),
    ("end_of_day_reports", "fk_end_of_day_reports_branch_id_branches", "branch_id", "branches", "id"),
    ("promise_to_pay", "fk_promise_to_pay_branch_id_branches", "branch_id", "branches", "id"),
    ("task_assignments", "fk_task_assignments_branch_id_branches", "branch_id", "branches", "id"),
    ("visit_checkins", "fk_visit_checkins_branch_id_branches", "branch_id", "branches", "id"),
]


def _idx_name(table: str, column: str) -> str:
    return f"ix_{table}_{column}"[:63]


def upgrade() -> None:
    # Align Alembic-created timestamp columns with the current ORM's naive
    # DateTime mapping. Existing timezone-aware values must be convertible;
    # PostgreSQL will abort instead of silently coercing invalid data.
    for table, column in _TIMESTAMP_TO_NAIVE:
        op.execute(
            sa.text(
                f'ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE TIMESTAMP WITHOUT TIME ZONE '
                f'USING "{column}" AT TIME ZONE \'UTC\''
            )
        )

    # Fields the application deliberately treats as ISO strings/text payloads.
    op.execute('ALTER TABLE collections ALTER COLUMN collected_at TYPE VARCHAR(30) USING collected_at::text')
    op.execute('ALTER TABLE devices ALTER COLUMN last_sync_at TYPE VARCHAR(30) USING last_sync_at::text')
    op.execute('ALTER TABLE sync_events ALTER COLUMN synced_at TYPE VARCHAR(30) USING synced_at::text')
    op.execute('ALTER TABLE task_assignments ALTER COLUMN completed_at TYPE VARCHAR(30) USING completed_at::text')
    op.execute('ALTER TABLE visit_checkins ALTER COLUMN checked_in_at TYPE VARCHAR(30) USING checked_in_at::text')
    op.execute('ALTER TABLE visit_checkins ALTER COLUMN synced_at TYPE VARCHAR(30) USING synced_at::text')
    op.execute('ALTER TABLE sync_events ALTER COLUMN payload_json TYPE TEXT USING payload_json::text')
    op.execute('ALTER TABLE end_of_day_reports ALTER COLUMN exceptions_json TYPE TEXT USING exceptions_json::text')
    op.execute('ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(50)')

    for table, column in _NOT_NULL_WITH_NOW:
        op.execute(sa.text(f'UPDATE "{table}" SET "{column}" = now() AT TIME ZONE \'UTC\' WHERE "{column}" IS NULL'))
        op.execute(sa.text(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" SET NOT NULL'))

    op.alter_column("loan_accounts", "installment_frequency", nullable=True, existing_type=sa.String(20))
    op.alter_column("task_assignments", "task_date", nullable=True, existing_type=sa.String(20))

    for table, name, cols in _UNIQUE_CONSTRAINTS:
        op.create_unique_constraint(name, table, cols)

    for table, name, column, ref_table, ref_column in _FOREIGN_KEYS:
        op.create_foreign_key(name, table, ref_table, [column], [ref_column])

    for table, column in _SINGLE_COLUMN_INDEXES:
        op.create_index(_idx_name(table, column), table, [column])


def downgrade() -> None:
    for table, column in reversed(_SINGLE_COLUMN_INDEXES):
        op.drop_index(_idx_name(table, column), table_name=table)

    for table, name, _column, _ref_table, _ref_column in reversed(_FOREIGN_KEYS):
        op.drop_constraint(name, table, type_="foreignkey")

    for table, name, _cols in reversed(_UNIQUE_CONSTRAINTS):
        op.drop_constraint(name, table, type_="unique")

    op.alter_column("task_assignments", "task_date", nullable=False, existing_type=sa.String(20))
    op.alter_column("loan_accounts", "installment_frequency", nullable=False, existing_type=sa.String(20))

    for table, column in reversed(_NOT_NULL_WITH_NOW):
        op.execute(sa.text(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" DROP NOT NULL'))

    op.execute('ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20)')
    op.execute('ALTER TABLE end_of_day_reports ALTER COLUMN exceptions_json TYPE JSONB USING exceptions_json::jsonb')
    op.execute('ALTER TABLE sync_events ALTER COLUMN payload_json TYPE JSONB USING payload_json::jsonb')
    op.execute('ALTER TABLE visit_checkins ALTER COLUMN synced_at TYPE TIMESTAMP WITH TIME ZONE USING synced_at::timestamp with time zone')
    op.execute('ALTER TABLE visit_checkins ALTER COLUMN checked_in_at TYPE TIMESTAMP WITH TIME ZONE USING checked_in_at::timestamp with time zone')
    op.execute('ALTER TABLE task_assignments ALTER COLUMN completed_at TYPE TIMESTAMP WITH TIME ZONE USING completed_at::timestamp with time zone')
    op.execute('ALTER TABLE sync_events ALTER COLUMN synced_at TYPE TIMESTAMP WITH TIME ZONE USING synced_at::timestamp with time zone')
    op.execute('ALTER TABLE devices ALTER COLUMN last_sync_at TYPE TIMESTAMP WITH TIME ZONE USING last_sync_at::timestamp with time zone')
    op.execute('ALTER TABLE collections ALTER COLUMN collected_at TYPE TIMESTAMP WITH TIME ZONE USING collected_at::timestamp with time zone')

    for table, column in reversed(_TIMESTAMP_TO_NAIVE):
        op.execute(
            sa.text(
                f'ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE TIMESTAMP WITH TIME ZONE '
                f'USING "{column}" AT TIME ZONE \'UTC\''
            )
        )
