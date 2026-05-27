/**
 * FieldOS Nepal — Voice Note Service (Phase 14)
 *
 * Handles voice note lifecycle:
 * 1. Record/type → save locally
 * 2. AI transcription (via backend → ASR)
 * 3. AI text cleanup (via backend → LLM)
 * 4. AI visit summary (via backend → LLM)
 * 5. Human review → mark as saved
 * 6. Sync to server via sync queue
 */

import { getConfig, getAccessToken } from './apiClient';
import {
  createVoiceNote,
  getVoiceNoteById,
  getAllVoiceNotes,
  getVoiceNotesByClient,
  updateVoiceNoteText,
  updateCleanedText,
  updateAISummary,
  markHumanReviewed,
  deleteVoiceNote,
  type VoiceNoteRecord,
} from '../db/repositories/voiceNotesRepo';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import { audit } from './auditService';

// ─── Types ───────────────────────────────────────────────────────

export interface VoiceNote {
  id: number;
  clientId: number | null;
  visitId: number | null;
  title: string;
  rawText: string;
  cleanedText: string | null;
  aiSummary: string | null;
  language: string;
  audioDurationSeconds: number | null;
  isAiCleaned: boolean;
  isAiSummarized: boolean;
  isHumanReviewed: boolean;
  status: string;
  syncStatus: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function fromRecord(r: VoiceNoteRecord): VoiceNote {
  return {
    id: r.id,
    clientId: r.client_id,
    visitId: r.visit_id,
    title: r.title,
    rawText: r.raw_text,
    cleanedText: r.cleaned_text,
    aiSummary: r.ai_summary,
    language: r.language,
    audioDurationSeconds: r.audio_duration_seconds,
    isAiCleaned: !!r.is_ai_cleaned,
    isAiSummarized: !!r.is_ai_summarized,
    isHumanReviewed: !!r.is_human_reviewed,
    status: r.status,
    syncStatus: r.sync_status,
    createdAt: r.created_at,
  };
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Create a new voice note from typed or transcribed text.
 */
export async function createNote(params: {
  rawText: string;
  clientId?: number | null;
  visitId?: number | null;
  title?: string;
  language?: string;
  audioDurationSeconds?: number | null;
}): Promise<{ success: boolean; noteId?: number; error?: string }> {
  try {
    const noteId = await createVoiceNote({
      raw_text: params.rawText,
      client_id: params.clientId ?? null,
      visit_id: params.visitId ?? null,
      title: params.title || '',
      language: params.language || 'ne',
      audio_duration_seconds: params.audioDurationSeconds,
    });

    // Audit
    await audit('voice_note_created', {
      entityType: 'voice_note',
      entityId: String(noteId),
      metadata: {
        client_id: params.clientId,
        text_length: params.rawText.length,
        language: params.language || 'ne',
      },
      localOnly: true,
    });

    // Add to sync queue
    try {
      await enqueueSyncEvent('voice_note', { voice_note_id: noteId });
    } catch { /* silent */ }

    return { success: true, noteId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create note' };
  }
}

/**
 * Get all voice notes.
 */
export async function getAllNotes(): Promise<VoiceNote[]> {
  const records = await getAllVoiceNotes();
  return records.map(fromRecord);
}

/**
 * Get voice notes for a specific client.
 */
export async function getClientNotes(clientId: number): Promise<VoiceNote[]> {
  const records = await getVoiceNotesByClient(clientId);
  return records.map(fromRecord);
}

/**
 * Update the raw text of a note (manual editing).
 */
export async function updateNoteText(noteId: number, newText: string): Promise<{ success: boolean; error?: string }> {
  try {
    await updateVoiceNoteText(noteId, newText);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update note' };
  }
}

/**
 * Request AI text cleanup from backend.
 */
export async function requestAICleanup(noteId: string | number): Promise<{
  success: boolean;
  cleanedText?: string;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    const note = await getVoiceNoteById(Number(noteId));
    const original = note?.raw_text || '';
    // Mock cleanup — trim and remove extra spaces
    const cleaned = original.replace(/\s+/g, ' ').trim();
    await updateCleanedText(Number(noteId), cleaned);
    return { success: true, cleanedText: cleaned };
  }

  try {
    const note = await getVoiceNoteById(Number(noteId));
    if (!note) return { success: false, error: 'Note not found' };

    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();

    const res = await fetch(`${apiUrl}/voice-ai/cleanup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        text: note.raw_text,
        language: note.language,
      }),
    });

    const json = await res.json();
    if (json.success && json.data?.cleaned) {
      await updateCleanedText(Number(noteId), json.data.cleaned);
      return { success: true, cleanedText: json.data.cleaned };
    }
    return { success: false, error: json.detail || 'Cleanup failed' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Request AI visit summary from backend.
 */
export async function requestAISummary(noteId: string | number, params: {
  clientName?: string;
  visitPurpose?: string;
  officerName?: string;
}): Promise<{
  success: boolean;
  summary?: string;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    const note = await getVoiceNoteById(Number(noteId));
    const raw = note?.raw_text || '';
    const mockSummary = `• Client discussion: ${raw.slice(0, 50)}...\n• No immediate concerns noted.\n• Follow-up: Routine check recommended.`;
    await updateAISummary(Number(noteId), mockSummary);
    return { success: true, summary: mockSummary };
  }

  try {
    const note = await getVoiceNoteById(Number(noteId));
    if (!note) return { success: false, error: 'Note not found' };

    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();

    const res = await fetch(`${apiUrl}/voice-ai/summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        notes: note.cleaned_text || note.raw_text,
        client_name: params.clientName,
        visit_purpose: params.visitPurpose,
        officer_name: params.officerName,
      }),
    });

    const json = await res.json();
    if (json.success && json.data?.summary) {
      await updateAISummary(Number(noteId), json.data.summary);
      return { success: true, summary: json.data.summary };
    }
    return { success: false, error: json.detail || 'Summary generation failed' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Mark note as human-reviewed and saved.
 * AI output never bypasses human review.
 */
export async function approveNote(noteId: number): Promise<{ success: boolean; error?: string }> {
  try {
    await markHumanReviewed(noteId);

    await audit('voice_note_approved', {
      entityType: 'voice_note',
      entityId: String(noteId),
      localOnly: true,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to approve note' };
  }
}

/**
 * Delete a voice note.
 */
export async function removeNote(noteId: number): Promise<{ success: boolean; error?: string }> {
  try {
    await audit('voice_note_deleted', {
      entityType: 'voice_note',
      entityId: String(noteId),
      localOnly: true,
    });
    await deleteVoiceNote(noteId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete note' };
  }
}
