/**
 * FieldOS Nepal — AI Assistant Service (Phase 14)
 *
 * "Ask FieldOS" — contextual AI assistant for field officers.
 * Provides answers about today's work, clients, policies.
 *
 * AI suggests only — human decides and acts.
 * AI output never bypasses human review.
 */

import { getConfig, getAccessToken } from './apiClient';
import { enqueueSyncEvent } from '../db/repositories/syncQueueRepo';
import { audit } from './auditService';

// ─── Types ───────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface FieldOSContext {
  pendingSyncCount?: number;
  todayVisitsCompleted?: number;
  todayVisitsPlanned?: number;
  todayCollectionsNPR?: number;
  promiseToPayDue?: number;
  overdueClients?: number;
  branchName?: string;
  officerName?: string;
  officerId?: string;
  todayDate?: string;
}

export interface QuickAction {
  id: string;
  label: string;
  question: string;
  icon: string;
  color: string;
}

// ─── Quick Actions ───────────────────────────────────────────────

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'due-today',
    label: "Today's Due Clients",
    question: 'Who are the clients with payments due today?',
    icon: 'people-outline',
    color: '#F59E0B',
  },
  {
    id: 'pending-sync',
    label: 'Pending Sync',
    question: 'How many items are pending sync? What needs attention?',
    icon: 'cloud-outline',
    color: '#6366F1',
  },
  {
    id: 'ptp-due',
    label: 'Promise-to-Pay Due',
    question: 'Which promise-to-pay commitments are due today?',
    icon: 'time-outline',
    color: '#DC2626',
  },
  {
    id: 'overdue',
    label: 'Overdue Clients',
    question: 'Which clients are overdue? How many days?',
    icon: 'alert-circle-outline',
    color: '#F59E0B',
  },
  {
    id: 'collection-summary',
    label: 'Today\'s Collections',
    question: 'What is the summary of today\'s collections?',
    icon: 'wallet-outline',
    color: '#16A34A',
  },
  {
    id: 'branch-policy',
    label: 'Branch Policy',
    question: 'What is the branch policy for high-value collection verification?',
    icon: 'shield-outline',
    color: '#0B1B3A',
  },
];

// ─── Conversation History ────────────────────────────────────────

let conversationHistory: ChatMessage[] = [];

export function getConversationHistory(): ChatMessage[] {
  return [...conversationHistory];
}

export function clearConversation(): void {
  conversationHistory = [];
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Ask FieldOS a question with optional context.
 * Returns AI-generated response.
 */
export async function askFieldOS(
  question: string,
  context?: FieldOSContext,
): Promise<{
  success: boolean;
  answer?: string;
  error?: string;
}> {
  const { enableMock } = getConfig();

  // Add user message to history
  const userMsg: ChatMessage = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: question,
    timestamp: new Date().toISOString(),
  };
  conversationHistory.push(userMsg);

  if (enableMock) {
    // Mock responses based on question keywords
    const answer = getMockAnswer(question, context);
    const assistantMsg: ChatMessage = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: answer,
      timestamp: new Date().toISOString(),
    };
    conversationHistory.push(assistantMsg);
    return { success: true, answer };
  }

  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = getAccessToken();

    // Build context for the AI
    const fieldOSContext: Record<string, any> = {};
    if (context) {
      if (context.pendingSyncCount !== undefined) fieldOSContext.pending_sync_count = context.pendingSyncCount;
      if (context.todayVisitsCompleted !== undefined) fieldOSContext.today_visits_completed = context.todayVisitsCompleted;
      if (context.todayVisitsPlanned !== undefined) fieldOSContext.today_visits_planned = context.todayVisitsPlanned;
      if (context.todayCollectionsNPR !== undefined) fieldOSContext.today_collections_npr = context.todayCollectionsNPR;
      if (context.promiseToPayDue !== undefined) fieldOSContext.ptp_due_today = context.promiseToPayDue;
      if (context.overdueClients !== undefined) fieldOSContext.overdue_clients = context.overdueClients;
      if (context.branchName) fieldOSContext.branch_name = context.branchName;
      if (context.officerName) fieldOSContext.officer_name = context.officerName;
      if (context.todayDate) fieldOSContext.today_date = context.todayDate;
    }

    const res = await fetch(`${apiUrl}/voice-ai/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        question,
        context: Object.keys(fieldOSContext).length > 0 ? fieldOSContext : undefined,
        conversation_history: conversationHistory.slice(-10), // Last 10 messages for context
      }),
    });

    const json = await res.json();
    if (json.success && json.data?.answer) {
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: json.data.answer,
        timestamp: new Date().toISOString(),
      };
      conversationHistory.push(assistantMsg);

      // Audit
      try {
        await audit('ai_assistant_query', {
          entityType: 'ai_assistant',
          metadata: {
            question_length: question.length,
            answer_length: json.data.answer.length,
          },
          localOnly: true,
        });
        await enqueueSyncEvent('audit_event', { event: 'ai_assistant_query' });
      } catch { /* silent */ }

      return { success: true, answer: json.data.answer };
    }
    return { success: false, error: json.detail || 'Failed to get answer' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ─── Mock Answer Generator ───────────────────────────────────────

function getMockAnswer(question: string, context?: FieldOSContext): string {
  const q = question.toLowerCase();

  if (q.includes('due today') || q.includes('due client')) {
    return `You have 6 clients with payments due today:\n\n• Sunita Kumari Chaudhary (M-1042) — NPR 5,500\n• Rita Devi Sharma (M-1043) — NPR 3,200\n• Sita Devi Sah (M-1089) — NPR 5,000 (PTP today)\n• Ramesh BK (M-1044) — NPR 7,500\n• Maya Tamang (M-1045) — NPR 2,800\n• Gita Kumari (M-1046) — NPR 4,200\n\nTotal due: NPR 28,200\n\n⚡ AI suggestion only — verify before acting.`;
  }

  if (q.includes('sync') || q.includes('pending')) {
    const count = context?.pendingSyncCount ?? 3;
    return `You have ${count} item(s) pending sync:\n\n• ${Math.max(1, count - 2)} collection(s) recorded locally\n• 1 visit check-in awaiting upload\n${count > 2 ? `• ${count - 2} other event(s)\n` : ''}\nTap "Sync Now" to upload all pending items.\n\n⚡ AI suggestion only — verify before acting.`;
  }

  if (q.includes('promise') || q.includes('ptp')) {
    const count = context?.promiseToPayDue ?? 1;
    return `You have ${count} promise-to-pay due today:\n\n• Sita Devi Sah (M-1089) — NPR 5,000 promised\n  Status: Pending — collection not yet confirmed\n\nAction: Visit Sita Devi Sah today to collect the promised amount.\n\n⚡ AI suggestion only — verify before acting.`;
  }

  if (q.includes('overdue')) {
    const count = context?.overdueClients ?? 4;
    return `You have ${count} overdue client(s):\n\n🔴 Critical (>30 days):\n  — (No NPA clients currently)\n\n🟠 High (>14 days):\n  — Babita Devi Rai (M-017) — 35 days, NPR 85,000 outstanding\n\n🟡 Medium (>7 days):\n  — Sita Devi Sah (M-1089) — 8 days, NPR 25,000\n\nAction: Prioritize Babita Devi Rai — NPA risk if not resolved within 30 days.\n\n⚡ AI suggestion only — verify before acting.`;
  }

  if (q.includes('collection') || q.includes('today')) {
    const npr = context?.todayCollectionsNPR ?? 18500;
    return `Today's collection summary:\n\n• Collections: NPR ${npr.toLocaleString()}\n• Transactions: 4\n• Target: NPR 185,000\n• Progress: ${Math.round(npr / 185000 * 100)}%\n\n${npr > 50000 ? 'Good progress today! Keep it up.' : 'Collection pace is below target. Focus on high-priority clients.'}\n\n⚡ AI suggestion only — verify before acting.`;
  }

  if (q.includes('policy') || q.includes('branch')) {
    return `Branch policy highlights:\n\n1. High-value verification: Collections ≥ NPR 10,000 require face verification\n2. CBS posting: All collections verified via CBS within 24 hours\n3. PTP follow-up: If PTP not fulfilled within 3 days, escalate to manager\n4. Visit completion: Target 80%+ daily visit completion rate\n5. EOD report: Must be submitted by 6:00 PM daily\n\nFor detailed policy questions, please contact your branch manager.\n\n⚡ AI suggestion only — verify before acting.`;
  }

  return `I'm FieldOS Assistant. I can help you with:\n\n• Today's due clients and overdue status\n• Pending sync items\n• Promise-to-pay due today\n• Collection summaries\n• Branch policies\n\nPlease ask a specific question about your field work.\n\n⚡ AI suggestion only — verify before acting.`;
}
