# FieldOS Client Protection — Phase 8 Messaging Infrastructure

Phase 8 adds RabbitMQ and a dedicated Redis instance for client communication distribution without moving durable communication truth out of PostgreSQL.

## Durability boundary

PostgreSQL remains authoritative for:

- communication event state
- attempt state
- outbox publication state
- broker message IDs
- idempotency
- audit records
- retries and final provider results

RabbitMQ distributes work only. Redis is limited to short-lived coordination, replay protection, rate limits, locks, and provider-health cache data. Redis must not store official communication status, financial records, audit history, full messages, phone numbers, or provider credentials.

## Flow

```text
collection/reminder transaction
  -> PostgreSQL client_communication_outbox
  -> python -m app.workers.communication_publisher [--once]
  -> RabbitMQ exchange fieldos.communication
  -> python -m app.workers.communication_consumer --queue sms
  -> existing provider abstraction
  -> PostgreSQL attempt/event/outbox result update
```

## Dispatch mode

Default remains rollback-safe:

```env
COMMUNICATION_DISPATCH_MODE=postgres
RABBITMQ_ENABLED=false
REDIS_ENABLED=false
N8N_REPLAY_STORE=memory
```

RabbitMQ mode is opt-in only:

```env
COMMUNICATION_DISPATCH_MODE=rabbitmq
RABBITMQ_ENABLED=true
RABBITMQ_URL=amqp://fieldos:<password>@rabbitmq:5672/%2Ffieldos
```

The existing direct Postgres worker is preserved. When dispatch mode is `rabbitmq`, the Postgres worker exits without dispatching so provider calls happen only through the broker consumer.

## RabbitMQ topology

Exchange: `fieldos.communication` durable topic exchange.

Active in Phase 8:

| Purpose | Routing key | Queue | Consumer |
|---|---|---|---|
| SMS | `communication.sms` | `fieldos.communication.sms` | enabled |
| Reminder orchestration | `communication.reminder` | `fieldos.communication.reminder` | declared; no active consumer by default |

Deterministic routing rule: delivery work routes by channel. Existing payment reminder scheduling creates an SMS outbox item, so it routes only to `communication.sms` / `fieldos.communication.sms`. The `communication.reminder` route is reserved for future non-delivery reminder orchestration and must not receive the same SMS delivery item.

Declared for forward compatibility only:

| Purpose | Routing key | Queue | Consumer |
|---|---|---|---|
| IVR | `communication.ivr` | `fieldos.communication.ivr` | disabled |
| Escalation | `communication.escalation` | `fieldos.communication.escalation` | disabled |

Dead-letter exchange: `fieldos.communication.dlx`.

Dead-letter queues:

- `fieldos.communication.sms.dead`
- `fieldos.communication.ivr.dead`
- `fieldos.communication.escalation.dead`
- `fieldos.communication.reminder.dead`

RabbitMQ requirements implemented/design-enforced:

- durable exchange and queues
- persistent messages
- publisher confirms
- manual consumer ack/nack/reject
- dead-letter routing
- bounded Postgres retry state for broker publish failures
- per-message idempotency key
- message envelope excludes PII and financial payloads

## Message envelope

```json
{
  "schema_version": 1,
  "message_id": "uuid",
  "idempotency_key": "client_comm:collection_verification:RCPT:sms:1",
  "outbox_id": 123,
  "event_id": 123,
  "attempt_id": 123,
  "channel": "sms",
  "purpose": "collection_verification",
  "created_at": "2026-07-29T00:00:00Z",
  "trace_id": "fieldos-outbox-123"
}
```

Never include full phone number, SMS body, provider token, or client financial payload in the envelope. The consumer fetches recipient/message/provider metadata from PostgreSQL using outbox/attempt/event IDs and validates idempotency before dispatch.

## Publisher behavior

Command:

```bash
python -m app.workers.communication_publisher --once
python -m app.workers.communication_publisher
```

Behavior:

1. Claims PostgreSQL outbox rows with existing safe claim logic, only when `COMMUNICATION_DISPATCH_MODE=rabbitmq` and `RABBITMQ_ENABLED=true`.
2. Builds a non-PII versioned envelope.
3. Publishes a persistent message to RabbitMQ with publisher confirms.
4. If RabbitMQ confirms publication, marks `client_communication_outbox.status='broker_published'`.
5. Stores `broker_message_id`, `broker_published_at`, and broker retry metadata in PostgreSQL.
6. On broker failure/interruption before confirm, increments `broker_retry_count`, releases the row back to retryable PostgreSQL state, or marks dead after bounded broker retries.
7. Never calls SMS provider directly and never increments provider attempt counters.

RabbitMQ publication attempt != SMS provider attempt. `broker_retry_count` tracks broker publication failures. `attempt_count` / `retry_count` track provider invocation and provider retry behavior only.

Crash window: if RabbitMQ confirms publication and the publisher crashes before PostgreSQL records `broker_published_at`, recovery may republish the same outbox row. This is intentional at-least-once broker delivery. The consumer remains safe through the stable FieldOS idempotency key, authoritative attempt-state lookup, row locking, final-state protection, and provider dispatch guard. Do not claim exactly-once delivery.

## Consumer behavior

Commands:

```bash
# Continuous mode: visible RabbitMQ subscription consumer.
python -m app.workers.communication_consumer --queue sms

# One-shot/bounded mode: single queue.get poll for canaries and smoke tests.
python -m app.workers.communication_consumer --queue sms --once
```

Continuous mode uses a registered RabbitMQ subscription (`queue.consume(...)`) with manual acknowledgements and a sanitized consumer tag:

```text
fieldos-sms-consumer:<worker_id>
```

This makes operations visible in RabbitMQ: the `fieldos.communication.sms` queue should report exactly one active consumer when one continuous SMS worker is running. One-shot mode intentionally remains bounded and may use `queue.get(...)`; it exits after processing at most one message or after a bounded empty poll. The worker applies `RABBITMQ_PREFETCH` as the maximum concurrent in-flight callback count per worker, with an effective minimum of `1` so RabbitMQ `prefetch=0` never creates an unlimited callback set.

Per-message behavior is shared by both modes:

1. Receive a message without automatic ACK (`no_ack=false`).
2. Validate JSON, schema version, required fields, allowed channel, and PII-free envelope constraints.
3. Load authoritative outbox, attempt, and event rows from PostgreSQL.
4. Lock the outbox row before deciding dispatch eligibility.
5. Verify idempotency key and row IDs match.
6. Refuse final-state/cancelled/non-dispatchable attempts without provider invocation.
7. Mark the outbox `processing` and commit that claim before provider work.
8. Call the existing provider abstraction using PostgreSQL-fetched recipient/message/provider data.
9. Persist provider result and communication state through the existing outbox result path.
10. Commit PostgreSQL.
11. ACK the RabbitMQ message only after the database commit returns successfully.

Database failure before result commit causes RabbitMQ `nack(requeue=True)` or bounded retry through PostgreSQL recovery. Malformed/non-retryable envelopes are rejected to DLQ. Final-state attempts are acknowledged without provider invocation. Logs/audits must not include full phone numbers, SMS bodies, provider tokens, or financial payloads.

Continuous shutdown handles SIGTERM/SIGINT by cancelling the RabbitMQ subscription, waiting a bounded period for in-flight processing to finish, ACKing only committed work, nacking/requeueing uncommitted work, then closing the channel/connection and exiting normally. Transient RabbitMQ connection loss triggers bounded-delay reconnect using `RABBITMQ_RECONNECT_SECONDS`; permanent configuration errors are surfaced instead of hidden in a tight infinite loop.

Provider edge: if a provider accepts a message and the consumer crashes before saving the provider result, RabbitMQ can redeliver and FieldOS may need to retry/reconcile. Future providers should receive the FieldOS idempotency key where supported so provider-side duplicate suppression can participate in recovery.

## Redis replay protection

Phase 7's process-local n8n nonce cache is replaced with a pluggable replay store.

```env
N8N_REPLAY_STORE=memory
REDIS_URL=
N8N_REPLAY_TTL_SECONDS=330
```

Redis mode uses atomic `SET key 1 NX EX <ttl>` and fails closed if Redis is configured but unavailable. TTL is validated as a positive bounded integer.

Replay keys use stable nonce identity only:

```text
<REDIS_KEY_PREFIX>:<APP_ENV>:n8n:replay:<integration_scope>:<nonce_digest>
```

The key intentionally excludes timestamp and signature digest. Reusing a nonce during the TTL is rejected even if timestamp, body, or valid signature changes. Raw request bodies and raw nonces are not stored.

Memory mode uses the same nonce-identity semantics for tests/local development.

## Outbox state model

| State/condition | Meaning |
|---|---|
| `pending` / `retryable` | Claimable for broker publication or Postgres dispatch, depending on dispatch mode. |
| `processing` with publisher lock | Claimed for broker publication; provider has not been called. |
| `broker_published` + `broker_message_id` | RabbitMQ publish confirmed; awaiting consumer processing. This is not provider-submitted. |
| `processing` with consumer lock | Consumer is attempting provider submission using authoritative DB state. |
| `published` | Provider submission completed through existing outbox result path. |
| `dead` | Terminal broker/provider failure after bounded retries. |
| `cancelled` / `skipped` | Terminal non-dispatch states. |

The following remain distinct: published to RabbitMQ, submitted to SMS provider, accepted by SMS provider, and delivered to handset.

## Homelab startup plan

No deployment has been performed by this phase. After explicit approval only:

```bash
cd /root/FieldOSpvt
cp infra/client-protection/.env.example infra/client-protection/.env
# edit passwords + DATABASE_URL; do not commit .env

docker compose -f infra/client-protection/compose.yml config
docker compose -f infra/client-protection/compose.yml up -d rabbitmq redis
infra/client-protection/scripts/health-check.sh
```

Then, after a separate approval to run workers:

```bash
docker compose -f infra/client-protection/compose.yml --profile workers up -d outbox-publisher sms-consumer
```

## Rollback

```bash
docker compose -f infra/client-protection/compose.yml --profile workers stop outbox-publisher sms-consumer
docker compose -f infra/client-protection/compose.yml stop rabbitmq redis
# Restore backend env to:
COMMUNICATION_DISPATCH_MODE=postgres
RABBITMQ_ENABLED=false
REDIS_ENABLED=false
N8N_REPLAY_STORE=memory
```

Do not remove volumes unless a separate cleanup is approved.

## Future per-MFI isolation

Future MFI model:

- separate RabbitMQ virtual host per institution
- separate credentials per institution
- separate queue namespace per institution
- no shared customer credentials
- app/database remains the source of truth per deployment/institution
