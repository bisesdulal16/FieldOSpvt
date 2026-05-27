/**
 * FieldOS Nepal — Device Service
 *
 * Handles device registration, identity, and health checks.
 * Wraps expo-device and expo-application for device information.
 */

import { getConfig } from './apiClient';
import type { DeviceInfo, DeviceRegisterRequest, ApiResponse } from '../types/api';

// ─── Mock Helpers ────────────────────────────────────────────────

function mockDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Register device with the backend.
 */
export async function registerDevice(req: DeviceRegisterRequest): Promise<ApiResponse<DeviceInfo>> {
  const { enableMock } = getConfig();

  if (enableMock) {
    await mockDelay(500);
    return {
      success: true,
      data: {
        id: 1,
        deviceId: req.deviceId,
        deviceName: req.deviceName,
        deviceModel: req.deviceModel,
        osVersion: req.osVersion,
        appVersion: req.appVersion,
        isRegistered: true,
        lastSyncAt: null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Real API call
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  const token = require('./apiClient').getAccessToken();

  const response = await fetch(`${apiUrl}/devices/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  });
  return await response.json();
}

/**
 * Send device heartbeat / health check.
 */
export async function sendDeviceHeartbeat(): Promise<void> {
  const { enableMock } = getConfig();

  if (enableMock) {
    return;
  }

  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
    const token = require('./apiClient').getAccessToken();
    const deviceInfo = require('./deviceIdentity').getDeviceInfo();

    await fetch(`${apiUrl}/devices/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        deviceId: deviceInfo.deviceId,
        batteryLevel: deviceInfo.batteryLevel,
        appVersion: deviceInfo.appVersion,
      }),
    });
  } catch {
    // Non-critical, fail silently
  }
}
