"""
Voice AI Router — Phase 14: Nepali Voice Notes & Assistant

Uses z-ai CLI tools (z-ai chat, z-ai asr) for all AI operations.
No separate Node.js mini-service required — runs CLI subprocesses.

Endpoints:
  POST /voice-ai/transcribe    — Audio base64 → text (ASR)
  POST /voice-ai/cleanup       — Nepali text cleanup (LLM)
  POST /voice-ai/summary       — Visit summary generation (LLM)
  POST /voice-ai/ask           — "Ask FieldOS" assistant (LLM)

Privacy: Audio is processed ephemerally. No audio stored on server.
Human Review: All AI output requires officer review before saving.
"""

import asyncio
import json
import logging
import tempfile
import time
import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Any

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice-ai", tags=["Voice AI v2"])


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


# ─── CLI Helpers ─────────────────────────────────────────────────

async def _run_chat(prompt: str, system_prompt: str) -> str:
    """Run z-ai chat CLI and return the response content."""
    proc = await asyncio.create_subprocess_exec(
        "z-ai", "chat",
        "--prompt", prompt,
        "--system", system_prompt,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)

    if proc.returncode != 0:
        err_msg = stderr.decode().strip() or f"CLI exited with code {proc.returncode}"
        logger.error(f"z-ai chat error: {err_msg}")
        raise RuntimeError(err_msg)

    output = stdout.decode().strip()
    try:
        data = json.loads(output)
        return data.get("choices", [{}])[0].get("message", {}).get("content", "")
    except json.JSONDecodeError:
        # Fallback: return raw output if not JSON
        logger.warning(f"z-ai chat returned non-JSON: {output[:200]}")
        return output


async def _run_asr(audio_base64: str) -> str:
    """Run z-ai asr CLI with base64 audio and return transcription text."""
    proc = await asyncio.create_subprocess_exec(
        "z-ai", "asr",
        "--base64", audio_base64,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60.0)

    if proc.returncode != 0:
        err_msg = stderr.decode().strip() or f"CLI exited with code {proc.returncode}"
        logger.error(f"z-ai asr error: {err_msg}")
        raise RuntimeError(err_msg)

    output = stdout.decode().strip()
    try:
        data = json.loads(output)
        return data.get("text", "")
    except json.JSONDecodeError:
        logger.warning(f"z-ai asr returned non-JSON: {output[:200]}")
        return output


# ─── System Prompts ──────────────────────────────────────────────

CLEANUP_SYSTEM_PROMPT = """You are a text cleanup assistant for a microfinance field officer app in Nepal.
You clean up voice-to-text transcriptions that may contain:
- Filler words (um, uh, ah, hmm, like)
- False starts and repetitions
- Mixed Nepali/English text
- Grammatical errors from speech recognition

Rules:
1. Preserve the ORIGINAL MEANING exactly — do not add information that wasn't said
2. Fix obvious grammar and spelling errors
3. Remove filler words and false starts
4. Keep Nepali text in Nepali script
5. Keep numbers and financial terms (NPR, amounts, percentages) exactly as spoken
6. Keep proper nouns (client names, places) exactly as spoken
7. If the text is already clean, return it as-is
8. Return ONLY the cleaned text, no explanation"""

CLEANUP_SYSTEM_PROMPT_NE = CLEANUP_SYSTEM_PROMPT + "\n9. The text is primarily in Nepali — preserve Nepali script and grammar"

SUMMARY_SYSTEM_PROMPT = """You are a visit summary assistant for FieldOS Nepal, a microfinance field officer app.
Generate a concise, professional visit summary from the officer's voice/text notes.

The summary should include:
1. Key topics discussed (2-3 bullet points)
2. Client's current situation/reason for visit
3. Any commitments made (payment promises, follow-up dates)
4. Action items for the officer

Rules:
- Be concise (max 150 words)
- Use professional language
- Preserve financial details (amounts, dates) exactly
- Flag any concerns (hardship, default risk, disputes)
- Use Nepali names and places as given
- If notes are in Nepali, keep the summary in Nepali
- AI output is advisory only — officer must review and approve

Format: Plain text with bullet points using "•" """

ASK_SYSTEM_PROMPT = """You are "FieldOS Assistant", an AI helper for microfinance field officers in Nepal.
You help officers with questions about their daily work — but you NEVER make decisions for them.

Available data context (provided with each question):
- Today's due clients and their overdue status
- Pending sync items count
- Promise-to-pay due today
- Client history and visit records
- Branch policies and collection targets

Rules:
- Be concise and actionable
- Use Nepali Rupee (NPR) for amounts
- Use Nepali names and places as provided
- If asked about loan approval, interest rates, or policy changes → redirect to branch manager
- NEVER suggest approving loans, waiving payments, or adjusting amounts
- NEVER suggest disciplinary actions
- Flag any client hardship or risk situations
- If data is not available, say "Data not available — check after sync"
- Keep responses under 100 words unless detailed explanation is needed
- AI output is advisory only — officer must verify and act independently

Disclaimer: Always end with "⚡ AI suggestion only — verify before acting." when providing actionable advice."""


# ─── 1. POST /voice-ai/transcribe ────────────────────────────────

@router.post("/transcribe")
async def transcribe_audio(request: TranscribeRequest):
    """
    Transcribe audio to text using ASR.
    Audio is processed ephemerally — not stored on server.
    """
    try:
        startTime = time.time()
        text = await _run_asr(request.audio_base64)
        elapsed = int((time.time() - startTime) * 1000)
        wordCount = len(text.split()) if text else 0

        logger.info(f"[ASR] Transcribed {wordCount} words in {elapsed}ms")

        return {
            "success": True,
            "data": {
                "text": text,
                "word_count": wordCount,
                "language_detected": request.language or "auto",
                "processing_time_ms": elapsed,
                "confidence": "high",
            },
            "timestamp": _ts(),
            "disclaimer": "Transcription is AI-generated. Officer must review before saving.",
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="ASR processing timed out. Please try again.")
    except Exception as e:
        logger.error(f"Transcribe error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


# ─── 2. POST /voice-ai/cleanup ──────────────────────────────────

@router.post("/cleanup")
async def cleanup_text(request: CleanupRequest):
    """
    Clean up voice-to-text transcription.
    Removes filler words, fixes grammar, preserves meaning.
    Supports Nepali and mixed Nepali/English text.
    """
    try:
        system = CLEANUP_SYSTEM_PROMPT_NE if request.language == "ne" else CLEANUP_SYSTEM_PROMPT
        prompt = f'Clean up this voice note:\n\n"{request.text}"'

        startTime = time.time()
        cleaned = await _run_chat(prompt, system)
        elapsed = int((time.time() - startTime) * 1000)

        logger.info(f"[LLM] Text cleanup complete in {elapsed}ms")

        return {
            "success": True,
            "data": {
                "original": request.text,
                "cleaned": cleaned.strip(),
                "processing_time_ms": elapsed,
            },
            "timestamp": _ts(),
            "disclaimer": "Text cleanup is AI-generated. Officer must review before saving.",
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Text cleanup timed out. Please try again.")
    except Exception as e:
        logger.error(f"Cleanup error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Text cleanup failed: {str(e)}")


# ─── 3. POST /voice-ai/summary ──────────────────────────────────

@router.post("/summary")
async def generate_visit_summary(request: VisitSummaryRequest):
    """
    Generate a concise visit summary from officer's notes.
    AI can suggest — human must review and approve.
    """
    try:
        context_parts = [
            f"Client: {request.client_name or 'Not specified'}",
            f"Visit purpose: {request.visit_purpose or 'Not specified'}",
            f"Officer: {request.officer_name or 'Field Officer'}",
            f"Notes: {request.notes}",
        ]
        prompt = "\n".join(context_parts)

        startTime = time.time()
        summary = await _run_chat(prompt, SUMMARY_SYSTEM_PROMPT)
        elapsed = int((time.time() - startTime) * 1000)

        logger.info(f"[LLM] Visit summary generated in {elapsed}ms")

        return {
            "success": True,
            "data": {
                "summary": summary.strip(),
                "processing_time_ms": elapsed,
                "disclaimer": "AI-generated summary — officer must review before saving.",
            },
            "timestamp": _ts(),
            "disclaimer": "AI-generated summary — officer must review before saving.",
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Summary generation timed out. Please try again.")
    except Exception as e:
        logger.error(f"Summary error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Visit summary generation failed: {str(e)}")


# ─── 4. POST /voice-ai/ask ─────────────────────────────────────

@router.post("/ask")
async def ask_fieldos(request: AskRequest):
    """
    'Ask FieldOS' AI assistant.
    Answers questions about today's work, clients, policies.
    AI suggests only — human decides and acts.

    Supports multi-turn conversation via conversation_history.
    """
    try:
        # Build the full prompt with context and history
        prompt_parts = []

        if request.context:
            prompt_parts.append(
                f"[FieldOS Data Context]\n{json.dumps(request.context, indent=2)}\n\n"
                f"Please use this data to answer my question."
            )

        # Add conversation history as part of the prompt
        if request.conversation_history and isinstance(request.conversation_history, list):
            for msg in request.conversation_history[-6:]:  # Last 6 messages for context
                role_label = "Previous question" if msg.get("role") == "user" else "Previous answer"
                prompt_parts.append(f"[{role_label}]: {msg.get('content', '')}")

        prompt_parts.append(request.question)
        full_prompt = "\n\n".join(prompt_parts)

        startTime = time.time()
        answer = await _run_chat(full_prompt, ASK_SYSTEM_PROMPT)
        elapsed = int((time.time() - startTime) * 1000)

        logger.info(f"[LLM] Ask FieldOS answered in {elapsed}ms")

        return {
            "success": True,
            "data": {
                "answer": answer.strip(),
                "processing_time_ms": elapsed,
                "disclaimer": "AI-generated response — verify information before acting.",
            },
            "timestamp": _ts(),
            "disclaimer": "AI-generated response — verify information before acting.",
        }
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI assistant timed out. Please try again.")
    except Exception as e:
        logger.error(f"Ask error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI assistant error: {str(e)}")
