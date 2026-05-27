/**
 * FieldOS Nepal — Auth Service
 *
 * Handles login, biometric auth, token management, and device registration.
 * When mock mode is enabled, returns mock data with simulated delays.
 */

import { loadTokens, setTokens, clearTokens, getAccessToken, getConfig } from './apiClient';
import * as SecureStore from 'expo-secure-store';
import type {
  LoginRequest,
  LoginResponse,
  BiometricLoginRequest,
  RefreshTokenResponse,
  DeviceRegisterRequest,
  ApiResponse,
  UserProfile,
} from '../types/api';

// ─── Mock Helpers ────────────────────────────────────────────────

const MOCK_USER: UserProfile = {
  id: 1,
  staffId: 'FO-208',
  name: 'Ram Bahadur Shah',
  nameNe: 'राम बहादुर शाह',
  role: 'field_officer',
  branchId: 'BR-KTW-001',
  branchName: 'Kathmandu West Branch',
  isActive: true,
};

const MOCK_DEVICE = {
  id: 1,
  deviceId: 'DEV-DEFAULT',
  deviceName: 'Pixel 7',
  deviceModel: 'Pixel 7',
  osVersion: 'Android 14',
  appVersion: '3.0.0',
  isRegistered: true,
  lastSyncAt: null,
};

function mockTokens() {
  return {
    accessToken: `eyJhbGciOiJIUzI1NiJ9.mock.${Date.now()}`,
    refreshToken: `eyJhbGciOiJIUzI1NiJ9.refresh.${Date.now()}`,
    expiresIn: 86400,
    refreshExpiresIn: 604800,
  };
}

function mockDelay(ms: number = 600): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Login with staff ID and PIN.
 */
export async function loginWithPin(req: LoginRequest): Promise<ApiResponse<LoginResponse>> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(800);
    // Validate mock credentials: any staff_id + any 4-digit PIN
    if (!req.staff_id || !req.pin || req.pin.length < 4) {
      return {
        success: false,
        data: {} as LoginResponse,
        message: 'Invalid credentials',
        timestamp: new Date().toISOString(),
      };
    }
    const tokens = mockTokens();
    setTokens(tokens.accessToken, tokens.refreshToken);

    return {
      success: true,
      data: {
        user: MOCK_USER,
        device: MOCK_DEVICE,
        tokens,
        branch: {
          id: 1,
          branchId: 'BR-KTW-001',
          name: 'Kathmandu West Branch',
          nameNe: 'काठमाडौं पश्चिम शाखा',
          address: 'Kalanki, Kathmandu',
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Real API call
  try {
    const fullLoginUrl = `${process.env.EXPO_PUBLIC_API_URL}/auth/login`;
    const payload = { staff_id: req.staff_id, pin: req.pin };

    const response = await fetch(fullLoginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (data.success && data.data?.tokens) {
      // Support both camelCase (accessToken) and snake_case (access_token) from backend
      const at = (data.data.tokens as any).accessToken || (data.data.tokens as any).access_token;
      const rt = (data.data.tokens as any).refreshToken || (data.data.tokens as any).refresh_token;
      setTokens(at, rt);
      // Persist user profile for AI/CBS services
      if (data.data.user) {
        try { SecureStore.setItemAsync('fieldos_user_profile', JSON.stringify(data.data.user)); } catch {}
      }
    }

    return data;
  } catch (networkError: any) {
    console.error('[Auth] Login fetch failed:', networkError?.message || networkError);
    return {
      success: false,
      data: {} as LoginResponse,
      message: networkError?.message || 'Network request failed — check API URL',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Login with biometric authentication.
 */
export async function loginWithBiometric(req: BiometricLoginRequest): Promise<ApiResponse<LoginResponse>> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(600);
    const tokens = mockTokens();
    setTokens(tokens.accessToken, tokens.refreshToken);

    return {
      success: true,
      data: {
        user: MOCK_USER,
        device: MOCK_DEVICE,
        tokens,
        branch: {
          id: 1,
          branchId: 'BR-KTW-001',
          name: 'Kathmandu West Branch',
          nameNe: 'काठमाडौं पश्चिम शाखा',
        },
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Real API call
  try {
    const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/auth/biometric`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const data = await response.json();

    if (data.success && data.data?.tokens) {
      // Support both camelCase (accessToken) and snake_case (access_token)
      const at = (data.data.tokens as any).accessToken || (data.data.tokens as any).access_token;
      const rt = (data.data.tokens as any).refreshToken || (data.data.tokens as any).refresh_token;
      setTokens(at, rt);
      if (data.data.user) {
        try { SecureStore.setItemAsync('fieldos_user_profile', JSON.stringify(data.data.user)); } catch {}
      }
    }

    return data;
  } catch (err: any) {
    return {
      success: false,
      data: {} as LoginResponse,
      message: err?.message || 'Network request failed',
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Refresh expired access token.
 */
export async function refreshAuthToken(): Promise<ApiResponse<RefreshTokenResponse>> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(300);
    const tokens = mockTokens();
    setTokens(tokens.accessToken, tokens.refreshToken);

    return {
      success: true,
      data: { tokens },
      timestamp: new Date().toISOString(),
    };
  }

  // Real API call
  const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: getAccessToken() }),
  });
  return await response.json();
}

/**
 * Register device with backend.
 */
export async function registerDevice(req: DeviceRegisterRequest): Promise<ApiResponse<{ deviceId: string }>> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(500);
    return {
      success: true,
      data: { deviceId: req.deviceId },
      message: 'Device registered',
      timestamp: new Date().toISOString(),
    };
  }

  // Real API call
  const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAccessToken()}` },
    body: JSON.stringify(req),
  });
  return await response.json();
}

/**
 * Logout — clear tokens, user profile, and local session.
 */
export async function logout(): Promise<void> {
  clearTokens();
  try { SecureStore.deleteItemAsync('fieldos_user_profile'); } catch {}
  await mockDelay(200);
}

/**
 * Get current authenticated user profile (from SecureStore).
 * Falls back to mock user when in mock mode.
 */
export async function getCurrentUser(): Promise<UserProfile | null> {
  const { enableMock } = getConfig();

  if (enableMock) {
    if (!getAccessToken()) return null;
    return MOCK_USER;
  }

  try {
    const raw = await SecureStore.getItemAsync('fieldos_user_profile');
    if (raw) {
      return JSON.parse(raw) as UserProfile;
    }
  } catch {}

  return null;
}

/**
 * Get cached user profile (synchronous, may return mock in mock mode).
 */
export function getCurrentUserSync(): UserProfile | null {
  const { enableMock } = getConfig();
  if (enableMock && getAccessToken()) {
    return MOCK_USER;
  }
  return null;
}

/**
 * Initialize auth state from secure storage.
 */
export async function initAuth(): Promise<void> {
  await loadTokens();
}

export type { LoginRequest, LoginResponse, BiometricLoginRequest };
