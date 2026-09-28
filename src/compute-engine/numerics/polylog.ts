import { Complex } from 'complex-esm';
import { lerchPhiComplex } from './lerch-phi.js';
import {
  gamma as gammaComplex,
  hurwitzZetaComplex,
  polylogComplex,
} from './numeric-complex.js';
import { polylog as polylogIntegerReal } from './special-functions.js';

// Liₛ(z) = z·Φ(z,s,1): `PolyLog` widened to a non-integer or complex order s
// (cortex-js/compute-engine#340), reusing the Lerch transcendent kernel
// (`lerch-phi.ts`) at base point a = 1 rather than a second series/
// continuation implementation. Native `PolyLog` already evaluates an
// integer order ≥ 2 (`numerics/special-functions.ts`'s `polylog`,
// `numeric-complex.ts`'s `polylogComplex`) and the elementary/ζ reductions
// in `library/special-functions.ts`'s `polylogReduce`. The interpreter only
// calls this widening where those decline, but the compiled (JavaScript)
// lane calls `polylogOrderReal` for EVERY order, so both entry points below
// dispatch the integer orders to the same closed forms and dedicated kernel
// first (`polylogIntegerOrder*`).

const C_ZERO = new Complex(0, 0);
const C_ONE = new Complex(1, 0);
const C_NAN = new Complex(NaN, NaN);

/**
 * The largest n for which Li₋ₙ(z) is computed from its rational closed form
 * (`eulerianRow`). Measured against mpmath at z ∈ {−0.99, −0.999, −1.01,
 * −1.5, −3, −100, ±1e6, 0.3, 0.5, 0.9, 0.99, 0.9999, 1.0001, 1.01, 5,
 * 0.5+0.5i, −0.9+0.4i, 2−3i}: the relative error stays below 1e−12 up to
 * n = 12 (worst 6.3e−13, at z = −0.999, next to the zero that an even order
 * has at z = −1) and reaches 1.9e−12 at n = 14. `library/special-functions.ts`
 * uses the same bound for its exact reduction.
 */
export const EULERIAN_MAX_ORDER = 12;

/**
 * Row n of the Eulerian numbers A(n, k), k = 0 … n − 1, from the recurrence
 * A(m, k) = (k + 1)·A(m−1, k) + (m − k)·A(m−1, k−1). They give the closed
 * form of a polylogarithm of negative integer order:
 *
 *   Li₋ₙ(z) = z · Σₖ A(n, k) zᵏ / (1 − z)ⁿ⁺¹,   n ≥ 1.
 *
 * Every entry for n ≤ 20 is an exact double (the row sums to n!).
 */
export function eulerianRow(n: number): number[] {
  let row = [1];
  for (let m = 1; m <= n; m++) {
    const next: number[] = [];
    for (let k = 0; k < m; k++)
      next.push((k + 1) * (row[k] ?? 0) + (m - k) * (row[k - 1] ?? 0));
    row = next;
  }
  return row;
}

/** Li₋ₙ(z) from the Eulerian closed form (see `eulerianRow`), n ≥ 1, z ≠ 1. */
function polylogNegativeIntegerComplex(n: number, z: Complex): Complex {
  const a = eulerianRow(n);
  let p = C_ZERO;
  for (let k = a.length - 1; k >= 0; k--) p = p.mul(z).add(a[k]);
  return z.mul(p).div(C_ONE.sub(z).pow(n + 1));
}

/**
 * Liₙ(z) for an integer order n, or `undefined` when n is outside the range
 * that this function handles (n < −EULERIAN_MAX_ORDER). The poles at z = 1
 * of the orders 1, 0 and −1 are returned as a complex infinity (the compiled
 * lane reads it as `Infinity`). For n ≤ −2, z = 1 is the point value ζ(n) of
 * the Hurwitz-zeta continuation, the same value `polylogReduce` gives in the
 * interpreter, not the pole of the rational closed form.
 */
function polylogIntegerOrderComplex(
  n: number,
  z: Complex
): Complex | undefined {
  const atOne = z.im === 0 && z.re === 1;
  if (n >= 2) return polylogComplex(new Complex(n, 0), z);
  if (n >= -1 && atOne) return new Complex(Infinity, 0);
  if (n === 1) return C_ONE.sub(z).log().neg();
  if (n === 0) return z.div(C_ONE.sub(z));
  if (n === -1) return z.div(C_ONE.sub(z).pow(2));
  if (n < -EULERIAN_MAX_ORDER) return undefined;
  if (atOne) return hurwitzZetaComplex(new Complex(n, 0), C_ONE);
  return polylogNegativeIntegerComplex(-n, z);
}

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
 * z inside the disk shows the same pattern (4.0e−12 at s = −3.7 + 2.8i,
 * z = −0.74i; 5.0e−12 at z = 0.19 − 0.71i, so a complex order needs the
 * bound in the right half of the disk too). This linear bound in |z|
 * stays clear of every measured failure, with margin to spare.
 *
 * A real order with a positive real z is exempt: every term of the series
 * is positive, so there is no cancellation. Measured against mpmath at
 * s ∈ {−1.5, −2.5, −3.5, −4.5, −5.3, −6.5, −7.7, −8.5, −10.5, −12.5} and
 * z ∈ {0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 0.999}: every relative
 * error is below 4e−13.
 */
function seriesUnreliable(
  sRe: number,
  sIm: number,
  zRe: number,
  zIm: number
): boolean {
  if (sIm === 0 && zIm === 0 && zRe > 0) return false;
  // The Euler transform runs on the whole real negative axis, z = −1
  // itself included (`lerchPhiComplex` dispatches every real z < 0 there
  // regardless of |z|), so this branch is checked on |z| directly, ahead
  // of the interior-only `absZ >= 1` exit below.
  // A complex order loses digits sooner there: against mpmath, s = −0.9 +
  // ti fails (1.0e−12 to 1.9e−12) at z = −1 and z = −0.999 for every t in
  // [0.001, 3] tried, and s = −0.8 + 0.01i at z = −0.999 (1.2e−12).
  if (zIm === 0 && zRe < 0)
    return sRe < (sIm === 0 ? -1 : -0.7) - 4 * (1 - Math.abs(zRe));
  const absZ = Math.hypot(zRe, zIm);
  if (absZ >= 1) return false; // outside the disk: `nearBranchPointUnreliable` covers it
  return sRe < -1 - 4 * (1 - absZ);
}

/**
 * True where the Hermite-integral continuation right at the z = 1 branch
 * point loses more than 1e−12 relative accuracy: the closed-form term
 * `Γ(1−s)(−log z)^(s−1)` grows without bound approaching z = 1, and its
 * cancellation against the rest grows faster than the kernel's own
 * `lost` guard (tuned to 1e−10) catches. Measured against mpmath at
 * s ∈ {−3.5, −1.5, 0.5, 1.5, 2.5, 3.5, 4.5, 2.5 + i} and z = 1 − d, 1 + d,
 * 1 + di, 1 + d − di: every point with |z − 1| ≥ 1e−3 stays below 1e−12,
 * the first failure is 1.1e−12 at s = −3.5, z = 1.0003 − 0.0003i
 * (|z − 1| ≈ 4.2e−4), and the error grows as z approaches 1 (2e−10 at
 * |z − 1| = 1e−6, 3e−8 at 1e−8). z = 1 itself is excluded:
 * `lerchPhiComplex` answers that point exactly, via `HurwitzZeta`, not
 * through this continuation.
 */
function nearBranchPointUnreliable(zRe: number, zIm: number): boolean {
  if (zRe === 1 && zIm === 0) return false;
  return Math.hypot(zRe - 1, zIm) < 1e-3;
}

/**
 * True where the continuation loses more than 1e−12 relative accuracy
 * because s sits close to a positive integer: `Γ(1−s)` has a pole at every
 * positive integer, so nearby the closed-form term and the rest of
 * `lerchContinuedComplex`'s sum swing through a large intermediate value
 * before mostly cancelling, and the reported `lost` estimate (tuned to
 * 1e−10) does not catch it this close in. Cross-checked against mpmath at
 * z ≈ −0.86 − 0.51i (on the rim): s = 5 − 0.05 (9.2e−14, safe), s = 5 −
 * 0.02 (4.6e−13, safe), s = 5 − 0.01 (6.3e−12, fails). The distance is
 * measured in the complex plane: a complex order next to the integer fails
 * the same way (s = 5 + 1e−6i gives 3e−4 at that z, s = 3 + 1e−3i 3e−10).
 * An exactly integer real order never reaches this kernel (see
 * `polylogIntegerOrderComplex`). Only engages where the continuation (not
 * the interior series) is actually doing the work: a real z in [−1, 0)
 * goes to the Euler transform instead, which stays below 6e−16 against
 * mpmath at s ∈ {1 + 1e−12, 1 + 1e−9i, 2 − 1e−6, 3 + 1e−3i, 4.98972,
 * 5 + 1e−6i, 6 − 0.02} and z ∈ {−0.9, −0.95, −0.99, −0.999, −1}.
 */
function nearPositiveIntegerOrderUnreliable(
  sRe: number,
  sIm: number,
  zRe: number,
  zIm: number
): boolean {
  if (zRe === 1 && zIm === 0) return false;
  const absZ = Math.hypot(zRe, zIm);
  if (absZ < 0.9 || (zIm === 0 && zRe < 0 && absZ <= 1)) return false;
  const nearest = Math.round(sRe);
  if (nearest < 1 || (sIm === 0 && sRe === nearest)) return false;
  return Math.hypot(sRe - nearest, sIm) < 0.05;
}

/**
 * Liₛ(z) for |z| > 1 by Jonquière's inversion formula (DLMF 25.12.13,
 * with the Hurwitz zeta form of the right-hand side):
 *
 *   Liₛ(z) + e^{iπs} Liₛ(1/z) = (2π)ˢ e^{iπs/2} / Γ(s) · ζ(1 − s, a),
 *   a = 1/2 + ln(−z)/(2πi),
 *
 * valid for z ∉ [0, 1], with the principal branch of ln(−z). For a real z
 * on the cut (1, ∞) the imaginary part of −z is taken as +0, which gives
 * the below-the-cut value (Im < 0), the same convention as mpmath and the
 * integer-order `polylogInversionComplex`. Checked against mpmath at
 * (s, z) = (1.5, −3), (2.5, −1.5), (−0.5, −2), (0.5, −5), (1.5, −1.01),
 * (3.7, −10), (2.5, 3), (2.5, 2), (1.5 + 0.5i, −3), (2.5, −2 + i).
 *
 * `hurwitzZetaComplex` is accurate at the negative order 1 − s only while
 * it can use its Taylor route (|Im a| ≤ 0.55, about |z| ≤ 32); past that its
 * Euler–Maclaurin route loses digits once Re(s) > 2 (for example
 * ζ(−11.5, 0.5 − 1.1i) is 30% off). A large imaginary part of s also
 * loses digits (e^{π|Im s|} amplifies the cancellation between the two
 * terms). The guard below is the measured safe region: in a random sweep
 * of 1500 points against mpmath (|z| from 1 to 1e7, a third of them on the
 * negative real axis, Re(s) ∈ [−4, 7], Im(s) ∈ [−3, 3]) it accepted 844
 * points, all within 1e−12, and rejected every inaccurate one.
 *
 * Next to an integer order, `hurwitzZetaComplex` works next to a pole of
 * ζ (and, at s = 0, of Γ(s) too), and the formula loses digits. Measured
 * against mpmath at a distance d from the integer (real, imaginary and
 * diagonal offsets; z from −1.001 to −1e4, −2 + i, 1.5 − 2i, 3): for
 * n = 0 … 4 the error is 2e−8 at d = 1e−9, 3e−12 at d = 1e−4 and at most
 * 2.5e−13 at d = 1e−3; for n = −1 it is 3.5e−12 at d = 1e−7 and 2.6e−13 at
 * d = 1e−6. An exactly integer real order never reaches this function
 * (`polylogIntegerOrderComplex`).
 *
 * Returns NaN outside the safe region, or when the inner Liₛ(1/z)
 * declines.
 */
function polylogInversionComplex(s: Complex, z: Complex): Complex {
  const twoPiI = new Complex(0, 2 * Math.PI);
  const negZ = new Complex(-z.re, z.im === 0 ? 0 : -z.im);
  const a = new Complex(0.5, 0).add(negZ.log().div(twoPiI));
  if (Math.abs(s.im) > 1.5 || (s.re > 2 && Math.abs(a.im) > 0.55)) return C_NAN;
  const nearest = Math.round(s.re);
  if (Math.hypot(s.re - nearest, s.im) < (nearest >= 0 ? 1e-3 : 1e-6))
    return C_NAN;
  const inner = polylogInsideDisk(s, z.inverse());
  if (inner.isNaN()) return C_NAN;
  const iPiS = new Complex(0, Math.PI).mul(s);
  const factor = new Complex(2 * Math.PI, 0)
    .pow(s)
    .mul(iPiS.mul(0.5).exp())
    .div(gammaComplex(s));
  const zeta = hurwitzZetaComplex(C_ONE.sub(s), a);
  const result = factor.mul(zeta).sub(iPiS.exp().mul(inner));
  // A real order and a real z < −1 give a real value; drop the rounding
  // residue of the two complex terms.
  if (s.im === 0 && z.im === 0 && z.re < 0) return new Complex(result.re, 0);
  return result;
}

/** Liₛ(z) = z·Φ(z,s,1) for |z| ≤ 1 (the rim included), with the guards. */
function polylogInsideDisk(s: Complex, z: Complex): Complex {
  if (
    seriesUnreliable(s.re, s.im, z.re, z.im) ||
    nearBranchPointUnreliable(z.re, z.im) ||
    nearPositiveIntegerOrderUnreliable(s.re, s.im, z.re, z.im)
  )
    return C_NAN;
  const phi = lerchPhiComplex(z, s, C_ONE);
  return phi === undefined ? C_NAN : z.mul(phi);
}

/**
 * Liₛ(z) for complex s, z, at machine precision. An integer order goes to
 * the closed forms and the dedicated kernel (`polylogIntegerOrderComplex`).
 * Any other order uses z·Φ(z,s,1): past |z| = 1 through the Lerch
 * continuation, and where that declines through Jonquière's inversion
 * (`polylogInversionComplex`). `NaN` where every route declines, or where a
 * reliability guard above catches an unreliable but not-NaN kernel answer —
 * the caller (`applyN`) reads a NaN kernel result as "stay symbolic" rather
 * than ship an unverified number.
 */
export function polylogOrderComplex(s: Complex, z: Complex): Complex {
  if (s.isNaN() || z.isNaN()) return C_NAN;
  if (z.isZero()) return C_ZERO;
  if (s.im === 0 && Number.isInteger(s.re)) {
    const r = polylogIntegerOrderComplex(s.re, z);
    if (r !== undefined) return r;
  }
  if (z.abs() <= 1) return polylogInsideDisk(s, z);
  // Past the disk: the Lerch continuation first; it declines on most of
  // the plane (see `lerchContinuedComplex`), and there the inversion takes
  // over.
  if (
    !nearBranchPointUnreliable(z.re, z.im) &&
    !nearPositiveIntegerOrderUnreliable(s.re, s.im, z.re, z.im)
  ) {
    const phi = lerchPhiComplex(z, s, C_ONE);
    if (phi !== undefined && !phi.isNaN()) return z.mul(phi);
  }
  if (nearBranchPointUnreliable(z.re, z.im)) return C_NAN;
  return polylogInversionComplex(s, z);
}

/**
 * Real-valued Liₛ(z) for real s, z — the compiled (JS) real-scalar lane,
 * `_SYS.polyLog`. It answers every order, the integer ones included, so it
 * agrees with the interpreter: z = 0 is 0, the orders 1, 0 and −1 are
 * −ln(1 − z), z/(1 − z) and z/(1 − z)², an integer order n ≥ 2 goes to the
 * dedicated kernel, and n ≤ −2 to the Eulerian closed form. A pole (z = 1
 * with s ∈ {1, 0, −1}) is `Infinity`. `NaN` for a genuinely complex value
 * (z > 1, except for an order that is an integer ≤ 0, where the value is
 * a real rational function of z), and wherever `polylogOrderComplex`
 * declines.
 */
export function polylogOrderReal(s: number, z: number): number {
  if (Number.isNaN(s) || Number.isNaN(z)) return NaN;
  if (z === 0) return 0;
  const integerOrder = Number.isInteger(s);
  if (integerOrder) {
    if (s >= 2 && z <= 1) {
      // The real kernel covers −1/2 ≤ z ≤ 1; the complex one the rest of
      // the real axis below 1, where the value is still real.
      const r = polylogIntegerReal(s, z);
      if (!Number.isNaN(r)) return r;
    }
    if (s === 1) return z < 1 ? -Math.log1p(-z) : z === 1 ? Infinity : NaN;
    if (s === 0) return z === 1 ? Infinity : z / (1 - z);
    if (s === -1) return z === 1 ? Infinity : z / ((1 - z) * (1 - z));
  }
  if (z > 1 && !(integerOrder && s <= 0)) return NaN;
  const r = polylogOrderComplex(new Complex(s, 0), new Complex(z, 0));
  return r.re;
}
