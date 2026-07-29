# Client Protection Phase 7 — n8n orchestration workflows

Phase 7 adds n8n orchestration around the FieldOS Client Protection ledger. FieldOS/Postgres remains the source of truth for communication state, financial records, reminders, disputes, audit logs, outbox rows, and task state.

No live n8n deployment, Docker network change, RabbitMQ, Redis, Jasmin, FreeSWITCH, IVR, or real SMS dispatch is part of this phase.

## Trust boundary

n8n is an orchestration client only:

1. FieldOS emits or exposes sanitized event context.
2. n8n evaluates workflow routing.
3. n8n calls narrow authenticated FieldOS integration endpoints.
4. FieldOS creates tasks, records audit events, and returns masked status.

n8n must not write directly to Postgres and must not mutate financial tables.

## Configuration

Safe defaults:

```env
N8N_INTEGRATION_ENABLED=false
N8N_WEBHOOK_URL=
N8N_SHARED_SECRET=
N8N_REQUEST_TIMEOUT_SECONDS=10
N8N_DAILY_REPORT_HOUR=8
N8N_TIMEZONE=Asia/Kathmandu
N8N_RANDOM_SAMPLE_PERCENT=0
N8N_PROVIDER_FAILURE_THRESHOLD=10
N8N_BACKLOG_AGE_THRESHOLD_SECONDS=900
```

Integration request bodies are bounded to 64 KiB before HMAC processing.

`N8N_SHARED_SECRET` is per environment and must be generated outside Git.

## Authentication

Every integration request uses HMAC-signed service authentication, not an admin user token.

Required headers:

- `X-FieldOS-Timestamp` — Unix timestamp.
- `X-FieldOS-Nonce` — unique per request within the timestamp tolerance window.
- `X-FieldOS-Signature` — `sha256=<hex>` HMAC of `timestamp.nonce.raw_body` using `N8N_SHARED_SECRET`.

Canonicalization:

```text
timestamp + "." + nonce + "." + raw_request_body
```

The body segment is the exact raw request body bytes received by FastAPI. JSON is not parsed or re-serialized before signature verification. Header strings are UTF-8 encoded for HMAC input. Empty body requests are deterministic: the signed input ends after the final dot. Signature comparison uses constant-time `hmac.compare_digest`.

Controls:

- integration disabled by default;
- fail-closed behavior when the integration is disabled, the shared secret is empty, signature/timestamp/nonce headers are missing, the timestamp is malformed/expired, the nonce is blank, or the request is replayed;
- timestamp tolerance validation;
- required non-empty nonce;
- process-local replay cache for nonce/signature reuse;
- invalid requests audited as `n8n_integration_request_rejected` with sanitized reason only;
- no admin credentials accepted as substitutes;
- no development bypass based on `APP_ENV`.

Fail-closed rejection performs no domain mutation: no tasks, financial updates, event state changes, provider state changes, random samples, or alerts are created. Only the rejected-request audit row is written.

### Replay protection limitation

The current replay cache is process-local. It is suitable only while:

- `N8N_INTEGRATION_ENABLED=false` by default;
- the integration is not enabled across multiple backend replicas;
- no live n8n workflow is connected.

Production readiness warning: shared replay protection is mandatory before live enablement. Use either a Postgres-backed integration nonce table or dedicated Redis with TTL and atomic `SET NX` behavior. This phase does not deploy Redis and does not add the shared implementation because the live integration remains disabled.

## Endpoint scope

Base path: `/api/v1/integrations/n8n`

- `POST /events/{event_id}/escalate`
- `POST /events/{event_id}/callback-task`
- `POST /events/{event_id}/acknowledge`
- `POST /provider-health/alert`
- `GET /exceptions`
- `GET /daily-summary`
- `POST /random-sample`

The endpoints are narrow, auditable, and do not expose generic write access.

## Workflow purposes

### Dispute escalation

Trigger: communication event becomes disputed.

Actions:

- fetch sanitized event context from FieldOS;
- create a manager callback task in FieldOS;
- notify authorized branch/Head Office channels from n8n configuration;
- optionally request acknowledgement through FieldOS;
- write audit events.

Payloads include branch, event ID, receipt/reference, masked client identifier, dispute timestamp, and task owner. They exclude full phone, message body, provider credentials, and raw callback payload.

### Failed delivery escalation

Trigger statuses: `failed`, `rejected`, `expired`, `dead_letter`, `no_phone`.

Actions:

- classify severity;
- create exception/callback task where configured;
- retry only via FieldOS policy APIs;
- notify managers when thresholds are exceeded;
- audit the escalation.

n8n must not arbitrarily reset final states.

### Daily exception report

Scheduled daily in `Asia/Kathmandu` using FieldOS read APIs.

Groups disputes, no-phone events, failures, expiry, rejects, dead-letter rows, stale processing rows, overdue undelivered reminders, and callback replay/conflict indicators by branch, officer, severity, and provider. No full phone, full message body, provider token, callback signature, raw callback payload, internal recipient value, or unnecessary financial amount is included. The optional `branch_id` query narrows scope; it does not create broader access.

### Random verification sampling

n8n requests sampling; FieldOS generates/validates the sample. n8n does not submit arbitrary selected event IDs. The percentage is bounded from 0 to 100 and sample size is capped at 100 events per request. Disputed, cancelled, suppressed, finalized, and already-selected items are excluded. Selection is not exposed to field officers before FieldOS creates the assigned callback/manual verification task. Repeated requests are idempotent by date, branch scope, and `sample_version`.

### Manager callback task

Creates a FieldOS task with assigned branch manager/authorized queue, due date, safe reason, event reference, FieldOS-tracked status, and idempotency key.

### Provider outage alert

Triggers when provider failure counts, backlog age, worker heartbeat staleness, or dead-letter spikes exceed configured thresholds. The endpoint accepts safe aggregate health values only, validates provider identifiers against a narrow lowercase slug pattern, uses a bounded `window_start`, and records one alert per provider/window idempotency key. It cannot switch providers directly; any provider switch must go through a future explicit FieldOS policy endpoint. It notifies platform/operations contacts through n8n configuration but never exposes credentials.

## Idempotency

Keys follow these patterns:

- `n8n:dispute:<event_id>`
- `n8n:failed-delivery:<event_id>:<status>`
- `n8n:callback-task:<event_id>:<reason>`
- `n8n:daily-report:<date>:<scope>`
- `n8n:sample:<date>:<branch>:<sample_version>`
- `n8n:provider-alert:<provider>:<window_start>`

Repeated workflow calls reuse existing callback tasks and avoid duplicate task audit side effects. Persistence is in FieldOS/Postgres, not n8n memory: callback/escalation task idempotency keys are embedded in `task_assignments.reason`, while side-effect audit idempotency is checked against `audit_logs.meta_json`. This preserves the original event, branch, client, and task relationship on repeated signed calls.

## Masking and logging

FieldOS responses and audit metadata exclude:

- raw request bodies;
- HMAC signatures;
- shared secrets;
- nonce values except one-way nonce digests for request receipt troubleshooting;
- full phone numbers;
- full SMS bodies;
- raw callback payloads;
- provider tokens;
- callback signatures;
- provider secrets;
- internal encrypted recipient values.

Request receipt/rejection audit rows are separated from side-effect audit rows. Idempotent repeats with a fresh signed request may record a sanitized request receipt, but they do not duplicate task creation, escalation, random-sample, or provider-alert side-effect audit events.

Workflow exports use safe payload nodes and placeholder credentials. Do not enable n8n execution logging of full request bodies in production.

## Workflow exports

Sanitized exports live under `n8n/workflows/`:

- `client-protection-dispute-escalation.json`
- `client-protection-failed-delivery.json`
- `client-protection-daily-report.json`
- `client-protection-random-sampling.json`
- `client-protection-manager-callback.json`
- `client-protection-provider-outage.json`

Exports contain placeholder credentials only, use `{{$env.FIELDOS_API_BASE_URL}}`, and are inactive by default. They contain no live n8n credential IDs, production hostnames, phone numbers, tokens, secrets, direct database nodes, or URLs derived from incoming payloads. `{{$env.FIELDOS_API_BASE_URL}}` is the only environment-derived base URL pattern and is concatenated only with static FieldOS integration paths.

## Import and credential setup

1. Import the workflow JSON into a non-production n8n workspace.
2. Create a FieldOS HMAC credential/header signing helper using the environment-specific secret.
3. Set `FIELDOS_API_BASE_URL` in n8n environment configuration.
4. Keep workflows inactive until FieldOS integration settings are enabled in a test environment.
5. Run signed local requests against FieldOS test data.
6. Review n8n execution logs for masking before enabling scheduled workflows.

## Local testing

Backend tests cover:

- valid signed request accepted;
- invalid signature rejected;
- expired timestamp rejected;
- replay rejected;
- admin user token cannot substitute for integration secret;
- idempotent dispute/callback task creation;
- branch-scoped summaries;
- no direct financial mutation;
- FieldOS-generated random sampling;
- masked daily summary/no-phone escalation;
- provider threshold handling;
- no PII/secrets in audit metadata.

Workflow export tests validate JSON, placeholder credentials, required nodes, idempotency keys, bounded retry/error paths, and absence of phone numbers/secrets/production URLs.

## Live deployment approval process

A later approved phase must explicitly authorize:

- enabling `N8N_INTEGRATION_ENABLED`;
- setting `N8N_SHARED_SECRET`;
- connecting n8n to FieldOS networking;
- configuring real notification channels;
- provider policy switch behavior.

Until then, no live n8n deployment or real SMS dispatch is performed.

## Known limitations

- Imported CBS schedules remain authoritative for due dates and amounts.
- Client language preference is still not modeled.
- Shared-phone and phone-change indicators remain conservative until stronger lineage exists.
- Workflow exports are sanitized starter exports; final production credentials and notification channels must be configured outside Git.
- The replay cache is process-local; production multi-worker replay protection should use shared storage before live enablement.
