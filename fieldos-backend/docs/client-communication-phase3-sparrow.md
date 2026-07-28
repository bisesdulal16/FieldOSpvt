# Client Communication Phase 3: Sparrow SMS Provider

Phase 3 adds real Sparrow HTTPS submission behind the Phase 2 Postgres outbox worker. It does not add delivery callbacks, reminders, RabbitMQ, Redis, Jasmin, FreeSWITCH, n8n, IVR, or live deployment.

## Required configuration

Safe default remains local logging:

```env
SMS_PROVIDER=log
COMMUNICATION_WORKER_ENABLED=false
```

To use Sparrow manually after explicit approval/configuration:

```env
COMMUNICATION_WORKER_ENABLED=true
CLIENT_PROTECTION_ENABLED=true
VERIFICATION_SMS_ENABLED=true
SMS_PROVIDER=sparrow
SMS_API_TOKEN=<sparrow token>
SMS_SENDER=<approved sender ID>
SMS_SPARROW_URL=https://api.sparrowsms.com/v2/sms/
SMS_REQUEST_TIMEOUT_SECONDS=10
```

Never commit real tokens or production telecom credentials.

## Provider request safety

- The token is sent only in the request body field required by Sparrow; it is never placed in URL query parameters.
- Requests use `SMS_REQUEST_TIMEOUT_SECONDS`.
- Full provider responses and response bodies are not logged.
- Stored/logged provider errors are sanitized fixed messages, not raw response bodies.
- `X-FieldOS-Idempotency-Key` is derived from FieldOS outbox identity and contains no phone number or message text.
- `SMS_SENDER` is required and bounded to 20 characters before request construction.
- Recipient numbers are masked in logs.

## Sender-ID requirements

`SMS_SENDER` must match the sender/from identity approved by the Sparrow account. Authentication, endpoint, or sender misconfiguration is treated as a permanent/operator-action failure, not an automatic retry loop.

## Phone normalization

The reusable function `normalize_nepal_phone()` normalizes approved Nepal mobile inputs to national `98XXXXXXXX` or `97XXXXXXXX` form before sending.

Supported inputs:

| Input | Output |
|---|---|
| `98XXXXXXXX` | `98XXXXXXXX` |
| `97XXXXXXXX` | `97XXXXXXXX` |
| `+97798XXXXXXXX` | `98XXXXXXXX` |
| `+97797XXXXXXXX` | `97XXXXXXXX` |
| `97798XXXXXXXX` | `98XXXXXXXX` |
| `97797XXXXXXXX` | `97XXXXXXXX` |

`96XXXXXXXX` is not supported in this phase because the approved policy is limited to `98` and `97` mobile prefixes. Invalid lengths, non-digits after simple separator stripping, foreign country codes, and unsupported prefixes are rejected. The provider does not silently send malformed numbers.

## Status meanings

Successful Sparrow submission means the provider accepted the HTTP request for processing. It is not delivery confirmation.

| Path | Outbox | Attempt | Event |
|---|---|---|---|
| Success | `processing → published` | `queued → submitted` | `provider_accepted` |
| Retryable failure | `processing → pending` with future `available_at` | remains non-final | remains non-final |
| Permanent failure | `processing → dead` | `failed` | `failed` |
| Cancelled event | `pending/processing → cancelled` | `cancelled` | `cancelled` |

Phase 3 does not assign `delivered` or `confirmed`.

## Provider response mapping

| Condition | Outcome | Provider/operator status | `retry_after_seconds` |
|---|---|---|---|
| HTTP `200` / `2xx` with parseable object response | `success` | `provider_accepted`; provider reference saved when available, deterministic fallback otherwise | no |
| HTTP `400` | `permanent_failure` | malformed/rejected request; operator/config/payload action | no |
| HTTP `401/403` | `permanent_failure` | authentication/configuration operator action | no |
| HTTP `404` | `permanent_failure` | endpoint/configuration operator action | no |
| HTTP `408` | `retryable_failure` | provider request timeout | yes, only if `Retry-After` header exists |
| HTTP `409` | `retryable_failure` | temporary provider conflict/idempotency state | yes, only if `Retry-After` header exists |
| HTTP `422` | `permanent_failure` | unprocessable payload/operator action | no |
| HTTP `429` | `retryable_failure` | rate limited | yes, only if `Retry-After` header exists |
| HTTP `500–599` | `retryable_failure` | provider/server temporary failure | yes, only if `Retry-After` header exists |
| Timeout exception | `retryable_failure` | local/provider timeout | no |
| Connection/network/transport error | `retryable_failure` | provider temporarily unavailable | no |
| Malformed success response | `permanent_failure` | provider response contract/operator action | no |

Be cautious with 4xx responses: most indicate configuration, authentication, sender-ID, destination, or payload problems that automatic retry will not fix. Only 408/409/429 are retryable in this phase.

## Idempotency

The worker passes the outbox idempotency key to Sparrow as:

```text
X-FieldOS-Idempotency-Key: <outbox.idempotency_key>
```

This is available for future provider-side de-duplication where supported. The provider token is never logged.

## Legacy compatibility

`ClientCommunication*` tables remain the source of truth.

On final worker result, the worker updates the existing `SmsNotification` receipt row when it can match `collection_receipt_id`, instead of creating duplicate receipt rows. It creates a compatibility row only if none exists and a receipt reference is available.

## One-shot manual test path

Only run a real SMS after explicit approval and after setting valid credentials outside git:

```bash
COMMUNICATION_WORKER_ENABLED=true \
CLIENT_PROTECTION_ENABLED=true \
VERIFICATION_SMS_ENABLED=true \
SMS_PROVIDER=sparrow \
SMS_API_TOKEN="$SMS_API_TOKEN" \
SMS_SENDER="$SMS_SENDER" \
SMS_SPARROW_URL="https://api.sparrowsms.com/v2/sms/" \
python -m app.workers.communication_outbox --once --worker-id manual-sparrow-test --max-jobs 1
```

The outbox row must already contain the explicit target test number. Do not hardcode real numbers in code or docs.

## How to disable dispatch

Any of these keeps real provider dispatch off:

```env
COMMUNICATION_WORKER_ENABLED=false
CLIENT_PROTECTION_ENABLED=false
VERIFICATION_SMS_ENABLED=false
SMS_PROVIDER=log
```

## Known limitations

- No delivery confirmation is available unless the Sparrow account/API provides callbacks and a later phase implements them.
- `submitted` / `provider_accepted` means HTTP acceptance only.
- Duplicate submission remains theoretically possible if Sparrow accepts a message and the worker crashes before saving `provider_reference` / `submitted_at`; stale recovery can retry. Provider idempotency support should be used if Sparrow offers it.
- No RabbitMQ, Redis, Jasmin, FreeSWITCH, n8n, reminders, delivery callbacks, or IVR are part of Phase 3.
