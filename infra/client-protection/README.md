# FieldOS Client Protection Infrastructure

Docker Compose assets for Phase 8 RabbitMQ + dedicated Redis messaging infrastructure.

## Services

- `rabbitmq` — dedicated RabbitMQ broker with management UI bound to `127.0.0.1` only.
- `redis` — dedicated Redis instance for short-lived coordination/replay/rate-limit state only.
- `outbox-publisher` — optional worker profile; publishes PostgreSQL outbox rows to RabbitMQ.
- `sms-consumer` — optional worker profile; consumes SMS messages and calls existing provider abstraction.

No Jasmin, FreeSWITCH, IVR provider, or real SMS deployment is included in this phase.

## Ports

| Service | Container | Host |
|---|---:|---:|
| RabbitMQ AMQP | 5672 | not published |
| RabbitMQ management | 15672 | `127.0.0.1:15672` |
| Redis | 6379 | not published |

## Networks

- `fieldos_client_protection` — internal RabbitMQ/Redis/worker network.
- `fieldospvt_default` — existing FieldOS application network, external, for backend/Postgres reachability.

## Volume paths

Default persistent data path:

```text
/mnt/hdd-internal/fieldos-client-protection/rabbitmq
/mnt/hdd-internal/fieldos-client-protection/redis
```

## Required setup

```bash
cd /root/FieldOSpvt
cp infra/client-protection/.env.example infra/client-protection/.env
# edit FIELDOS_RABBITMQ_PASSWORD, FIELDOS_REDIS_PASSWORD, DATABASE_URL
```

Validate only:

```bash
FIELDOS_RABBITMQ_PASSWORD=placeholder \
FIELDOS_REDIS_PASSWORD=placeholder \
DATABASE_URL=postgresql+asyncpg://fieldos:placeholder@postgres:5432/fieldos_nepal \
docker compose -f infra/client-protection/compose.yml config
```

Start only after approval:

```bash
docker compose -f infra/client-protection/compose.yml up -d rabbitmq redis
```

Start workers only after separate approval:

```bash
docker compose -f infra/client-protection/compose.yml --profile workers up -d outbox-publisher sms-consumer
```

## Worker operating modes

`outbox-publisher` can run continuously or with `--once` for bounded canaries. It publishes non-PII PostgreSQL outbox envelopes to RabbitMQ and records broker metadata only after publisher confirm.

`sms-consumer` supports two modes:

```bash
# Continuous mode: registered RabbitMQ subscription consumer visible in queue metrics.
python -m app.workers.communication_consumer --queue sms

# One-shot/bounded mode: queue.get(...) poll, processes at most one message.
python -m app.workers.communication_consumer --queue sms --once
```

Continuous mode registers a manual-ACK RabbitMQ consumer with tag:

```text
fieldos-sms-consumer:<worker_id>
```

Operational expectation: one running `sms-consumer` container should make `rabbitmqctl list_queues name messages consumers` report `fieldos.communication.sms ... consumers=1`. Reminder, IVR, escalation, and all DLQ queues should remain at `consumers=0` unless separately approved.

ACK ordering is database-first: the consumer validates the non-PII envelope, loads and locks PostgreSQL authoritative event/attempt/outbox rows, invokes the configured provider only when eligible, persists and commits the provider result, then ACKs RabbitMQ. Malformed envelopes are rejected to DLQ. Database or provider processing failures NACK/requeue according to the existing bounded retry paths. Callback concurrency is bounded by `RABBITMQ_PREFETCH` per worker, using an effective minimum of `1` to avoid RabbitMQ's unlimited `prefetch=0` behavior; duplicate deliveries are still guarded by authoritative row locks and final-state checks. Graceful SIGTERM/SIGINT cancels the subscription, lets in-flight committed work finish within a bounded timeout, requeues uncommitted work, closes RabbitMQ cleanly, and exits normally. Transient RabbitMQ connection loss reconnects after `RABBITMQ_RECONNECT_SECONDS`; permanent configuration errors are surfaced.

## Environment variables

Safe defaults:

```env
COMMUNICATION_DISPATCH_MODE=postgres
RABBITMQ_ENABLED=false
RABBITMQ_URL=
RABBITMQ_VHOST=/fieldos
RABBITMQ_EXCHANGE=fieldos.communication
RABBITMQ_PREFETCH=20
RABBITMQ_PUBLISH_CONFIRM_TIMEOUT_SECONDS=10
RABBITMQ_RECONNECT_SECONDS=5
RABBITMQ_MAX_RETRIES=5
REDIS_ENABLED=false
REDIS_URL=
REDIS_KEY_PREFIX=fieldos
REDIS_MAXMEMORY=256mb
N8N_REPLAY_STORE=memory
N8N_REPLAY_TTL_SECONDS=330
```

## Redis replay identity

Replay protection uses stable nonce identity:

```text
<REDIS_KEY_PREFIX>:<APP_ENV>:n8n:replay:<integration_scope>:<nonce_digest>
```

The key excludes timestamp and signature digest, stores no raw nonce, and uses atomic `SET key 1 NX EX <ttl>`. Reusing a nonce inside the TTL is rejected even with a different timestamp, body, or valid signature.

Redis password note: static `redis.conf` does not rely on environment substitution. Compose passes `--requirepass ${FIELDOS_REDIS_PASSWORD}` on the Redis command line and the healthcheck uses the same uncommitted environment value.

## Redis permitted uses

Allowed:

1. n8n HMAC nonce replay protection.
2. Short-lived worker coordination.
3. Provider outage counters.
4. Temporary distributed rate limiting.
5. Provider health cache.

Forbidden:

- official communication status
- financial records
- audit history
- full message bodies
- full phone numbers
- provider credentials

## Smoke-test policy

`infra/client-protection/scripts/smoke-test.sh` prints the local smoke-test sequence but does not start containers. Container startup requires explicit approval.

## Rollback

```bash
docker compose -f infra/client-protection/compose.yml --profile workers stop outbox-publisher sms-consumer
docker compose -f infra/client-protection/compose.yml stop rabbitmq redis
```

Restore backend env:

```env
COMMUNICATION_DISPATCH_MODE=postgres
RABBITMQ_ENABLED=false
REDIS_ENABLED=false
N8N_REPLAY_STORE=memory
```

Do not delete persistent volumes unless separately approved.


## Review hardening notes

- RabbitMQ publication attempt != SMS provider attempt. Broker publication may update only outbox broker metadata (`broker_message_id`, `broker_published_at`, publisher locks, broker retry metadata). Provider attempt counters/status/timestamps change only in the consumer immediately before/after invoking the provider abstraction.
- Redis replay protection uses stable nonce identity keys: `<REDIS_KEY_PREFIX>:<APP_ENV>:n8n:replay:<integration_scope>:<nonce_digest>`. Timestamp, request body, and signature digest are not part of the key. `N8N_REPLAY_TTL_SECONDS` must be at least `N8N_TIMESTAMP_TOLERANCE_SECONDS + 30`.
- Network topology: RabbitMQ, Redis, publisher, and consumer share the private `fieldos-client-protection` network. Redis and workers also join the explicit FieldOS app network (`FIELDOS_APP_NETWORK`, default `fieldospvt_default`) so backend/workers can reach Redis/PostgreSQL without joining n8n or public proxy networks. Redis has no host port; RabbitMQ AMQP has no host port; management is loopback-only.
- RabbitMQ imports topology automatically through `/etc/rabbitmq/rabbitmq.conf` with `management.load_definitions = /etc/rabbitmq/definitions.json`. Definitions carry topology only; secret-bearing user configuration comes from runtime environment and can be tightened by `configure-rabbitmq.sh`.
