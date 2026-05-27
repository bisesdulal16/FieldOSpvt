/**
 * Secure Storage Service — Phase 4
 *
 * Wraps expo-secure-store for sensitive data:
 *   - Auth token
 *   - Session metadata
 *   - Device ID
 *   - App lock setting
 *   - User role
 *   - Branch ID
 *
 * All keys are namespaced with "fieldos_" prefix.
 * On web, expo-secure-store falls back to localStorage (dev mode only).
 */

import * as SecureStore from 'expo-secure-store';

// ─── Key Constants ────────────────────────────────────────────────

const KEYS = {
  AUTH_TOKEN: 'fieldos_auth_token',
  SESSION_CREATED: 'fieldos_session_created',
  SESSION_EXPIRES: 'fieldos_session_expires',
  DEVICE_ID: 'fieldos_device_id',
  USER_ROLE: 'fieldos_user_role',
  USER_ID: 'fieldos_user_id',
  BRANCH_ID: 'fieldos_branch_id',
  APP_LOCK_ENABLED: 'fieldos_app_lock_enabled',
  APP_LOCK_TIMEOUT: 'fieldos_app_lock_timeout',  // minutes
  LAST_ACTIVE: 'fieldos_last_active',
  BIOMETRIC_ENABLED: 'fieldos_biometric_enabled',
} as const;

// ─── Options ─────────────────────────────────────────────────────

const OPTIONS: SecureStore.SecureStoreOptions = {
  // expo-secure-store keychain options
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// ─── Generic Helpers ─────────────────────────────────────────────

async function setItem(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value, OPTIONS);
  } catch (err) {
    // Fallback: web or simulator may not support keychain
    console.warn(`[SecureStore] Failed to set ${key}:`, err);
  }
}

async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, OPTIONS);
  } catch (err) {
    console.warn(`[SecureStore] Failed to get ${key}:`, err);
    return null;
  }
}

async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, OPTIONS);
  } catch (err) {
    console.warn(`[SecureStore] Failed to delete ${key}:`, err);
  }
}

// ─── Auth Token ──────────────────────────────────────────────────

export async function setAuthToken(token: string): Promise<void> {
  await setItem(KEYS.AUTH_TOKEN, token);
  await setItem(KEYS.SESSION_CREATED, new Date().toISOString());
  // Session expires in 24 hours
  const expires = new Date();
  expires.setHours(expires.getHours() + 24);
  await setItem(KEYS.SESSION_EXPIRES, expires.toISOString());
}

export async function getAuthToken(): Promise<string | null> {
  const token = await getItem(KEYS.AUTH_TOKEN);
  if (!token) return null;

  // Check if session is expired
  const expires = await getItem(KEYS.SESSION_EXPIRES);
  if (expires && new Date(expires) < new Date()) {
    // Session expired — clear everything
    await clearSession();
    return null;
  }

  return token;
}

export async function isSessionActive(): Promise<boolean> {
  const token = await getAuthToken();
  return token !== null;
}

// ─── Session Management ──────────────────────────────────────────

export async function getSessionCreated(): Promise<string | null> {
  return getItem(KEYS.SESSION_CREATED);
}

export async function clearSession(): Promise<void> {
  await deleteItem(KEYS.AUTH_TOKEN);
  await deleteItem(KEYS.SESSION_CREATED);
  await deleteItem(KEYS.SESSION_EXPIRES);
  await deleteItem(KEYS.LAST_ACTIVE);
}

// ─── Device Identity ─────────────────────────────────────────────

export async function setDeviceId(deviceId: string): Promise<void> {
  await setItem(KEYS.DEVICE_ID, deviceId);
}

export async function getDeviceId(): Promise<string | null> {
  return getItem(KEYS.DEVICE_ID);
}

// ─── User Info ───────────────────────────────────────────────────

export async function setUserRole(role: string): Promise<void> {
  await setItem(KEYS.USER_ROLE, role);
}

export async function getUserRole(): Promise<string | null> {
  return getItem(KEYS.USER_ROLE);
}

export async function setUserId(userId: string): Promise<void> {
  await setItem(KEYS.USER_ID, userId);
}

export async function getUserId(): Promise<string | null> {
  return getItem(KEYS.USER_ID);
}

export async function setBranchId(branchId: string): Promise<void> {
  await setItem(KEYS.BRANCH_ID, branchId);
}

export async function getBranchId(): Promise<string | null> {
  return getItem(KEYS.BRANCH_ID);
}

// ─── App Lock ────────────────────────────────────────────────────

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await setItem(KEYS.APP_LOCK_ENABLED, enabled ? 'true' : 'false');
}

export async function isAppLockEnabled(): Promise<boolean> {
  const val = await getItem(KEYS.APP_LOCK_ENABLED);
  return val === 'true';
}

export async function setAppLockTimeout(minutes: number): Promise<void> {
  await setItem(KEYS.APP_LOCK_TIMEOUT, String(minutes));
}

export async function getAppLockTimeout(): Promise<number> {
  const val = await getItem(KEYS.APP_LOCK_TIMEOUT);
  return val ? parseInt(val, 10) : 5; // default 5 minutes
}

export async function setLastActive(): Promise<void> {
  await setItem(KEYS.LAST_ACTIVE, new Date().toISOString());
}

export async function getLastActive(): Promise<Date | null> {
  const val = await getItem(KEYS.LAST_ACTIVE);
  return val ? new Date(val) : null;
}

export async function isAppLocked(): Promise<boolean> {
  const enabled = await isAppLockEnabled();
  if (!enabled) return false;

  const lastActive = await getLastActive();
  if (!lastActive) return false;

  const timeout = await getAppLockTimeout();
  const elapsed = (Date.now() - lastActive.getTime()) / 60000; // minutes
  return elapsed >= timeout;
}

// ─── Biometric Setting ───────────────────────────────────────────

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await setItem(KEYS.BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
}

export async function isBiometricEnabled(): Promise<boolean> {
  const val = await getItem(KEYS.BIOMETRIC_ENABLED);
  return val === 'true';
}

// ─── Full Init / Reset ──────────────────────────────────────────

/** Initialize secure storage with default values for a new session */
export async function initSecureStorage(): Promise<void> {
  // Set defaults if not already set
  if (await getItem(KEYS.BIOMETRIC_ENABLED) === null) {
    await setItem(KEYS.BIOMETRIC_ENABLED, 'false');
  }
  if (await getItem(KEYS.APP_LOCK_ENABLED) === null) {
    await setItem(KEYS.APP_LOCK_ENABLED, 'true');
  }
  if (await getItem(KEYS.APP_LOCK_TIMEOUT) === null) {
    await setItem(KEYS.APP_LOCK_TIMEOUT, '5');
  }
}

/** Clear ALL secure storage data (full logout) */
export async function clearAllSecureData(): Promise<void> {
  await clearSession();
  await deleteItem(KEYS.DEVICE_ID);
  await deleteItem(KEYS.USER_ROLE);
  await deleteItem(KEYS.USER_ID);
  await deleteItem(KEYS.BRANCH_ID);
  await deleteItem(KEYS.APP_LOCK_ENABLED);
  await deleteItem(KEYS.APP_LOCK_TIMEOUT);
  await deleteItem(KEYS.BIOMETRIC_ENABLED);
}
