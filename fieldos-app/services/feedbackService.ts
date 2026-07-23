/**
 * FieldOS Nepal — Feedback Service
 *
 * The officer's way INTO the hierarchical feedback loop (PILOT_SCOPE_V2.md §3).
 * Submits feedback tied to a subject, and lists open campaigns targeted at the
 * officer's role so they can answer a Head-Office question in-app.
 *
 * Feedback is fire-and-forget (no offline DB/sync-queue for the pilot — unlike
 * collections/PTP which are money paths): a direct POST with graceful failure.
 * The author + branch are derived server-side from the JWT, never sent here.
 */

import { getAccessToken } from './apiClient';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export type FeedbackCategory = 'bug' | 'time_sink' | 'request' | 'praise' | 'blocker';

export interface SubmitFeedbackRequest {
  category: FeedbackCategory;
  severity: number;            // 1..5
  bodyText: string;
  subjectRef?: string;         // e.g. which screen/tool the feedback is about
  campaignId?: number;         // set when answering a campaign
}

export interface OpenCampaign {
  id: number;
  prompt_text: string;
  prompt_ne: string | null;
  target_role: string | null;
  opened_at: string | null;
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Submit feedback. Returns { ok } — never throws, so the screen can show a
 * friendly "couldn't reach the office, try again" without crashing.
 */
export async function submitFeedback(
  req: SubmitFeedbackRequest,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`${API_URL}/feedback`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        category: req.category,
        severity: req.severity,
        body_text: req.bodyText,
        subject_type: req.subjectRef ? 'tool' : 'general',
        subject_ref: req.subjectRef ?? null,
        campaign_id: req.campaignId ?? null,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      return { ok: false, error: `Server responded ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the office network' };
  }
}

/**
 * Fetch open campaigns the current officer is eligible to answer.
 * Returns [] on any error (a campaign prompt is a nice-to-have, never a blocker).
 */
export async function fetchOpenCampaigns(): Promise<OpenCampaign[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${API_URL}/feedback/campaigns`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return [];
    const json = await res.json();
    const items = json?.data?.items;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
