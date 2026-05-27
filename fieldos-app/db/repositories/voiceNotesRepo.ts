/**
 * FieldOS Nepal — Voice Notes Repository (Phase 14)
 *
 * SQLite CRUD operations for voice notes.
 * Notes are saved locally first, then synced via sync queue.
 */

import { query, mutate, insertAndGetId, queryOne } from '../database';

// ─── Types ───────────────────────────────────────────────────────

export interface VoiceNoteRecord {
  id: number;
  client_id: number | null;
  visit_id: number | null;
  title: string;
  raw_text: string;
  cleaned_text: string | null;
  ai_summary: string | null;
  language: string;
  audio_duration_seconds: number | null;
  audio_file_uri: string | null;
  audio_file_size: number | null;
  is_ai_cleaned: number;
  is_ai_summarized: number;
  is_human_reviewed: number;
  status: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
}

// ─── CRUD ─────────────────────────────────────────────────────────

export async function createVoiceNote(params: {
  client_id?: number | null;
  visit_id?: number | null;
  title?: string;
  raw_text: string;
  language?: string;
  audio_duration_seconds?: number | null;
  audio_file_uri?: string | null;
  audio_file_size?: number | null;
}): Promise<number> {
  const id = await insertAndGetId(
    `INSERT INTO voice_notes (client_id, visit_id, title, raw_text, language, audio_duration_seconds, audio_file_uri, audio_file_size, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      params.client_id ?? null,
      params.visit_id ?? null,
      params.title || '',
      params.raw_text,
      params.language || 'ne',
      params.audio_duration_seconds ?? null,
      params.audio_file_uri ?? null,
      params.audio_file_size ?? null,
    ]
  );
  return id;
}

export async function getVoiceNoteById(id: number): Promise<VoiceNoteRecord | null> {
  return queryOne<VoiceNoteRecord>('SELECT * FROM voice_notes WHERE id = ?', [id]);
}

export async function getAllVoiceNotes(limit = 50): Promise<VoiceNoteRecord[]> {
  return query<VoiceNoteRecord>(
    'SELECT * FROM voice_notes ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
}

export async function getVoiceNotesByClient(clientId: number): Promise<VoiceNoteRecord[]> {
  return query<VoiceNoteRecord>(
    'SELECT * FROM voice_notes WHERE client_id = ? ORDER BY created_at DESC',
    [clientId]
  );
}

export async function getVoiceNotesByVisit(visitId: number): Promise<VoiceNoteRecord[]> {
  return query<VoiceNoteRecord>(
    'SELECT * FROM voice_notes WHERE visit_id = ? ORDER BY created_at DESC',
    [visitId]
  );
}

export async function updateVoiceNoteText(id: number, rawText: string): Promise<void> {
  await mutate(
    `UPDATE voice_notes SET raw_text = ?, status = 'edited', updated_at = datetime('now','localtime') WHERE id = ?`,
    [rawText, id]
  );
}

export async function updateCleanedText(id: number, cleanedText: string): Promise<void> {
  await mutate(
    `UPDATE voice_notes SET cleaned_text = ?, is_ai_cleaned = 1, updated_at = datetime('now','localtime') WHERE id = ?`,
    [cleanedText, id]
  );
}

export async function updateAISummary(id: number, summary: string): Promise<void> {
  await mutate(
    `UPDATE voice_notes SET ai_summary = ?, is_ai_summarized = 1, updated_at = datetime('now','localtime') WHERE id = ?`,
    [summary, id]
  );
}

export async function markHumanReviewed(id: number): Promise<void> {
  await mutate(
    `UPDATE voice_notes SET is_human_reviewed = 1, status = 'saved', updated_at = datetime('now','localtime') WHERE id = ?`,
    [id]
  );
}

export async function markSynced(id: number): Promise<void> {
  await mutate(
    `UPDATE voice_notes SET sync_status = 'synced', updated_at = datetime('now','localtime') WHERE id = ?`,
    [id]
  );
}

export async function markSyncFailed(id: number, error: string): Promise<void> {
  await mutate(
    `UPDATE voice_notes SET sync_status = 'failed', updated_at = datetime('now','localtime') WHERE id = ?`,
    [id]
  );
}

export async function deleteVoiceNote(id: number): Promise<void> {
  await mutate('DELETE FROM voice_notes WHERE id = ?', [id]);
}

export async function getVoiceNotesCount(): Promise<number> {
  const result = await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM voice_notes');
  return result?.count ?? 0;
}

export async function getPendingSyncCount(): Promise<number> {
  const result = await queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM voice_notes WHERE sync_status = 'pending'"
  );
  return result?.count ?? 0;
}

export async function searchVoiceNotes(searchTerm: string): Promise<VoiceNoteRecord[]> {
  const pattern = `%${searchTerm}%`;
  return query<VoiceNoteRecord>(
    `SELECT * FROM voice_notes 
     WHERE raw_text LIKE ? OR cleaned_text LIKE ? OR ai_summary LIKE ? OR title LIKE ?
     ORDER BY created_at DESC LIMIT 20`,
    [pattern, pattern, pattern, pattern]
  );
}
