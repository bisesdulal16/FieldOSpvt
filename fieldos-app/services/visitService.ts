/**
 * FieldOS Nepal — Visit Check-in Service
 *
 * Handles visit check-in creation: local persist → sync queue → audit → server.
 */

import { getConfig, getAccessToken } from './apiClient';
import { insertAndGetId } from '../db/database';
import { enqueueSyncEvent, markEventSynced } from '../db/repositories/syncQueueRepo';
import { auditVisitCheckin } from './auditService';
import { getCurrentUser } from './authService';
import type {
  CreateVisitCheckinRequest,
  VisitCheckinResponse,
  ApiResponse,
} from '../types/api';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Record a visit check-in locally and queue for sync.
 */
export async function recordVisitCheckin(
  req: CreateVisitCheckinRequest,
): Promise<ApiResponse<VisitCheckinResponse>> {
  const { enableMock } = getConfig();

  // 1. Always persist locally first (offline-first)
  const checkinId = await insertAndGetId(
    `INSERT INTO visit_checkins (client_id, visit_purpose, task_id, gps_latitude, gps_longitude, gps_accuracy, gps_address, checked_in_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
    [
      req.clientId,
      req.visitPurpose,
      req.taskId ?? null,
      req.gpsLatitude ?? null,
      req.gpsLongitude ?? null,
      req.gpsAccuracyMeters ?? null,
      req.gpsAddress ?? null,
    ],
  );

  // 2. Enqueue for sync — use flat, backend-shaped keys. The backend reads
  // visit_purpose / gps_* / checked_in_at; without checked_in_at the visit
  // syncs with a NULL date and is filtered out of the dashboard's today view.
  const user = await getCurrentUser();
  const checkedInAt = new Date().toISOString();
  const queueEventId = await enqueueSyncEvent('visit_checkin', {
    visitId: checkinId,
    clientId: req.clientId,
    taskId: req.taskId,
    officerId: user?.id || null,
    visitPurpose: req.visitPurpose,
    gpsLatitude: req.gpsLatitude ?? null,
    gpsLongitude: req.gpsLongitude ?? null,
    gpsAccuracyMeters: req.gpsAccuracyMeters ?? null,
    gpsAddress: req.gpsAddress ?? null,
    checkedInAt,
  }, checkinId);

  // 3. Audit
  await auditVisitCheckin(String(req.clientId), req.visitPurpose);

  // 3b. Best-effort direct sync so the visit shows on the manager dashboard
  // immediately (like collections), not only after a queue flush. On failure
  // it stays queued and retries.
  if (!enableMock) {
    const synced = await trySyncVisitToServer({ ...req, officerId: user?.id ?? null, checkedInAt });
    if (synced) {
      try { await markEventSynced(queueEventId); } catch { /* keep queued */ }
    }
  }

  // 4. Return immediately (offline-first)
  if (enableMock) {
    await mockDelay(300);
  }

  return {
    success: true,
    data: {
      checkinId,
      serverId: 0,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── Internal ────────────────────────────────────────────────────

async function trySyncVisitToServer(
  req: CreateVisitCheckinRequest & { officerId: number | null; checkedInAt: string },
): Promise<boolean> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${apiUrl}/visit-checkins/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        client_id: req.clientId,
        task_id: req.taskId,
        officer_id: req.officerId,
        visit_purpose: req.visitPurpose,
        gps_latitude: req.gpsLatitude,
        gps_longitude: req.gpsLongitude,
        gps_address: req.gpsAddress,
        gps_accuracy_meters: req.gpsAccuracyMeters,
        checked_in_at: req.checkedInAt,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false; // stays queued, retries on next sync
  }
}

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
