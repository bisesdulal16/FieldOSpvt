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

/**
 * Average several embeddings into one L2-normalized centroid.
 *
 * A single capture is noisy — the same person's cosine can swing ~0.2 across
 * frames (measured on real devices: genuine ranged 0.49–0.89 off ONE enroll
 * photo). Averaging N captures cancels per-frame noise: the genuine centroid
 * rises and tightens, while an impostor's lucky high frame is pulled back down
 * toward their true (lower) mean. This is the main lever that opens the
 * genuine-vs-lookalike gap without swapping the model. Used for both the
 * enrolled template and the live verify sample.
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  const valid = embeddings.filter((e) => Array.isArray(e) && e.length > 0);
  if (valid.length === 0) return [];
  const dim = valid[0].length;
  const sum = new Array(dim).fill(0);
  for (const e of valid) {
    if (e.length !== dim) continue; // skip a malformed frame rather than corrupt the mean
    for (let i = 0; i < dim; i++) sum[i] += e[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= valid.length;
  return l2normalize(sum);
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

export interface FaceStatus {
  enrolled: boolean;
  enrolled_at: string | null;
  dims: number;
  face_photo: string | null; // profile picture (first-enroll selfie), data URI
}

/** Fetch the officer's enrollment status incl. profile picture. Null on failure. */
export async function getFaceStatus(): Promise<FaceStatus | null> {
  try {
    const { baseUrl } = getConfig();
    const token = getAccessToken();
    const res = await fetch(`${baseUrl}/face/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const json = await res.json();
    return (json?.data as FaceStatus) ?? null;
  } catch (e) {
    console.warn('[faceVerify] getFaceStatus failed', e);
    return null;
  }
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
  embedding: number[] | number[][],
  selfieDataUri?: string | null,
): Promise<{ success: boolean; error?: string }> {
  // Accept a single embedding (legacy) or several captures to average into a
  // stable centroid template. A number[][] is averaged; a number[] is used as-is.
  const isMulti = Array.isArray(embedding[0]);
  const normalized = isMulti
    ? averageEmbeddings(embedding as number[][])
    : l2normalize(embedding as number[]);
  if (!normalized.length) {
    return { success: false, error: 'No usable face captures to enroll.' };
  }
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

const FACE_DEBUG =
  String(process.env.EXPO_PUBLIC_FACE_DEBUG).toLowerCase() === 'true';

/** Compare a freshly-captured embedding to the enrolled template. */
export async function verifyEmbedding(embedding: number[]): Promise<FaceVerifyResult> {
  const enrolled = await getEnrolledTemplate();
  if (!enrolled) return { verified: false, similarity: -1, reason: 'no_enrollment' };
  const similarity = cosineSimilarity(l2normalize(embedding), enrolled);
  const verified = similarity >= FACE_MATCH_THRESHOLD;
  if (FACE_DEBUG) {
    // The number to tune the threshold on: capture same-person and different-person
    // scores on real officers/cameras. With correct (signed) preprocessing, expect
    // same-person cosine > ~0.7 and cross-person < ~0.45.
    console.log(
      `[faceVerify] cosine=${similarity.toFixed(4)} threshold=${FACE_MATCH_THRESHOLD} → ${verified ? 'PASS' : 'FAIL'}`,
    );
  }
  return { verified, similarity, reason: verified ? 'ok' : 'below_threshold' };
}

/**
 * Verify several live captures at once: average them into one sample, then
 * compare to the enrolled template. Averaging the verify side (like enrollment)
 * stops an impostor from passing on a single lucky frame — their high frame is
 * pulled back toward their mean — while smoothing a genuine officer's dips.
 */
export async function verifyEmbeddings(embeddings: number[][]): Promise<FaceVerifyResult> {
  const sample = averageEmbeddings(embeddings);
  if (!sample.length) return { verified: false, similarity: -1, reason: 'no_enrollment' };
  const enrolled = await getEnrolledTemplate();
  if (!enrolled) return { verified: false, similarity: -1, reason: 'no_enrollment' };
  const similarity = cosineSimilarity(sample, enrolled);
  const verified = similarity >= FACE_MATCH_THRESHOLD;
  if (FACE_DEBUG) {
    console.log(
      `[faceVerify] avg-of-${embeddings.length} cosine=${similarity.toFixed(4)} threshold=${FACE_MATCH_THRESHOLD} → ${verified ? 'PASS' : 'FAIL'}`,
    );
  }
  return { verified, similarity, reason: verified ? 'ok' : 'below_threshold' };
}
