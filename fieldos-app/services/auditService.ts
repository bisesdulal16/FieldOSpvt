/**
 * Audit Service — Phase 3: Centralized audit logging.
 *
 * Provides a single `audit()` function that:
 *   1. Creates a local audit_event in SQLite
 *   2. Enqueues a sync queue event so the audit log gets synced
 *
 * Usage:
 *   import { audit } from '../services/auditService';
 *   await audit('login', { method: 'pin' });
 */

import { createAuditEvent, getLocalAuditCount, markAllAuditsSynced } from '../db/repositories/auditRepo';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import type { AuditActionType, AuditVerificationStatus } from '../types';

// ─── Context (resolved at runtime from store / platform) ──────────

let _userId = 'FO-208';
let _deviceId = 'DEV-DEFAULT';
let _branchId = 'BR-KTW-001';

export function setAuditContext(ctx: { userId?: string; deviceId?: string; branchId?: string }): void {
  if (ctx.userId) _userId = ctx.userId;
  if (ctx.deviceId) _deviceId = ctx.deviceId;
  if (ctx.branchId) _branchId = ctx.branchId;
}

// ─── Core Audit Function ─────────────────────────────────────────

export interface AuditParams {
  /** Optional entity the action relates to (e.g. 'client', 'collection', 'meeting') */
  entityType?: string;
  /** Optional entity ID */
  entityId?: string;
  /** Optional verification status (auto-set from config if not provided) */
  verificationStatus?: AuditVerificationStatus;
  /** Additional data to store as JSON metadata */
  metadata?: Record<string, unknown>;
  /**
   * If true, only creates a local audit record — does NOT enqueue a sync event.
   * Use this for meta-audit events (sync attempted, sync failed) to avoid
   * creating recursive sync queue entries.
   */
  localOnly?: boolean;
}

/**
 * Log an audit event for a sensitive action.
 *
 * This is the single entry point for all audit logging.
 * It creates a local audit_event AND enqueues a sync event.
 *
 * @param actionType - The type of action being audited
 * @param params - Optional metadata and entity info
 * @returns The audit event ID (string)
 */
export async function audit(
  actionType: AuditActionType,
  params?: AuditParams
): Promise<string> {
  try {
    const auditId = await createAuditEvent({
      userId: _userId,
      role: 'field_officer',
      branchId: _branchId,
      deviceId: _deviceId,
      actionType,
      entityType: params?.entityType,
      entityId: params?.entityId,
      verificationStatus: params?.verificationStatus,
      metadata: params?.metadata,
    });

    // Also enqueue for sync (unless localOnly)
    if (!params?.localOnly) {
      await enqueueSyncEvent('audit_event', {
        auditId,
        actionType,
        userId: _userId,
        timestamp: new Date().toISOString(),
        metadata: params?.metadata,
      });
    }

    return auditId;
  } catch (err) {
    // Audit must never crash the app — silent fail with console warning
    console.warn(`[Audit] Failed to log ${actionType}:`, err);
    return '';
  }
}

// ─── Convenience Helpers ─────────────────────────────────────────

/** Audit a login action */
export async function auditLogin(method: 'pin' | 'biometric'): Promise<string> {
  return audit(method === 'biometric' ? 'biometric_login' : 'login', {
    metadata: { method },
    verificationStatus: method === 'biometric' ? 'verified' : 'not_required',
  });
}

/** Audit a start-day action */
export async function auditStartDay(time: string): Promise<string> {
  return audit('start_day', { metadata: { time } });
}

/** Audit face verification result */
export async function auditFaceVerification(
  context: string,
  success: boolean
): Promise<string> {
  return audit(
    success ? 'face_verification_success' : 'face_verification_failure',
    {
      entityType: 'session',
      verificationStatus: success ? 'verified' : 'failed',
      metadata: { context },
    }
  );
}

/** Audit visit check-in */
export async function auditVisitCheckin(clientId: string, purpose: string): Promise<string> {
  return audit('visit_checkin', {
    entityType: 'client',
    entityId: clientId,
    metadata: { purpose, gps: { lat: 27.7103, lng: 83.4567 } },
  });
}

/** Audit collection recorded */
export async function auditCollectionRecorded(
  collectionId: number,
  receiptId: string,
  amount: number,
  method: string
): Promise<string> {
  return audit('collection_recorded', {
    entityType: 'collection',
    entityId: String(collectionId),
    metadata: { receiptId, amount, method },
  });
}

/** Audit collection edited */
export async function auditCollectionEdited(
  collectionId: number,
  receiptId: string
): Promise<string> {
  return audit('collection_edited', {
    entityType: 'collection',
    entityId: String(collectionId),
    metadata: { receiptId },
  });
}

/** Audit receipt created */
export async function auditReceiptCreated(receiptId: string, amount: number): Promise<string> {
  return audit('receipt_created', {
    entityType: 'receipt',
    entityId: receiptId,
    metadata: { amount },
  });
}

/** Audit promise-to-pay created */
export async function auditPromiseToPayCreated(
  clientId: string,
  amount: number,
  reason: string
): Promise<string> {
  return audit('promise_to_pay_created', {
    entityType: 'promise_to_pay',
    entityId: clientId,
    metadata: { amount, reason },
  });
}

/** Audit center meeting completed */
export async function auditMeetingCompleted(
  centerId: string,
  presentCount: number,
  paidCount: number,
  totalCount: number
): Promise<string> {
  return audit('center_meeting_completed', {
    entityType: 'center_meeting',
    entityId: centerId,
    metadata: { presentCount, paidCount, totalCount },
  });
}

/** Audit end-of-day submitted */
export async function auditEODSubmitted(
  collections: number,
  visits: number,
  confirmed: boolean
): Promise<string> {
  return audit('end_of_day_submitted', {
    entityType: 'report',
    metadata: { collections, visits, confirmed },
  });
}

/** Audit sync attempt (local only — avoids recursive sync queue entries) */
export async function auditSyncAttempted(
  synced: number,
  failed: number
): Promise<string> {
  return audit('sync_attempted', {
    entityType: 'sync_queue',
    metadata: { synced, failed },
    localOnly: true,
  });
}

/** Audit sync failure (local only — avoids recursive sync queue entries) */
export async function auditSyncFailed(
  synced: number,
  failed: number,
  errors: string[]
): Promise<string> {
  return audit('sync_failed', {
    entityType: 'sync_queue',
    metadata: { synced, failed, errors },
    localOnly: true,
  });
}

/** Audit secure logout */
export async function auditLogout(): Promise<string> {
  return audit('secure_logout');
}

/** Audit KYC document captured */
export async function auditKycDocumentCaptured(
  clientId: string,
  documentType: string,
  docId: number
): Promise<string> {
  return audit('kyc_document_captured', {
    entityType: 'kyc_document',
    entityId: String(docId),
    metadata: { clientId, documentType },
  });
}

/** Audit KYC document viewed */
export async function auditKycDocumentViewed(
  docId: number,
  documentType: string
): Promise<string> {
  return audit('kyc_document_viewed', {
    entityType: 'kyc_document',
    entityId: String(docId),
    metadata: { documentType },
  });
}

/** Audit KYC document deleted */
export async function auditKycDocumentDeleted(
  docId: number,
  documentType: string
): Promise<string> {
  return audit('kyc_document_deleted', {
    entityType: 'kyc_document',
    entityId: String(docId),
    metadata: { documentType },
  });
}

/** Audit PIN changed */
export async function auditPinChanged(): Promise<string> {
  return audit('pin_changed', {
    entityType: 'security',
    metadata: { action: 'pin_changed' },
  });
}

/** Audit security setting changed */
export async function auditSecuritySettingChanged(
  setting: string,
  oldValue: string | boolean,
  newValue: string | boolean
): Promise<string> {
  return audit('security_setting_changed', {
    entityType: 'security',
    metadata: { setting, oldValue: String(oldValue), newValue: String(newValue) },
  });
}

/** Audit consent changed */
export async function auditConsentChanged(
  consentType: string,
  status: string
): Promise<string> {
  return audit('consent_changed', {
    entityType: 'consent',
    metadata: { consentType, status },
  });
}

// ─── Pilot Readiness Helpers ──────────────────────────────────────

/** Audit pilot info viewed */
export async function auditPilotInfoViewed(): Promise<string> {
  return audit('pilot_info_viewed', {
    entityType: 'pilot',
    metadata: { screen: 'pilot_info' },
  });
}

/** Audit pilot feedback submitted */
export async function auditFeedbackSubmitted(
  averageRating: number,
  wouldRecommend: string
): Promise<string> {
  return audit('feedback_submitted', {
    entityType: 'feedback',
    metadata: { averageRating, wouldRecommend },
  });
}

// ─── Sync Helpers ─────────────────────────────────────────────────

/** Get count of unsynced audit events */
export async function getUnsyncedAuditCount(): Promise<number> {
  return getLocalAuditCount();
}

/** Mark all audit events as synced (called after successful sync) */
export async function syncAllAudits(): Promise<number> {
  const count = await markAllAuditsSynced();
  return count;
}
