/**
 * FieldOS Nepal — API Client
 *
 * Base HTTP client with interceptors for authentication,
 * error handling, and request/response transformation.
 *
 * When EXPO_PUBLIC_ENABLE_MOCK_SYNC=true, all API calls
 * are intercepted and handled by mock implementations.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// ─── Config ──────────────────────────────────────────────────────

const CONFIG = {
  baseUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1',
  enableMock: process.env.EXPO_PUBLIC_ENABLE_MOCK_SYNC === 'true',
  timeout: 30000,
  syncBatchSize: Number(process.env.EXPO_PUBLIC_SYNC_BATCH_SIZE) || 50,
};

export function getConfig() {
  return CONFIG;
}

export function updateConfig(overrides: Partial<typeof CONFIG>) {
  Object.assign(CONFIG, overrides);
}

// ─── Types ───────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestConfig {
  url: string;
  method: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  timeout?: number;
  skipAuth?: boolean;
  responseType?: 'json' | 'blob';
}

export interface ApiClientError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]>;
  data?: unknown;
}

// ─── Token Management ───────────────────────────────────────────

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
// The staff_id of the officer currently signed in on this device. Used to stamp
// offline sync-queue items so one officer's queued actions never sync (and get
// mis-attributed) under a different officer who later logs in on the same device.
let _currentStaffId: string | null = null;

export function setCurrentStaffId(staffId: string | null): void {
  _currentStaffId = staffId || null;
}

export function getCurrentStaffId(): string | null {
  return _currentStaffId;
}

export function setTokens(accessToken: string, refreshToken: string): void {
  _accessToken = accessToken;
  _refreshToken = refreshToken;
  // Persist to secure storage
  try {
    SecureStore.setItemAsync('fieldos_access_token', accessToken);
    SecureStore.setItemAsync('fieldos_refresh_token', refreshToken);
  } catch { /* fallback silently */ }
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

export async function loadTokens(): Promise<void> {
  try {
    _accessToken = await SecureStore.getItemAsync('fieldos_access_token');
    _refreshToken = await SecureStore.getItemAsync('fieldos_refresh_token');
  } catch { /* fallback silently */ }
}

export function clearTokens(): void {
  _accessToken = null;
  _refreshToken = null;
  _currentStaffId = null;
  try {
    SecureStore.deleteItemAsync('fieldos_access_token');
    SecureStore.deleteItemAsync('fieldos_refresh_token');
  } catch { /* fallback silently */ }
}

/**
 * End the in-memory session (return the app to the login screen) WITHOUT deleting
 * the persisted token from secure storage — so a field-friendly logout can still
 * allow an OFFLINE re-login within the token's lifetime. See authService.logout.
 */
export function endSessionInMemory(): void {
  _accessToken = null;
  _refreshToken = null;
  _currentStaffId = null;
}

export function isAuthenticated(): boolean {
  return !!_accessToken;
}

// ─── Request Builder ─────────────────────────────────────────────

function buildUrl(config: RequestConfig): string {
  let url = config.url.startsWith('http') ? config.url : `${CONFIG.baseUrl}${config.url}`;

  if (config.params) {
    const searchParams = new URLSearchParams(config.params);
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}${searchParams.toString()}`;
  }

  return url;
}

function buildHeaders(config: RequestConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-App-Version': '3.0.0',
    'X-Platform': Platform.OS,
    ...config.headers,
  };

  if (!config.skipAuth && _accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  }

  return headers;
}

// ─── Core Request Function ───────────────────────────────────────

async function request<T>(config: RequestConfig): Promise<T> {
  const url = buildUrl(config);
  const headers = buildHeaders(config);
  const timeout = config.timeout || CONFIG.timeout;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: config.method,
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle non-OK responses
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const error: ApiClientError = {
        status: response.status,
        code: errorBody?.error?.code || 'UNKNOWN_ERROR',
        message: errorBody?.error?.message || `HTTP ${response.status}`,
        details: errorBody?.error?.details,
        data: errorBody,
      };

      // Handle 401 — token expired
      if (response.status === 401 && _refreshToken) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          // Retry original request with new token
          return request<T>({ ...config, skipAuth: false });
        }
      }

      throw error;
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return await response.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw { status: 0, code: 'TIMEOUT', message: 'Request timed out' } as ApiClientError;
    }
    if (err.status !== undefined) {
      throw err; // Already an ApiClientError
    }
    // Network error
    throw {
      status: 0,
      code: 'NETWORK_ERROR',
      message: err.message || 'Network request failed',
    } as ApiClientError;
  }
}

// ─── Token Refresh ──────────────────────────────────────────────

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await request<{ tokens: { accessToken: string; refreshToken: string } }>({
        url: '/auth/refresh',
        method: 'POST',
        body: { refreshToken: _refreshToken },
        skipAuth: true,
      });
      setTokens(response.tokens.accessToken, response.tokens.refreshToken);
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ─── Convenience Methods ─────────────────────────────────────────

export const apiClient = {
  get<T>(url: string, params?: Record<string, string>, config?: Partial<RequestConfig>): Promise<T> {
    return request<T>({ url, method: 'GET', params, ...config });
  },

  post<T>(url: string, body?: unknown, config?: Partial<RequestConfig>): Promise<T> {
    return request<T>({ url, method: 'POST', body, ...config });
  },

  put<T>(url: string, body?: unknown, config?: Partial<RequestConfig>): Promise<T> {
    return request<T>({ url, method: 'PUT', body, ...config });
  },

  patch<T>(url: string, body?: unknown, config?: Partial<RequestConfig>): Promise<T> {
    return request<T>({ url, method: 'PATCH', body, ...config });
  },

  delete<T>(url: string, config?: Partial<RequestConfig>): Promise<T> {
    return request<T>({ url, method: 'DELETE', ...config });
  },
};

export default apiClient;
