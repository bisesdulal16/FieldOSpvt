/**
 * FieldOS Nepal — KYC Document Service
 *
 * Handles KYC document capture, viewing, and deletion:
 * local persist → sync queue → audit → server.
 */

import { getConfig } from './apiClient';
import {
  getDocumentsByClientId,
  getClientKycSummary,
  createKycDocument,
  deleteDocument,
  type KycDocument,
  type KycDocumentType,
} from '../db/repositories/kycRepo';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import {
  auditKycDocumentCaptured,
  auditKycDocumentViewed,
  auditKycDocumentDeleted,
} from './auditService';
import type {
  UploadKycDocumentRequest,
  UploadKycDocumentResponse,
  ApiResponse,
} from '../types/api';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Capture a KYC document: save locally → sync queue → audit.
 */
export async function captureKycDocument(
  clientId: number,
  params: {
    documentType: KycDocumentType;
    fileUri: string;
    fileName: string;
    fileSize?: number;
    mimeType?: string;
    width?: number;
    height?: number;
    blurScore?: number;
    qualityStatus: string;
  },
): Promise<ApiResponse<UploadKycDocumentResponse>> {
  const { enableMock } = getConfig();

  // 1. Persist locally
  const docId = await createKycDocument({
    clientId,
    documentType: params.documentType,
    fileUri: params.fileUri,
    fileName: params.fileName,
    fileSize: params.fileSize,
    mimeType: params.mimeType,
    width: params.width,
    height: params.height,
    blurScore: params.blurScore,
    qualityStatus: params.qualityStatus as 'clear' | 'blurry' | 'pending_review',
  });

  // 2. Enqueue for sync
  await enqueueSyncEvent('kyc_document', {
    docId,
    clientId,
    documentType: params.documentType,
    fileName: params.fileName,
    capturedAt: new Date().toISOString(),
  });

  // 3. Audit
  await auditKycDocumentCaptured(
    String(clientId),
    params.documentType,
    docId,
  );

  // 4. Return
  if (enableMock) {
    await mockDelay(300);
  }

  return {
    success: true,
    data: {
      documentId: docId,
      serverId: 0,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * View a KYC document (audit the access).
 */
export async function viewKycDocument(doc: KycDocument): Promise<void> {
  await auditKycDocumentViewed(doc.id, doc.documentType);
}

/**
 * Delete a KYC document: local delete → audit.
 */
export async function deleteKycDocumentRecord(
  doc: KycDocument,
): Promise<void> {
  await deleteDocument(doc.id);
  await auditKycDocumentDeleted(doc.id, doc.documentType);
}

/**
 * Get all documents for a client.
 */
export async function getClientDocuments(
  clientId: number,
): Promise<KycDocument[]> {
  return getDocumentsByClientId(clientId);
}

/**
 * Get KYC summary for a client.
 */
export async function getClientKycStatus(
  clientId: number,
): Promise<Record<KycDocumentType, KycDocument | null>> {
  return getClientKycSummary(clientId);
}

// ─── Internal ────────────────────────────────────────────────────

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
