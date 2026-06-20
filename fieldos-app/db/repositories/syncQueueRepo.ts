import { query, mutate, insertAndGetId } from '../database';

/**
 * Sync Queue Repository — Phase 2: Real Offline Queue
 *
 * Every field action creates a sync queue event.
 * The queue tracks what needs to sync to the server.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type SyncQueueEventType =
  | 'visit_checkin'
  | 'collection'
  | 'promise_to_pay'
  | 'center_meeting'
  | 'end_of_day_report'
  | 'audit_event'
  | 'kyc_document'
  | 'voice_note';

/**
 * Map mobile entity types to backend-valid entity types for sync.
 */
export function mapEntityTypeToBackend(type: SyncQueueEventType): string {
  const map: Record<string, string> = {
    promise_to_pay: 'promise',
    center_meeting: 'meeting',
    end_of_day_report: 'eod',
    visit_checkin: 'visit_checkin',
    collection: 'collection',
    audit_event: 'audit_event',
    kyc_document: 'kyc_document',
    voice_note: 'voice_note',
  };
  return map[type] || type;
}

export type SyncQueueStatus =
  | 'pending_sync'
  | 'syncing'
  | 'synced'
  | 'failed';

export interface SyncQueueEvent {
  id: number;
  type: SyncQueueEventType;
  operation: string;
  payload: string;
  status: SyncQueueStatus;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// Internal row from SQLite (uses different column names)
interface SyncQueueRow {
  id: number;
  entity_type: string;
  entity_id: number;
  operation: string;
  payload_json: string;
  retry_count: number;
  max_retries: number;
  status: string;
  last_error: string | null;
  scheduled_at: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToEvent(row: SyncQueueRow): SyncQueueEvent {
  return {
    id: row.id,
    type: row.entity_type as SyncQueueEventType,
    operation: row.operation,
    payload: row.payload_json,
    status: row.status as SyncQueueStatus,
    retryCount: row.retry_count,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD Operations ────────────────────────────────────────────────

/**
 * Add a new event to the sync queue.
 */
export async function enqueueSyncEvent(
  type: SyncQueueEventType,
  payload: any,
  entityId?: number
): Promise<number> {
  const eid = entityId ?? 0;
  return insertAndGetId(
    `INSERT INTO sync_queue (entity_type, entity_id, operation, payload_json, status)
     VALUES (?, ?, 'create', ?, 'pending_sync')`,
    [type, eid, JSON.stringify(payload)]
  );
}

/**
 * Get all events in the queue, ordered by creation time.
 */
export async function getAllQueueEvents(): Promise<SyncQueueEvent[]> {
  const rows = await query<SyncQueueRow>(
    'SELECT * FROM sync_queue ORDER BY created_at ASC'
  );
  return rows.map(mapRowToEvent);
}

/**
 * Get pending events (not yet synced).
 */
export async function getPendingEvents(): Promise<SyncQueueEvent[]> {
  const rows = await query<SyncQueueRow>(
    "SELECT * FROM sync_queue WHERE status = 'pending_sync' ORDER BY created_at ASC"
  );
  return rows.map(mapRowToEvent);
}

/**
 * Get events grouped by type for the Sync Center UI.
 */
export async function getPendingGroupedByType(): Promise<Record<string, SyncQueueEvent[]>> {
  const events = await getPendingEvents();
  const grouped: Record<string, SyncQueueEvent[]> = {};
  for (const event of events) {
    if (!grouped[event.type]) grouped[event.type] = [];
    grouped[event.type].push(event);
  }
  return grouped;
}

/**
 * Get failed events (retryable).
 */
export async function getFailedEvents(): Promise<SyncQueueEvent[]> {
  const rows = await query<SyncQueueRow>(
    "SELECT * FROM sync_queue WHERE status = 'failed' ORDER BY updated_at DESC"
  );
  return rows.map(mapRowToEvent);
}

/**
 * Get count of pending events.
 */
export async function getPendingCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending_sync'"
  );
  return rows[0]?.count ?? 0;
}

/**
 * Get count of failed events.
 */
export async function getFailedCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'"
  );
  return rows[0]?.count ?? 0;
}

/**
 * Get total count of all unsynced events (pending + syncing + failed).
 */
export async function getUnsyncedCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('pending_sync', 'syncing', 'failed')"
  );
  return rows[0]?.count ?? 0;
}

/**
 * Mark an event as syncing.
 */
export async function markEventSyncing(id: number): Promise<void> {
  await mutate(
    `UPDATE sync_queue SET status = 'syncing', updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [id]
  );
}

/**
 * Mark an event as synced.
 */
export async function markEventSynced(id: number): Promise<void> {
  await mutate(
    `UPDATE sync_queue SET status = 'synced', synced_at = datetime('now','localtime'),
     updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [id]
  );
}

/**
 * Mark an event as failed with an error message.
 */
export async function markEventFailed(id: number, error: string): Promise<void> {
  await mutate(
    `UPDATE sync_queue
     SET status = 'failed',
         last_error = ?,
         retry_count = retry_count + 1,
         updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [error, id]
  );
}

/**
 * Reset a failed event back to pending for retry.
 */
export async function retryEvent(id: number): Promise<void> {
  await mutate(
    `UPDATE sync_queue
     SET status = 'pending_sync',
         last_error = NULL,
         updated_at = datetime('now','localtime')
     WHERE id = ? AND status = 'failed'`,
    [id]
  );
}

/**
 * Retry all failed events.
 */
export async function retryAllFailed(): Promise<void> {
  await mutate(
    `UPDATE sync_queue
     SET status = 'pending_sync',
         last_error = NULL,
         updated_at = datetime('now','localtime')
     WHERE status = 'failed'`
  );
}

/**
 * Clear all synced events (keep failed/pending for safety).
 */
export async function clearSyncedEvents(): Promise<void> {
  await mutate("DELETE FROM sync_queue WHERE status = 'synced'");
}

/**
 * Get total count of all events (including synced).
 */
export async function getTotalCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM sync_queue'
  );
  return rows[0]?.count ?? 0;
}

/**
 * Get the most recent sync timestamp.
 */
export async function getLastSyncTime(): Promise<string | null> {
  const rows = await query<{ synced_at: string }>(
    "SELECT synced_at FROM sync_queue WHERE status = 'synced' ORDER BY synced_at DESC LIMIT 1"
  );
  return rows[0]?.synced_at ?? null;
}

/**
 * Get pending event counts per type.
 */
export async function getPendingCountsByType(): Promise<Record<string, number>> {
  const rows = await query<{ entity_type: string; count: number }>(
    "SELECT entity_type, COUNT(*) as count FROM sync_queue WHERE status IN ('pending_sync', 'syncing', 'failed') GROUP BY entity_type"
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.entity_type] = row.count;
  }
  return result;
}

/**
 * Dismiss (archive) failed events whose last_error matches any of the given patterns.
 * Marks them as 'synced' so they disappear from the failed list.
 * Used to clear old mock/test demo failures before a pilot demo.
 */
export async function dismissFailedEvents(patterns: string[]): Promise<number> {
  if (patterns.length === 0) return 0;

  // Build OR clauses for pattern matching
  const clauses = patterns.map(() => `?`).join(' OR ');
  const rows = await query<SyncQueueRow>(
    `SELECT id FROM sync_queue WHERE status = 'failed' AND (last_error LIKE ${clauses})`,
    patterns.map(p => `%${p}%`)
  );

  if (rows.length === 0) return 0;

  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  await mutate(
    `UPDATE sync_queue SET status = 'synced', synced_at = datetime('now','localtime'), last_error = 'Dismissed (demo cleanup)', updated_at = datetime('now','localtime')
     WHERE id IN (${placeholders})`,
    ids
  );
  return rows.length;
}

/**
 * Mark all events of a given type as synced (skip/unsupported).
 * Used for event types that the backend doesn't yet support (e.g., EOD report sync).
 */
export async function skipEventType(type: SyncQueueEventType): Promise<number> {
  const rows = await query<SyncQueueRow>(
    `SELECT id FROM sync_queue WHERE entity_type = ? AND status IN ('pending_sync', 'syncing', 'failed')`,
    [type]
  );

  if (rows.length === 0) return 0;

  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');

  // Pending/syncing → synced
  await mutate(
    `UPDATE sync_queue SET status = 'synced', synced_at = datetime('now','localtime'),
     last_error = 'Unsupported by backend sync', updated_at = datetime('now','localtime')
     WHERE id IN (${placeholders}) AND status IN ('pending_sync', 'syncing')`,
    ids
  );

  // Failed → synced (for any type, mark as skipped)
  await mutate(
    `UPDATE sync_queue SET status = 'synced', synced_at = datetime('now','localtime'),
     last_error = 'Skipped (unsupported by backend)', updated_at = datetime('now','localtime')
     WHERE id IN (${placeholders}) AND status = 'failed'`,
    ids
  );

  return rows.length;
}
