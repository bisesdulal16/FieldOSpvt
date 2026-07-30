import asyncio
import json
import sys
import types

import pytest

from app.config import settings
from app.workers import communication_consumer as consumer


class FakeMessage:
    def __init__(self, body):
        self.body = body
        self.acked = 0
        self.rejected = []
        self.nacked = []

    async def ack(self):
        self.acked += 1

    async def reject(self, *, requeue=False):
        self.rejected.append(requeue)

    async def nack(self, *, requeue=True):
        self.nacked.append(requeue)


class FakeQueue:
    def __init__(self, *, message=None):
        self.message = message
        self.consume_calls = []
        self.cancelled = []
        self.get_calls = 0
        self.consumer_count = 0

    async def get(self, **_kwargs):
        self.get_calls += 1
        return self.message

    async def consume(self, callback, *, no_ack=False, consumer_tag=None):
        self.consume_calls.append({"callback": callback, "no_ack": no_ack, "consumer_tag": consumer_tag})
        self.consumer_count += 1
        return consumer_tag or "fake-tag"

    async def cancel(self, tag):
        self.cancelled.append(tag)
        self.consumer_count = max(0, self.consumer_count - 1)


class FakeChannel:
    def __init__(self, queue):
        self.queue = queue
        self.qos = None

    async def set_qos(self, *, prefetch_count):
        self.qos = prefetch_count

    async def get_queue(self, queue_name, ensure=True):
        self.queue_name = queue_name
        self.ensure = ensure
        return self.queue


class FakeConnection:
    def __init__(self, channel):
        self._channel = channel
        self.closed = False

    async def channel(self):
        return self._channel

    async def close(self):
        self.closed = True


def install_fake_aio_pika(monkeypatch, queue):
    channel = FakeChannel(queue)
    connection = FakeConnection(channel)

    async def connect_robust(url):
        assert url == settings.RABBITMQ_URL
        return connection

    module = types.SimpleNamespace(connect_robust=connect_robust)
    monkeypatch.setitem(sys.modules, "aio_pika", module)
    return connection, channel, queue


@pytest.mark.asyncio
async def test_continuous_mode_registers_visible_manual_consumer(monkeypatch):
    queue = FakeQueue()
    connection, channel, _ = install_fake_aio_pika(monkeypatch, queue)
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    monkeypatch.setattr(settings, "RABBITMQ_URL", "amqp://fieldos:secret@rabbitmq:5672/%2Ffieldos")
    monkeypatch.setattr(settings, "RABBITMQ_PREFETCH", 7)
    consumer._stop.clear()

    task = asyncio.create_task(consumer.consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="worker:one", once=False))
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert queue.consumer_count == 1
    assert queue.consume_calls[0]["no_ack"] is False
    assert queue.consume_calls[0]["consumer_tag"] == "fieldos-sms-consumer:worker:one"
    assert channel.qos == 7

    consumer._stop.set()
    await asyncio.wait_for(task, timeout=1)
    assert queue.consumer_count == 0
    assert queue.cancelled == ["fieldos-sms-consumer:worker:one"]
    assert connection.closed is True
    consumer._stop.clear()


@pytest.mark.asyncio
async def test_one_shot_mode_uses_bounded_get_not_subscription(monkeypatch):
    message = FakeMessage(json.dumps({"schema_version": 1}).encode())
    queue = FakeQueue(message=message)
    install_fake_aio_pika(monkeypatch, queue)
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    monkeypatch.setattr(settings, "RABBITMQ_URL", "amqp://fieldos:secret@rabbitmq:5672/%2Ffieldos")

    await consumer.consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="one-shot", once=True)

    assert queue.get_calls == 1
    assert queue.consume_calls == []
    assert message.rejected == [False]


@pytest.mark.asyncio
async def test_manual_ack_happens_after_process_envelope_commit(monkeypatch):
    order = []
    envelope = {"schema_version": 1, "message_id": "m1", "idempotency_key": "k1", "outbox_id": 1, "event_id": 1, "attempt_id": 1, "channel": "sms", "purpose": "collection_verification", "created_at": "2026-07-30T00:00:00Z", "trace_id": "t1"}
    message = FakeMessage(json.dumps(envelope).encode())

    async def fake_process(envelope, *, worker_id):
        order.append("db_commit_complete")
        return types.SimpleNamespace(status="published", outbox_id=envelope["outbox_id"])

    async def ack():
        order.append("ack")
        message.acked += 1

    message.ack = ack
    monkeypatch.setattr(consumer, "process_envelope", fake_process)

    await consumer._handle_message(message, worker_id="ack-order")

    assert order == ["db_commit_complete", "ack"]
    assert message.acked == 1
    assert message.rejected == []


@pytest.mark.asyncio
async def test_database_failure_does_not_ack_and_requeues(monkeypatch):
    envelope = {"schema_version": 1, "message_id": "m1", "idempotency_key": "k1", "outbox_id": 1, "event_id": 1, "attempt_id": 1, "channel": "sms", "purpose": "collection_verification", "created_at": "2026-07-30T00:00:00Z", "trace_id": "t1"}
    message = FakeMessage(json.dumps(envelope).encode())

    async def fail_process(_envelope, *, worker_id):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(consumer, "process_envelope", fail_process)

    await consumer._handle_message(message, worker_id="db-fail")

    assert message.acked == 0
    assert message.nacked == [True]
    assert message.rejected == []


@pytest.mark.asyncio
async def test_malformed_message_rejected_to_dlq_without_provider(monkeypatch):
    message = FakeMessage(b'{"schema_version":1}')
    calls = {"process": 0}

    async def fake_process(_envelope, *, worker_id):
        calls["process"] += 1

    monkeypatch.setattr(consumer, "process_envelope", fake_process)

    await consumer._handle_message(message, worker_id="malformed")

    assert calls["process"] == 0
    assert message.acked == 0
    assert message.rejected == [False]


@pytest.mark.asyncio
async def test_final_state_duplicate_ack_without_provider(monkeypatch):
    envelope = {"schema_version": 1, "message_id": "m1", "idempotency_key": "k1", "outbox_id": 1, "event_id": 1, "attempt_id": 1, "channel": "sms", "purpose": "collection_verification", "created_at": "2026-07-30T00:00:00Z", "trace_id": "t1"}
    message = FakeMessage(json.dumps(envelope).encode())

    async def duplicate(_envelope, *, worker_id):
        return types.SimpleNamespace(status="already_submitted", outbox_id=1, provider_called=False)

    monkeypatch.setattr(consumer, "process_envelope", duplicate)

    await consumer._handle_message(message, worker_id="dupe")

    assert message.acked == 1
    assert message.nacked == []
    assert message.rejected == []


@pytest.mark.asyncio
async def test_graceful_sigterm_path_cancels_subscription(monkeypatch):
    queue = FakeQueue()
    install_fake_aio_pika(monkeypatch, queue)
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    monkeypatch.setattr(settings, "RABBITMQ_URL", "amqp://fieldos:secret@rabbitmq:5672/%2Ffieldos")
    consumer._stop.clear()

    task = asyncio.create_task(consumer.consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="shutdown", once=False))
    await asyncio.sleep(0)
    assert queue.consumer_count == 1
    consumer._request_stop()
    await asyncio.wait_for(task, timeout=1)
    assert queue.consumer_count == 0
    consumer._stop.clear()


@pytest.mark.asyncio
async def test_reconnect_replaces_consumer_without_duplicate_active_consumers(monkeypatch):
    queues = [FakeQueue(), FakeQueue()]
    connections = []
    attempts = {"count": 0}

    async def fake_subscription(*, queue_name, queue_key, worker_id):
        idx = attempts["count"]
        attempts["count"] += 1
        q = queues[min(idx, 1)]
        q.consumer_count = 1
        if idx == 0:
            q.consumer_count = 0
            raise ConnectionError("lost broker")
        consumer._stop.set()
        q.consumer_count = 0

    monkeypatch.setattr(consumer, "_consume_continuous_subscription", fake_subscription)
    monkeypatch.setattr(settings, "RABBITMQ_ENABLED", True)
    monkeypatch.setattr(settings, "RABBITMQ_RECONNECT_SECONDS", 0)
    consumer._stop.clear()

    await consumer.consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="reconnect", once=False)

    assert attempts["count"] == 2
    assert queues[0].consumer_count == 0
    assert queues[1].consumer_count == 0
    consumer._stop.clear()


@pytest.mark.asyncio
async def test_provider_invocation_occurs_exactly_once_per_delivery(monkeypatch):
    envelope = {"schema_version": 1, "message_id": "m1", "idempotency_key": "k1", "outbox_id": 1, "event_id": 1, "attempt_id": 1, "channel": "sms", "purpose": "collection_verification", "created_at": "2026-07-30T00:00:00Z", "trace_id": "t1"}
    message = FakeMessage(json.dumps(envelope).encode())
    calls = {"count": 0}

    async def fake_process(_envelope, *, worker_id):
        calls["count"] += 1
        return types.SimpleNamespace(status="published", outbox_id=1)

    monkeypatch.setattr(consumer, "process_envelope", fake_process)

    await consumer._handle_message(message, worker_id="provider-once")

    assert calls["count"] == 1
    assert message.acked == 1
    assert message.nacked == []
    assert message.rejected == []


@pytest.mark.asyncio
async def test_worker_logs_do_not_include_phone_body_or_credentials(monkeypatch, caplog):
    envelope = {"schema_version": 1, "message_id": "m1", "idempotency_key": "k1", "outbox_id": 1, "event_id": 1, "attempt_id": 1, "channel": "sms", "purpose": "collection_verification", "created_at": "2026-07-30T00:00:00Z", "trace_id": "t1"}
    message = FakeMessage(json.dumps(envelope).encode())
    secrets = [
        "+9779841234567",
        "Sensitive SMS body",
        "provider-token-123",
        "rabbitmq-password-123",
        "postgresql+asyncpg://fieldos:dbpass@postgres/fieldos",
    ]

    async def leaky_failure(_envelope, *, worker_id):
        raise RuntimeError(" ".join(secrets))

    monkeypatch.setattr(consumer, "process_envelope", leaky_failure)

    with caplog.at_level("WARNING"):
        await consumer._handle_message(message, worker_id="log-safe")

    log_text = caplog.text
    for value in secrets:
        assert value not in log_text
    assert any(getattr(record, "error_type", None) == "RuntimeError" for record in caplog.records)
    assert message.acked == 0
    assert message.nacked == [True]


def test_effective_prefetch_never_allows_unbounded_zero(monkeypatch):
    monkeypatch.setattr(settings, "RABBITMQ_PREFETCH", 0)
    assert consumer._effective_prefetch() == 1
    monkeypatch.setattr(settings, "RABBITMQ_PREFETCH", 7)
    assert consumer._effective_prefetch() == 7


def test_consumer_tag_sanitizes_identity_without_secrets():
    tag = consumer.consumer_tag_for("host/pid secret$token", "sms")
    assert tag.startswith("fieldos-sms-consumer:")
    assert "/" not in tag
    assert "$" not in tag
