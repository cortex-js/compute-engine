import { Complex } from 'complex-esm';
import { lerchPhiComplex, lerchPhiReal } from './lerch-phi.js';

// Liₛ(z) = z·Φ(z,s,1): `PolyLog` widened to a non-integer or complex order s
// (cortex-js/compute-engine#340), reusing the Lerch transcendent kernel
// (`lerch-phi.ts`) at base point a = 1 rather than a second series/
// continuation implementation. Native `PolyLog` already evaluates an
// integer order ≥ 2 (`numerics/special-functions.ts`'s `polylog`,
// `numeric-complex.ts`'s `polylogComplex`) and the elementary/ζ reductions
// in `library/special-functions.ts`'s `polylogReduce`; this widening only
// engages where those decline.

const C_ONE = new Complex(1, 0);
const C_NAN = new Complex(NaN, NaN);

/**
 * True where `lerchPhiComplex`'s interior summation (`lerchSeriesComplex`
 * inside the disk, `lerchEulerComplex` on the real negative axis) has been
 * measured to lose more than 1e−12 relative accuracy. Both sum a
 * formally divergent, growing-magnitude series once Re(s) is very
 * negative (the (k+1)^(−s) term grows like (k+1)^|s| before |z|ᵏ decay
 * catches up), and the accumulated rounding grows sharply as |z| → 1.
 * Cross-checked against mpmath (dps 30) on the real axis: at z = −1 the
 * error first exceeds 1e−12 between s = −1.2 (1.8e−14) and s = −1.3
 * (2.8e−12); at z = −0.9 between s = −2.5 (8.2e−13) and s = −3 (2.0e−12);
 * at z = −0.8 between s = −3.5 (6.5e−13) and s = −4 (6.6e−12); a complex
 * z inside the disk shows the same pattern (2.8e−12 at s ≈ −3.7 + 2.8i,
 * |z| ≈ 0.74). This linear bound in |z| stays clear of every measured
 * failure, with margin to spare.
 */
function seriesUnreliable(sRe: number, zRe: number, zIm: number): boolean {
  // The Euler transform runs on the whole real negative axis, z = −1
  // itself included (`lerchPhiComplex` dispatches every real z < 0 there
  // regardless of |z|), so this branch is checked on |z| directly, ahead
  // of the interior-only `absZ >= 1` exit below.
  if (zIm === 0 && zRe < 0) return sRe < -1 - 4 * (1 - Math.abs(zRe));
  const absZ = Math.hypot(zRe, zIm);
  if (absZ >= 1) return false; // outside the disk: `nearBranchPointUnreliable` covers it
  return sRe < -1 - 4 * (1 - absZ);
}

/**
 * True where the Hermite-integral continuation right at the z = 1 branch
 * point loses more than 1e−12 relative accuracy: the closed-form term
 * `Γ(1−s)(−log z)^(s−1)` grows without bound approaching z = 1, and its
 * cancellation against the rest widens faster than the kernel's own
 * `lost` guard (tuned to 1e−10) catches. Cross-checked against mpmath: up
 * to ~2e−9 at |z − 1| between 1e−4 and 1e−2 for s in [3, 5]; elsewhere on
 * the unit circle (`nearPositiveIntegerOrderUnreliable` aside) the same
 * continuation reaches 1e−15 (checked at z = i, 0.6+0.8i, −0.6+0.8i,
 * 0.8−0.6i for s ∈ {±0.5, ±1.5, …, 5.5}), so this guard is a point
 * exclusion around z = 1, not a blanket rim decline. z = 1 itself is
 * excluded — `lerchPhiComplex` answers that point exactly, via
 * `HurwitzZeta`, not through this continuation.
 */
function nearBranchPointUnreliable(zRe: number, zIm: number): boolean {
  if (zRe === 1 && zIm === 0) return false;
  return Math.hypot(zRe - 1, zIm) < 0.02;
}

/**
 * True where the continuation loses more than 1e−12 relative accuracy
 * because s sits close to a positive integer: `Γ(1−s)` has a pole at every
 * positive integer, so nearby the closed-form term and the rest of
 * `lerchContinuedComplex`'s sum swing through a large intermediate value
 * before mostly cancelling, and the reported `lost` estimate (tuned to
 * 1e−10) does not catch it this close in. Cross-checked against mpmath at
 * z ≈ −0.86 − 0.51i (on the rim): s = 5 − 0.05 (9.2e−14, safe), s = 5 −
 * 0.02 (4.6e−13, safe), s = 5 − 0.01 (6.3e−12, fails). Only engages where
 * the continuation (not the interior series) is actually doing the work.
 */
function nearPositiveIntegerOrderUnreliable(
  sRe: number,
  zRe: number,
  zIm: number
): boolean {
  if (zRe === 1 && zIm === 0) return false;
  if (Math.hypot(zRe, zIm) < 0.9) return false;
  const nearest = Math.round(sRe);
  return nearest >= 1 && sRe !== nearest && Math.abs(sRe - nearest) < 0.05;
}

/**
 * Liₛ(z) = z·Φ(z,s,1) for complex s, z, at machine precision. `NaN` where
 * `lerchPhiComplex`'s continuation past |z| = 1 declines, or where either
 * guard above catches an unreliable but not-NaN kernel answer — the
 * caller (`applyN`) reads a NaN kernel result as "stay symbolic" rather
 * than ship an unverified number.
 */
export function polylogOrderComplex(s: Complex, z: Complex): Complex {
  if (
    seriesUnreliable(s.re, z.re, z.im) ||
    nearBranchPointUnreliable(z.re, z.im) ||
    nearPositiveIntegerOrderUnreliable(s.re, z.re, z.im)
  )
    return C_NAN;
  const phi = lerchPhiComplex(z, s, C_ONE);
  return phi === undefined ? C_NAN : z.mul(phi);
}

/**
 * Real-valued Liₛ(z) for real s, z — the compiled (JS/GPU) real-scalar
 * lane. `NaN` for a genuinely complex value, a declined continuation, or
 * either reliability guard above, matching `lerchPhiReal`.
 */
export function polylogOrderReal(s: number, z: number): number {
  if (Number.isNaN(s) || Number.isNaN(z)) return NaN;
  if (
    seriesUnreliable(s, z, 0) ||
    nearBranchPointUnreliable(z, 0) ||
    nearPositiveIntegerOrderUnreliable(s, z, 0)
  )
    return NaN;
  return z * lerchPhiReal(z, s, 1);
}
