"""
Voice AI Router — Phase 14: Nepali Voice Notes & Assistant

Local processing pipeline for voice notes. No external CLI dependencies.
Supports pilot phase with local heuristic processing.

Endpoints:
  POST /voice-ai/transcribe    — Audio base64 placeholder → text mock
  POST /voice-ai/cleanup       — Nepali text cleanup (heuristic)
  POST /voice-ai/summary       — Visit summary generation (template)
  POST /voice-ai/ask           — "Ask FieldOS" assistant (rule-based)

Privacy: No audio or text data is stored on server.
Human Review: All output requires officer review before saving.
"""

import asyncio
import base64
import json
import logging
import os
import re
import time
import urllib.request
import urllib.error
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Any

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice-ai", tags=["Voice AI"])


def _ts() -> int:
    return int(time.time())


# ─── Local LLM (Ollama) with heuristic fallback ──────────────────
# Set OLLAMA_URL / OLLAMA_MODEL in the backend .env. If Ollama is
# unreachable, every endpoint falls back to the rule-based functions so the
# pilot never breaks when the model server is down.
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3:latest")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "20"))
# On this host the GPU (GTX 1650, 4GB) is mostly consumed by another process, so any
# GPU offload makes the llama runner OOM-crash (exit 2). Force CPU-only by default —
# gemma2:2b answers in ~12s warm on CPU. Set OLLAMA_NUM_GPU>0 if a GPU frees up.
OLLAMA_NUM_GPU = int(os.getenv("OLLAMA_NUM_GPU", "0"))


def _ollama_generate(prompt: str, system: str | None = None) -> str | None:
    """Call a local Ollama model. Returns the text, or None on any failure."""
    try:
        body = {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "system": system or "",
            "stream": False,
            "keep_alive": "30m",  # keep the model resident between requests
            "options": {"temperature": 0.2, "num_gpu": OLLAMA_NUM_GPU},
        }
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as r:
            data = json.loads(r.read().decode())
        text = (data.get("response") or "").strip()
        return text or None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        logger.warning(f"Ollama unavailable, using heuristic fallback: {e}")
        return None


async def _llm(prompt: str, system: str | None = None) -> str | None:
    """Async wrapper so the blocking HTTP call doesn't stall the event loop."""
    return await asyncio.to_thread(_ollama_generate, prompt, system)


def prewarm_ollama() -> None:
    """Load the model into memory once at startup so the first real request is
    fast. Safe no-op if Ollama is down. Call from a background thread."""
    try:
        _ollama_generate("ok", system="Reply with one word.")
        logger.info(f"Ollama model '{OLLAMA_MODEL}' pre-warmed")
    except Exception:
        pass


# ─── Speech-to-text (homelab Whisper) with placeholder fallback ──
# Self-hosted Whisper on the homelab — anything exposing an OpenAI-compatible
# POST /v1/audio/transcriptions that accepts a multipart `file`
# (faster-whisper-server / speaches / whisper-asr-webservice). If WHISPER_URL is
# unset or unreachable, /transcribe returns a clearly-labelled placeholder so the
# pilot never hard-fails when the STT box is down.
WHISPER_URL = os.getenv("WHISPER_URL", "")  # e.g. http://192.168.1.50:9000/v1/audio/transcriptions
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "Systran/faster-whisper-small")
WHISPER_TIMEOUT = float(os.getenv("WHISPER_TIMEOUT", "60"))


def _whisper_transcribe(audio_bytes: bytes, filename: str, language: str | None) -> str | None:
    """POST audio to a self-hosted Whisper server as multipart/form-data.
    Returns transcript text, or None on any failure (caller falls back)."""
    if not WHISPER_URL:
        return None
    boundary = f"----fieldos{uuid.uuid4().hex}"
    fields = {"model": WHISPER_MODEL, "response_format": "json"}
    if language and language not in ("auto", ""):
        fields["language"] = language[:2]
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        )
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
        f"filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode()
    )
    parts.append(audio_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    payload = b"".join(parts)
    try:
        req = urllib.request.Request(
            WHISPER_URL,
            data=payload,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=WHISPER_TIMEOUT) as r:
            raw = r.read().decode()
        try:
            text = (json.loads(raw).get("text") or "").strip()
        except ValueError:
            text = raw.strip()  # some servers return text/plain
        return text or None
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        logger.warning(f"Whisper unavailable, using placeholder: {e}")
        return None


async def _stt(audio_bytes: bytes, filename: str, language: str | None) -> str | None:
    """Async wrapper so the blocking STT HTTP call doesn't stall the event loop."""
    return await asyncio.to_thread(_whisper_transcribe, audio_bytes, filename, language)


# ─── Request/Response Models ─────────────────────────────────────

class TranscribeRequest(BaseModel):
    audio_base64: str = Field(..., description="Base64-encoded audio data")
    language: Optional[str] = Field(None, description="Language hint (ne, en, auto)")

class CleanupRequest(BaseModel):
    text: str = Field(..., description="Raw text to clean up")
    language: Optional[str] = Field("ne", description="Primary language")

class VisitSummaryRequest(BaseModel):
    notes: str = Field(..., description="Raw visit notes text")
    client_name: Optional[str] = Field(None, description="Client name")
    visit_purpose: Optional[str] = Field(None, description="Purpose of visit")
    officer_name: Optional[str] = Field(None, description="Officer name")

class AskRequest(BaseModel):
    question: str = Field(..., description="User's question")
    context: Optional[dict[str, Any]] = Field(None, description="FieldOS data context")
    conversation_history: Optional[list[dict[str, str]]] = Field(
        None, description="Previous messages for multi-turn conversation"
    )


# ─── Local Cleanup (No External CLI) ─────────────────────────────

def _cleanup_text(text: str, language: str = "ne") -> str:
    """Clean up voice-to-text text using heuristic rules. No external dependencies."""
    cleaned = text.strip()
    # Remove filler words (Nepali + English)
    fillers = [r'\bum\b', r'\buh\b', r'\bah\b', r'\bhmm\b', r'\blike\b',
                r'\bथो\b', r'\भने\b', r'\बहुत\b']
    for filler in fillers:
        cleaned = re.sub(filler, '', cleaned, flags=re.IGNORECASE)
    # Remove excessive spaces and punctuation
    cleaned = re.sub(r'\s{2,}', ' ', cleaned)
    cleaned = re.sub(r'[\.]{3,}', '.', cleaned)
    return cleaned.strip()


def _generate_summary(notes: str, client_name: str | None, purpose: str | None) -> str:
    """Generate a visit summary using template + notes analysis."""
    lines = []
    if client_name:
        lines.append(f"Client: {client_name}")
    if purpose:
        lines.append(f"Purpose: {purpose}")

    # Extract key points from notes (split by newlines/periods)
    segments = re.split(r'[.\n]+', notes.strip())
    key_points = [s.strip() for s in segments if len(s.strip()) > 20][:3]

    summary_lines = []
    for i, point in enumerate(key_points, 1):
        summary_lines.append(f"• {point}")

    if not summary_lines:
        lines.append("• Visit completed. Officer provided general notes.")

    return "\n".join(lines + ["", "Key observations:", ""] + summary_lines)


# ─── Local AI Assistant (Rule-Based, No External CLI) ─────────────

def _generate_answer(question: str, context: dict | None, history: list[dict] | None) -> str:
    """Generate an AI assistant answer using rule-based logic."""
    q = question.lower().strip()
    answers = {
        "what should i do today": "Check your task list for today's collections and priority clients. Focus on overdue accounts first.",
        "who has the highest priority": "Clients with the most overdue days and active PAR status should be your top priority today.",
        "how much is my target": "Review your collection target from the dashboard. Contact high-value clients early in the day.",
        "what is par": "PAR (Portfolio at Risk) measures loans that are 30+ days past due. Keep it below 5% for healthy portfolio status.",
        "how to reduce par": "Follow up with overdue clients first, collect pending payments, and set promise-to-pay dates for those unable to pay fully.",
    }

    # Check context-provided data first
    if context:
        pending = context.get("pending_sync_count", 0)
        if pending > 0:
            return f"⚡ Sync reminder: {pending} items pending sync. Complete sync before EOD.\n\n" + answers.get(q, "I can help with your daily tasks. Try asking 'What should I do today?' or 'How to reduce PAR?'")

    # Keyword matching
    for key, answer in answers.items():
        if any(word in q for word in key.split()):
            return answer

    # Fallback: acknowledge question and suggest topics
    return (f"I understand your question: \"{question}\". "
            f"For field officer guidance, try asking about:\n"
            f"- Today's priorities\n- PAR reduction strategies\n- Collection targets\n"
            f"\n⚡ AI suggestion only — verify before acting.")


# ─── 1. POST /voice-ai/transcribe ────────────────────────────────

@router.post("/transcribe")
async def transcribe_audio(request: TranscribeRequest):
    """
    Speech-to-text for a recorded voice note.

    The mobile app records audio (expo-audio), base64-encodes it, and posts it
    here. We decode it and hand it to the homelab Whisper server (WHISPER_URL).
    If Whisper is unset/unreachable, we return a labelled placeholder so the
    officer can still type — the pilot never hard-fails on a down STT box.

    Privacy: audio is streamed to the STT server and NOT persisted here.
    """
    started = time.time()
    lang = request.language or "auto"

    # Accept either a raw base64 string or a data URI ("data:audio/m4a;base64,...").
    b64 = request.audio_base64 or ""
    ext = "m4a"
    if b64.startswith("data:"):
        header, _, b64 = b64.partition(",")
        m = re.search(r"audio/([a-zA-Z0-9]+)", header)
        if m:
            ext = {"mp4": "m4a", "x-m4a": "m4a", "mpeg": "mp3"}.get(m.group(1), m.group(1))
    try:
        audio_bytes = base64.b64decode(b64, validate=False)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid base64 audio payload")
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio payload")

    text = await _stt(audio_bytes, f"note.{ext}", lang)
    engine = "whisper" if text else "unavailable"
    if not text:
        # Placeholder: keep the flow alive; the officer types/edits the note.
        text = ""

    return {
        "success": True,
        "data": {
            "text": text,
            "engine": engine,
            "word_count": len(text.split()),
            "language_detected": lang,
            "processing_time_ms": int((time.time() - started) * 1000),
            "confidence": "high" if engine == "whisper" else "none",
        },
        "timestamp": _ts(),
        "disclaimer": "Transcription is AI-generated. Officer must review before saving.",
    }


# ─── 2. POST /voice-ai/cleanup ──────────────────────────────────

@router.post("/cleanup")
async def cleanup_text(request: CleanupRequest):
    """Clean up voice-to-text via local LLM, falling back to heuristic rules."""
    lang_name = "Nepali" if (request.language or "ne").startswith("ne") else "English"
    llm = await _llm(
        prompt=f"Clean up this field-visit voice note. Fix grammar and remove filler "
               f"words, keep the original {lang_name} language and meaning, return only "
               f"the cleaned note:\n\n{request.text}",
        system="You are a careful transcription editor for a microfinance field app. "
               "Never invent facts; only clean what is written.",
    )
    cleaned = llm or _cleanup_text(request.text, request.language)
    engine = "llm" if llm else "heuristic"

    return {
        "success": True,
        "data": {
            "original": request.text,
            "cleaned": cleaned,
            "engine": engine,
            "processing_time_ms": 0,
        },
        "timestamp": _ts(),
        "disclaimer": "Text cleanup is AI-generated. Officer must review before saving.",
    }


# ─── 3. POST /voice-ai/summary ──────────────────────────────────

@router.post("/summary")
async def generate_visit_summary(request: VisitSummaryRequest):
    """Summarize a visit via local LLM, falling back to a template."""
    ctx = []
    if request.client_name:
        ctx.append(f"Client: {request.client_name}")
    if request.visit_purpose:
        ctx.append(f"Purpose: {request.visit_purpose}")
    ctx_str = ("\n".join(ctx) + "\n\n") if ctx else ""
    llm = await _llm(
        prompt=f"{ctx_str}Summarize these microfinance field-visit notes into 3-5 short "
               f"bullet points an officer and branch manager can scan. Keep facts exactly "
               f"as written; do not add amounts or promises that aren't stated:\n\n{request.notes}",
        system="You summarize microfinance field visits factually and concisely.",
    )
    summary = llm or _generate_summary(request.notes, request.client_name, request.visit_purpose)
    engine = "llm" if llm else "heuristic"

    return {
        "success": True,
        "data": {
            "summary": summary,
            "engine": engine,
            "processing_time_ms": 0,
            "disclaimer": "AI-generated summary — officer must review before saving.",
        },
        "timestamp": _ts(),
        "disclaimer": "AI-generated summary — officer must review before saving.",
    }


# ─── 4. POST /voice-ai/ask ─────────────────────────────────────

@router.post("/ask")
async def ask_fieldos(request: AskRequest):
    """'Ask FieldOS' assistant via local LLM, falling back to rule-based answers."""
    ctx_str = ""
    if request.context:
        ctx_str = "Current data context (use it in your answer):\n" + json.dumps(request.context) + "\n\n"
    llm = await _llm(
        prompt=f"{ctx_str}Field officer question: {request.question}",
        system="You are FieldOS, an assistant for microfinance field officers in Nepal. "
               "Give short, practical answers about collections, visits, PAR and promises-to-pay. "
               "You may suggest and prioritize, but never approve loans, confirm payments, or make "
               "compliance decisions. Keep it under 4 sentences.",
    )
    answer = llm or _generate_answer(request.question, request.context, request.conversation_history)
    engine = "llm" if llm else "heuristic"

    return {
        "success": True,
        "data": {
            "answer": answer,
            "engine": engine,
            "processing_time_ms": 0,
            "disclaimer": "AI-generated response — verify information before acting.",
        },
        "timestamp": _ts(),
        "disclaimer": "AI-generated response — verify information before acting.",
    }
