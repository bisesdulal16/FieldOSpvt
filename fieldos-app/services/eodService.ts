/**
 * FieldOS Nepal — End-of-Day Service
 *
 * Handles EOD report submission: sync queue → audit → server.
 * Note: EOD reports are aggregated from local data, not a single DB row.
 */

import { getConfig, getAccessToken } from './apiClient';
import { enqueueSyncEvent, markEventSynced } from '../db/repositories/syncQueueRepo';
import { auditEODSubmitted } from './auditService';
import { getCurrentUser } from './authService';
import type {
  CreateEndOfDayReportRequest,
  CreateEndOfDayResponse,
  EndOfDayException,
  ApiResponse,
} from '../types/api';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Submit the end-of-day report: queue as a real EOD entity + best-effort
 * direct POST so it appears on the manager dashboard immediately.
 */
export async function submitEndOfDayReport(
  req: CreateEndOfDayReportRequest,
): Promise<ApiResponse<CreateEndOfDayResponse>> {
  const { enableMock } = getConfig();
  const user = await getCurrentUser();
  const officerId = user?.id ?? null;

  // 1. Queue as a real end-of-day report (maps to backend "eod"), not an audit event.
  const queueEventId = await enqueueSyncEvent('end_of_day_report', {
    reportDate: req.reportDate,
    officerId,
    totalCollections: req.totalCollections,
    totalVisits: req.totalVisits,
    pendingCount: req.pendingCount,
    isConfirmed: req.isConfirmed,
    isSubmitted: true,
    exceptionsJson: req.exceptions ? JSON.stringify(req.exceptions) : null,
  });

  // 2. Audit
  await auditEODSubmitted(req.totalCollections, req.totalVisits, req.isConfirmed);

  // 3. Best-effort direct sync so the EOD shows on the dashboard now.
  if (!enableMock) {
    const synced = await trySyncEodToServer({ ...req, officerId });
    if (synced) { try { await markEventSynced(queueEventId); } catch { /* keep queued */ } }
  } else {
    await mockDelay(300);
  }

  return {
    success: true,
    data: { reportId: Date.now(), serverId: 0, timestamp: new Date().toISOString() },
    timestamp: new Date().toISOString(),
  };
}

// ─── Internal ────────────────────────────────────────────────────

async function trySyncEodToServer(
  req: CreateEndOfDayReportRequest & { officerId: number | null },
): Promise<boolean> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${apiUrl}/end-of-day/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        report_date: req.reportDate,
        officer_id: req.officerId,
        total_collections: req.totalCollections,
        total_visits: req.totalVisits,
        pending_count: req.pendingCount,
        face_verified: req.faceVerified ?? false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
