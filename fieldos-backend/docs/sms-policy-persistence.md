# SMS Policy Persistence

FieldOS real-SMS dispatch is fail-closed behind provider-independent persistent controls. This migration and service layer do **not** enable Sparrow or any real provider.

## Schema

Migration `014_sms_policy_controls` adds:

- `sms_consent_evidence` — consent evidence by recipient hash/protected reference, purpose, status, version, branch scope, evidence reference, and timestamps.
- `sms_suppression_records` — active/expiring suppressions by recipient hash/protected reference. Global suppressions use `branch_id = NULL` and override branch records.
- `sms_approved_templates` — versioned template records by key/version/language/purpose/branch scope.
- `sms_quota_reservations` — durable reservation ledger by outbox/attempt, provider, recipient hash, quota day/timezone, count/cost, and status.

Allowed statuses are enforced by service code and migration check constraints:

- Consent: `granted`, `revoked`, `expired`, `pending_review`
- Suppression reasons: `client_opt_out`, `legal_or_compliance`, `invalid_recipient`, `provider_complaint`, `manual_suppression`, `safety_hold`
- Template lifecycle: `draft`, `pending_approval`, `approved`, `rejected`, `retired`
- Quota reservation: `reserved`, `committed`, `released`, `provider_uncertain`, `cancelled`

## Privacy model

Policy tables must not store broad recipient plaintext. Services normalize Nepal mobile recipients to canonical `98/97XXXXXXXX` form and store only `recipient_hash` unless an existing protected reference is supplied.

Hashing behavior:

1. Normalize with the existing Nepal SMS normalization function.
2. Hash with SHA-256.
3. If `SMS_POLICY_HASH_PEPPER` is configured, use HMAC-SHA256 with that value.
4. Never hardcode salts/peppers. Production must manage the pepper as a secret outside the repository.

Lookup behavior:

- Provider checks hash the outbound recipient and query by hash plus purpose/scope.
- Broad list APIs expose only `recipient_hash_prefix`, never the full recipient.
- Audit and logs strip `recipient`, `phone`, `message`, `payload`, and template body fields.

Migration limitation: existing historical messages are not backfilled into consent/suppression/template/quota tables. Real SMS remains blocked until durable records are explicitly created.

## Consent semantics

Decision model:

- `CONSENT_GRANTED` — only passing decision.
- `CONSENT_REVOKED`
- `CONSENT_EXPIRED`
- `CONSENT_NOT_FOUND`
- `CONSENT_SCOPE_MISMATCH`
- `CONSENT_SERVICE_ERROR`

Rules:

- Purpose must match exactly.
- Branch-specific consent applies to that branch; global consent uses `branch_id = NULL`.
- Latest applicable record wins.
- Revoked/expired/pending-review are blocking.
- Query errors fail closed.
- No implicit consent exists.

## Suppression precedence

Decision model:

- `NOT_SUPPRESSED` — only passing decision.
- `SUPPRESSED_OPT_OUT`
- `SUPPRESSED_COMPLIANCE`
- `SUPPRESSED_INVALID_RECIPIENT`
- `SUPPRESSED_MANUAL`
- `SUPPRESSION_SERVICE_ERROR`

Rules:

- Suppression is checked after normalization.
- `active=true`, `effective_at <= now`, and unexpired records block.
- Global suppression overrides branch scope.
- Suppression overrides consent, template approval, and quota success.
- Query errors fail closed.

## Template lifecycle

Decision model:

- `TEMPLATE_APPROVED` — only passing decision.
- `TEMPLATE_NOT_FOUND`
- `TEMPLATE_NOT_APPROVED`
- `TEMPLATE_RETIRED`
- `TEMPLATE_SCOPE_MISMATCH`
- `TEMPLATE_VERSION_MISMATCH`
- `TEMPLATE_SERVICE_ERROR`

Rules:

- Exact `template_key`, `template_version`, `language`, and purpose are required.
- Only `approval_status='approved'` and `active=true` passes.
- Branch-specific templates take precedence over global templates.
- Arbitrary free-form real SMS is blocked because the persistent template key/version is mandatory.
- Log/Synthetic providers can still use safe test paths.

## Quota transaction design

Configuration:

- `SMS_QUOTA_TIMEZONE` default: `Asia/Kathmandu`
- `SMS_DAILY_SEND_LIMIT`
- `SMS_PER_RECIPIENT_DAILY_LIMIT`
- `SMS_MAX_COST_PER_DAY`
- `SMS_ESTIMATED_COST_PER_MESSAGE` default: `1`

PostgreSQL reservation uses a transaction-scoped advisory lock keyed by quota day/timezone (`pg_advisory_xact_lock(hashtext(...))`) plus locked reads of same-day active reservations. This serializes daily quota decisions so concurrent workers cannot both observe stale daily totals.

Active quota statuses are `reserved`, `committed`, and `provider_uncertain`. Released/cancelled reservations do not count.

Guarantees:

- Reservation happens before provider invocation.
- Duplicate outbox/attempt reuses the existing active reservation.
- Final duplicate paths do not reserve again because outbox/attempt final states are checked before policy evaluation.
- Retry paths reuse the original reservation.
- Provider-uncertain retains the reservation.
- Blocked-before-provider paths release or never create the reservation.
- Committed provider submission marks reservation `committed`.
- Manual cancellation must explicitly release only `reserved` rows; `provider_uncertain` requires reconciliation.

SQLite can exercise service behavior, but disposable PostgreSQL is required for final concurrent race validation.

## Timezone behavior

Quota day is computed from current UTC time converted to `SMS_QUOTA_TIMEZONE`. Invalid timezone configuration falls back to `Asia/Kathmandu` fail-safe behavior. Tests set the timezone explicitly for deterministic day-boundary behavior.

## Provider-uncertain handling

If the provider boundary is crossed and the worker cannot safely persist a result, the system marks:

- outbox status: `provider_uncertain`
- attempt status: `provider_uncertain`
- event status: `provider_uncertain`
- quota reservation status: `provider_uncertain`

Automatic resend is prohibited because `provider_uncertain` is terminal for normal claiming. The admin review API exposes these rows for manual reconciliation. No Sparrow-specific reconciliation is implemented in this phase.

## Safety-policy integration order

Real-provider dispatch evaluates:

1. Provider classification
2. Real-SMS feature gates
3. Emergency stop
4. Provider allowlist
5. Recipient allowlist
6. Consent
7. Template approval
8. Suppression
9. Atomic quota reservation
10. Provider invocation

A real provider returns `ALLOWED` only when every persistent control passes.

## Admin authorization

Management endpoints live under `/api/v1/client-communication/sms-policy/*` and require:

- authenticated user
- manager/admin role dependency
- financial-access department dependency
- branch scoping for branch managers

Endpoints support recording/revoking consent, creating/removing suppression, creating/approving/retiring templates, viewing quota reservations, and viewing provider-uncertain records. Pagination is bounded to 100 rows.

## Metrics

Low-cardinality counters are exposed via existing outbox metrics:

- `fieldos_sms_consent_denied_total`
- `fieldos_sms_consent_missing_total`
- `fieldos_sms_suppression_blocked_total`
- `fieldos_sms_template_missing_total`
- `fieldos_sms_template_not_approved_total`
- `fieldos_sms_quota_reservation_success_total`
- `fieldos_sms_quota_limit_blocked_total`
- `fieldos_sms_provider_uncertain_total`
- `fieldos_sms_quota_release_total`
- `fieldos_sms_quota_commit_total`

Metrics do not label by recipient, client, branch, template, provider reference, outbox/attempt, or message body.

## Rollout limitations

- Migration 014 must not be applied to live PostgreSQL without a separate approval gate.
- No runtime provider is enabled by this branch.
- No Sparrow-specific reconciliation is implemented.
- Historical consent/suppression/template records require controlled admin import or API creation.
- `SMS_POLICY_HASH_PEPPER` rotation requires a planned rehash/backfill strategy.
