import { query, mutate } from '../database';
import type {
  AuditEvent,
  AuditActionType,
  AuditSyncStatus,
  AuditRole,
  AuditVerificationStatus,
} from '../../types';

/**
 * Audit Repository — Phase 3: Cybersecurity-first accountability.
 *
 * Provides full CRUD operations for the audit_events table.
 * Every sensitive action in the app should create an audit event.
 */

// ─── ID Generation ────────────────────────────────────────────────

function generateAuditId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `AUD-${ts}-${rand}`;
}

// ─── Create ───────────────────────────────────────────────────────

export interface CreateAuditParams {
  userId: string;
  role?: AuditRole;
  branchId?: string;
  deviceId?: string;
  actionType: AuditActionType;
  entityType?: string;
  entityId?: string;
  verificationStatus?: AuditVerificationStatus;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new audit event.
 * Uses sensible defaults for userId, role, branchId, deviceId.
 */
export async function createAuditEvent(params: CreateAuditParams): Promise<string> {
  const id = generateAuditId();
  const now = new Date().toISOString();

  await mutate(
    `INSERT INTO audit_events (id, user_id, role, branch_id, device_id, action_type, entity_type, entity_id, timestamp, sync_status, verification_status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.userId || 'FO-208',
      params.role || 'field_officer',
      params.branchId || 'BR-KTW-001',
      params.deviceId || 'DEV-DEFAULT',
      params.actionType,
      params.entityType || null,
      params.entityId || null,
      now,
      'local',
      params.verificationStatus || 'not_required',
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]
  );

  return id;
}

// ─── Read ─────────────────────────────────────────────────────────

/** Get all audit events, newest first */
export async function getAllAuditEvents(limit = 100): Promise<AuditEvent[]> {
  const rows = await query(
    'SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ?',
    [limit]
  );
  return rows.map(rowToAuditEvent);
}

/** Get audit events for today */
export async function getTodayAuditEvents(): Promise<AuditEvent[]> {
  const rows = await query(
    `SELECT * FROM audit_events
     WHERE date(timestamp) = date('now','localtime')
     ORDER BY timestamp DESC`,
  );
  return rows.map(rowToAuditEvent);
}

/** Get audit events by action type */
export async function getAuditEventsByAction(actionType: AuditActionType): Promise<AuditEvent[]> {
  const rows = await query(
    'SELECT * FROM audit_events WHERE action_type = ? ORDER BY timestamp DESC',
    [actionType]
  );
  return rows.map(rowToAuditEvent);
}

/** Get audit events by date (YYYY-MM-DD) */
export async function getAuditEventsByDate(date: string): Promise<AuditEvent[]> {
  const rows = await query(
    `SELECT * FROM audit_events
     WHERE date(timestamp) = date(?)
     ORDER BY timestamp DESC`,
    [date]
  );
  return rows.map(rowToAuditEvent);
}

/** Get audit events by sync status */
export async function getAuditEventsBySyncStatus(syncStatus: AuditSyncStatus): Promise<AuditEvent[]> {
  const rows = await query(
    'SELECT * FROM audit_events WHERE sync_status = ? ORDER BY timestamp DESC',
    [syncStatus]
  );
  return rows.map(rowToAuditEvent);
}

/** Get audit events with optional filters */
export interface AuditFilterParams {
  actionType?: AuditActionType;
  syncStatus?: AuditSyncStatus;
  verificationStatus?: AuditVerificationStatus;
  dateFrom?: string;
  dateTo?: string;
  entityType?: string;
  limit?: number;
  offset?: number;
}

export async function getFilteredAuditEvents(filters: AuditFilterParams): Promise<AuditEvent[]> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters.actionType) {
    conditions.push('action_type = ?');
    values.push(filters.actionType);
  }
  if (filters.syncStatus) {
    conditions.push('sync_status = ?');
    values.push(filters.syncStatus);
  }
  if (filters.verificationStatus) {
    conditions.push('verification_status = ?');
    values.push(filters.verificationStatus);
  }
  if (filters.dateFrom) {
    conditions.push("date(timestamp) >= date(?)");
    values.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push("date(timestamp) <= date(?)");
    values.push(filters.dateTo);
  }
  if (filters.entityType) {
    conditions.push('entity_type = ?');
    values.push(filters.entityType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const rows = await query(
    `SELECT * FROM audit_events ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );
  return rows.map(rowToAuditEvent);
}

// ─── Update ───────────────────────────────────────────────────────

/** Mark audit event as synced */
export async function markAuditSynced(id: string): Promise<void> {
  await mutate(
    "UPDATE audit_events SET sync_status = 'synced', updated_at = datetime('now','localtime') WHERE id = ?",
    [id]
  );
}

/** Mark all local audit events as synced */
export async function markAllAuditsSynced(): Promise<number> {
  const result = await mutate(
    "UPDATE audit_events SET sync_status = 'synced' WHERE sync_status = 'local'",
  );
  return result.changes;
}

/** Mark audit events for sync queue (update sync_status to 'local' from any stale state) */
export async function resetAuditSyncStatus(): Promise<number> {
  const result = await mutate(
    "UPDATE audit_events SET sync_status = 'local' WHERE sync_status != 'local' AND sync_status != 'synced'",
  );
  return result.changes;
}

// ─── Delete ───────────────────────────────────────────────────────

/** Delete audit events older than N days */
export async function deleteAuditEventsOlderThan(days: number): Promise<number> {
  const result = await mutate(
    `DELETE FROM audit_events WHERE timestamp < datetime('now', ? || ' days', 'localtime')`,
    [String(-days)]
  );
  return result.changes;
}

// ─── Counts ───────────────────────────────────────────────────────

/** Get total audit event count */
export async function getAuditCount(): Promise<number> {
  const row = await query<{ count: number }>('SELECT COUNT(*) as count FROM audit_events');
  return row[0]?.count ?? 0;
}

/** Get count by action type */
export async function getAuditCountByAction(): Promise<Record<string, number>> {
  const rows = await query<{ action_type: string; count: number }>(
    'SELECT action_type, COUNT(*) as count FROM audit_events GROUP BY action_type ORDER BY count DESC'
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.action_type] = row.count;
  }
  return result;
}

/** Get count of local (unsynced) events */
export async function getLocalAuditCount(): Promise<number> {
  const row = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM audit_events WHERE sync_status = 'local'"
  );
  return row[0]?.count ?? 0;
}

// ─── Legacy compatibility (deprecated — kept for smooth migration) ─

/** @deprecated Use createAuditEvent instead */
export async function logEvent(
  eventType: string,
  actor: string,
  entityType?: string,
  entityId?: number,
  details?: any
): Promise<string> {
  return createAuditEvent({
    userId: actor,
    actionType: eventType as AuditActionType,
    entityType,
    entityId: entityId !== undefined ? String(entityId) : undefined,
    metadata: details,
  });
}

/** @deprecated Use getTodayAuditEvents or getFilteredAuditEvents instead */
export async function getRecentEvents(limit: number): Promise<any[]> {
  return query(
    'SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ?',
    [limit]
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function rowToAuditEvent(row: any): AuditEvent {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role as AuditRole,
    branchId: row.branch_id,
    deviceId: row.device_id,
    actionType: row.action_type as AuditActionType,
    entityType: row.entity_type || undefined,
    entityId: row.entity_id || undefined,
    timestamp: row.timestamp,
    syncStatus: row.sync_status as AuditSyncStatus,
    verificationStatus: (row.verification_status || 'not_required') as AuditVerificationStatus,
    metadata: row.metadata || undefined,
  };
}
