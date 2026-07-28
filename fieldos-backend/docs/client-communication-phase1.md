# Client Communication Phase 1 Semantics

Phase 1 records a transactional communication ledger and durable outbox only. It does **not** synchronously call SMS/IVR/AI-call providers from the collection commit path.

## State rules

- `attempt.status = pending` when dispatch is disabled or no SMS outbox row is created.
- `attempt.status = queued` only when an outbox row exists and a worker is expected to process it.
- `attempt.status = no_phone` when the client has no phone number.
- Provider submission must not be represented as `sent` or `delivered`; later phases should use distinct provider states such as submitted/accepted/delivered/client-confirmed.

## Behavior matrix

| Case | Event | Attempt | SMS outbox | Provider call | Collection commit |
|---|---|---|---|---|---|
| Phone exists, `CLIENT_PROTECTION_ENABLED=false` | Created with `pending` status | Created with `pending` status | None | None | Commits |
| Phone exists, `CLIENT_PROTECTION_ENABLED=true` and `VERIFICATION_SMS_ENABLED=true` | Created with `queued` status | Created with `queued` status | Exactly one row | None synchronously | Commits |
| No phone | Created with `no_phone` status | Created with `no_phone` status | None | None | Commits |
| Duplicate offline sync | Existing collection returned | No duplicate attempt | No duplicate row | None | Commits/idempotent |

## PII constraints

Full phone numbers must not be written into audit metadata, structured logs, exception messages, or idempotency keys. Audit metadata stores only `recipient_masked` (for example, `***0001`).

Outbox payloads and attempt/legacy notification rows may contain the recipient because they are the internal dispatch records needed for later workers.
