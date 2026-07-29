from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.config import settings

_MEMORY_REPLAY_CACHE: dict[str, datetime] = {}
MAX_REPLAY_TTL_SECONDS = 24 * 60 * 60


class ReplayStoreError(RuntimeError):
    pass


@dataclass(frozen=True)
class ReplayResult:
    accepted: bool
    key: str
    store: str


def nonce_digest(nonce: str) -> str:
    return hashlib.sha256(str(nonce).encode("utf-8")).hexdigest()


def replay_ttl_seconds() -> int:
    try:
        ttl = int(settings.N8N_REPLAY_TTL_SECONDS)
    except (TypeError, ValueError) as exc:
        raise ReplayStoreError("N8N_REPLAY_TTL_SECONDS must be an integer") from exc
    if ttl <= 0:
        raise ReplayStoreError("N8N_REPLAY_TTL_SECONDS must be positive")
    if ttl > MAX_REPLAY_TTL_SECONDS:
        raise ReplayStoreError(f"N8N_REPLAY_TTL_SECONDS must be <= {MAX_REPLAY_TTL_SECONDS}")
    return ttl


def replay_key(*, nonce: str, integration_scope: str = "n8n") -> str:
    """Stable nonce-identity key.

    Timestamp, request body, and signature digest are intentionally excluded so
    a reused nonce is rejected during the TTL even when a caller generates a new
    timestamp/body/signature tuple.
    """
    digest = nonce_digest(nonce)
    scope = "".join(ch if ch.isalnum() or ch in {"_", "-", "."} else "_" for ch in integration_scope)[:80] or "n8n"
    return f"{settings.REDIS_KEY_PREFIX}:{settings.APP_ENV}:n8n:replay:{scope}:{digest}"


class MemoryReplayStore:
    name = "memory"

    async def mark_seen(self, key: str, ttl_seconds: int) -> ReplayResult:
        now = datetime.utcnow()
        cutoff = now - timedelta(seconds=ttl_seconds)
        for cached_key, seen_at in list(_MEMORY_REPLAY_CACHE.items()):
            if seen_at < cutoff:
                _MEMORY_REPLAY_CACHE.pop(cached_key, None)
        if key in _MEMORY_REPLAY_CACHE:
            return ReplayResult(False, key, self.name)
        _MEMORY_REPLAY_CACHE[key] = now
        return ReplayResult(True, key, self.name)


class RedisReplayStore:
    name = "redis"

    def __init__(self, redis_url: str | None = None):
        self.redis_url = redis_url or settings.REDIS_URL

    async def mark_seen(self, key: str, ttl_seconds: int) -> ReplayResult:
        if not self.redis_url:
            raise ReplayStoreError("redis replay store configured without REDIS_URL")
        try:
            from redis.asyncio import Redis
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise ReplayStoreError("redis package is not installed") from exc
        client = Redis.from_url(self.redis_url, decode_responses=True)
        try:
            accepted = await client.set(key, "1", nx=True, ex=ttl_seconds)
            return ReplayResult(bool(accepted), key, self.name)
        except Exception as exc:  # fail closed when redis mode is configured
            raise ReplayStoreError("redis replay store unavailable") from exc
        finally:
            await client.aclose()


def replay_store():
    if settings.N8N_REPLAY_STORE == "redis":
        return RedisReplayStore()
    if settings.N8N_REPLAY_STORE != "memory":
        raise ReplayStoreError("unsupported N8N_REPLAY_STORE")
    return MemoryReplayStore()


async def mark_n8n_nonce_seen(*, nonce: str, integration_scope: str = "n8n", timestamp: int | None = None, signature_digest: str | None = None) -> ReplayResult:
    # timestamp/signature_digest are accepted for backward call-site compatibility
    # but intentionally excluded from the replay identity.
    key = replay_key(nonce=nonce, integration_scope=integration_scope)
    return await replay_store().mark_seen(key, replay_ttl_seconds())
