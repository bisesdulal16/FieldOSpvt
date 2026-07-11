/**
 * FieldOS Nepal — Day-Start Service
 *
 * Real "start of day" with two anti-fraud signals sent to the server:
 *   - a start-of-day selfie (front camera)
 *   - the request's source IP, which the backend checks against the branch office network
 *
 * The office-network check is enforced SERVER-SIDE (returns 403 when off-network), so it can't
 * be bypassed on the device.
 */

import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { getAccessToken } from './apiClient';

export interface DayStartResult {
  ok: boolean;
  blocked: boolean;       // true when the backend rejected because the officer is off-network
  ipVerified: boolean;
  message?: string;
}

/** Capture a start-of-day selfie (front camera). Returns a base64 data URI, or null if cancelled. */
export async function captureSelfie(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.front,
    quality: 0.4,
    base64: true,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]?.base64) return null;
  return `data:image/jpeg;base64,${result.assets[0].base64}`;
}

async function captureGps(): Promise<{ lat?: number; lng?: number; address?: string }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return {};
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    let address: string | undefined;
    try {
      const geo = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      const g = geo?.[0];
      if (g) address = [g.city, g.region].filter(Boolean).join(', ') || undefined;
    } catch { /* raw coords are fine */ }
    return { lat: loc.coords.latitude, lng: loc.coords.longitude, address };
  } catch {
    return {};
  }
}

/** Capture selfie + GPS, then call the server day-start gate. */
export async function startDayWithVerification(selfieDataUri: string | null): Promise<DayStartResult> {
  const gps = await captureGps();
  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
  const token = getAccessToken();
  try {
    const res = await fetch(`${apiUrl}/day-start/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : 'Bearer undefined',
      },
      body: JSON.stringify({
        selfie_data_uri: selfieDataUri,
        gps_latitude: gps.lat,
        gps_longitude: gps.lng,
        gps_address: gps.address,
      }),
    });
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, blocked: true, ipVerified: false, message: body?.detail || 'Not on the branch office network.' };
    }
    if (!res.ok) {
      return { ok: false, blocked: false, ipVerified: false, message: `Server error ${res.status}` };
    }
    const json = await res.json();
    return { ok: true, blocked: false, ipVerified: !!json?.data?.ip_verified };
  } catch (e: any) {
    // Offline / unreachable: allow the local day to start (offline-first), unverified.
    return { ok: true, blocked: false, ipVerified: false, message: 'offline' };
  }
}
