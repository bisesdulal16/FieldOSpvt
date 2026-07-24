/**
 * FieldOS Nepal — Collection Service
 *
 * Handles payment collection creation and submission.
 * When mock mode is enabled, simulates server responses.
 */

import { getConfig } from './apiClient';
import { createCollection } from '../db/repositories/collectionsRepo';
import { enqueueSyncEvent, markEventSynced } from '../db/repositories/syncQueueRepo';
import { auditCollectionRecorded } from './auditService';
import { getCurrentUser } from './authService';
import type { CreateCollectionRequest, CreateCollectionResponse, ApiResponse } from '../types/api';

// ─── Public API ──────────────────────────────────────────────────

/**
 * Record a new collection locally and queue for sync.
 */
export async function recordCollection(req: CreateCollectionRequest): Promise<ApiResponse<CreateCollectionResponse>> {
  const { enableMock } = getConfig();

  // Always persist locally first (offline-first)
  const receiptId = `RCP-${Date.now()}`;
  const collectionId = await createCollection({
    receipt_id: receiptId,
    client_id: req.clientId,
    amount: req.amount,
    due_amount: req.dueAmount,
    outstanding_after: req.outstandingAfter,
    payment_method: req.paymentMethod,
    is_high_value: req.isHighValue,
    face_verified: req.faceVerified,
    gps_latitude: req.gpsLatitude,
    gps_longitude: req.gpsLongitude,
  });

  // Enqueue for sync
  const user = await getCurrentUser();
  const queueEventId = await enqueueSyncEvent('collection', {
    collectionId,
    receiptId,
    clientId: req.clientId,
    officerId: user?.id || null,
    amount: req.amount,
    dueAmount: req.dueAmount,
    outstandingAfter: req.outstandingAfter,
    paymentMethod: req.paymentMethod,
    isHighValue: req.isHighValue,
    faceVerified: req.faceVerified,
    gpsLatitude: req.gpsLatitude,
    gpsLongitude: req.gpsLongitude,
    gpsAddress: req.gpsAddress,
    capturedAt: new Date().toISOString(),
  }, collectionId);

  // Audit
  await auditCollectionRecorded(collectionId, receiptId, req.amount, req.paymentMethod);

  if (enableMock) {
    await mockDelay(400);
    // Mark mock-synced queue event as synced
    await markEventSynced(queueEventId);
    return {
      success: true,
      data: {
        collectionId,
        receiptId,
        serverId: Math.floor(Math.random() * 100000),
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Real API call (fire-and-forget, already saved locally)
  const synced = await trySyncToServer(req, collectionId, receiptId);

  // Mark queue event as synced if server acknowledged
  if (synced) {
    console.log('[Collection Direct Sync] marked queue synced, eventId:', queueEventId);
    await markEventSynced(queueEventId);
  } else {
    console.warn('[Collection Direct Sync] direct sync failed, keeping queue event pending, eventId:', queueEventId);
  }

  return {
    success: true,
    data: {
      collectionId,
      receiptId,
      serverId: 0, // Will be set on sync
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get today's collection total.
 */
export async function getTodayCollectionTotal(): Promise<{ amount: number; count: number }> {
  const { enableMock } = getConfig();

  if (enableMock) {
    return { amount: 45000, count: 6 };
  }

  // Query local DB
  const { getTotalCollectedToday, getCollectionsByDate } = require('../db/repositories/collectionsRepo');
  const total = await getTotalCollectedToday();
  const today = new Date().toISOString().split('T')[0];
  const todayCollections = await getCollectionsByDate(today);
  return { amount: total, count: todayCollections.length };
}

// ─── Internal ────────────────────────────────────────────────────

async function trySyncToServer(req: CreateCollectionRequest, collectionId: number, receiptId: string): Promise<boolean> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const { getAccessToken } = require('./apiClient');
    const token = getAccessToken();

    const user = await getCurrentUser();
    const backendPayload = {
      client_id: req.clientId,
      amount: req.amount,
      payment_method: req.paymentMethod,
      due_amount: req.dueAmount,
      outstanding_after: req.outstandingAfter,
      is_high_value: req.isHighValue,
      face_verified: req.faceVerified,
      task_id: req.taskId,
      officer_id: user?.id || null,
      gps_latitude: req.gpsLatitude,
      gps_longitude: req.gpsLongitude,
      gps_accuracy_meters: req.gpsAccuracyMeters,
      gps_address: req.gpsAddress,
      collected_at: new Date().toISOString(),
      receipt_id: receiptId,
    };

    console.log('[Collection Direct Sync] backend payload:', JSON.stringify(backendPayload, null, 2));

    // Bound the request so a slow/unreachable server can never freeze the
    // collect screen — on timeout we fall back to the offline queue.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(`${apiUrl}/collections/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : 'Bearer undefined',
      },
      body: JSON.stringify(backendPayload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const responseText = await response.text();
    console.log('[Collection Direct Sync] response status:', response.status, 'body:', responseText?.substring(0, 500));

    let responseBody: any = null;
    try {
      responseBody = JSON.parse(responseText);
    } catch { /* plain text or empty body */ }

    if (response.status === 409) {
      // Duplicate receipt — already synced on server
      console.log('[Collection Direct Sync] duplicate receipt on server (409), treating as synced');
      return true;
    }

    if (!response.ok) {
      console.warn('[Collection Direct Sync] Server returned error, will retry from queue:', responseText);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[Collection Direct Sync] Network error, event will be retried from queue:', err);
    return false;
  }
}

function mockDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
