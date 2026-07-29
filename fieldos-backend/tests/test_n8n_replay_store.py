from datetime import datetime, timedelta

import pytest

from app.config import settings
from app.services import replay_store as replay_module
from app.services.replay_store import ReplayResult, ReplayStoreError, mark_n8n_nonce_seen, nonce_digest, replay_key


@pytest.fixture(autouse=True)
def clear_memory_replay_cache():
    replay_module._MEMORY_REPLAY_CACHE.clear()
    yield
    replay_module._MEMORY_REPLAY_CACHE.clear()


@pytest.mark.asyncio
async def test_memory_same_nonce_same_request_rejected(monkeypatch):
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "memory")
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 330)
    first = await mark_n8n_nonce_seen(nonce="nonce-a", integration_scope="n8n", timestamp=123, signature_digest="sig-a")
    second = await mark_n8n_nonce_seen(nonce="nonce-a", integration_scope="n8n", timestamp=123, signature_digest="sig-a")
    assert first.accepted is True
    assert second.accepted is False


@pytest.mark.asyncio
async def test_memory_same_nonce_different_timestamp_or_body_signature_rejected(monkeypatch):
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "memory")
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 330)
    first = await mark_n8n_nonce_seen(nonce="nonce-b", integration_scope="n8n", timestamp=100, signature_digest="sig-body-a")
    different_timestamp = await mark_n8n_nonce_seen(nonce="nonce-b", integration_scope="n8n", timestamp=200, signature_digest="sig-body-a")
    different_body_new_signature = await mark_n8n_nonce_seen(nonce="nonce-b", integration_scope="n8n", timestamp=300, signature_digest="sig-body-b")
    assert first.accepted is True
    assert different_timestamp.accepted is False
    assert different_body_new_signature.accepted is False


@pytest.mark.asyncio
async def test_memory_different_nonce_accepted_and_nonce_only_after_ttl(monkeypatch):
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "memory")
    monkeypatch.setattr(settings, "N8N_TIMESTAMP_TOLERANCE_SECONDS", 1)
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 31)
    first = await mark_n8n_nonce_seen(nonce="nonce-c", integration_scope="n8n")
    different = await mark_n8n_nonce_seen(nonce="nonce-d", integration_scope="n8n")
    assert first.accepted is True
    assert different.accepted is True
    replay_module._MEMORY_REPLAY_CACHE[first.key] = datetime.utcnow() - timedelta(seconds=32)
    after_ttl = await mark_n8n_nonce_seen(nonce="nonce-c", integration_scope="n8n")
    assert after_ttl.accepted is True


def test_replay_key_namespaces_by_env_scope_and_hashes_nonce(monkeypatch):
    monkeypatch.setattr(settings, "REDIS_KEY_PREFIX", "fieldos")
    monkeypatch.setattr(settings, "APP_ENV", "test")
    key = replay_key(nonce="raw-sensitive-nonce", integration_scope="n8n-fieldos")
    assert key.startswith("fieldos:test:n8n:replay:n8n-fieldos:")
    assert "raw-sensitive-nonce" not in key
    assert nonce_digest("raw-sensitive-nonce") in key
    assert ":123:" not in key
    assert "signature" not in key


@pytest.mark.parametrize("ttl", [0, -1, 86401, "not-int", 300])
@pytest.mark.asyncio
async def test_replay_ttl_must_be_positive_bounded_integer(monkeypatch, ttl):
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "memory")
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", ttl)
    with pytest.raises(ReplayStoreError):
        await mark_n8n_nonce_seen(nonce="nonce-ttl", integration_scope="n8n")


@pytest.mark.asyncio
async def test_redis_set_nx_replay_protection_stable_nonce_key(monkeypatch):
    seen = {}

    class FakeRedis:
        @classmethod
        def from_url(cls, url, decode_responses=True):
            return cls()

        async def set(self, key, value, nx=False, ex=None):
            assert nx is True
            assert ex == 330
            if key in seen:
                return None
            seen[key] = value
            return True

        async def aclose(self):
            return None

    import sys, types
    redis_module = types.ModuleType("redis")
    asyncio_module = types.ModuleType("redis.asyncio")
    setattr(asyncio_module, "Redis", FakeRedis)
    monkeypatch.setitem(sys.modules, "redis", redis_module)
    monkeypatch.setitem(sys.modules, "redis.asyncio", asyncio_module)
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "redis")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://:pass@redis:6379/0")
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 330)
    first = await mark_n8n_nonce_seen(nonce="nonce-e", integration_scope="n8n", timestamp=456, signature_digest="sig-a")
    second = await mark_n8n_nonce_seen(nonce="nonce-e", integration_scope="n8n", timestamp=999, signature_digest="sig-b")
    other = await mark_n8n_nonce_seen(nonce="nonce-f", integration_scope="n8n", timestamp=999, signature_digest="sig-c")
    assert first == ReplayResult(True, first.key, "redis")
    assert second.accepted is False
    assert other.accepted is True
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_redis_unavailable_fails_closed_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "redis")
    monkeypatch.setattr(settings, "REDIS_URL", "")
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 330)
    with pytest.raises(ReplayStoreError):
        await mark_n8n_nonce_seen(nonce="nonce-g", integration_scope="n8n")


def test_replay_ttl_must_cover_signature_window_with_margin(monkeypatch):
    monkeypatch.setattr(settings, "N8N_TIMESTAMP_TOLERANCE_SECONDS", 300)
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 329)
    with pytest.raises(ReplayStoreError):
        replay_module.replay_ttl_seconds()
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 330)
    assert replay_module.replay_ttl_seconds() == 330


@pytest.mark.asyncio
async def test_same_nonce_blocked_for_full_signature_window(monkeypatch):
    monkeypatch.setattr(settings, "N8N_REPLAY_STORE", "memory")
    monkeypatch.setattr(settings, "N8N_TIMESTAMP_TOLERANCE_SECONDS", 300)
    monkeypatch.setattr(settings, "N8N_REPLAY_TTL_SECONDS", 330)
    first = await mark_n8n_nonce_seen(nonce="window-nonce", integration_scope="n8n")
    replay_module._MEMORY_REPLAY_CACHE[first.key] = datetime.utcnow() - timedelta(seconds=300)
    second = await mark_n8n_nonce_seen(nonce="window-nonce", integration_scope="n8n")
    assert second.accepted is False
    replay_module._MEMORY_REPLAY_CACHE[first.key] = datetime.utcnow() - timedelta(seconds=331)
    third = await mark_n8n_nonce_seen(nonce="window-nonce", integration_scope="n8n")
    assert third.accepted is True
