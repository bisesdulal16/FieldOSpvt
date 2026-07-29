# Client Communication Phase 4: Delivery Callbacks

Phase 4 adds an authenticated provider-delivery callback framework using simulated callbacks only. It does **not** deploy public callback URLs, real Sparrow/SMPP credentials, reminders, RabbitMQ, Jasmin, FreeSWITCH, n8n, or IVR.

## Callback endpoints

All endpoints live under the API v1 prefix:

```text
POST /api/v1/client-communication/callbacks/sparrow
POST /api/v1/client-communication/callbacks/jasmin
POST /api/v1/client-communication/callbacks/generic
```

Supported adapters:

- **Sparrow simulated callback**: accepts `message_id`, `event_id`, `status`.
- **Jasmin simulated DLR**: accepts `id_smsc`, `dlr_id`, `dlr_status`.
- **Generic normalized callback**: accepts `provider_reference`, `provider_event_id`, `normalized_status`.

## Callback authentication

Callbacks require HMAC authentication with replay protection.

Required headers:

```text
X-FieldOS-Timestamp: <unix epoch seconds>
X-FieldOS-Signature: <hex hmac sha256>
```

Signature input:

```text
provider + "." + timestamp + "." + canonical_request_body
```

For the Phase 4 simulator and tests, `canonical_request_body` is deterministic JSON:

```text
json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
```

For later real providers, ingress adapters must either pass the exact raw request body bytes received from the provider or normalize provider payloads into the same canonical JSON rule before signature verification. Do not mix raw-body and canonical-body modes for the same endpoint.

The signed canonical body includes provider callback identity fields such as provider event ID, provider reference, and status. The provider name is also bound into the HMAC input from the endpoint adapter.

Signature algorithm:

```text
HMAC-SHA256(secret, provider + "." + timestamp + "." + canonical_request_body)
```

Header format:

```text
X-FieldOS-Signature: <64 lowercase hex chars>
```

Configuration:

```env
SMS_CALLBACK_SECRET=<protected runtime secret>
SMS_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS=300
```

Security rules:

- Missing signature is rejected.
- Invalid signature is rejected.
- Malformed timestamp is rejected.
- Expired timestamp is rejected.
- Replayed signature is rejected.
- Empty `SMS_CALLBACK_SECRET` fails closed with `callback_secret_not_configured`; there is no unsigned development bypass.
- Duplicate provider event IDs with the same provider and same payload hash are accepted idempotently.
- Duplicate provider event IDs with the same provider but a different payload hash are rejected as `provider_event_payload_conflict` and audited as suspicious replay/conflict.
- HMAC comparison uses constant-time comparison.
- Audit metadata excludes phone numbers and full message content.

## Normalized statuses

Provider statuses normalize into:

```text
submitted
provider_accepted
delivered
failed
expired
rejected
unknown
```

Unknown provider values are preserved as `unknown` and never inferred as `delivered`.

## State-transition rules

| Current state | Callback | Result |
|---|---|---|
| `submitted` | `provider_accepted` | event `provider_accepted`, attempt remains `submitted` |
| `submitted` | `delivered` | event/attempt `delivered` |
| `provider_accepted` | `delivered` | event/attempt `delivered` |
| `submitted` / `provider_accepted` | `failed` | event/attempt `failed` |
| `submitted` / `provider_accepted` | `expired` | event/attempt `expired` |
| `submitted` / `provider_accepted` | `rejected` | event/attempt `rejected` |
| `delivered` | `submitted` / `provider_accepted` | no state change; out-of-order audit |
| `confirmed` | any failure/delivery callback | no state change; final-state protected |
| `disputed` | delivery callback | no state change; final-state protected |
| `cancelled` | delivery callback | no state change; final-state protected |
| any active state | `unknown` | no delivery inference; out-of-order/unknown audit |

## Idempotency and replay protection

Phase 4 stores provider callback receipts in:

```text
client_communication_callback_receipts
```

This table enforces:

- unique `(provider, provider_event_id)` for provider event idempotency.
- unique signature digest for replay protection.
- callback payload hash for diagnostics without storing raw full payload in audit metadata.

Duplicate provider event ID behavior:

- Same `(provider, provider_event_id, callback_payload_hash)` is accepted idempotently.
- No duplicate delivery/failure audit is created.
- Existing timestamps are not overwritten repeatedly.
- Same `(provider, provider_event_id)` with a different `callback_payload_hash` is rejected with HTTP `409` and `provider_event_payload_conflict`.
- The same `provider_event_id` may be reused by different providers because uniqueness is scoped to `(provider, provider_event_id)`.

## Audit events

Phase 4 adds these audit action types:

```text
communication_callback_received
communication_callback_rejected
communication_delivered
communication_delivery_failed
communication_callback_duplicate
communication_callback_out_of_order
```

Audit metadata must not include:

- full phone numbers
- SMS body/full message content
- callback shared secret
- provider API tokens

## Simulator usage

Local simulator module:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic \
  --provider-reference <provider_reference> \
  --event-id sim-delivered-001 \
  --status delivered
```

Simulated delivered:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic --provider-reference <provider_reference> --event-id sim-delivered-001 --status delivered
```

Simulated failed:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic --provider-reference <provider_reference> --event-id sim-failed-001 --status failed
```

Simulated expired:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic --provider-reference <provider_reference> --event-id sim-expired-001 --status expired
```

Duplicate provider event ID:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic --provider-reference <provider_reference> --event-id sim-dupe-001 --status delivered --send-twice
```

Invalid signature:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic --provider-reference <provider_reference> --event-id sim-invalid-001 --status delivered --invalid-signature
```

Expired/replayed timestamp:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic --provider-reference <provider_reference> --event-id sim-expired-ts-001 --status delivered --timestamp-offset-seconds -999
```

Out-of-order callback:

```bash
SMS_CALLBACK_SECRET=dev-secret python -m app.scripts.simulate_communication_callback \
  --provider generic --provider-reference <already-terminal-provider-reference> --event-id sim-ooo-001 --status submitted
```

## Provider-specific adapter strategy

The callback service separates provider-specific extraction from normalized state handling:

1. Adapter extracts provider reference, provider event ID, raw status.
2. Normalizer maps raw provider status into the FieldOS status vocabulary.
3. State machine applies only allowed transitions.
4. Audit/logging uses sanitized metadata only.

Later real-provider configuration should only add provider-specific payload mapping and deployment wiring. The normalized service and state machine should remain shared.

## Real Sparrow/Jasmin configuration later

Before public callback deployment:

- Register provider callback URL only after HTTPS/public ingress is approved.
- Load `SMS_CALLBACK_SECRET` through protected runtime environment.
- Confirm provider timestamp/signature support or wrap provider callbacks at the ingress layer.
- Confirm provider event ID semantics.
- Confirm callback source IP allow-listing requirements.
- Run simulator tests against staging before registering production callback URLs.

## Not included in Phase 4

- Public deployment of callback endpoint
- Live Sparrow credentials
- SMPP/Jasmin deployment
- Delivery-report provider registration
- Payment reminders
- RabbitMQ
- Redis
- FreeSWITCH
- n8n workflows
- IVR
