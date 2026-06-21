/**
 * FieldOS Nepal — Promise-to-Pay Service
 *
 * Handles promise-to-pay creation: local persist → sync queue → audit → server.
 */

import { getConfig, getAccessToken } from './apiClient';
import { createPromise } from '../db/repositories/promiseToPayRepo';
import { enqueueSyncEvent, markEventSynced } from '../db/repositories/syncQueueRepo';
import { auditPromiseToPayCreated } from './auditService';
import type {
  CreatePromiseToPayRequest,
  CreatePromiseToPayResponse,
  ApiResponse,
} from '../types/api';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Record a promise-to-pay locally and queue for sync.
 */
export async function recordPromiseToPay(
  req: CreatePromiseToPayRequest,
): Promise<ApiResponse<CreatePromiseToPayResponse>> {
  const { enableMock } = getConfig();

  // 1. Always persist locally first (offline-first)
  const ptpId = await createPromise({
    client_id: req.clientId,
    task_id: undefined,
    promised_amount: req.promisedAmount,
    expected_payment_date: req.expectedPaymentDate,
    reason: req.reason,
    outstanding_amount: req.outstandingAmount,
  });

  // 2. Enqueue for sync — keys map to the backend's snake_case promise fields
  // (the backend promise handler has no camelCase fallback).
  const queueEventId = await enqueueSyncEvent('promise_to_pay', {
    promiseId: ptpId,
    clientId: req.clientId,
    promisedAmount: req.promisedAmount,
    reason: req.reason,
    expectedPaymentDate: req.expectedPaymentDate,
    outstandingAmount: req.outstandingAmount,
  }, ptpId);

  // 3. Audit
  await auditPromiseToPayCreated(String(req.clientId), req.promisedAmount, req.reason);

  // 3b. Best-effort direct sync so the PTP reaches the dashboard immediately.
  if (!enableMock) {
    const synced = await trySyncPtpToServer(req);
    if (synced) { try { await markEventSynced(queueEventId); } catch { /* keep queued */ } }
  }

  // 4. Return immediately
  if (enableMock) {
    await mockDelay(300);
  }

  return {
    success: true,
    data: {
      promiseId: ptpId,
      serverId: 0,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── Internal ────────────────────────────────────────────────────

async function trySyncPtpToServer(req: CreatePromiseToPayRequest): Promise<boolean> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${apiUrl}/promise-to-pay/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        client_id: req.clientId,
        promised_amount: req.promisedAmount,
        expected_payment_date: req.expectedPaymentDate,
        reason: req.reason,
        outstanding_amount: req.outstandingAmount,
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
