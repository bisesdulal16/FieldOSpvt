/**
 * FieldOS Nepal — Announcements Service
 *
 * Fetches active announcements for the current officer.
 */

import { apiClient } from './apiClient';
import { getCurrentUser } from './authService';
import type { ApiResponse } from '../types/api';

export interface Announcement {
  id: number;
  title: string;
  message: string;
  priority: 'normal' | 'urgent';
  target_type: 'all' | 'officer';
  created_by: number;
  created_at: string;
}

/**
 * Fetch active announcements for the requesting officer.
 */
export async function fetchAnnouncements(): Promise<Announcement[]> {
  try {
    const user = await getCurrentUser();
    if (!user) return [];

    const res = await apiClient.get<ApiResponse<Announcement[]>>(
      '/announcements',
      { officer_id: String(user.id) },
    );

    return res.data ?? [];
  } catch {
    console.warn('[Announcements] Failed to fetch');
    return [];
  }
}
