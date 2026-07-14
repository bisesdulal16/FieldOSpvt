"""
Server-side LLM text generation — pluggable, so AI summaries work on EVERY phone (no on-device
model needed). Providers:
  - heuristic : default, no LLM. Returns a templated summary from the numbers. Always works.
  - ollama    : your homelab (set OLLAMA_URL + LLM_MODEL, e.g. llama3.2).
  - openai    : OpenAI-compatible API (set OPENAI_API_KEY, optionally OPENAI_BASE_URL).

`generate(prompt, fallback)` never raises — on any provider error it returns `fallback` so the
feature degrades to the heuristic instead of failing.
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def generate(prompt: str, fallback: str) -> str:
    provider = settings.LLM_PROVIDER
    try:
        if provider == "ollama":
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(f"{settings.OLLAMA_URL}/api/generate",
                                 json={"model": settings.LLM_MODEL, "prompt": prompt, "stream": False})
                r.raise_for_status()
                return (r.json().get("response") or fallback).strip()
        if provider == "openai":
            if not settings.OPENAI_API_KEY:
                return fallback
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(f"{settings.OPENAI_BASE_URL}/chat/completions",
                                 headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                                 json={"model": settings.LLM_MODEL,
                                       "messages": [{"role": "user", "content": prompt}]})
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:  # any LLM failure → heuristic fallback, never break the endpoint
        logger.warning("LLM (%s) failed, using fallback: %s", provider, e)
    return fallback


def is_llm_enabled() -> bool:
    return settings.LLM_PROVIDER in ("ollama", "openai")
