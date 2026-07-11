/**
 * FieldOS Nepal — Task Service
 *
 * Fetches and manages field officer task assignments.
 * When mock mode is enabled, returns mock task data.
 */

import { getConfig } from './apiClient';
import type { TaskAssignment, FetchTasksRequest, ApiResponse } from '../types/api';

// ─── Mock Data ───────────────────────────────────────────────────

const MOCK_TASKS: TaskAssignment[] = [
  { id: 1, taskId: 1, clientId: 1, clientName: 'Sunita Kumari Chaudhary', clientMemberId: 'M-1042', taskType: 'collection', taskDate: new Date().toISOString().split('T')[0], priority: 'high', amount: 5500, status: 'pending', loanCycle: 3, overdueDays: 8 },
  { id: 2, taskId: 2, clientId: 2, clientName: 'Rita Devi Sharma', clientMemberId: 'M-1038', taskType: 'collection', taskDate: new Date().toISOString().split('T')[0], priority: 'normal', amount: 3000, status: 'pending', loanCycle: 2, overdueDays: 0 },
  { id: 3, taskId: 3, clientId: 3, clientName: 'Sita Devi Sah', clientMemberId: 'M-1055', taskType: 'follow-up', taskDate: new Date().toISOString().split('T')[0], priority: 'high', amount: 2500, status: 'pending', loanCycle: 1, overdueDays: 15 },
  { id: 4, taskId: 4, clientId: 4, clientName: 'Ramesh Thapa Magar', clientMemberId: 'M-1012', taskType: 'collection', taskDate: new Date().toISOString().split('T')[0], priority: 'normal', amount: 4500, status: 'pending', loanCycle: 5, overdueDays: 0 },
  { id: 5, taskId: 5, clientId: 5, clientName: 'Maya Kumari Gurung', clientMemberId: 'M-1067', taskType: 'kyc', taskDate: new Date().toISOString().split('T')[0], priority: 'normal', status: 'pending', loanCycle: 1, overdueDays: 0 },
  { id: 6, taskId: 6, clientId: 6, clientName: 'Gita Devi Pokharel', clientMemberId: 'M-1023', taskType: 'collection', taskDate: new Date().toISOString().split('T')[0], priority: 'normal', amount: 2200, status: 'pending', loanCycle: 4, overdueDays: 3 },
];

// ─── Public API ──────────────────────────────────────────────────

/**
 * Fetch today's assigned tasks.
 */
export async function fetchAssignedTasks(req?: FetchTasksRequest): Promise<ApiResponse<TaskAssignment[]>> {
  const { enableMock, baseUrl } = getConfig();

  if (enableMock) {
    await mockDelay(400);
    let tasks = [...MOCK_TASKS];

    // Apply filters
    if (req?.status) {
      tasks = tasks.filter(t => t.status === req.status);
    }
    if (req?.type) {
      tasks = tasks.filter(t => t.taskType === req.type);
    }

    return {
      success: true,
      data: tasks,
      timestamp: new Date().toISOString(),
    };
  }

  // Real API call
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  const params = new URLSearchParams();
  if (req?.date) params.set('date', req.date);
  if (req?.status) params.set('status', req.status);
  if (req?.type) params.set('type', req.type);

  const token = require('./apiClient').getAccessToken();
  console.log('[Tasks] fetch URL:', `${apiUrl}/tasks/today?${params}`);
  console.log('[Tasks] current user id/staff_id:', token ? 'token present (length=' + token.length + ')' : 'NO TOKEN');

  const response = await fetch(`${apiUrl}/tasks/today?${params}`, {
    headers: {
      'Authorization': token ? `Bearer ${token}` : 'Bearer undefined',
      'Content-Type': 'application/json',
    },
  });

  console.log('[Tasks] response status:', response.status);

  const text = await response.text();
  console.log('[Tasks] response body:', text?.substring(0, 1000));

  try {
    const parsed = JSON.parse(text);
    // The API returns snake_case (client_id, client_name, member_id). Normalize to the
    // camelCase TaskAssignment shape the app relies on — otherwise selectedClient.clientId
    // is undefined and Record Collection fails with "Client information missing".
    if (parsed && Array.isArray(parsed.data)) {
      parsed.data = parsed.data.map(normalizeTask);
    }
    return parsed;
  } catch {
    return { success: false, data: [], error: 'Invalid response from server', timestamp: new Date().toISOString() };
  }
}

/** Map a raw API task (snake_case) to the app's camelCase TaskAssignment, keeping raw fields. */
function normalizeTask(raw: any): TaskAssignment {
  return {
    ...raw,
    id: raw.id,
    taskId: raw.id,
    clientId: raw.clientId ?? raw.client_id,
    clientName: raw.clientName ?? raw.client_name,
    clientMemberId: raw.clientMemberId ?? raw.member_id,
    taskType: raw.taskType ?? raw.task_type,
    taskDate: raw.taskDate ?? raw.task_date,
    amount: raw.amount,
    status: raw.status,
    priority: raw.priority,
    overdueDays: raw.overdueDays ?? raw.overdue_days ?? 0,
  } as TaskAssignment;
}

/**
 * Fetch tasks from local SQLite (offline fallback).
 * Uses mock data since tasks table doesn't have getByDate/getByStatus in the repo.
 */
export async function getLocalTasks(req?: FetchTasksRequest): Promise<TaskAssignment[]> {
  // Return mock data as fallback — the real service layer
  // will use the API response when available
  return MOCK_TASKS.filter(t => {
    if (req?.status) {
      if (req.status === 'overdue') return (t.overdueDays || 0) > 0;
      return t.status === req.status;
    }
    if (req?.type) return t.taskType === req.type;
    return true;
  });
}

/**
 * Get tasks for a specific date.
 */
export async function fetchTasksByDate(date: string): Promise<TaskAssignment[]> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(300);
    return MOCK_TASKS.filter(t => t.taskDate === date);
  }

  // Try API first, fall back to local
  try {
    const result = await fetchAssignedTasks({ date });
    if (result.success) return result.data;
  } catch { /* fall through to local */ }

  return getLocalTasks({ date });
}

function mockDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
