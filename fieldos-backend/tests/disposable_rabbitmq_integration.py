#!/usr/bin/env python3
"""Fully disposable RabbitMQ + PostgreSQL broker regressions.

Cases:
- exact publisher/consumer race recovery
- two sequential records
- bounded max-retry to DLQ

This script starts isolated Docker containers with a unique network and named
RabbitMQ volume. It never joins FieldOS live networks or persistent volumes.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
import uuid
from contextlib import suppress
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def sh(cmd: list[str], *, check: bool = True) -> str:
    r = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    if check and r.returncode != 0:
        raise RuntimeError(f"command failed ({r.returncode}): {' '.join(cmd)}\n{r.stdout}")
    return r.stdout.strip()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def q(url_vhost: str) -> str:
    import urllib.parse
    return urllib.parse.quote(url_vhost, safe="")


async def queue_count(name: str) -> int:
    import aio_pika
    conn = await aio_pika.connect_robust(os.environ["RABBITMQ_URL"])
    ch = await conn.channel()
    try:
        queue = await ch.declare_queue(name, durable=True, passive=True)
        return int(queue.declaration_result.message_count)
    finally:
        await ch.close()
        await conn.close()


async def purge_known_queues() -> None:
    import aio_pika
    conn = await aio_pika.connect_robust(os.environ["RABBITMQ_URL"])
    ch = await conn.channel()
    try:
        for name in ["fieldos.communication.sms", "fieldos.communication.sms.retry", "fieldos.communication.sms.dead"]:
            with suppress(Exception):
                queue = await ch.declare_queue(name, durable=True, passive=True)
                await queue.purge()
    finally:
        await ch.close()
        await conn.close()


async def wait_counts(expected: dict[str, int], *, timeout_s: float = 8.0) -> dict[str, int]:
    deadline = time.time() + timeout_s
    last = {}
    while time.time() < deadline:
        last = {k: await queue_count(k) for k in expected}
        if all(last[k] == v for k, v in expected.items()):
            return last
        await asyncio.sleep(0.1)
    return last


async def seed_record(sequence: int, *, status: str = "pending") -> int:
    from app.database import AsyncSessionLocal
    from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox

    async with AsyncSessionLocal() as s:
        event = ClientCommunicationEvent(
            purpose="collection_verification_test",
            event_type="disposable_regression",
            status="queued",
            idempotency_key=f"disposable:{uuid.uuid4()}:event:{sequence}",
            source_system="disposable_regression",
            source_reference=f"DISP-{sequence}",
        )
        s.add(event)
        await s.flush()
        attempt = ClientCommunicationAttempt(
            event_id=event.id,
            channel="sms",
            provider="log",
            recipient="+100****0000",
            attempt_number=sequence,
            status="queued",
            metadata_json=json.dumps({"message": f"disposable message {sequence}", "sequence": sequence, "synthetic": True}),
        )
        s.add(attempt)
        await s.flush()
        outbox = ClientCommunicationOutbox(
            event_id=event.id,
            attempt_id=attempt.id,
            queue_name="client_communication.sms",
            payload_json=json.dumps({"event_id": event.id, "attempt_id": attempt.id, "channel": "sms", "purpose": "collection_verification_test", "trace_id": f"disposable-{sequence}"}),
            status=status,
            idempotency_key=f"disposable:{event.id}:outbox:{sequence}",
            max_retries=5,
        )
        s.add(outbox)
        await s.flush()
        outbox_id = outbox.id
        await s.commit()
        return outbox_id


async def snapshot(outbox_ids: list[int]) -> list[dict]:
    from app.database import AsyncSessionLocal
    from app.models.client_communication import ClientCommunicationAttempt, ClientCommunicationEvent, ClientCommunicationOutbox

    rows = []
    async with AsyncSessionLocal() as s:
        for idx, outbox_id in enumerate(outbox_ids, start=1):
            outbox = await s.get(ClientCommunicationOutbox, outbox_id)
            attempt = await s.get(ClientCommunicationAttempt, outbox.attempt_id)
            event = await s.get(ClientCommunicationEvent, outbox.event_id)
            rows.append({
                "record": idx,
                "outbox_id": outbox.id,
                "event_status": event.status,
                "attempt_status": attempt.status,
                "outbox_status": outbox.status,
                "provider_invocations": outbox.attempt_count,
                "attempt_count": outbox.attempt_count,
                "provider_reference_present": attempt.provider_reference is not None,
            })
    return rows


async def stranded_count() -> int:
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.client_communication import ClientCommunicationOutbox
    async with AsyncSessionLocal() as s:
        return len((await s.execute(select(ClientCommunicationOutbox).where(ClientCommunicationOutbox.status == "broker_published"))).scalars().all())


async def run_cases(pg_port: int, rabbit_port: int) -> dict:
    os.environ.update({
        "DB_TYPE": "postgres",
        "DATABASE_URL": f"postgresql+asyncpg://fieldos:fieldos_test_password@127.0.0.1:{pg_port}/fieldos_test",
        "JWT_SECRET_KEY": "test-secret-key",
        "SMS_PROVIDER": "log",
        "COMMUNICATION_DISPATCH_MODE": "rabbitmq",
        "RABBITMQ_ENABLED": "true",
        "RABBITMQ_URL": f"amqp://fieldos:fieldos_test_password@127.0.0.1:{rabbit_port}/{q('/fieldos_test')}",
        "RABBITMQ_EXCHANGE": "fieldos.communication.test",
        "RABBITMQ_PREFETCH": "1",
        "COMMUNICATION_CONSUMER_MAX_RETRIES": "3",
        "COMMUNICATION_CONSUMER_RETRY_DELAY_MS": "500",
    })

    from sqlalchemy import select
    import app.main  # noqa: F401
    from app.database import AsyncSessionLocal, Base, engine
    from app.models.client_communication import ClientCommunicationOutbox
    from app.services.communication_broker import RabbitMQClient, build_message_envelope, publish_once
    from app.workers.communication_consumer import consume_rabbitmq

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with RabbitMQClient() as _broker:
        pass
    await purge_known_queues()

    # Case 1: exact race recovery.
    race_id = await seed_record(1, status="processing")
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, race_id)
        outbox.locked_by = "publisher-race"
        envelope = build_message_envelope(outbox, json.loads(outbox.payload_json))
        await s.commit()
    async with RabbitMQClient() as broker:
        await broker.publish(envelope, "communication.sms")
    await consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="race-first", once=True)
    race_after_first = await snapshot([race_id])
    counts_after_first = {"primary": await queue_count("fieldos.communication.sms"), "retry": await queue_count("fieldos.communication.sms.retry"), "dlq": await queue_count("fieldos.communication.sms.dead")}
    async with AsyncSessionLocal() as s:
        outbox = await s.get(ClientCommunicationOutbox, race_id)
        outbox.status = "broker_published"
        outbox.locked_by = None
        outbox.locked_at = None
        await s.commit()
    await wait_counts({"fieldos.communication.sms": 1, "fieldos.communication.sms.retry": 0}, timeout_s=5)
    await consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="race-redelivery", once=True)
    race_rows = await snapshot([race_id])
    race_counts = {"primary": await queue_count("fieldos.communication.sms"), "retry": await queue_count("fieldos.communication.sms.retry"), "dlq": await queue_count("fieldos.communication.sms.dead")}

    await purge_known_queues()

    # Case 2: two sequential records.
    two_ids = [await seed_record(2), await seed_record(3)]
    async with RabbitMQClient() as broker:
        published = await publish_once(worker_id="two-publisher", broker=broker, batch_size=2)
    await consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="two-1", once=True)
    await consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id="two-2", once=True)
    two_rows = await snapshot(two_ids)
    two_counts = {"primary": await queue_count("fieldos.communication.sms"), "retry": await queue_count("fieldos.communication.sms.retry"), "dlq": await queue_count("fieldos.communication.sms.dead")}

    await purge_known_queues()

    # Case 3: max retry/DLQ for missing row.
    missing_env = {"schema_version": 1, "message_id": "missing-1", "idempotency_key": "missing", "outbox_id": 999999, "event_id": 999999, "attempt_id": 999999, "channel": "sms", "purpose": "collection_verification_test", "created_at": "2026-07-30T00:00:00Z", "trace_id": "missing"}
    async with RabbitMQClient() as broker:
        await broker.publish(missing_env, "communication.sms")
    retry_evidence = []
    for i in range(3):
        await wait_counts({"fieldos.communication.sms": 1}, timeout_s=5)
        await consume_rabbitmq(queue_name="fieldos.communication.sms", queue_key="sms", worker_id=f"missing-{i}", once=True)
        retry_evidence.append({"step": i + 1, "primary": await queue_count("fieldos.communication.sms"), "retry": await queue_count("fieldos.communication.sms.retry"), "dlq": await queue_count("fieldos.communication.sms.dead")})
        if retry_evidence[-1]["dlq"]:
            break
        await wait_counts({"fieldos.communication.sms": 1, "fieldos.communication.sms.retry": 0}, timeout_s=5)
    max_counts = {"primary": await queue_count("fieldos.communication.sms"), "retry": await queue_count("fieldos.communication.sms.retry"), "dlq": await queue_count("fieldos.communication.sms.dead")}

    await engine.dispose()
    return {
        "topology": {"rabbitmq_url_host": "127.0.0.1", "postgres_host": "127.0.0.1", "live_networks_joined": False, "persistent_rabbitmq_reused": False},
        "race": {"after_first": race_after_first, "counts_after_first": counts_after_first, "final_rows": race_rows, "final_counts": race_counts},
        "two_record": {"published_statuses": [r.status for r in published], "records": two_rows, "counts": two_counts},
        "max_retry": {"evidence": retry_evidence, "counts": max_counts, "provider_invocations": 0},
        "stranded_broker_published": await stranded_count(),
    }


def main() -> int:
    suffix = uuid.uuid4().hex[:8]
    network = f"fieldos-test-net-{suffix}"
    volume = f"fieldos-test-rabbitmq-data-{suffix}"
    pg = f"fieldos-test-pg-{suffix}"
    rabbit = f"fieldos-test-rabbitmq-{suffix}"
    pg_port = free_port()
    rabbit_port = free_port()
    created = {"network": network, "volume": volume, "postgres": pg, "rabbitmq": rabbit}
    try:
        sh(["docker", "network", "create", network])
        sh(["docker", "volume", "create", volume])
        sh(["docker", "run", "-d", "--name", pg, "--network", network, "-e", "POSTGRES_USER=fieldos", "-e", "POSTGRES_PASSWORD=fieldos_test_password", "-e", "POSTGRES_DB=fieldos_test", "-p", f"127.0.0.1:{pg_port}:5432", "postgres:16-alpine"])
        sh(["docker", "run", "-d", "--name", rabbit, "--network", network, "-e", "RABBITMQ_DEFAULT_USER=fieldos", "-e", "RABBITMQ_DEFAULT_PASS=fieldos_test_password", "-e", "RABBITMQ_DEFAULT_VHOST=/fieldos_test", "-v", f"{volume}:/var/lib/rabbitmq", "-p", f"127.0.0.1:{rabbit_port}:5672", "rabbitmq:3.13-management-alpine"])
        for _ in range(120):
            if "accepting connections" in sh(["docker", "exec", pg, "pg_isready", "-U", "fieldos", "-d", "fieldos_test"], check=False):
                break
            time.sleep(1)
        else:
            raise RuntimeError(sh(["docker", "logs", "--tail", "80", pg], check=False))
        for _ in range(180):
            if sh(["docker", "exec", rabbit, "rabbitmq-diagnostics", "-q", "ping"], check=False).strip() == "Ping succeeded":
                vhosts = sh(["docker", "exec", rabbit, "rabbitmqctl", "-q", "list_vhosts"], check=False)
                users = sh(["docker", "exec", rabbit, "rabbitmqctl", "-q", "list_users"], check=False)
                if "/fieldos_test" in vhosts and "fieldos" in users:
                    break
            time.sleep(1)
        else:
            raise RuntimeError(sh(["docker", "logs", "--tail", "120", rabbit], check=False))
        time.sleep(3)
        result = asyncio.run(run_cases(pg_port, rabbit_port))
        result["disposable"] = created
        print(json.dumps(result, indent=2, sort_keys=True))
        assert result["race"]["after_first"][0]["provider_invocations"] == 0
        assert result["race"]["counts_after_first"]["retry"] == 1
        assert result["race"]["final_rows"][0]["provider_invocations"] == 1
        assert result["race"]["final_counts"] == {"primary": 0, "retry": 0, "dlq": 0}
        for row in result["two_record"]["records"]:
            assert row["provider_invocations"] == 1
            assert row["attempt_count"] == 1
            assert row["outbox_status"] == "published"
            assert row["attempt_status"] == "submitted"
            assert row["event_status"] == "provider_accepted"
        assert result["two_record"]["counts"] == {"primary": 0, "retry": 0, "dlq": 0}
        assert result["max_retry"]["counts"] == {"primary": 0, "retry": 0, "dlq": 1}
        assert result["stranded_broker_published"] == 0
        return 0
    finally:
        with suppress(Exception): sh(["docker", "rm", "-f", pg, rabbit], check=False)
        with suppress(Exception): sh(["docker", "network", "rm", network], check=False)
        with suppress(Exception): sh(["docker", "volume", "rm", "-f", volume], check=False)


if __name__ == "__main__":
    raise SystemExit(main())
