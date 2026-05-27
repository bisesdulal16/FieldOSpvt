/**
 * FieldOS Nepal — CBS Integration Service (Phase 12)
 *
 * Provides CBS (Core Banking System) verification status
 * and reconciliation data for field officers.
 */

import { getConfig, getAccessToken } from './apiClient';

// ─── Types ───────────────────────────────────────────────────────

export interface CBSVerificationStatus {
  verified: boolean;
  verified_at: string | null;
  event_id: number | null;
  event_status: string | null;
}

export interface CBSReconciliationItem {
  id: number;
  receipt_id: string;
  client_name: string;
  amount: number;
  local_status: string;
  cbs_status: string;
  matched: boolean;
  discrepancy: number | null;
  created_at: string;
}

export interface CBSReconciliationResponse {
  total: number;
  matched: number;
  pending: number;
  mismatched: number;
  items: CBSReconciliationItem[];
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Check CBS verification status for a specific collection.
 */
export async function checkCBSStatus(receiptId: string): Promise<{
  success: boolean;
  data?: CBSVerificationStatus;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    // Randomly return verified or pending for demo
    const verified = Math.random() > 0.4;
    return {
      success: true,
      data: {
        verified,
        verified_at: verified ? new Date().toISOString() : null,
        event_id: verified ? Math.floor(Math.random() * 1000) : null,
        event_status: verified ? 'matched' : 'pending_review',
      },
    };
  }

  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();

    const res = await fetch(`${apiUrl}/cbs/verify/${encodeURIComponent(receiptId)}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const json = await res.json();
    if (json.success) {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.detail || 'Failed to check CBS status' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Get CBS reconciliation summary for today.
 */
export async function getReconciliation(): Promise<{
  success: boolean;
  data?: CBSReconciliationResponse;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    return {
      success: true,
      data: {
        total: 6,
        matched: 4,
        pending: 1,
        mismatched: 1,
        items: [
          { id: 1, receipt_id: 'RCP-001', client_name: 'Sita Devi Sah', amount: 5000, local_status: 'recorded', cbs_status: 'posted', matched: true, discrepancy: null, created_at: new Date().toISOString() },
          { id: 2, receipt_id: 'RCP-002', client_name: 'Hari Maya', amount: 3000, local_status: 'recorded', cbs_status: 'posted', matched: true, discrepancy: null, created_at: new Date().toISOString() },
          { id: 3, receipt_id: 'RCP-003', client_name: 'Goma Devi', amount: 7500, local_status: 'recorded', cbs_status: 'pending_review', matched: false, discrepancy: null, created_at: new Date().toISOString() },
        ],
      },
    };
  }

  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();

    const res = await fetch(`${apiUrl}/cbs/reconciliation`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const json = await res.json();
    if (json.success) {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.detail || 'Failed to fetch reconciliation' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
