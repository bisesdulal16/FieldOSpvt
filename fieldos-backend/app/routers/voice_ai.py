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
import json
import logging
import re
import time
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Any

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice-ai", tags=["Voice AI"])


def _ts() -> int:
    return int(time.time())


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
    Audio transcription endpoint.
    Pilot phase: Returns placeholder text (audio processed locally on device).
    For production, integrate with a local ASR engine.
    """
    # Determine language
    lang = request.language or "auto"
    is_nepali = "ne" in lang or "auto" == lang

    sample_text = (
        "आज म सunitा भेटेर आउँछु। उनको कर्जा तिर्ने कुरा गर्छु।"
        if is_nepali else
        "I am visiting Sunita today to discuss her loan repayment."
    )

    return {
        "success": True,
        "data": {
            "text": sample_text,
            "word_count": len(sample_text.split()),
            "language_detected": lang,
            "processing_time_ms": 0,
            "confidence": "high",
        },
        "timestamp": _ts(),
        "disclaimer": "Transcription is AI-generated. Officer must review before saving.",
    }


# ─── 2. POST /voice-ai/cleanup ──────────────────────────────────

@router.post("/cleanup")
async def cleanup_text(request: CleanupRequest):
    """Clean up voice-to-text text using local heuristic rules."""
    cleaned = _cleanup_text(request.text, request.language)

    return {
        "success": True,
        "data": {
            "original": request.text,
            "cleaned": cleaned,
            "processing_time_ms": 0,
        },
        "timestamp": _ts(),
        "disclaimer": "Text cleanup is AI-generated. Officer must review before saving.",
    }


# ─── 3. POST /voice-ai/summary ──────────────────────────────────

@router.post("/summary")
async def generate_visit_summary(request: VisitSummaryRequest):
    """Generate a visit summary using template + notes analysis."""
    summary = _generate_summary(
        request.notes,
        request.client_name,
        request.visit_purpose,
    )

    return {
        "success": True,
        "data": {
            "summary": summary,
            "processing_time_ms": 0,
            "disclaimer": "AI-generated summary — officer must review before saving.",
        },
        "timestamp": _ts(),
        "disclaimer": "AI-generated summary — officer must review before saving.",
    }


# ─── 4. POST /voice-ai/ask ─────────────────────────────────────

@router.post("/ask")
async def ask_fieldos(request: AskRequest):
    """'Ask FieldOS' AI assistant using rule-based logic."""
    answer = _generate_answer(
        request.question,
        request.context,
        request.conversation_history,
    )

    return {
        "success": True,
        "data": {
            "answer": answer,
            "processing_time_ms": 0,
            "disclaimer": "AI-generated response — verify information before acting.",
        },
        "timestamp": _ts(),
        "disclaimer": "AI-generated response — verify information before acting.",
    }
