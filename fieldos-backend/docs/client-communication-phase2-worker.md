# Client Communication Phase 2 Worker

Phase 2 adds a Postgres-backed asynchronous outbox worker. It proves the full dispatch flow without RabbitMQ, Redis, Jasmin, FreeSWITCH, n8n, or Docker network changes.

## Lifecycle

The worker has two modes:

- One-shot: claims at most one configured batch, processes that batch, then exits `0` when processing completes. Individual message failures do not make the worker exit nonzero.
- Continuous: polls, claims, dispatches, sleeps for `OUTBOX_POLL_INTERVAL_SECONDS`, and handles `SIGTERM`/`SIGINT` by stopping after the current job boundary.

Commands:

```bash
python -m app.workers.communication_outbox --once
python -m app.workers.communication_outbox
```

The worker identity is:

```text
hostname:process_id:random_suffix
```

It is written to `locked_by`, structured logs, audit metadata, and heartbeat rows.

## Claim transaction

Claiming uses database-side time and Postgres row locking:

```sql
FOR UPDATE SKIP LOCKED
```

Rows are claimable only when:

- outbox status is `pending` or `retryable`
- `available_at IS NULL OR available_at <= NOW()`
- no active lock exists, or the lock is stale by `OUTBOX_LOCK_TIMEOUT_SECONDS`
- the event is not cancelled/confirmed/disputed
- the attempt is still dispatchable
- no provider reference or submitted timestamp exists

The claim transaction updates:

- `status = processing`
- `locked_at = NOW()`
- `locked_by = worker_id`
- `attempt_count = attempt_count + 1`
- `last_attempted_at = NOW()`

Then it commits before calling the provider.

## Provider-call boundary

Dispatch does not run inside the claim transaction:

1. Transaction A claims rows and commits lock state.
2. Provider call happens outside the DB transaction.
3. Transaction B verifies lock ownership and persists success/failure.

Final updates verify:

- outbox ID matches
- outbox status is `processing`
- `locked_by` matches the current worker

If zero rows match, the worker treats the lock as lost and does not overwrite state.

## Provider result model

Providers return normalized results:

- `success`
- `retryable_failure`
- `permanent_failure`

Each result may include:

- `provider_reference`
- `provider_status`
- `error_code`
- safe error message
- `retry_after_seconds`
- idempotency key used

Only `LogSmsProvider` exists in Phase 2. It returns `submitted`, never `delivered`, never logs full phone numbers, and supports deterministic test failure injection.

## Dispatchability

The worker will not dispatch if:

- event is cancelled
- outbox is already `published`, `dead`, `cancelled`, or `skipped`
- attempt is in `submitted`, `provider_accepted`, `delivered`, `confirmed`, `disputed`, or `cancelled`
- attempt already has `provider_reference`
- attempt already has `submitted_at`

## Status transitions

| Path | Outbox | Attempt | Event |
|---|---|---|---|
| Success | `pending → processing → published` | `queued → submitted` | `queued → provider_accepted` |
| Retryable failure | `pending → processing → pending` with future `available_at` | remains `queued` | remains `queued` |
| Permanent failure | `pending → processing → dead` | `failed` | `failed` |
| Max attempts | `processing → dead` | `failed` | `failed` |
| Cancelled event | `pending/processing → cancelled` | `cancelled` | `cancelled` |

No Phase 2 path sets `delivered` or `confirmed`.

## Retry calculation

Backoff is exponential with jitter:

```text
delay = min(OUTBOX_MAX_RETRY_SECONDS, OUTBOX_BASE_RETRY_SECONDS * 2^(attempt_count - 1))
delay = max(delay, provider_retry_after_seconds) when provider_retry_after_seconds is present
delay = min(delay + jitter, OUTBOX_MAX_RETRY_SECONDS)
```

Defaults:

```env
OUTBOX_BASE_RETRY_SECONDS=30
OUTBOX_MAX_RETRY_SECONDS=3600
```

Example without jitter:

```text
30s, 60s, 120s, 240s, 480s
```

Tests inject deterministic jitter.

## Stale-lock recovery

Rows stuck in `processing` beyond `OUTBOX_LOCK_TIMEOUT_SECONDS` become recoverable if the attempt has no provider reference and no submitted timestamp.

Recovery records:

- prior `locked_by`
- prior `locked_at`
- `recovery_count`
- `last_recovered_at`
- `last_recovered_by`
- `communication_stale_lock_recovered` audit event

If a provider reference or submitted timestamp exists, the row is not automatically re-dispatched.

## Dead-letter behavior

After maximum attempts or a permanent failure:

- outbox status becomes `dead`
- attempt status becomes `failed`
- event status becomes `failed`
- `last_error` and `last_error_code` are retained
- `communication_dispatch_dead_lettered` audit event is written
- no further automatic retries occur

Rows are never deleted.

## Cancellation behavior

If `event.cancelled_at` is set before dispatch:

- provider is not called
- outbox is marked `cancelled`
- attempt is marked `cancelled`
- event remains/gets `cancelled`
- `communication_dispatch_cancelled` audit event is written
- outbox is not marked `published`

## Health and metrics

Restricted endpoint:

```text
GET /api/v1/client-communication/outbox/health
```

It reports process/queue state only:

- process alive
- worker enabled
- database reachable
- recently polled
- recently dispatched successfully
- backlog degraded
- dead-letter backlog present
- pending/processing/retryable/dead counts
- oldest pending age

It does not expose phone numbers, payloads, message text, provider credentials, or message bodies.

Prometheus-compatible metrics:

```text
GET /api/v1/client-communication/outbox/metrics
```

Metrics include queue counts, success/failure/retry counters, oldest pending age, and dispatch duration summary values.

## Audit events

Phase 2 writes:

- `communication_outbox_claimed`
- `communication_dispatch_submitted`
- `communication_dispatch_retry_scheduled`
- `communication_dispatch_dead_lettered`
- `communication_stale_lock_recovered`
- `communication_dispatch_cancelled`

Audit metadata must not include full phone numbers, message text, raw payloads, or credentials.

## Idempotency limitation

The worker checks before dispatch that the outbox is not published/dead and the attempt has no final provider result.

Known unavoidable edge case:

> A provider accepts the message, but the worker crashes before saving `provider_reference` and `submitted_at`. After stale-lock recovery, another worker may retry and submit again.

Future real providers must receive `outbox.idempotency_key` as a provider idempotency key/header. The log provider simulates this by returning a deterministic fake provider reference based on the idempotency key.

## Phase 3 path

Phase 3 may replace or supplement Postgres polling with RabbitMQ. The ledger, attempt states, provider abstraction, idempotency key, retry policy, dead-letter policy, and audit events should remain the source of truth. RabbitMQ should become a transport/notification layer, not the financial transaction dependency.
