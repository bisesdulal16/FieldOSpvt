/**
 * FieldOS Nepal — AI Intelligence Service (Phase 13)
 *
 * Provides rule-based AI priority queue and suggestions
 * for field officers. AI suggests — human acts.
 */

import { getConfig, getAccessToken } from './apiClient';

// ─── Types ───────────────────────────────────────────────────────

export interface PriorityFactor {
  factor: string;
  label: string;
  points: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface PriorityClient {
  client_id: number;
  member_id: string;
  client_name: string;
  center_name: string | null;
  assigned_officer: string | null;
  officer_id: number | null;
  overdue_days: number;
  due_amount_npr: number;
  outstanding_npr: number;
  status: string;
  promised_today: boolean;
  missed_visit: boolean;
  npa_risk: boolean;
  missed_ptp: boolean;
  priority_score: number;
  priority_tier: 'critical' | 'high' | 'medium' | 'low' | 'normal';
  priority_factors: PriorityFactor[];
  suggestion: string;
}

export interface PriorityQueueResponse {
  total_clients: number;
  tier_counts: Record<string, number>;
  queue: PriorityClient[];
}

export interface AISuggestion {
  id: number;
  category: 'overdue' | 'ptp' | 'par' | 'missing_data';
  urgency: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  client_id: number | null;
  member_id: string | null;
  client_name: string | null;
  center_name: string | null;
  due_amount_npr?: number;
  outstanding_npr?: number;
  promised_amount_npr?: number;
  days_missed?: number;
  days_to_npa?: number;
  action: string;
  ai_rule: string;
  can_auto_act: boolean;
}

export interface SuggestionsResponse {
  total_suggestions: number;
  category_counts: Record<string, number>;
  urgency_counts: Record<string, number>;
  suggestions: AISuggestion[];
  disclaimer: string;
}

export interface EODSummaryOfficer {
  officer_id: number;
  staff_id: string;
  officer_name: string;
  date: string;
  tasks_total: number;
  visits_completed: number;
  completion_rate: number;
  collections_count: number;
  collections_npr: number;
  ptp_fulfilled: number;
  overdue_clients: number;
  eod_submitted: boolean;
  eod_confirmed: boolean;
  narrative: string;
  alerts: { type: string; message: string }[];
}

export interface EODSummaryResponse {
  date: string;
  total_officers: number;
  officers_started: number;
  eod_submitted: number;
  officers_with_alerts: number;
  summaries: EODSummaryOfficer[];
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Get AI priority queue for the current officer.
 * Returns clients sorted by priority score (highest first).
 */
export async function getPriorityQueue(officerId?: number): Promise<{
  success: boolean;
  data?: PriorityQueueResponse;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    return {
      success: true,
      data: {
        total_clients: 3,
        tier_counts: { critical: 1, high: 1, low: 1 },
        queue: [
          {
            client_id: 17, member_id: 'M-017', client_name: 'Babita Devi Rai',
            center_name: 'Kalanki Center', assigned_officer: 'Ram Bahadur Shah',
            officer_id: 1, overdue_days: 35, due_amount_npr: 15000,
            outstanding_npr: 85000, status: 'active', promised_today: false,
            missed_visit: false, npa_risk: true, missed_ptp: true,
            priority_score: 165, priority_tier: 'critical',
            priority_factors: [
              { factor: 'npa_risk', label: 'NPA risk — 30+ days overdue', points: 30, severity: 'critical' },
              { factor: 'overdue_days', label: '35 days overdue', points: 105, severity: 'critical' },
              { factor: 'missed_ptp', label: 'Previous promise broken/missed', points: 25, severity: 'high' },
              { factor: 'high_amount', label: 'High outstanding NPR 85,000', points: 10, severity: 'medium' },
            ],
            suggestion: 'URGENT: Babita Devi Rai is at NPA risk with 35 days overdue. Immediate escalation recommended. | Previous payment promise was broken. Consider in-person follow-up and restructuring for Babita Devi Rai. | High outstanding balance NPR 85,000. Monitor repayment capacity.',
          },
          {
            client_id: 5, member_id: 'M-005', client_name: 'Sita Devi Sah',
            center_name: 'Kalanki Center', assigned_officer: 'Ram Bahadur Shah',
            officer_id: 1, overdue_days: 8, due_amount_npr: 5000,
            outstanding_npr: 25000, status: 'active', promised_today: true,
            missed_visit: false, npa_risk: false, missed_ptp: false,
            priority_score: 44, priority_tier: 'high',
            priority_factors: [
              { factor: 'promised_today', label: 'Promise-to-pay due today', points: 20, severity: 'high' },
              { factor: 'overdue_days', label: '8 days overdue', points: 24, severity: 'medium' },
            ],
            suggestion: 'Payment promise due today (NPR 5,000). Confirm collection by EOD.',
          },
          {
            client_id: 12, member_id: 'M-012', client_name: 'Hari Maya Shrestha',
            center_name: 'Thamel Center', assigned_officer: 'Ram Bahadur Shah',
            officer_id: 1, overdue_days: 2, due_amount_npr: 2000,
            outstanding_npr: 12000, status: 'active', promised_today: false,
            missed_visit: false, npa_risk: false, missed_ptp: false,
            priority_score: 6, priority_tier: 'low',
            priority_factors: [
              { factor: 'overdue_days', label: '2 days overdue', points: 6, severity: 'medium' },
            ],
            suggestion: 'Mildly overdue (2d). Routine follow-up sufficient.',
          },
        ],
      },
    };
  }

  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();
    // Officer-scoped priority feed (real overdue/due from the officer's own clients).
    // NOTE: /manager/ai/* is manager-only (403 for officers) — do not use it here.
    const res = await fetch(`${apiUrl}/tasks/priority`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const json = await res.json();
    if (json.success) {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.detail || 'Failed to fetch priority queue' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Get AI suggestions for the current officer.
 * Returns actionable recommendations grouped by category.
 */
export async function getSuggestions(officerId?: number, category?: string): Promise<{
  success: boolean;
  data?: SuggestionsResponse;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    return {
      success: true,
      data: {
        total_suggestions: 2,
        category_counts: { overdue: 1, ptp: 1 },
        urgency_counts: { critical: 1, high: 1 },
        suggestions: [
          {
            id: 1, category: 'overdue', urgency: 'critical',
            title: 'Babita Devi Rai — 35 days overdue',
            description: 'Babita Devi Rai (M-017) is 35 days overdue with NPR 85,000 outstanding. No visit in 3 days.',
            client_id: 17, member_id: 'M-017', client_name: 'Babita Devi Rai',
            center_name: 'Kalanki Center', due_amount_npr: 15000, outstanding_npr: 85000,
            action: 'schedule_visit', ai_rule: 'overdue_no_recent_visit', can_auto_act: false,
          },
          {
            id: 2, category: 'ptp', urgency: 'high',
            title: 'PTP due today — Sita Devi Sah (NPR 5,000)',
            description: 'Payment promise of NPR 5,000 from Sita Devi Sah (M-005) is due today.',
            client_id: 5, member_id: 'M-005', client_name: 'Sita Devi Sah',
            center_name: 'Kalanki Center', promised_amount_npr: 5000,
            action: 'confirm_collection', ai_rule: 'ptp_due_today', can_auto_act: false,
          },
        ],
        disclaimer: 'Rule-based recommendations only. AI cannot approve loans, adjust collections, confirm payments, or discipline staff.',
      },
    };
  }

  try {
    // Derive real, officer-scoped suggestions from the officer's real priority queue.
    // (No /manager/ai/* — that's manager-only and 403s for a field officer.)
    const pq = await getPriorityQueue(officerId);
    if (!pq.success || !pq.data) {
      return { success: false, error: pq.error || 'Failed to fetch suggestions' };
    }
    let items = pq.data.queue.filter((c) => c.priority_tier !== 'normal');
    if (category === 'overdue') items = items.filter((c) => c.overdue_days > 0);
    items = items.slice(0, 10);

    const suggestions: AISuggestion[] = items.map((c, i) => ({
      id: i + 1,
      category: c.overdue_days > 0 ? 'overdue' : 'par',
      urgency: c.priority_tier === 'critical' ? 'critical' : c.priority_tier === 'high' ? 'high' : 'medium',
      title: c.overdue_days > 0
        ? `${c.client_name} — ${c.overdue_days} days overdue`
        : `${c.client_name} — installment due`,
      description: c.suggestion,
      client_id: c.client_id, member_id: c.member_id, client_name: c.client_name,
      center_name: c.center_name, due_amount_npr: c.due_amount_npr, outstanding_npr: c.outstanding_npr,
      days_missed: c.overdue_days,
      action: c.overdue_days > 0 ? 'schedule_visit' : 'confirm_collection',
      ai_rule: c.overdue_days >= 30 ? 'npa_risk' : c.overdue_days > 0 ? 'overdue' : 'due_today',
      can_auto_act: false,
    }));

    const category_counts: Record<string, number> = {};
    const urgency_counts: Record<string, number> = {};
    for (const s of suggestions) {
      category_counts[s.category] = (category_counts[s.category] || 0) + 1;
      urgency_counts[s.urgency] = (urgency_counts[s.urgency] || 0) + 1;
    }
    return {
      success: true,
      data: {
        total_suggestions: suggestions.length, category_counts, urgency_counts, suggestions,
        disclaimer: 'Rule-based prompts from your own due/overdue clients. AI suggests — you decide and act.',
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Get AI-generated EOD summary for the current officer.
 */
export async function getEODSummary(officerId?: number): Promise<{
  success: boolean;
  data?: EODSummaryResponse;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    return {
      success: true,
      data: {
        date: new Date().toISOString().split('T')[0],
        total_officers: 1,
        officers_started: 1,
        eod_submitted: 0,
        officers_with_alerts: 1,
        summaries: [{
          officer_id: 1, staff_id: 'FO-208', officer_name: 'Ram Bahadur Shah',
          date: new Date().toISOString().split('T')[0],
          tasks_total: 8, visits_completed: 5, completion_rate: 62.5,
          collections_count: 4, collections_npr: 18500, ptp_fulfilled: 1,
          overdue_clients: 2, eod_submitted: false, eod_confirmed: false,
          narrative: 'Ram Bahadur Shah: 5/8 visits (62.5%) — follow-up needed. Collected NPR 18,500 (4 txns). 1 PTP fulfilled. 2 overdue client(s). EOD NOT submitted — pending.',
          alerts: [
            { type: 'low_completion', message: 'Visit rate 62.5% — below 50%' },
            { type: 'eod_pending', message: 'EOD report not submitted' },
          ],
        }],
      },
    };
  }

  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();
    const params = new URLSearchParams();
    if (officerId) params.set('officer_id', String(officerId));
    const qs = params.toString() ? `?${params.toString()}` : '';

    const res = await fetch(`${apiUrl}/manager/ai/eod-summary${qs}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const json = await res.json();
    if (json.success) {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.detail || 'Failed to fetch EOD summary' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Get AI-generated branch summary for the current officer.
 */
export async function getBranchSummary(officerId?: number): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  const { enableMock } = getConfig();

  if (enableMock) {
    return {
      success: true,
      data: {
        branch_name: 'Kathmandu West Branch',
        date: new Date().toISOString().split('T')[0],
        total_clients: 156,
        active_loans: 142,
        par_30: 8.2,
        top_priority_client: 'Sunita Kumari Chaudhary (M-1042)',
      },
    };
  }

  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();
    const params = new URLSearchParams();
    if (officerId) params.set('officer_id', String(officerId));
    const qs = params.toString() ? `?${params.toString()}` : '';

    const res = await fetch(`${apiUrl}/manager/ai/branch-summary${qs}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const json = await res.json();
    if (json.success) {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.detail || 'Failed to fetch branch summary' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
