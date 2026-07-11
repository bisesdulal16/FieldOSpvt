'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastUpdated: Date | null;
}

export function useCBSAPI<T = unknown>(endpoint: string, enabled = true): ApiState<T> {
  return useManagerAPI<T>(`cbs/${endpoint}`, enabled);
}

export function useSecurityAPI<T = unknown>(endpoint: string, enabled = true): ApiState<T> {
  return useManagerAPI<T>(`security/${endpoint}`, enabled);
}

export function usePilotAPI<T = unknown>(endpoint: string, enabled = true): ApiState<T> {
  return useManagerAPI<T>(`pilot/${endpoint}`, enabled);
}

export interface Branding {
  org_name: string;
  org_name_ne: string;
  tagline: string;
  product_suffix: string;
  primary_color: string;
  accent_color: string;
  logo_url: string;
}

const DEFAULT_BRANDING: Branding = {
  org_name: 'FieldOS', org_name_ne: '', tagline: 'Nepal',
  product_suffix: 'Branch Manager Dashboard',
  primary_color: '#0B1B3A', accent_color: '#F59E0B', logo_url: '',
};

/** Public white-label branding. Falls back to FieldOS defaults if unavailable. */
export function useBranding(): Branding {
  const { data } = useManagerAPI<Branding>('branding/', true);
  return data || DEFAULT_BRANDING;
}

export function useManagerAPI<T = unknown>(endpoint: string, enabled = true): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('fieldos_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`/api/fieldos/${endpoint}`, {
        headers,
        cache: 'no-store',
      });

      if (!res.ok) {
        if (res.status === 401) {
          // Token expired — clear it
          localStorage.removeItem('fieldos_token');
          localStorage.removeItem('fieldos_user');
          setError('Session expired. Please log in again.');
        } else {
          setError(`API error: ${res.status}`);
        }
        return;
      }

      const json = await res.json();

      if (mountedRef.current) {
        setData(json.data as T);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [endpoint, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData, lastUpdated };
}

export function useAutoRefresh(intervalMs: number, refetch: () => void) {
  useEffect(() => {
    const timer = setInterval(refetch, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, refetch]);
}

export async function apiMutation<T = unknown>(endpoint: string, method = 'POST', body?: unknown): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const token = localStorage.getItem('fieldos_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`/api/fieldos/${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      return { success: false, error: json.detail || `API error: ${res.status}` };
    }

    return { success: true, data: json.data as T };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Request failed' };
  }
}

export async function apiLogin(staffId: string, pin: string): Promise<{
  success: boolean;
  user?: { name: string; staff_id: string; role: string; branch_name: string | null };
  token?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/fieldos/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, pin }),
    });

    const json = await res.json();

    if (!json.success) {
      const detail = json.detail || 'Login failed';
      return { success: false, error: detail };
    }

    const { user, tokens } = json.data;
    return {
      success: true,
      user: { name: user.name, staff_id: user.staff_id, role: user.role, branch_name: user.branch_name },
      token: tokens.access_token,
    };
  } catch (err) {
    return { success: false, error: 'Backend unavailable' };
  }
}
