import { Complex } from 'complex-esm';
import { lerchPhiComplex } from './lerch-phi.js';
import {
  gamma as gammaComplex,
  gammaErrorWeight,
  hurwitzZetaComplex,
  polylogComplex,
  polylogSeriesOutsideDisk,
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
 * The two terms of the right-hand side can cancel: for a complex order
 * with Re(s) < 0 they are up to 1e4 times the value (e^{π|Im s|} scales
 * one of them). Each term carries the rounding of its factors, the largest
 * of which is that of Γ(s) (`gammaErrorWeight`: about 5ε at |s| < 1 and
 * 1300ε at |s| = 30), so the value's error is about the cancellation ratio
 * times that. The formula estimates the error as the ratio times
 * (2ε·gammaErrorWeight(s) + 2e−13, the second term for the inner Liₛ(1/z)
 * and ζ(1 − s, a), each measured within 1.3e−13) and declines above
 * 2e−12. Measured against mpmath's `polylog` on 5859 answered points
 * (|z| from 1 to 1e7, a third on the negative real axis, Re(s) from −30 to
 * 12, a third of the orders with |Im s| up to 1.5): the actual error was
 * at most 1.35 times ε·gammaErrorWeight(s)·ratio, and without the check
 * 103 values were off by more than 1e−12 (up to 5.1e−10, all but two with
 * a complex order); with it, every answered value is within 3.1e−13. A
 * larger |Im s| loses digits faster (e^{π|Im s|} amplifies the
 * cancellation; 1.3e−10 at |Im s| near 3), so the formula also declines
 * for |Im s| > 1.5. Every Re(s) is accepted: `hurwitzZetaComplex` at the
 * negative order 1 − s and a complex a is accurate for every |Im a|
 * (|Im a| = ln|z|/(2π), 2.6 at |z| = 1e7).
 *
 * Next to an integer order n the formula needs ζ(1 − s, a) next to its
 * pole when n = 0 (and 1/Γ(s) next to its zero); the exact distance −s is
 * passed to `hurwitzZetaComplex`, so the rounding of 1 − s does not
 * matter. Measured against mpmath at distances d = 1e−9 … 1e−2 from
 * n = −3 … 6 (real, imaginary and diagonal offsets; z = −1.001, −1.01,
 * −1.5, −3, −10, −100, −1e4, −1e6, −2 + i, 1.5 − 2i, 3, 0.3 + 40i): every
 * answer is within 1.4e−13. So no integer order needs a separate guard. An
 * exactly integer real order never reaches this function
 * (`polylogIntegerOrderComplex`).
 *
 * Returns NaN for |Im s| > 1.5, when the inner Liₛ(1/z) declines, when
 * `hurwitzZetaComplex` declines (it returns NaN where its own error
 * estimate is above 1e−12 of its value; the NaN reaches the error check
 * below, which then fails), or when the two terms cancel too far.
 */
function polylogInversionComplex(s: Complex, z: Complex): Complex {
  const twoPiI = new Complex(0, 2 * Math.PI);
  const negZ = new Complex(-z.re, z.im === 0 ? 0 : -z.im);
  const a = new Complex(0.5, 0).add(negZ.log().div(twoPiI));
  if (Math.abs(s.im) > 1.5) return C_NAN;
  const inner = polylogInsideDisk(s, z.inverse());
  if (inner.isNaN()) return C_NAN;
  // Γ(s) overflows a double past Re(s) ≈ 171.6. The factor below then
  // comes out as 0, the error check sees only the second term, and the
  // result would be that term, not the value.
  const g = gammaComplex(s);
  if (!g.isFinite()) return C_NAN;
  const iPiS = new Complex(0, Math.PI).mul(s);
  const factor = new Complex(2 * Math.PI, 0)
    .pow(s)
    .mul(iPiS.mul(0.5).exp())
    .div(g);
  // 1 − s is rounded; its exact distance to the pole of ζ at 1 is −s.
  const zeta = hurwitzZetaComplex(C_ONE.sub(s), a, s.neg());
  const first = factor.mul(zeta);
  const second = iPiS.exp().mul(inner);
  const result = first.sub(second);
  // A real order and a real z < −1 give a real value; drop the rounding
  // residue of the two complex terms.
  const value =
    s.im === 0 && z.im === 0 && z.re < 0 ? new Complex(result.re, 0) : result;
  const ratio = Math.max(first.abs(), second.abs()) / value.abs();
  const error = ratio * (2 * Number.EPSILON * gammaErrorWeight(s) + 2e-13);
  if (!(error <= 2e-12)) return C_NAN;
  return value;
}

/**
 * Liₛ(z) = z·Φ(z,s,1) for |z| ≤ 1 (the rim included). `lerchPhiComplex`
 * checks the rounding of its own sums and declines, or takes its
 * continuation, where the direct series cancels, so no guard is needed
 * here. Measured against mpmath's `polylog` (40 digits) on 7000 points with
 * Re(s) from −20 to 8, |Im s| up to 5, a seventh of the orders within 1e−9
 * to 0.1 of an integer, and z over the disk, on the negative and positive
 * real axes, within 1e−7 to 0.1 of the unit circle and on it: 6983 answer,
 * none off by more than 2.0e−13. On 3000 points within 1e−8 to 1e−2 of the
 * branch point z = 1 (inside and outside the disk): all answer, none off by
 * more than 7.3e−13.
 */
function polylogInsideDisk(s: Complex, z: Complex): Complex {
  const phi = lerchPhiComplex(z, s, C_ONE);
  return phi === undefined ? C_NAN : z.mul(phi);
}

/**
 * Liₛ(z) for complex s, z, at machine precision. An integer order goes to
 * the closed forms and the dedicated kernel (`polylogIntegerOrderComplex`).
 * Any other order uses z·Φ(z,s,1): past |z| = 1, for a real order, first
 * the leading terms of the power series where they give the value
 * (`polylogSeriesOutsideDisk`, which answers fast at a large order), then
 * the Lerch continuation, and where that declines Jonquière's inversion
 * (`polylogInversionComplex`). `NaN` where every route declines: the caller
 * (`applyN`) reads a NaN kernel result as "stay symbolic" rather than ship
 * an unverified number.
 */
export function polylogOrderComplex(s: Complex, z: Complex): Complex {
  if (s.isNaN() || z.isNaN()) return C_NAN;
  if (z.isZero()) return C_ZERO;
  if (s.im === 0 && Number.isInteger(s.re)) {
    const r = polylogIntegerOrderComplex(s.re, z);
    if (r !== undefined) return r;
  }
  if (z.abs() <= 1) return polylogInsideDisk(s, z);
  // Past the disk: the first terms of the power series where they give the
  // value (a real order large enough for |z|), then the Lerch continuation;
  // where that declines (see `lerchContinuedComplex`), the inversion takes
  // over.
  if (s.im === 0) {
    const series = polylogSeriesOutsideDisk(s.re, z);
    if (series !== undefined) return series;
  }
  const phi = lerchPhiComplex(z, s, C_ONE);
  if (phi !== undefined && !phi.isNaN()) return z.mul(phi);
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
