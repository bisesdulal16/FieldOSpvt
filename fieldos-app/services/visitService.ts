/**
 * FieldOS Nepal — Visit Check-in Service
 *
 * Handles visit check-in creation: local persist → sync queue → audit → server.
 */

import { getConfig } from './apiClient';
import { insertAndGetId } from '../db/database';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
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
  await enqueueSyncEvent('visit_checkin', {
    visitId: checkinId,
    clientId: req.clientId,
    taskId: req.taskId,
    officerId: user?.id || null,
    visitPurpose: req.visitPurpose,
    gpsLatitude: req.gpsLatitude ?? null,
    gpsLongitude: req.gpsLongitude ?? null,
    gpsAccuracyMeters: req.gpsAccuracyMeters ?? null,
    gpsAddress: req.gpsAddress ?? null,
    checkedInAt: new Date().toISOString(),
  }, checkinId);

  // 3. Audit
  await auditVisitCheckin(String(req.clientId), req.visitPurpose);

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

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
