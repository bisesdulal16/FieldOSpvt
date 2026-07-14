/**
 * FieldOS Nepal — Face Verification Service (attendance clock-in)
 *
 * This is ATTENDANCE tooling — the face punch-in countless orgs use — not field
 * surveillance (decision 2026-07-14). Matching runs ON-DEVICE:
 *
 *   enroll:  capture reference face → MobileFaceNet embedding → POST /face/enroll
 *            (server keeps a backup copy so a reinstalled app can re-hydrate).
 *   verify:  at start-of-day, capture a live face (with a blink/turn liveness
 *            check) → embedding → cosine-similarity vs the enrolled template →
 *            pass/fail at THRESHOLD. The result rides along on the day-start POST.
 *
 * If the device can't run the model (Expo Go, low-end phone, model missing), the
 * caller falls back to plain photo-proof — the day-start selfie still works.
 */
import * as SecureStore from 'expo-secure-store';
import { getConfig, getAccessToken } from './apiClient';

// Cosine-similarity pass mark for MobileFaceNet. 0.6–0.7 is the usual band;
// DEVICE-TUNE this against real officers + cameras during the pilot.
export const FACE_MATCH_THRESHOLD = Number(
  process.env.EXPO_PUBLIC_FACE_THRESHOLD || 0.62,
);

const TEMPLATE_KEY = 'fieldos_face_template';

let _memTemplate: number[] | null = null;

// ─── Vector math ─────────────────────────────────────────────────

/** L2-normalise so cosine similarity == dot product. */
export function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : -1;
}

// ─── Local template cache ────────────────────────────────────────

async function cacheTemplate(embedding: number[]): Promise<void> {
  _memTemplate = embedding;
  try {
    // Small (128–192 floats). Best-effort; server /face/status is the source of truth.
    await SecureStore.setItemAsync(TEMPLATE_KEY, JSON.stringify(embedding));
  } catch (e) {
    console.warn('[faceVerify] could not persist template locally', e);
  }
}

/** Get the enrolled reference embedding: memory → SecureStore → server. */
export async function getEnrolledTemplate(): Promise<number[] | null> {
  if (_memTemplate) return _memTemplate;
  try {
    const cached = await SecureStore.getItemAsync(TEMPLATE_KEY);
    if (cached) {
      _memTemplate = JSON.parse(cached);
      return _memTemplate;
    }
  } catch { /* fall through to server */ }
  return hydrateFromServer();
}

/** Pull the officer's enrolled template from the backend and cache it locally. */
export async function hydrateFromServer(): Promise<number[] | null> {
  try {
    const { baseUrl } = getConfig();
    const token = getAccessToken();
    const res = await fetch(`${baseUrl}/face/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const json = await res.json();
    const template = json?.data?.template;
    if (Array.isArray(template) && template.length) {
      await cacheTemplate(template);
      return template;
    }
  } catch (e) {
    console.warn('[faceVerify] server hydrate failed', e);
  }
  return null;
}

export async function isEnrolled(): Promise<boolean> {
  return (await getEnrolledTemplate()) !== null;
}

// ─── Enroll ──────────────────────────────────────────────────────

export async function enrollFace(
  embedding: number[],
  selfieDataUri?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const normalized = l2normalize(embedding);
  try {
    const { baseUrl } = getConfig();
    const token = getAccessToken();
    const res = await fetch(`${baseUrl}/face/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ embedding: normalized, selfie_data_uri: selfieDataUri ?? null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { success: false, error: body?.detail || `Enroll failed (${res.status})` };
    }
    await cacheTemplate(normalized);
    return { success: true };
  } catch (e) {
    // Offline: still cache locally so verification works today; it syncs on next enroll.
    await cacheTemplate(normalized);
    return { success: false, error: 'Saved on device (offline) — will re-sync when online.' };
  }
}

// ─── Verify ──────────────────────────────────────────────────────

export interface FaceVerifyResult {
  verified: boolean;
  similarity: number;
  reason?: 'no_enrollment' | 'below_threshold' | 'ok';
}

/** Compare a freshly-captured embedding to the enrolled template. */
export async function verifyEmbedding(embedding: number[]): Promise<FaceVerifyResult> {
  const enrolled = await getEnrolledTemplate();
  if (!enrolled) return { verified: false, similarity: -1, reason: 'no_enrollment' };
  const similarity = cosineSimilarity(l2normalize(embedding), enrolled);
  const verified = similarity >= FACE_MATCH_THRESHOLD;
  return { verified, similarity, reason: verified ? 'ok' : 'below_threshold' };
}
