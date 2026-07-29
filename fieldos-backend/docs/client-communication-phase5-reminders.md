# Client Communication Phase 5 — Scheduled Reminders

Phase 5 adds scheduled reminder creation on top of the existing `ClientCommunicationEvent`, `ClientCommunicationAttempt`, and `ClientCommunicationOutbox` ledger. It does **not** send real SMS and does **not** deploy RabbitMQ, Redis, Jasmin, FreeSWITCH, n8n, or public callback endpoints.

## Reminder purposes

Supported reminder purposes:

- `payment_due_reminder`
- `payment_overdue_reminder`
- `promise_to_pay_reminder`
- `center_meeting_reminder`

`collection_verification` behavior remains unchanged and is not cancelled by reminder recovery.

## Source-of-truth assumptions

Payment reminders use imported CBS schedule rows where available:

- `cbs_schedule_items.due_date`
- `cbs_schedule_items.due_amount`
- `cbs_schedule_items.paid_amount`
- `cbs_schedule_items.status`
- linked `cbs_loan_snapshots` and `clients`

The scheduler does not independently calculate authoritative payment amounts. If CBS/imported schedule data is missing, reminders are suppressed/documented rather than guessed.

Promise reminders use `promise_to_pay.expected_payment_date`. A promise is never treated as payment.

Center meeting reminders use `center_meetings.meeting_date` plus meeting attendance membership. Meeting reminders do not include financial amount.

## Scheduler lifecycle

One-shot mode:

```bash
python -m app.workers.communication_reminders --once
```

Continuous mode:

```bash
python -m app.workers.communication_reminders
```

One-shot mode scans one configured batch, creates eligible reminder ledger/outbox rows, writes a scheduler audit event, commits, prints a JSON summary, and exits `0` unless a scheduler-level failure occurs.

The scheduler only creates:

- `ClientCommunicationEvent`
- `ClientCommunicationAttempt`
- `ClientCommunicationOutbox`

The existing communication outbox worker performs dispatch. With `SMS_PROVIDER=log`, dispatch is local log-provider behavior only.

## Configuration

Safe disabled defaults:

```env
REMINDERS_ENABLED=false
REMINDER_DUE_DAYS_BEFORE=1
REMINDER_OVERDUE_DAYS=1,3,7
REMINDER_QUIET_HOURS_START=20:00
REMINDER_QUIET_HOURS_END=08:00
REMINDER_MAX_PER_CLIENT_PER_DAY=1
REMINDER_MAX_PER_CLIENT_PER_WEEK=3
REMINDER_DEFAULT_LANGUAGE=ne
REMINDER_TIMEZONE=Asia/Kathmandu
REMINDER_LOOKAHEAD_DAYS=7
```

## Idempotency keys

Examples:

```text
reminder:payment_due:<client_id>:<source_reference>:<due_date>:<schedule_slot>
reminder:payment_overdue:<client_id>:<source_reference>:<due_date>:<overdue_day>
promise_to_pay:<client_id>:<source_reference>:<promise_date>:<schedule_slot>
center_meeting:<client_id>:<meeting_id>:<meeting_date>:<schedule_slot>
```

Repeated scheduler runs query `ClientCommunicationEvent.idempotency_key` first and do not create duplicate events, attempts, or outbox rows.

## Quiet hours

If a reminder would dispatch during quiet hours, the event is still created and the outbox `available_at` is moved to the next allowed local time.

Timestamp handling is explicit:

1. Scheduler input is normalized to a timezone-aware datetime in `REMINDER_TIMEZONE`.
2. Quiet-hours rules are evaluated in `Asia/Kathmandu` by default.
3. Before persistence, `scheduled_for` and `outbox.available_at` are converted to UTC and stored as **naive UTC** datetimes because the existing SQLAlchemy columns are plain `DateTime`.
4. Database comparisons remain consistent because scheduler-created timestamps and throttle windows are both compared as naive UTC.

Example:

```text
2026-07-29 21:30 Asia/Kathmandu
→ next allowed local time: 2026-07-30 08:00 Asia/Kathmandu
→ stored database timestamp: 2026-07-30 02:15:00 UTC, persisted as naive 2026-07-30T02:15:00
```

Timezone: `Asia/Kathmandu` by default. Nepal currently does not observe DST; Python `zoneinfo` is used so future timezone-rule changes are handled by the runtime timezone database.

## Throttling

Throttling enforces:

- `REMINDER_MAX_PER_CLIENT_PER_DAY`
- `REMINDER_MAX_PER_CLIENT_PER_WEEK`
- idempotent duplicate same-purpose obligation/slot keys

Counts include **reminder communications only** with purposes:

- `payment_due_reminder`
- `payment_overdue_reminder`
- `promise_to_pay_reminder`
- `center_meeting_reminder`

Counts include reminder attempts in:

- `pending`
- `queued`
- `submitted`
- `provider_accepted`
- `delivered`

`collection_verification` receipts are explicitly excluded. Duplicate/idempotent scheduler runs do not create new rows, so they do not increase throttle counts.

Suppressed throttle decisions write `communication_reminder_throttled` audit metadata without phone numbers or full messages.

## Cancellation

Reusable service:

```python
cancel_pending_reminders_for_payment(session, client_id=..., branch_id=None, source_reference=None, reason="payment_recorded")
```

Exact cancellation query conditions:

- `ClientCommunicationEvent.client_id == client_id`
- `ClientCommunicationEvent.purpose IN ('payment_due_reminder', 'payment_overdue_reminder', 'promise_to_pay_reminder')`
- if supplied: `ClientCommunicationEvent.branch_id == branch_id`
- if supplied: `ClientCommunicationEvent.source_reference == source_reference`
- only attempts with status `pending` or `queued` are mutated
- only outbox rows with status `pending`, `retryable`, or `processing` are cancelled

When payment is recorded, pending/queued due, overdue, and promise-to-pay reminders for the same client/branch/source scope are cancelled. The service:

- cancels pending/queued reminder attempts only
- cancels pending/retryable/processing outbox rows
- marks the reminder event cancelled
- writes `communication_reminder_cancelled`
- does not cancel `collection_verification`
- does not mutate submitted, provider-accepted, delivered, confirmed, disputed, or historical attempts

## Templates

English and Nepali templates are built in for all supported reminder purposes.

Examples:

English due reminder:

> `{org_name}: Your payment of NPR {amount} is due on {due_date}. Contact your branch if you need help.`

Nepali due reminder:

> `{org_name}: तपाईंको रु {amount} किस्ता {due_date} मा तिर्न बाँकी छ। सहयोग चाहिए शाखामा सम्पर्क गर्नुहोस्।`

Messages must not include PIN, OTP, full account number, or unnecessary loan details. Amounts are rendered with zero decimal places and dates use ISO `YYYY-MM-DD` for deterministic output. Missing template placeholders raise a safe `ValueError` before any outbox row is created. Metadata records Unicode character count and an estimated SMS segment count. Final segmentation depends on the real provider’s encoding rules and is verified only in a future live-provider phase; the estimate is not treated as a guarantee that a message is one SMS.

## Suppressed cases

The scheduler fails closed for paid installments, closed/inactive clients, closed/inactive/paid-off accounts, missing due dates, missing authoritative amounts, and invalid communication policy. These cases create no SMS outbox row and call no provider. Suppression is auditable via `communication_reminder_suppressed`; metadata contains reason, client/source identifiers, and excludes phone numbers and full message bodies.

## No-phone behavior

If no phone exists:

- event status: `no_phone`
- attempt status: `no_phone`
- no SMS outbox row is created
- branch/client/source references are preserved
- `communication_reminder_no_phone` audit is written

Escalation outbox creation is not enabled in Phase 5.

## Manager visibility

Read-only endpoints:

- `GET /api/v1/client-communication/reminders/upcoming`
- `GET /api/v1/client-communication/reminders/overdue-exceptions`
- `GET /api/v1/client-communication/reminders/summary`
- `GET /api/v1/client-communication/reminders/by-client/{client_id}`
- `GET /api/v1/client-communication/reminders/cancellation-history`

Branch managers are scoped to their branch. Admin/head-office style users can see consolidated authorized scope. `admin_it` remains excluded through the financial-data wall. Phone numbers are masked and full message payloads are not returned.

## Audit events

Added audit actions:

- `communication_reminder_created`
- `communication_reminder_suppressed`
- `communication_reminder_throttled`
- `communication_reminder_cancelled`
- `communication_reminder_no_phone`
- `communication_reminder_scheduler_run`

Audit metadata excludes full phone numbers and full message bodies.

## How real SMS providers dispatch later

Real providers are still handled by the existing outbox worker/provider abstraction. This phase creates durable outbox rows only. Future live-provider work must explicitly enable provider credentials, run migrations, replace backend, and start workers under separate approval gates.

## Known gaps

- CBS schedule import quality determines reminder quality; missing due dates or amounts are not guessed.
- Client preferred language is not modeled yet, so `REMINDER_DEFAULT_LANGUAGE` is used.
- Center membership depends on `meeting_attendance`; if membership is unavailable, meeting reminders cannot target clients.
- No escalation outbox is created for no-phone cases in Phase 5.
- No live migration 012/013 and no real SMS provider validation are performed in this phase.
