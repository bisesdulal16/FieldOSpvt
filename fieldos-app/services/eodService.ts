/**
 * FieldOS Nepal — End-of-Day Service
 *
 * Handles EOD report submission: sync queue → audit → server.
 * Note: EOD reports are aggregated from local data, not a single DB row.
 */

import { getConfig } from './apiClient';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import { auditEODSubmitted } from './auditService';
import type {
  CreateEndOfDayReportRequest,
  CreateEndOfDayResponse,
  EndOfDayException,
  ApiResponse,
} from '../types/api';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Submit the end-of-day report: enqueue sync event + audit.
 */
export async function submitEndOfDayReport(
  req: CreateEndOfDayReportRequest,
): Promise<ApiResponse<CreateEndOfDayResponse>> {
  const { enableMock } = getConfig();

  // 1. Enqueue as audit_event for pilot — EOD reports are not synced to /sync/events
  await enqueueSyncEvent('audit_event', {
    date: req.reportDate,
    totalCollections: req.totalCollections,
    totalVisits: req.totalVisits,
    pendingCount: req.pendingCount,
    isConfirmed: req.isConfirmed,
    exceptions: req.exceptions,
  });

  // 2. Audit
  await auditEODSubmitted(
    req.totalCollections,
    req.totalVisits,
    req.isConfirmed,
  );

  // 3. Return immediately
  if (enableMock) {
    await mockDelay(300);
  }

  return {
    success: true,
    data: {
      reportId: Date.now(),
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
