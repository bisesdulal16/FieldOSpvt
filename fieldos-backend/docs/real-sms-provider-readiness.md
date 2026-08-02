# Real SMS Provider Readiness Review

Status: planning only.
Branch: `plan/real-sms-provider-readiness`
Base SHA: `90d31ee50ed57665f70c2d5d7282f13d3b8a72d0`
Scope: read-only architecture review and next implementation plan. No live provider activation, credentials, runtime flag changes, worker restarts, merges, or deployments.

## Executive summary

FieldOS already has the core shape needed for real SMS behind a durable communication ledger:

- transactional `ClientCommunicationEvent`, `ClientCommunicationAttempt`, and `ClientCommunicationOutbox` tables;
- provider abstraction with `LogSmsProvider`, `SparrowSmsProvider`, and `UnknownProvider`;
- provider result normalization into `success`, `retryable_failure`, and `permanent_failure`;
- Postgres outbox claim/commit, provider call outside transaction, and ownership-verified result persistence;
- RabbitMQ publisher/consumer path with explicit ACK/retry/DLQ outcomes and bounded retry;
- simulated provider callback framework with HMAC authentication, timestamp tolerance, replay protection, provider-event idempotency, and delivery state updates;
- sanitized audit helpers and masking in the newer communication path.

FieldOS is **not ready** to enable Sparrow for real recipients until additional production controls are implemented and provider documentation is externally verified. The main unresolved operational risk remains provider-side duplicate suppression/reconciliation when Sparrow accepts a message but FieldOS crashes before committing the provider result to PostgreSQL.

## Existing provider functionality

### Provider abstraction

File: `app/services/communication_providers.py`

Existing:

- `CommunicationProvider.dispatch(attempt, payload, *, idempotency_key)` interface.
- `DispatchResult` with:
  - `outcome`
  - `provider_reference`
  - `provider_status`
  - `error_code`
  - sanitized `safe_error_message`
  - `retry_after_seconds`
  - `idempotency_key_used`
- `provider_for(payload)` routes:
  - `log` / `log_sms` -> `LogSmsProvider`
  - `sparrow` / `sparrow_http` -> `SparrowSmsProvider`
  - otherwise -> `UnknownProvider`

### LogSmsProvider

Existing:

- safe local provider that sends no SMS;
- validates `channel=sms`, provider `log`/`log_sms`, message presence, and destination shape;
- supports injected retryable/permanent test failures;
- creates deterministic `log_sms_<hash>` provider references from the FieldOS idempotency key;
- logs only masked recipient and idempotency-key hash.

### Sparrow provider framework

Existing:

- HTTPS default endpoint: `https://api.sparrowsms.com/v2/sms/`;
- token is sent in request body, not URL query params;
- sender ID is bounded and required;
- request timeout via `SMS_REQUEST_TIMEOUT_SECONDS`;
- Nepal mobile normalization via `normalize_nepal_phone()`;
- `X-FieldOS-Idempotency-Key` header sent with the FieldOS outbox idempotency key;
- 2xx parseable response maps to success/provider acceptance;
- provider reference extracted from a bounded set of response keys with deterministic fallback;
- timeout/network/408/409/429/5xx map to retryable failure;
- auth/config/payload/endpoint/422/malformed success map to permanent/operator action;
- full provider response bodies are not stored/logged by the new provider implementation.

### Legacy SMS service

File: `app/services/sms_service.py`

Existing but should **not** be the real-provider path for the next rollout:

- `send_sms()` supports `log` and `sparrow` directly;
- `record_and_send_receipt()` sends synchronously and records `SmsNotification`;
- logs full phone/message for `log` provider and returns raw/truncated provider text on some errors.

Readiness decision: keep this as legacy compatibility only or retire it from real-provider activation paths. Real sends should go through the communication outbox provider abstraction, not the legacy synchronous service.

### Outbox and consumer architecture

Files:

- `app/services/communication_outbox_service.py`
- `app/services/communication_broker.py`
- `app/workers/communication_consumer.py`

Existing:

- source of truth remains PostgreSQL;
- outbox rows are claimed using Postgres locking/`SKIP LOCKED` where available;
- claim transaction commits before provider call;
- provider result is persisted in a second transaction only if the worker still owns the processing row;
- final-state guard prevents dispatch when an attempt already has `provider_reference`, `submitted_at`, or terminal status;
- broker consumer validates compact PII-free envelopes and fetches authoritative recipient/message/provider data from PostgreSQL;
- explicit `ConsumerOutcome -> BrokerAction` map:
  - provider submitted/retry scheduled/final duplicate -> ACK
  - retryable conflict/not found/unexpected state -> delayed retry
  - malformed/idempotency mismatch/permanent invalid -> reject/DLQ
- bounded RabbitMQ delayed retry/DLQ path with retry headers;
- stranded `broker_published` visibility endpoint and Prometheus gauge.

### Audit logging and masking

Existing:

- `write_system_audit()` removes `recipient`, `phone`, `message`, and `payload` from audit metadata;
- communication provider logs masked recipient and idempotency-key hash;
- broker envelopes reject PII/financial payload keys;
- callback rejection for unknown provider reference stores a provider-reference hash instead of the raw value.

Known concern:

- `communication_dispatch_submitted` audit metadata currently includes `idempotency_key_used`. The current FieldOS idempotency key should not contain phone/message text, but before real SMS this should be re-reviewed and preferably replaced with an idempotency-key hash in audit metadata.

## Missing provider functionality

Before real SMS activation, FieldOS still needs:

1. explicit real-provider activation gate separate from `SMS_PROVIDER`;
2. provider allowlist and startup fail-closed validation;
3. allowlisted recipient/test-mode controls;
4. daily/global/per-recipient send limits;
5. estimated cost limits;
6. suppression/opt-out/consent enforcement;
7. approved message-template registry;
8. emergency kill switch checked by publisher and consumer before provider calls;
9. provider-side idempotency/reconciliation behavior documented and implemented;
10. callback URL registration and production callback authentication mapping to actual Sparrow capabilities;
11. callback rate limiting and edge-level access controls;
12. delivery callback metrics/alerts;
13. provider result uncertainty state and reconciliation workflow;
14. sanitized tests for no token/full phone/full body/provider response leakage;
15. runbook for rollback and first real-message approval.

## Provider-side idempotency findings

Repository evidence:

- `SparrowSmsProvider` sends `X-FieldOS-Idempotency-Key` with the outbox idempotency key.
- `client-communication-phase3-sparrow.md` states this is available for future provider-side de-duplication where supported.
- The same doc explicitly says duplicate submission remains theoretically possible if Sparrow accepts a message and the worker crashes before saving `provider_reference` / `submitted_at`.
- No repository file proves that Sparrow honors client-provided idempotency keys, request reference IDs, duplicate-request protection, provider message lookup by client reference, or reconciliation APIs.

Conclusion:

- Sparrow provider-side idempotency is **not verified from repository artifacts**.
- This is an **external verification requirement** before real SMS activation.

### External information required from Sparrow/account docs

Required before enabling real SMS:

- whether Sparrow accepts a client-provided idempotency key or request reference;
- exact field/header name for that key, if any;
- duplicate-request behavior for same key + same payload;
- duplicate-request behavior for same key + different payload;
- provider message lookup API by provider message ID;
- provider message lookup API by client reference/idempotency key;
- reconciliation/reporting API and date-range limits;
- callback payload schema and delivery status vocabulary;
- callback authentication/signature/IP allowlisting options;
- retry/timeout/rate-limit/error-code semantics;
- sender ID approval constraints and test/sandbox behavior.

## FieldOS behavior if provider supports idempotency keys

Design:

1. Generate a deterministic provider-safe idempotency key from the outbox ID and immutable event/attempt identity.
2. Ensure the key contains no phone number, message body, client ID, financial data, or branch name.
3. Send it using the provider-documented field/header, not an invented header unless Sparrow confirms it.
4. Persist the idempotency key hash and provider request hash before dispatch.
5. If the worker crashes after provider acceptance but before DB commit, stale recovery can retry with the same provider idempotency key.
6. If provider returns duplicate/same accepted reference, treat as success and persist the returned provider reference.
7. If provider reports same key with conflicting payload, mark the outbox `provider_uncertain`/review and do not retry automatically.
8. Reconcile by provider reference/idempotency key before any further send attempt.

Required implementation changes:

- add explicit `provider_idempotency_key_hash` / request hash fields or safe metadata;
- replace audit storage of raw `idempotency_key_used` with a hash;
- document and test duplicate same-key behavior;
- add reconciliation worker/job for uncertain outcomes.

## FieldOS behavior if provider does not support idempotency keys

Design:

1. Treat provider acceptance before DB commit as an uncertain-send risk.
2. After a worker crash in the post-provider/pre-commit window, do **not** blindly retry real SMS.
3. Move stale `processing` rows with no saved provider reference into a `provider_uncertain` / `manual_review` state rather than back to normal pending retry for real providers.
4. Attempt provider reconciliation by time window, masked recipient hash, sender, and message template hash only if provider has a safe lookup/report API.
5. If reconciliation cannot prove non-delivery, require manual operator decision; default should avoid duplicate client contact.
6. Keep automated retry for pre-provider failures only: timeout before request sent, connection failure before write, validation failure, or provider explicitly rejected without sending.

Required implementation changes:

- distinguish `provider_called_unknown_commit` from ordinary retryable failure;
- persist provider request start timestamp and request hash before call;
- add operator review queue for uncertain results;
- add a no-auto-resend policy for real providers when acceptance is uncertain;
- add reconciliation runbook and audit events.

## Production safety requirements

Required controls before any real SMS provider is enabled:

- explicit provider allowlist: only configured safe provider names accepted;
- real-provider feature flag separate from `SMS_PROVIDER`;
- environment separation for dev/stage/prod/test provider credentials;
- encrypted secret storage outside git and outside plain runtime logs;
- startup validation that fails closed when real provider is selected without every safety gate;
- reusable recipient normalization;
- Nepal mobile-number validation with approved prefixes only;
- suppression/opt-out list checked before outbox creation and before dispatch;
- consent evidence linked to client/purpose/template;
- message-template approval registry with versioned template IDs;
- branch and tenant scoping;
- per-client/per-recipient rate limits;
- global send limits;
- daily estimated cost limit;
- duplicate-send protection across event/outbox/provider-idempotency layers;
- emergency kill switch checked by both publisher and consumer;
- sanitized audit logging for every state transition;
- delivery callback verification and replay protection;
- reconciliation workflow for uncertain provider results.

## Proposed configuration design

Safe defaults should remain no-real-send:

```env
SMS_PROVIDER=log
REAL_SMS_ENABLED=false
SMS_PROVIDER_ALLOWLIST=log
SMS_ALLOWED_RECIPIENTS=
SMS_DAILY_SEND_LIMIT=0
SMS_PER_RECIPIENT_DAILY_LIMIT=0
SMS_MAX_COST_PER_DAY=0
SMS_EMERGENCY_STOP=true
SMS_PROVIDER_IDEMPOTENCY_ENABLED=false
SMS_PROVIDER_RECONCILIATION_ENABLED=false
SMS_REQUIRE_APPROVED_TEMPLATE=true
SMS_REQUIRE_CONSENT=true
SMS_REQUIRE_SUPPRESSION_CHECK=true
SMS_REQUIRE_CALLBACK_SIGNATURE=true
SMS_CALLBACK_SECRET=
SMS_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS=300
SMS_REQUEST_TIMEOUT_SECONDS=10
```

Naming follows existing conventions where possible: `SMS_*` for provider-specific send controls and existing `SMS_CALLBACK_*`, `SMS_REQUEST_TIMEOUT_SECONDS`, `SMS_PROVIDER`, `SMS_API_TOKEN`, `SMS_SENDER`, `SMS_SPARROW_URL`.

Activation principle:

- `SMS_PROVIDER=sparrow` alone must **not** be enough.
- Real send requires every applicable activation gate below to pass. Missing any one gate must fail closed with no provider call.

Required before any real send:

- `SMS_PROVIDER=sparrow`;
- `REAL_SMS_ENABLED=true`;
- `SMS_EMERGENCY_STOP=false`;
- `SMS_PROVIDER_ALLOWLIST` includes `sparrow`;
- approved recipient allowlist entry or approved rollout scope;
- approved versioned message template;
- consent evidence linked to the client/purpose/template;
- suppression/opt-out check passed;
- applicable daily, per-recipient, and cost limits configured and not exceeded;
- valid provider credentials available from approved secret storage outside git;
- written authorization for the specific rollout stage.

## Callback security review

Files:

- `app/services/communication_callbacks.py`
- `app/routers/communication_callbacks.py`
- `app/models/client_communication.py`

Existing:

- callback endpoints for `/sparrow`, `/jasmin`, and `/generic`;
- fail-closed if `SMS_CALLBACK_SECRET` is missing;
- HMAC over provider + timestamp + raw body;
- timestamp tolerance check;
- constant-time signature compare;
- signature digest stored for replay protection;
- provider callback receipt table with unique `(provider, provider_event_id)` and unique `signature_digest`;
- duplicate same provider event returns duplicate without state mutation;
- same provider event with different payload is rejected;
- unknown provider reference is rejected with audit metadata using hash;
- final-state/out-of-order transition protection;
- callback audit records for received, duplicate, rejected, out-of-order, delivered, and delivery failed;
- logs only provider/status/attempt ID, not payload body.

Gaps before real callbacks:

1. Actual Sparrow callback authentication scheme is not verified. Current HMAC is FieldOS-defined and works for simulated callbacks, but may not match Sparrow.
2. Callback exposure policy is not documented: public URL, IP allowlist, API gateway/WAF, and HTTPS termination need a runbook.
3. No endpoint-specific rate limiting is visible in the callback router.
4. `provider_reference` is included in duplicate callback audit metadata. Treat as provider-sensitive and prefer hash-only for real callbacks.
5. No explicit branch/tenant check on provider callback beyond provider reference lookup. This may be acceptable because provider references are unique, but tenant scoping should be documented/tested.
6. Callback parser has inferred Sparrow field candidates, but actual Sparrow DLR schema must be verified externally.
7. `unknown` status is stored as receipt then no state change. That is safe, but needs alerting/reconciliation.
8. No reconciliation endpoint/job exists for callbacks that never arrive.
9. Replay protection uses signature digest; if provider does not sign in a way that changes per callback, this must be adapted.
10. No documented retry semantics for provider callback delivery failures.

Required callback changes:

- implement actual Sparrow callback authentication after provider confirmation;
- add callback-specific rate limits;
- hash provider references in audit metadata where not needed raw;
- add tests for actual Sparrow schema/status mapping;
- add metrics for callback accepted/rejected/duplicate/conflict/unknown/no-mutation;
- add reconciliation job for missing callbacks;
- require HTTPS callback URL and callback secret/allowlist validation at startup.

## Delivery-state model

Intended happy path:

```text
queued
→ broker_published
→ submitted
→ provider_accepted
→ delivered
```

Authoritative systems:

| Transition | Authority | Notes |
|---|---|---|
| `queued` | FieldOS DB transaction | Event/attempt/outbox created with business transaction. |
| `broker_published` | RabbitMQ publisher + PostgreSQL | Publisher confirm observed, then Postgres records broker publish. |
| `submitted` | FieldOS consumer + provider HTTP response | Worker sent provider request and is persisting provider result. |
| `provider_accepted` | Provider HTTP acceptance normalized by FieldOS | Acceptance only; not delivery. Event status reflects provider accepted for processing. |
| `delivered` | Authenticated provider callback or reconciliation API | Only callback/reconciliation can mark delivered. |

Other states:

| State | Meaning | Authority/action |
|---|---|---|
| `provider_rejected` / `rejected` | Provider rejected destination/payload/sender. | Provider callback or synchronous provider response; terminal unless corrected and new event is approved. |
| `failed` | Permanent dispatch/delivery failure. | FieldOS provider classification or callback. |
| `expired` | Provider TTL expired or delivery window passed. | Provider callback/reconciliation. |
| `undeliverable` | Destination cannot receive SMS. | Map to `rejected` or `failed` unless separate state is added. |
| retryable failure | Temporary pre-acceptance failure. | FieldOS retry scheduler/broker retry; no delivery assumption. |
| unknown/provider-uncertain | Provider result cannot be proven after request may have been accepted. | FieldOS review/reconciliation state; avoid automatic duplicate send. |

Recommended addition:

- Add an explicit `provider_uncertain` / `manual_review` status for real-provider crash windows and reconciliation gaps.

## Real-provider activation gates

All must pass before Sparrow is enabled:

- provider account approved;
- test credentials available outside git;
- sandbox or approved test endpoint confirmed;
- sender ID approved;
- callback URL registered;
- callback signature/authentication confirmed;
- provider IP allowlist or equivalent documented, if supported;
- rate limits documented;
- pricing documented;
- idempotency behavior documented;
- provider lookup/reconciliation behavior documented;
- error codes mapped;
- delivery statuses mapped;
- opt-out process implemented;
- suppression list implemented;
- consent evidence implemented;
- message-template approval implemented;
- monitoring and alerting implemented;
- emergency kill switch implemented and tested;
- rollback tested;
- approved test recipients identified;
- written approval obtained before first real SMS.

## Staged rollout plan

### Stage A — LogSmsProvider always-on

Entry criteria:

- current 24-hour LogSmsProvider monitor completes cleanly;
- no stranded broker rows, duplicate provider calls, queue growth, or sensitive logs;
- backend and workers prove safe defaults restore.

Stop conditions:

- queue depth grows unexpectedly;
- duplicate log-provider invocation;
- stranded gauge nonzero;
- worker restart loop;
- real rows appear unexpectedly.

Rollback:

- stop worker containers;
- restore safe flags;
- keep `SMS_PROVIDER=log`.

Success criteria:

- four synthetic canaries processed exactly once;
- provider invocation total exactly four;
- final queues zero;
- no live client communication.

Approval:

- approval to proceed to provider sandbox/test planning only.

### Stage B — Sparrow sandbox or approved test mode, one internal recipient

Entry criteria:

- Sparrow test/sandbox endpoint and callback auth verified;
- real-provider safety flags implemented;
- allowlist contains exactly one internal test recipient;
- `SMS_DAILY_SEND_LIMIT=1`, `SMS_PER_RECIPIENT_DAILY_LIMIT=1`, cost limit set;
- written approval for exactly one test SMS.

Stop conditions:

- callback auth mismatch;
- provider returns unexpected status/error schema;
- duplicate provider request;
- any recipient outside allowlist;
- logs expose token/full phone/body/provider payload.

Rollback:

- set emergency stop true;
- stop workers;
- restore `SMS_PROVIDER=log`, `REAL_SMS_ENABLED=false`;
- revoke/test-rotate credentials if exposed.

Success criteria:

- exactly one provider request;
- provider reference persisted;
- no `delivered` without callback;
- callback/reconciliation maps final state correctly if available.

Approval:

- explicit approval for Stage C only.

### Stage C — Up to five approved recipients, manual approval per batch

Entry criteria:

- Stage B passed;
- callback and reconciliation paths tested;
- five internal/test recipients approved;
- template approved and versioned;
- monitoring alerts active.

Stop conditions:

- any duplicate send;
- rate/cost counter mismatch;
- callback failures above threshold;
- provider uncertainty not resolved;
- any non-approved purpose/template.

Rollback:

- emergency stop;
- stop workers;
- provider reconciliation report;
- notify operators with sanitized summary.

Success criteria:

- each approved recipient receives at most one intended message;
- all outbox rows terminal or provider-accepted with expected callback state;
- no DLQ/stranded growth.

Approval:

- written pilot-branch approval.

### Stage D — One pilot branch, approved purposes only

Entry criteria:

- branch scope configured;
- consent and suppression data complete;
- daily send/cost limits approved;
- branch manager and operations approval;
- rollback drill complete.

Stop conditions:

- opt-out violation;
- consent missing;
- branch-scope leak;
- cost/rate limit exceeded;
- unresolved provider uncertainty;
- provider outage.

Rollback:

- emergency stop;
- switch provider to log;
- stop workers if needed;
- reconcile all in-flight provider references;
- operator report.

Success criteria:

- no unauthorized recipients;
- delivery/callback metrics within expected threshold;
- no duplicate sends;
- branch audit trail complete.

Approval:

- broader production readiness review.

### Stage E — Broader controlled production rollout

Entry criteria:

- Stage D stable over agreed monitoring period;
- production support runbook approved;
- provider SLA/rate/cost monitoring active;
- alert escalation owner assigned.

Stop conditions:

- provider incident;
- customer complaint pattern;
- duplicate/incorrect message;
- cost/rate breach;
- callback/reconciliation backlog.

Rollback:

- emergency stop;
- controlled worker shutdown;
- disable real provider;
- provider reconciliation and incident review.

Success criteria:

- stable daily sends within approved limits;
- no duplicate or unauthorized sends;
- callback/reconciliation backlog bounded;
- clean audit/monitoring trail.

Approval:

- separate approval for each expansion in branch/purpose/volume.

## Monitoring and alerting requirements

Metrics must avoid phone numbers, client IDs, message IDs, outbox IDs, provider references, broker IDs, idempotency keys, and message bodies as labels.

Required metrics:

- `fieldos_communication_messages_published_total{channel,provider,purpose}`
- `fieldos_communication_provider_submissions_total{provider,purpose,outcome}`
- `fieldos_communication_provider_acceptance_total{provider,purpose}`
- `fieldos_communication_delivery_success_total{provider,purpose}`
- `fieldos_communication_provider_rejection_total{provider,purpose,reason_class}`
- `fieldos_communication_retry_total{stage,reason_class}`
- `fieldos_communication_dlq_total{queue,reason_class}`
- `fieldos_communication_broker_published_unprocessed` gauge, already present
- `fieldos_communication_duplicate_prevention_total{stage,provider}`
- `fieldos_communication_callback_failures_total{provider,reason_class}`
- `fieldos_communication_send_latency_seconds` histogram
- `fieldos_communication_daily_send_count{provider,purpose,environment}`
- `fieldos_communication_estimated_daily_cost{provider,environment}`
- `fieldos_communication_emergency_stop_enabled` gauge
- `fieldos_communication_provider_uncertain_total{provider,reason_class}`
- `fieldos_communication_reconciliation_pending_total{provider}`

Required alerts:

- stranded broker-published gauge > 0 for threshold window;
- DLQ count > 0;
- provider rejection spike;
- callback rejection/conflict spike;
- duplicate-prevention event during real provider mode;
- daily send limit >= 80% and >= 100%;
- cost limit >= 80% and >= 100%;
- emergency stop enabled/disabled changes;
- provider-uncertain rows > 0;
- no callback/reconciliation after provider acceptance beyond SLA;
- worker restart loop;
- queue depth growth;
- real provider active while `REAL_SMS_ENABLED=false`.

## Implementation plan before real provider activation

1. Add safety config flags and startup validation.
2. Add provider allowlist and real-provider activation gate.
3. Add emergency-stop checks in publisher/consumer/provider path.
4. Add recipient allowlist and daily/per-recipient/cost limit enforcement.
5. Add suppression/opt-out/consent/template gates before outbox creation and before dispatch.
6. Hash idempotency key/provider reference in audit metadata where raw value is not necessary.
7. Add provider-uncertain state and reconciliation workflow for post-provider/pre-commit crash window.
8. Confirm Sparrow idempotency and callback docs externally.
9. Update callback adapter to actual Sparrow authentication/schema.
10. Add callback rate limiting and monitoring metrics.
11. Add tests for all safety gates and log redaction.
12. Prepare one-message live test runbook requiring explicit written approval.

## Non-goals for this planning branch

- no real credentials;
- no real recipient numbers;
- no environment changes;
- no worker/runtime changes;
- no live sends;
- no n8n/Redis replay/reminders/Phase 9 activation;
- no deployment, merge, or commit without approval.
