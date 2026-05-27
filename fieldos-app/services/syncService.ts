/**
 * FieldOS Nepal — Sync Service (Refactored for Phase 9)
 *
 * Handles sync operations — pushing local events to the server
 * and pulling server updates.
 *
 * When EXPO_PUBLIC_ENABLE_MOCK_SYNC=true, simulates sync with delays.
 * When disabled, sends real API requests to the backend.
 */

import { getConfig } from './apiClient';
import { getPendingEvents, markEventSyncing, markEventSynced, markEventFailed, getPendingCount } from '../db/repositories/syncQueueRepo';
import { markAllAuditsSynced } from '../db/repositories/auditRepo';
import { setSetting } from '../db/repositories/settingsRepo';
import { getCollectionByReceiptId } from '../db/repositories/collectionsRepo';
import type { SyncQueueEvent, SyncQueueEventType } from '../db/repositories/syncQueueRepo';
import type { SyncEventsResponse, SyncStatusResponse } from '../types/api';

// ─── Config ──────────────────────────────────────────────────────

let _forceNextFailure = false;
let _failureRate = 0; // 0-1

export function setForceNextFailure(force: boolean): void {
  _forceNextFailure = force;
}

export function setFailureRate(rate: number): void {
  _failureRate = Math.max(0, Math.min(1, rate));
}

// ─── Mock Helpers ────────────────────────────────────────────────

function mockDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldFail(): boolean {
  if (_forceNextFailure) {
    _forceNextFailure = false;
    return true;
  }
  return Math.random() < _failureRate;
}

// ─── Sync Event Mapping ─────────────────────────────────────────

interface LocalSyncPayload {
  entityType: string;
  operation: string;
  localId: number;
  data: Record<string, unknown>;
  timestamp: string;
}

function mapEventToPayload(event: SyncQueueEvent): LocalSyncPayload {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(event.payload);
  } catch {
    data = {};
  }

  // Normalize camelCase keys → snake_case for backend
  let normalizedData: Record<string, unknown> = { ...data };

  // Top-level key mapping
  const keyMap: Record<string, string> = {
    entityType: 'entity_type',
    localId: 'entity_id',
    clientId: 'client_id',
    taskId: 'task_id',
    officerId: 'officer_id',
    paymentMethod: 'payment_method',
    receiptId: 'receipt_id',
    isHighValue: 'is_high_value',
    faceVerified: 'face_verified',
    gpsLatitude: 'gps_latitude',
    gpsLongitude: 'gps_longitude',
    dueAmount: 'due_amount',
    outstandingAfter: 'outstanding_after',
  };
  normalizedData = Object.fromEntries(
    Object.entries(normalizedData).map(([k, v]) => [keyMap[k] || k, v]),
  );

  return {
    entityType: event.type,
    operation: 'create',
    localId: event.id,
    data: normalizedData,
    timestamp: event.createdAt,
  };
}

// ─── Backend payload (snake_case) ────────────────────────────────

interface BackendSyncEvent {
  entity_type: string;
  entity_id: string;
  operation: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

function mapEventToBackendPayload(event: SyncQueueEvent): BackendSyncEvent {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(event.payload);
  } catch {
    data = {};
  }

  // Strip non-backend keys (local-only shape)
  const { entityType, localId, ...rest } = data as Record<string, unknown> & { entityType?: unknown; localId?: unknown };
  let normalizedData: Record<string, unknown> = { ...rest };

  const keyMap: Record<string, string> = {
    clientId: 'client_id',
    taskId: 'task_id',
    officerId: 'officer_id',
    paymentMethod: 'payment_method',
    receiptId: 'receipt_id',
    isHighValue: 'is_high_value',
    faceVerified: 'face_verified',
    gpsLatitude: 'gps_latitude',
    gpsLongitude: 'gps_longitude',
    dueAmount: 'due_amount',
    outstandingAfter: 'outstanding_after',
  };
  normalizedData = Object.fromEntries(
    Object.entries(normalizedData).map(([k, v]) => [keyMap[k] || k, v]),
  );

  return {
    entity_type: event.type ?? event.entity_type ?? 'audit_event',
    entity_id: String(event.id),
    operation: event.operation ?? 'create',
    data: normalizedData,
    timestamp: event.createdAt,
  };
}

// ─── Core Sync Functions ─────────────────────────────────────────

/**
 * Run a full sync cycle — push all pending events to the server.
 */
export async function runSync(): Promise<SyncEventsResponse> {
  const { enableMock } = getConfig();
  const events = await getPendingEvents();

  if (events.length === 0) {
    const timestamp = new Date().toISOString();
    await setSetting('last_sync_at', timestamp, 'string');
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      serverTimestamp: timestamp,
    };
  }

  if (enableMock) {
    return runMockSync(events);
  }

  return runRealSync(events);
}

/**
 * Mock sync — simulates server processing with delays and optional failures.
 */
async function runMockSync(events: SyncQueueEvent[]): Promise<SyncEventsResponse> {
  let succeeded = 0;
  let failed = 0;
  const results: Array<{ localId: number; success: boolean; serverId?: number; error?: string }> = [];

  for (const event of events) {
    await markEventSyncing(event.id);
    await mockDelay(150 + Math.random() * 200); // 150-350ms per event

    if (shouldFail()) {
      await markEventFailed(event.id, 'Mock server error');
      failed++;
      results.push({ localId: event.id, success: false, error: 'Server error' });
    } else {
      await markEventSynced(event.id);
      succeeded++;
      results.push({ localId: event.id, success: true, serverId: Math.floor(Math.random() * 100000) });
    }
  }

  // Update local state
  await markAllAuditsSynced();
  const timestamp = new Date().toISOString();
  await setSetting('last_sync_at', timestamp, 'string');

  // Note: Audit is handled by the store layer (triggerSync/triggerRetrySync)
  // to avoid creating recursive sync queue entries from within the sync service.

  return {
    processed: events.length,
    succeeded,
    failed,
    results,
    serverTimestamp: timestamp,
  };
}

/**
 * Check if a collection with the given receipt_id already exists locally.
 */
async function collectionReceiptExists(receiptId: string): Promise<boolean> {
  const existing = await getCollectionByReceiptId(receiptId);
  return existing !== null;
}

/**
 * Real sync — sends events to the backend API.
 */
async function runRealSync(events: SyncQueueEvent[]): Promise<SyncEventsResponse> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  const { getAccessToken } = require('./apiClient');
  const token = getAccessToken();


  // Collect all pending events — do NOT filter out collections with local receipts
  // Local receipt existence does NOT mean backend has the collection
  const pendingCollections: SyncQueueEvent[] = [];
  for (const event of events) {
    if (event.type === 'collection') {
      console.log('[Sync Real] collection backend payload:', JSON.stringify(mapEventToBackendPayload(event), null, 2));
    }
    pendingCollections.push(event);
  }

  if (pendingCollections.length === 0) {
    const timestamp = new Date().toISOString();
    await setSetting('last_sync_at', timestamp, 'string');
    return { processed: 0, succeeded: 0, failed: 0, results: [], serverTimestamp: timestamp };
  }

  const backendEvents = pendingCollections.map(mapEventToBackendPayload);

  // Temp debug — verify payload shape before sending
  if (backendEvents.length > 0) {
    console.log('[Sync Real] first backend event payload:', JSON.stringify(backendEvents[0], null, 2));
  }

  try {
    const response = await fetch(`${apiUrl}/sync/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ events: backendEvents }),
    });

    const responseText = await response.text();

    if (response.status === 409) {
      // Unique constraint violation — collection already exists on server
      console.warn('[Sync Real] 409 conflict on sync, marking collection events as synced');
      for (const event of pendingCollections) {
        if (event.type === 'collection') {
          await markEventSynced(event.id);
        } else {
          await markEventFailed(event.id, 'Conflict (409)');
        }
      }
      const timestamp = new Date().toISOString();
      await setSetting('last_sync_at', timestamp, 'string');
      return { processed: pendingCollections.length, succeeded: 0, failed: 0, results: [], serverTimestamp: timestamp };
    }

    if (response.ok) {
      const data = JSON.parse(responseText);

      if (data.success) {
        const resultsArr = data.data?.results ?? [];
        const succeeded = resultsArr.filter((r: { status?: string }) => r.status === 'completed' || r.status === 'synced').length;
        const failed = resultsArr.filter((r: { status?: string }) => r.status === 'failed').length;

        for (const result of resultsArr) {
          if (!result || !result.entity_id) {
            console.warn('[Sync Real] skipping invalid result:', result);
            continue;
          }

          const localId = Number(result.entity_id);
          if (isNaN(localId)) {
            console.warn('[Sync Real] skipping result with invalid entity_id:', result);
            continue;
          }

          const entityType = result.entity_type || 'unknown';
          const isCompleted = result.status === 'completed' || result.status === 'synced';

          if (isCompleted) {
            await markEventSynced(localId);
          } else {
            const errorMsg = result.error || 'Sync failed';
            console.warn('[Sync Real] marked failed entity:', { entityType, entityId: localId, error: errorMsg });
            await markEventFailed(localId, errorMsg);
          }
        }

        await markAllAuditsSynced();
        const timestamp = data.data?.serverTimestamp ?? new Date().toISOString();
        await setSetting('last_sync_at', timestamp, 'string');


        return {
          processed: resultsArr.length,
          succeeded,
          failed,
          results: [],
          serverTimestamp: timestamp,
        };
      }

      // Server returned error response
      console.warn('[Sync Real] Backend error:', data.error?.message || 'Unknown server error');
      for (const event of pendingCollections) {
        await markEventFailed(event.id, data.error?.message || 'Server error');
      }
      return { processed: pendingCollections.length, succeeded: 0, failed: pendingCollections.length, results: [], serverTimestamp: new Date().toISOString() };
    }

    // Network/HTTP error — don't mark as failed, they'll retry
    console.warn('[Sync Real] Network/HTTP error (will retry):', response.status, responseText?.substring(0, 200));
    return { processed: 0, succeeded: 0, failed: 0, results: [], serverTimestamp: new Date().toISOString() };
  } catch (err) {
    // Network error — don't mark as failed, they'll retry
    console.warn('[Sync Real] Network exception (will retry):', err);
    return { processed: 0, succeeded: 0, failed: 0, results: [], serverTimestamp: new Date().toISOString() };
  }
}

/**
 * Retry all failed sync events — resets them to pending, then runs a full sync.
 */
export async function retryFailedAndSync(): Promise<SyncEventsResponse> {
  const { retryAllFailed } = require('../db/repositories/syncQueueRepo');
  await retryAllFailed();
  return runSync();
}

/**
 * Get current sync status (pending count + last sync time).
 */
export async function loadSyncState(): Promise<{
  pendingCount: number;
  lastSyncAt: string | null;
  isOnline: boolean;
}> {
  const pendingCount = await getPendingCount();

  // Check last sync from settings
  const { getSetting } = require('../db/repositories/settingsRepo');
  const lastSyncAt = await getSetting('last_sync_at') || null;

  return {
    pendingCount,
    lastSyncAt,
    isOnline: true, // Could check NetInfo here
  };
}

/**
 * Format last sync time for display.
 */
export function formatLastSyncTime(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Never';
  try {
    const date = new Date(lastSyncAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  } catch {
    return 'Unknown';
  }
}

/**
 * Get pending sync counts grouped by event type.
 */
export async function getPendingCountsByType(): Promise<Record<string, number>> {
  const { getPendingCountsByType } = require('../db/repositories/syncQueueRepo');
  return getPendingCountsByType();
}

// ─── Utility: Save/Load sync status to settings ─────────────────

export async function saveSyncStatus(status: {
  pendingCount: number;
  lastSyncAt?: string;
}): Promise<void> {
  if (status.lastSyncAt) {
    await setSetting('last_sync_at', status.lastSyncAt, 'string');
  }
}

export async function loadSyncStatus(): Promise<{
  pendingCount: number;
  lastSyncAt: string | null;
}> {
  const state = await loadSyncState();
  return {
    pendingCount: state.pendingCount,
    lastSyncAt: state.lastSyncAt,
  };
}

// ─── Demo Cleanup ─────────────────────────────────────

/**
 * Dismiss (archive) old mock/test failed sync events.
 * Returns count of dismissed events.
 */
export async function cleanupMockFailures(): Promise<number> {
  const { dismissFailedEvents } = require('../db/repositories/syncQueueRepo');
  // Match mock/test error patterns
  return dismissFailedEvents([
    'Simulated server error',
    'connection timeout',
    'Mock server error',
    'Test: Force Failed Sync',
    'Server error',
  ]);
}

/**
 * Skip events of a type that the backend doesn't support.
 * Returns count of skipped events.
 */
export async function skipUnsupportedEvents(type: 'end_of_day_report'): Promise<number> {
  const { skipEventType } = require('../db/repositories/syncQueueRepo');
  return skipEventType(type);
}

/**
 * Full pilot-ready cleanup: dismiss mock failures + skip unsupported types.
 * Call this before a pilot demo to clear test artifacts.
 */
export async function cleanupForDemo(): Promise<{ dismissed: number; skipped: number }> {
  const dismissed = await cleanupMockFailures();
  const skipped = await skipUnsupportedEvents('end_of_day_report');
  return { dismissed, skipped };
}
