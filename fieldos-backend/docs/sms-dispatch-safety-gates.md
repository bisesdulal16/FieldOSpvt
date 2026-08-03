# SMS Dispatch Safety Gates

Status: provider-independent implementation guidance and runtime safety controls. This document does not authorize Sparrow enablement, provider credentials, real SMS sends, worker deployment, n8n, Redis replay, reminder activation, or Phase 9 work.

## Safe defaults

The SMS dispatch layer fails closed for real providers by default:

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
```

`LogSmsProvider` remains usable under these defaults because it sends no telecom traffic. Real providers, including Sparrow, must pass every gate before their provider adapter is invoked.

## Provider classification

| Classification | Providers | Default behavior |
|---|---|---|
| `safe_log` | `log`, `log_sms` | Allowed for local/demo dispatch. |
| `real_sms` | `sparrow`, `sparrow_http` | Blocked unless every safety gate passes. |
| `unknown` | any other provider string | Blocked before provider selection. |

## Dispatch decision codes

Allowed decisions:

- `allowed_log_provider`
- `allowed_real_provider`

Blocked decisions:

- `blocked_unknown_provider`
- `blocked_malformed_configuration`
- `blocked_real_sms_disabled`
- `blocked_emergency_stop`
- `blocked_provider_not_allowlisted`
- `blocked_recipient_not_allowlisted`
- `blocked_daily_limit_closed`
- `blocked_per_recipient_daily_limit_closed`
- `blocked_cost_limit_closed`
- `blocked_idempotency_uncertain`
- `blocked_reconciliation_unavailable`
- `blocked_atomic_quota_unavailable`
- `blocked_template_service_missing`
- `blocked_consent_service_missing`
- `blocked_suppression_service_missing`

Blocked decisions persist as permanent failures for the claimed outbox row. That is intentional: a blocked real SMS must not sit in an automatically retried state that could send later after a configuration change.

## Required gates for real SMS

A real SMS provider must satisfy all of the following before provider invocation:

1. `REAL_SMS_ENABLED=true`.
2. `SMS_EMERGENCY_STOP=false`.
3. Provider appears in `SMS_PROVIDER_ALLOWLIST`.
4. Recipient appears in `SMS_ALLOWED_RECIPIENTS` after Nepal mobile normalization.
5. `SMS_DAILY_SEND_LIMIT > 0`.
6. `SMS_PER_RECIPIENT_DAILY_LIMIT > 0`.
7. `SMS_MAX_COST_PER_DAY > 0`.
8. `SMS_PROVIDER_IDEMPOTENCY_ENABLED=true`.
9. `SMS_PROVIDER_RECONCILIATION_ENABLED=true`.
10. If `SMS_REQUIRE_APPROVED_TEMPLATE=true`, an approved-template service must be available and pass.
11. If `SMS_REQUIRE_CONSENT=true`, a consent service must be available and pass.
12. Persistent atomic quota reservation must exist. This phase intentionally does not implement production quota reservation, so real providers still block with `blocked_atomic_quota_unavailable` even when the configuration gates above are positive.

Any malformed gate configuration blocks with `blocked_malformed_configuration`.

## Limit semantics

`SMS_DAILY_SEND_LIMIT`, `SMS_PER_RECIPIENT_DAILY_LIMIT`, and `SMS_MAX_COST_PER_DAY` are currently configuration gates only:

- zero means disabled/block all real sends;
- negative or malformed values fail closed;
- day-boundary enforcement is not active in this phase and must be explicitly implemented with the approved production timezone before activation;
- only real-provider attempts may count toward real-SMS limits;
- `LogSmsProvider` synthetic dispatch must not consume production quotas;
- failed-before-provider policy checks must not consume quota;
- provider-called uncertain outcomes must reserve/consume quota until reconciled;
- retries must reuse the original outbox/attempt quota reservation and must not reserve twice;
- duplicate/final-state work must not reserve again.

Because this phase has no persistent atomic reservation table/lock, all real providers remain blocked by `blocked_atomic_quota_unavailable` regardless of positive limits. Production activation requires an atomic database reservation, row lock, advisory lock, or equivalent before provider invocation.

## Future service interfaces

The implementation defines provider-independent interfaces for:

- recipient allowlist
- approved-template checks
- consent checks
- suppression checks

Unavailable service, timeout/exception, `None`, or unknown result is not approval. Only explicit positive template/consent results pass. Suppression has veto priority after template and consent have passed. The current default behavior for real providers is fail-closed when those service interfaces are required but unavailable. Future production services must plug into these interfaces without bypassing the gate.

## Dispatch integration points

The centralized safety policy is evaluated immediately before every current SMS provider boundary:

- PostgreSQL outbox worker before `provider.dispatch(...)`;
- RabbitMQ consumer before `provider.dispatch(...)`;
- legacy/direct `send_sms(...)` path before Sparrow HTTP;
- `SparrowSmsProvider.dispatch(...)` itself as a defense-in-depth boundary before HTTP.

No administrative/manual resend or callback-triggered resend path currently exists in the reviewed backend. Any future resend path must call the same centralized policy immediately before provider invocation.

## Emergency stop behavior

`SMS_EMERGENCY_STOP` defaults to `true`. It is evaluated at dispatch time by the centralized policy, so retries and previously queued real-provider work are blocked when the running settings object has the stop enabled. Operational changes to environment-backed settings require the same process reload/restart behavior as the rest of the backend configuration. `LogSmsProvider` remains exempt because it is non-delivery and emits no telecom request.

## Startup/config status

Unsafe real-provider configuration is represented through sanitized decision codes. The policy should surface status such as `blocked_real_sms_disabled`, `blocked_emergency_stop`, or `blocked_atomic_quota_unavailable`; it must not expose recipients, credentials, provider tokens, provider payloads, or message text.

## Audit and metrics behavior

Blocked paths:

- do not invoke provider adapters;
- do not log full recipients;
- do not log message bodies;
- record low-cardinality decision codes;
- expose block counters as `fieldos_sms_dispatch_safety_block_total{decision="..."}`.

The audit path uses sanitized metadata already handled by the communication outbox service. Provider tokens, full phone numbers, and message bodies must not be added to audit metadata or application logs.

## Rollout rule

Sparrow remains blocked until:

- authoritative Sparrow evidence is received;
- FieldOS owner decisions are approved;
- runtime secrets are configured outside git;
- real-SMS gates are intentionally configured for a one-message test;
- workers are started only under a separate explicit approval gate.
