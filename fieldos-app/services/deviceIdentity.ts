/**
 * Device Identity Service — Phase 4
 *
 * Uses expo-device to read and store device information.
 * Generates a persistent device ID on first launch.
 */

import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { setDeviceId, getDeviceId, setBranchId, setUserRole, setUserId, getUserRole, getUserId, getBranchId } from './secureStorage';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceModel: string;
  osVersion: string;
  platform: string;
  appVersion: string;
  buildNumber: string;
}

// ─── ID Generation ────────────────────────────────────────────────

function generateDeviceId(): string {
  // Use a combination of platform info + random to create a unique ID
  const platform = Device.osName || 'unknown';
  const model = Device.modelName || 'unknown';
  const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
  const hash = `${platform}-${model}-${rand}`.replace(/\s+/g, '-');
  // Format: DEV-ANDROID-PIXEL6-XXXX
  return `DEV-${hash.substring(0, 28).toUpperCase()}`;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Initialize device identity.
 * Loads existing device ID or generates a new one.
 * Stores device info in secure storage.
 */
export async function initDeviceIdentity(): Promise<DeviceInfo> {
  // Check for existing device ID
  let deviceId = await getDeviceId();

  if (!deviceId) {
    // Generate and store new device ID
    deviceId = generateDeviceId();
    await setDeviceId(deviceId);
  }

  // Default user info for demo
  const existingRole = await getUserRole();
  if (!existingRole) {
    await setUserRole('field_officer');
  }
  const existingUserId = await getUserId();
  if (!existingUserId) {
    await setUserId('FO-208');
  }
  const existingBranch = await getBranchId();
  if (!existingBranch) {
    await setBranchId('BR-KTW-001');
  }

  return getDeviceInfo(deviceId);
}

/**
 * Get current device information.
 * Falls back to safe defaults if expo-device returns null/undefined.
 */
export function getDeviceInfo(deviceId?: string): DeviceInfo {
  const id = deviceId || 'DEV-UNKNOWN';

  return {
    deviceId: id,
    deviceName: Device.deviceName || 'Unknown Device',
    deviceModel: Device.modelName || 'Unknown',
    osVersion: Device.osVersion ? `${Device.osName} ${Device.osVersion}` : (Device.osName || 'Unknown OS'),
    platform: Device.osName || 'unknown',
    appVersion: Application.nativeApplicationVersion || '3.0.0',
    buildNumber: Application.nativeBuildVersion || '1',
  };
}

/**
 * Get stored device ID only.
 */
export async function getStoredDeviceId(): Promise<string | null> {
  return getDeviceId();
}

/**
 * Check if device is authorized (always true for MVP prototype).
 * In production, this would check against a server allowlist.
 */
export async function isDeviceAuthorized(): Promise<boolean> {
  const deviceId = await getDeviceId();
  return deviceId !== null; // Any device with stored ID is "authorized"
}

/**
 * Reset device identity (for testing / logout).
 */
export async function resetDeviceIdentity(): Promise<void> {
  const newId = generateDeviceId();
  await setDeviceId(newId);
}
