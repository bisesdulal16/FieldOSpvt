# Client Protection Phase 6 — Manager Dashboard

Phase 6 adds read-only manager, Head Office, and audit visibility over client-protection communication flows. It does not add mutating financial actions, provider dispatch, or infrastructure deployment.

## Roles and access

| Role / department | Access | Branch scope |
|---|---|---|
| Branch manager | Allowed | Own branch only |
| Area manager | Allowed | Existing authorized scope |
| Head Office | Allowed | Existing authorized consolidated scope |
| Audit | Allowed | Existing authorized consolidated scope |
| Admin IT | Forbidden | No financial, client, or dispute data |
| Platform health | Safe operational fields only | No client payloads |

The APIs reuse existing manager/admin and financial-access dependencies. `admin_it` is explicitly excluded because client communication history can contain financial and dispute context.

## API endpoints

Base prefix: `/api/v1/manager/client-protection`.

| Endpoint | Purpose |
|---|---|
| `GET /summary` | Dashboard metrics and denominator definitions |
| `GET /events` | Paginated communication events/attempts |
| `GET /events/{event_id}` | Sanitized event detail, attempts, callbacks, outbox status |
| `GET /exceptions` | Classified exceptions and risk indicators |
| `GET /reminders` | Reminder-focused event list |
| `GET /clients/{client_id}/history` | Chronological sanitized client communication history |
| `GET /officers/{officer_id}/summary` | Officer-level operational indicators |
| `GET /branches/{branch_id}/summary` | Branch-level summary for authorized scope |
| `GET /worker-health` | Safe worker/provider operational state |
| `GET /export.csv` | Authorized masked CSV export |

All endpoints are read-only.

## Filters

Supported query filters:

- `start_date`
- `end_date`
- `branch_id`
- `officer_id`
- `client_id`
- `purpose`
- `channel`
- `event_status`
- `attempt_status`
- `provider`
- `risk_level`
- `exception_severity`
- `due_state`
- `page`
- `page_size`

Pagination is bounded to a maximum page size of 100. CSV export is capped at 5,000 rows per request and rejects date ranges wider than 366 days when both `start_date` and `end_date` are supplied. Without a date range, the export still hard-limits to the first 5,000 authorized rows ordered newest first.

## Metric definitions

| Metric | Definition |
|---|---|
| Total communication events | Distinct `ClientCommunicationEvent` rows in authorized scope |
| Collection verification count | Events where purpose is `collection_verification` |
| Due reminder count | Events where purpose is `payment_due_reminder` |
| Overdue reminder count | Events where purpose is `payment_overdue_reminder` |
| Promise-to-pay reminder count | Events where purpose is `promise_to_pay_reminder` |
| Center-meeting reminder count | Events where purpose is `center_meeting_reminder` |
| Queued/submitted/provider accepted/delivered/failed/expired/rejected/no-phone/cancelled counts | Event status plus attempt status counts in authorized scope |
| Dead-letter count | Outbox rows with `dead` or `dead_letter` status |
| Confirmed count | Unique event IDs where event status is `confirmed` or attempt client response is `confirmed` |
| Disputed count | Unique event IDs where event status is `disputed` or attempt client response is `disputed` |
| Reminder suppression count | Audit rows with `communication_reminder_suppressed` |
| Reminder throttle count | Audit rows with `communication_reminder_throttled` |

## Percentage denominators

| Percentage | Numerator | Denominator |
|---|---|---|
| Verification rate | Confirmed collection-verification event IDs | Eligible `collection_verification` event IDs excluding `cancelled` and `suppressed` rows |
| Delivery rate | Attempts with status `delivered` | Eligible attempts with status `submitted`, `provider_accepted`, or `delivered`; `queued`, `cancelled`, `no_phone`, and suppressed rows are excluded |
| Dispute rate | Disputed collection-verification event IDs | Eligible `collection_verification` event IDs excluding `cancelled` and `suppressed` rows |
| No-phone rate | Unique eligible event IDs with event/attempt status `no_phone` | Total eligible communication events excluding `cancelled` and `suppressed` rows |

Zero denominators return `0.0` instead of raising or producing null/NaN.

## Exception classification

Phase 6 presents risk indicators only. It does not infer fraud or punitive scoring.

| Exception | Severity | Source |
|---|---|---|
| No phone | warning | Event/attempt status `no_phone` |
| Failed delivery | high | Attempt status `failed` |
| Dead-letter outbox | critical | Outbox status `dead` or `dead_letter` |
| Expired reminder | warning | Attempt status `expired` |
| Rejected message | warning | Attempt status `rejected` |
| Disputed collection | critical | Event status or client response `disputed` |
| Callback conflict/replay rejection | high | Callback receipt action such as replay/conflict |
| Overdue reminder not delivered | high | Overdue reminder attempt not delivered/confirmed and authoritative CBS schedule remains unpaid |
| Stale processing outbox row | high | Processing outbox locked beyond configured `OUTBOX_LOCK_TIMEOUT_SECONDS` |

Repeated phone changes and shared phone numbers are reserved for the same exceptions layer once stronger phone-change lineage is available.

## Masking rules

- Phone numbers are returned as `******7844` format.
- Full phone numbers are not returned.
- Full SMS bodies are not returned by default.
- Provider secrets, provider tokens, callback signatures, callback payload hashes, full raw provider responses, raw callback payloads, and full outbox payloads are not returned.
- Internal encrypted recipient values are never returned.
- Event detail returns sanitized metadata only.
- Worker health returns operational counts and provider status counts only.

## Exports

CSV export is authorized through the same client-protection financial-access rules.

Export behavior:

- same manager/admin + financial-access authorization as the JSON endpoints
- branch scoping is applied before row selection; branch managers cannot widen scope with query parameters
- masked recipient identifiers only
- selected event/attempt fields only
- no full phone number by default
- no full SMS body
- maximum date range: 366 days when both `start_date` and `end_date` are supplied
- row limit: 5,000
- pagination/truncation behavior: CSV does not paginate; it truncates to the newest 5,000 authorized rows
- CSV formula-injection protection: any cell beginning with `=`, `+`, `-`, or `@` is prefixed with a single quote before writing
- audit event: `client_protection_export_requested`

## Audit events

Dashboard access records safe audit events:

- `client_protection_dashboard_viewed`
- `client_protection_event_viewed`
- `client_communication_history_viewed`
- `client_protection_export_requested`

Audit metadata stores sanitized filters only. It must not log phone numbers, message bodies, provider secrets, callback signatures, or raw provider payloads.

Polling behavior:

- Dashboard-list audit events are throttled per user/action/entity for 5 minutes to avoid excessive audit records from frontend refreshes.
- `worker-health` is intentionally not audited on each poll.
- CSV export is always audited.
- Direct event detail views and client-history views are audited with `client_protection_event_viewed` and `client_communication_history_viewed`.

## Worker health

`GET /api/v1/manager/client-protection/worker-health` returns only:

- `worker_enabled`
- `database_reachable`
- `recently_polled`
- `recently_dispatched`
- `pending_count`
- `processing_count`
- `retryable_count`
- `dead_count`
- `oldest_pending_age_seconds`
- `safe_provider_summary`

It must not return client identifiers, message bodies, recipients, outbox payloads, callback payloads, provider tokens, callback signatures, provider secrets, or encrypted recipient values.

## Dashboard sections

The Next.js dashboard adds a Client Protection section with:

1. Overview metric cards
2. Verification and message status table
3. Reminders table
4. Exceptions list
5. Provider/worker health card
6. Export action for masked CSV

The UI intentionally avoids one oversized mixed chart. It separates reminder status, exceptions, event tables, and worker health.

## Migration

No migration 013 is required. Phase 6 uses query/view-layer reads over existing communication event, attempt, outbox, callback, audit, branch, user, client, and collection records introduced by earlier migrations.

Migrations 010–012 must not be modified.

## Known limitations

- Imported CBS schedules remain authoritative for due dates and amounts.
- Missing amounts or due dates are not guessed.
- Client-specific language preference is not yet modeled.
- Center-meeting targeting depends on existing meeting-attendance data.
- No no-phone escalation workflow exists yet.
- Repeated phone-change and shared-phone exceptions are conservative until a stronger phone-change ledger exists.
- No real provider dispatch was tested in this phase.
- No live deployment or real SMS is included.
