/**
 * Biometric Auth Service — Phase 4
 *
 * Wraps expo-local-authentication for:
 *   - Biometric Login
 *   - App Unlock
 *   - Optional fallback for Identity Verification
 */

import * as LocalAuthentication from 'expo-local-authentication';
import { isBiometricEnabled, setBiometricEnabled } from './secureStorage';

export interface BiometricResult {
  success: boolean;
  error?: string;
  biometricType?: string;
}

// ─── Check Availability ──────────────────────────────────────────

/**
 * Check if the device supports biometric authentication.
 */
export async function isBiometricAvailable(): Promise<{
  available: boolean;
  hasHardware: boolean;
  enrolled: boolean;
  biometricType?: string;
}> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();

  let biometricType: string | undefined;
  if (hasHardware && enrolled) {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      biometricType = 'Face ID';
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      biometricType = 'Fingerprint';
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      biometricType = 'Iris';
    } else {
      biometricType = 'Biometric';
    }
  }

  return {
    available: hasHardware && enrolled,
    hasHardware,
    enrolled,
    biometricType,
  };
}

// ─── Authenticate ────────────────────────────────────────────────

/**
 * Prompt for biometric authentication.
 *
 * @param reason - The reason shown to the user (e.g., "Login to FieldOS")
 * @param fallbackLabel - Label for the fallback button (PIN)
 * @param cancelLabel - Label for the cancel button
 */
export async function authenticate(
  reason: string = 'Verify your identity',
  fallbackLabel: string = 'Use PIN',
  cancelLabel: string = 'Cancel'
): Promise<BiometricResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      fallbackLabel,
      cancelLabel,
      disableDeviceFallback: false, // Allow PIN fallback
    });

    if (result.success) {
      return { success: true };
    } else {
      return {
        success: false,
        error: result.error === 'unknown'
          ? 'Authentication failed'
          : result.error,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Biometric auth error',
    };
  }
}

// ─── Settings ────────────────────────────────────────────────────

export async function getBiometricSetting(): Promise<boolean> {
  return isBiometricEnabled();
}

export async function setBiometricSetting(enabled: boolean): Promise<void> {
  await setBiometricEnabled(enabled);
}

// ─── Convenience ─────────────────────────────────────────────────

/**
 * Attempt biometric login.
 * Returns success/failure with error message if applicable.
 */
export async function biometricLogin(): Promise<BiometricResult> {
  const bio = await isBiometricAvailable();
  if (!bio.available) {
    return {
      success: false,
      error: bio.enrolled
        ? 'Biometric hardware not available'
        : 'No biometric enrolled on this device',
    };
  }

  return authenticate('Login to FieldOS Nepal');
}

/**
 * Attempt app unlock via biometric.
 * Used when app returns from background and app lock is active.
 */
export async function appUnlock(): Promise<BiometricResult> {
  const enabled = await isBiometricEnabled();
  if (!enabled) {
    return { success: true }; // Biometric not enabled — allow through
  }

  const bio = await isBiometricAvailable();
  if (!bio.available) {
    return { success: true }; // Can't use biometric — fall through to PIN
  }

  return authenticate('Unlock FieldOS', 'Use PIN');
}
