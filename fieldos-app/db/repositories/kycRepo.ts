import { query, mutate, insertAndGetId } from '../database';

/**
 * KYC Documents Repository — Phase 8: Document Capture
 *
 * Manages KYC document records for clients.
 * Stores file references (URIs) — NOT raw file paths in UI.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type KycDocumentType =
  | 'citizenship_front'
  | 'citizenship_back'
  | 'client_photo'
  | 'signature'
  | 'other';

export type KycDocumentStatus =
  | 'missing'
  | 'captured'
  | 'pending_sync'
  | 'needs_review'
  | 'approved';

export type KycQualityStatus =
  | 'pending_review'
  | 'clear'
  | 'blurry';

export type KycSyncStatus =
  | 'pending'
  | 'synced'
  | 'failed';

export interface KycDocument {
  id: number;
  clientId: number;
  documentType: KycDocumentType;
  fileUri: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  blurScore: number | null;
  qualityStatus: KycQualityStatus;
  status: KycDocumentStatus;
  capturedAt: string;
  syncedAt: string | null;
  syncStatus: KycSyncStatus;
  createdAt: string;
  updatedAt: string;
}

// Internal row from SQLite
interface KycDocumentRow {
  id: number;
  client_id: number;
  document_type: string;
  file_uri: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  blur_score: number | null;
  quality_status: string;
  status: string;
  captured_at: string;
  synced_at: string | null;
  sync_status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: KycDocumentRow): KycDocument {
  return {
    id: row.id,
    clientId: row.client_id,
    documentType: row.document_type as KycDocumentType,
    fileUri: row.file_uri,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    blurScore: row.blur_score,
    qualityStatus: row.quality_status as KycQualityStatus,
    status: row.status as KycDocumentStatus,
    capturedAt: row.captured_at,
    syncedAt: row.synced_at,
    syncStatus: row.sync_status as KycSyncStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Create ────────────────────────────────────────────────────────

export interface CreateKycParams {
  clientId: number;
  documentType: KycDocumentType;
  fileUri: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  blurScore?: number;
  qualityStatus?: KycQualityStatus;
}

/**
 * Create a new KYC document record.
 * Returns the new document ID.
 */
export async function createKycDocument(params: CreateKycParams): Promise<number> {
  return insertAndGetId(
    `INSERT INTO kyc_documents (client_id, document_type, file_uri, file_name, file_size, mime_type, width, height, blur_score, quality_status, status, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', 'pending')`,
    [
      params.clientId,
      params.documentType,
      params.fileUri,
      params.fileName ?? null,
      params.fileSize ?? null,
      params.mimeType ?? null,
      params.width ?? null,
      params.height ?? null,
      params.blurScore ?? null,
      params.qualityStatus ?? 'pending_review',
    ]
  );
}

// ─── Read ──────────────────────────────────────────────────────────

/**
 * Get all KYC documents for a specific client.
 */
export async function getDocumentsByClientId(clientId: number): Promise<KycDocument[]> {
  const rows = await query<KycDocumentRow>(
    'SELECT * FROM kyc_documents WHERE client_id = ? ORDER BY document_type ASC, created_at DESC',
    [clientId]
  );
  return rows.map(mapRow);
}

/**
 * Get a single KYC document by ID.
 */
export async function getDocumentById(id: number): Promise<KycDocument | null> {
  const row = await query<KycDocumentRow>(
    'SELECT * FROM kyc_documents WHERE id = ?',
    [id]
  );
  return row.length > 0 ? mapRow(row[0]) : null;
}

/**
 * Get the latest document of a specific type for a client.
 */
export async function getLatestDocumentByType(
  clientId: number,
  documentType: KycDocumentType
): Promise<KycDocument | null> {
  const rows = await query<KycDocumentRow>(
    'SELECT * FROM kyc_documents WHERE client_id = ? AND document_type = ? ORDER BY created_at DESC LIMIT 1',
    [clientId, documentType]
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/**
 * Get a summary of KYC document status for a client.
 * Returns which types are captured vs missing.
 */
export async function getClientKycSummary(clientId: number): Promise<Record<KycDocumentType, KycDocument | null>> {
  const docs = await getDocumentsByClientId(clientId);
  const types: KycDocumentType[] = ['citizenship_front', 'citizenship_back', 'client_photo', 'signature', 'other'];
  const summary = {} as Record<KycDocumentType, KycDocument | null>;

  for (const type of types) {
    // Find the latest document for each type
    const doc = docs.find(d => d.documentType === type);
    summary[type] = doc ?? null;
  }

  return summary;
}

/**
 * Get all documents pending sync.
 */
export async function getPendingSyncDocuments(): Promise<KycDocument[]> {
  const rows = await query<KycDocumentRow>(
    "SELECT * FROM kyc_documents WHERE sync_status = 'pending' ORDER BY created_at ASC"
  );
  return rows.map(mapRow);
}

/**
 * Get count of documents pending sync.
 */
export async function getPendingSyncCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM kyc_documents WHERE sync_status = 'pending'"
  );
  return rows[0]?.count ?? 0;
}

// ─── Update ────────────────────────────────────────────────────────

/**
 * Update document status.
 */
export async function updateDocumentStatus(id: number, status: KycDocumentStatus): Promise<void> {
  await mutate(
    `UPDATE kyc_documents SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [status, id]
  );
}

/**
 * Update document quality status.
 */
export async function updateQualityStatus(id: number, qualityStatus: KycQualityStatus): Promise<void> {
  await mutate(
    `UPDATE kyc_documents SET quality_status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [qualityStatus, id]
  );
}

/**
 * Mark a document as synced.
 */
export async function markDocumentSynced(id: number): Promise<void> {
  await mutate(
    `UPDATE kyc_documents
     SET sync_status = 'synced', synced_at = datetime('now','localtime'), status = 'approved',
         updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [id]
  );
}

/**
 * Mark a document sync as failed.
 */
export async function markDocumentSyncFailed(id: number): Promise<void> {
  await mutate(
    `UPDATE kyc_documents
     SET sync_status = 'failed', status = 'needs_review', updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [id]
  );
}

/**
 * Update blur score (set after quality check).
 */
export async function updateBlurScore(id: number, score: number): Promise<void> {
  const qualityStatus: KycQualityStatus = score < 50 ? 'clear' : 'blurry';
  await mutate(
    `UPDATE kyc_documents SET blur_score = ?, quality_status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [score, qualityStatus, id]
  );
}

// ─── Delete ────────────────────────────────────────────────────────

/**
 * Delete a KYC document by ID.
 */
export async function deleteDocument(id: number): Promise<void> {
  await mutate('DELETE FROM kyc_documents WHERE id = ?', [id]);
}

/**
 * Delete all documents for a client (used for data reset).
 */
export async function deleteClientDocuments(clientId: number): Promise<void> {
  await mutate('DELETE FROM kyc_documents WHERE client_id = ?', [clientId]);
}
