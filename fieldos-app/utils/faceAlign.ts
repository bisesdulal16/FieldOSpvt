/**
 * FieldOS Nepal — 5-point face alignment (worklet-safe, pure arithmetic)
 *
 * MobileFaceNet (ArcFace training) expects a LANDMARK-ALIGNED 112×112 crop —
 * eyes/nose/mouth warped onto a fixed canonical template — NOT a raw bounding-box
 * crop. Feeding a loose bbox crop collapses the embedding space so two different
 * people captured in the same pose score ~0.999 cosine (the pilot's false-accept).
 *
 * This module computes the similarity transform from the detector's 5 landmarks to
 * the canonical template (Umeyama, closed-form) and warps the frame's RGB pixels
 * into a 112×112 buffer by inverse-mapping + bilinear sampling. Everything here is
 * plain math with no imports, so it runs inside the vision-camera frame-processor
 * worklet. Enroll and verify BOTH call this via FaceScanner, so their preprocessing
 * is identical — a hard requirement for the cosine comparison to be meaningful.
 *
 * Verified offline against the live model: with this alignment, LFW same-person
 * cosine ≈ 0.77 and different-person ≈ 0.11 (separation ≈ 0.66); without it, ~0.32.
 */

/** Standard ArcFace 5-point destination template for a 112×112 crop.
 *  Order MUST match the source-point order passed to similarityTransform:
 *  [left eye, right eye, nose, mouth-left, mouth-right]. */
export const ARC_TEMPLATE_112: number[][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export interface Point {
  x: number;
  y: number;
}

/** A 2×3 affine matrix [[a, b, tx], [c, d, ty]] mapping src → dst. */
export type Affine = [number, number, number, number, number, number];

/**
 * Umeyama similarity transform (rotation + uniform scale + translation, no shear)
 * mapping `src` points onto `dst` points. Closed-form via the 2×2 covariance and its
 * SVD; for 2×2 the SVD is done analytically so this stays worklet-safe (no libs).
 * Returns the affine as [a, b, tx, c, d, ty] such that dst ≈ [[a,b],[c,d]]·src + [tx,ty].
 */
export function similarityTransform(src: number[][], dst: number[][]): Affine {
  'worklet';

  // NOTE: the SVD/eigen helpers are declared *inside* this function on purpose.
  // The react-native-worklets-core Babel plugin only captures the closure at each
  // worklet's definition site. A cross-module `'worklet'` helper referenced only
  // from *within* another worklet (never named in the frame-processor closure)
  // resolves to `undefined` in the worklet runtime → "undefined is not a function"
  // the first time similarityTransform runs on a frame. Inlining them as local
  // consts keeps everything in one captured closure. Do NOT hoist these back out.

  /** Eigen-decomposition of a symmetric 2×2 [[a,b],[b,c]] → cos/sin of the rotation
   *  to its eigenbasis and the two eigenvalues (l1 ≥ l2). */
  const symEig2x2 = (a: number, b: number, c: number) => {
    'worklet';
    const tr = a + c;
    const diff = a - c;
    const disc = Math.sqrt(diff * diff + 4 * b * b);
    const l1 = (tr + disc) / 2;
    const l2 = (tr - disc) / 2;
    let cs: number, sn: number;
    if (Math.abs(b) < 1e-12) {
      cs = 1; sn = 0; // already diagonal
    } else {
      const y = l1 - a;
      const norm = Math.sqrt(b * b + y * y) || 1;
      cs = b / norm;
      sn = y / norm;
    }
    return { c: cs, s: sn, l1, l2 };
  };

  /** Analytic SVD of a 2×2 matrix [[a,b],[c,d]] → U, S(diag as [s0,s1]), V. */
  const svd2x2 = (a: number, b: number, c: number, d: number) => {
    'worklet';
    // Eigen-decompose AᵀA to get V and singular values.
    const ata00 = a * a + c * c;
    const ata01 = a * b + c * d;
    const ata11 = b * b + d * d;
    const { c: vc, s: vs, l1, l2 } = symEig2x2(ata00, ata01, ata11);
    const s0 = Math.sqrt(Math.max(l1, 0));
    const s1 = Math.sqrt(Math.max(l2, 0));
    // V columns are the eigenvectors: [[vc,-vs],[vs,vc]]
    const Vm = [vc, -vs, vs, vc];
    // U = A V Σ⁻¹  (column-wise); guard tiny singulars.
    const inv0 = s0 > 1e-12 ? 1 / s0 : 0;
    const inv1 = s1 > 1e-12 ? 1 / s1 : 0;
    const av0x = a * Vm[0] + b * Vm[2], av0y = c * Vm[0] + d * Vm[2];
    const av1x = a * Vm[1] + b * Vm[3], av1y = c * Vm[1] + d * Vm[3];
    const Um = [av0x * inv0, av1x * inv1, av0y * inv0, av1y * inv1];
    return { U: Um, S: [s0, s1], V: Vm };
  };

  const n = src.length;
  // means
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) {
    msx += src[i][0]; msy += src[i][1];
    mdx += dst[i][0]; mdy += dst[i][1];
  }
  msx /= n; msy /= n; mdx /= n; mdy /= n;

  // covariance H = (1/n) Σ (dst-μd)(src-μs)ᵀ  and source variance
  let h00 = 0, h01 = 0, h10 = 0, h11 = 0, varSrc = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - msx, sy = src[i][1] - msy;
    const dx = dst[i][0] - mdx, dy = dst[i][1] - mdy;
    h00 += dx * sx; h01 += dx * sy;
    h10 += dy * sx; h11 += dy * sy;
    varSrc += sx * sx + sy * sy;
  }
  h00 /= n; h01 /= n; h10 /= n; h11 /= n;
  varSrc /= n;

  // Analytic SVD of the 2×2 H = U Σ Vᵀ, then R = U D Vᵀ with D fixing reflection.
  const { U, S, V } = svd2x2(h00, h01, h10, h11);
  // D = diag(1, ±1) so det(R) = +1 (proper rotation, no mirror)
  const detU = U[0] * U[3] - U[1] * U[2];
  const detV = V[0] * V[3] - V[1] * V[2];
  const d2 = detU * detV < 0 ? -1 : 1;

  // R = U · diag(1, d2) · Vᵀ
  const Vt00 = V[0], Vt01 = V[2], Vt10 = V[1], Vt11 = V[3]; // Vᵀ
  const r00 = U[0] * Vt00 + U[1] * d2 * Vt10;
  const r01 = U[0] * Vt01 + U[1] * d2 * Vt11;
  const r10 = U[2] * Vt00 + U[3] * d2 * Vt10;
  const r11 = U[2] * Vt01 + U[3] * d2 * Vt11;

  // uniform scale = trace(Σ·D) / varSrc
  const scale = varSrc > 0 ? (S[0] + d2 * S[1]) / varSrc : 1;

  const a = scale * r00, b = scale * r01;
  const c = scale * r10, d = scale * r11;
  const tx = mdx - (a * msx + b * msy);
  const ty = mdy - (c * msx + d * msy);
  return [a, b, tx, c, d, ty];
}

/**
 * Warp an interleaved RGB buffer (`w`×`h`, row-major, 3 channels, values 0–255)
 * into a fresh 112×112×3 uint8 array using the inverse of `m` (dst→src) and
 * bilinear sampling. Out-of-bounds samples clamp to the nearest edge.
 */
export function warpToTemplate(
  rgb: Uint8Array | number[],
  w: number,
  h: number,
  m: Affine,
  size: number = 112,
): Uint8Array {
  'worklet';
  // invert the 2×3 affine [a b tx; c d ty]. Index directly — array destructuring
  // makes Babel inject a `_slicedToArray` helper that isn't a worklet, which the
  // worklet runtime rejects ("Regular javascript function '_slicedToArray' cannot
  // be shared"). Same class of trap as the inlined SVD helpers above.
  const a = m[0], b = m[1], tx = m[2], c = m[3], d = m[4], ty = m[5];
  const det = a * d - b * c;
  const idet = det !== 0 ? 1 / det : 0;
  const ia = d * idet, ib = -b * idet;
  const ic = -c * idet, idd = a * idet;
  const itx = -(ia * tx + ib * ty);
  const ity = -(ic * tx + idd * ty);

  const out = new Uint8Array(size * size * 3);
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      // map output pixel → source coords
      let sxf = ia * ox + ib * oy + itx;
      let syf = ic * ox + idd * oy + ity;
      // clamp to valid sampling range
      if (sxf < 0) sxf = 0; else if (sxf > w - 1) sxf = w - 1;
      if (syf < 0) syf = 0; else if (syf > h - 1) syf = h - 1;
      const x0 = Math.floor(sxf), y0 = Math.floor(syf);
      const x1 = x0 + 1 < w ? x0 + 1 : x0;
      const y1 = y0 + 1 < h ? y0 + 1 : y0;
      const fx = sxf - x0, fy = syf - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w01 = fx * (1 - fy);
      const w10 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (y0 * w + x0) * 3;
      const i01 = (y0 * w + x1) * 3;
      const i10 = (y1 * w + x0) * 3;
      const i11 = (y1 * w + x1) * 3;
      const o = (oy * size + ox) * 3;
      for (let ch = 0; ch < 3; ch++) {
        out[o + ch] =
          rgb[i00 + ch] * w00 +
          rgb[i01 + ch] * w01 +
          rgb[i10 + ch] * w10 +
          rgb[i11 + ch] * w11;
      }
    }
  }
  return out;
}
