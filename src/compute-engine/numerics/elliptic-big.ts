import { BigDecimal } from '../../big-decimal/index.js';
import {
  checkDeadline,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { bigEllipticE, bigEllipticK } from './special-functions.js';

/**
 * Incomplete elliptic integrals F(φ|m), E(φ|m) and Π(n; φ|m), and the
 * complete Π(n|m), at the working precision, for real operands whose value
 * is real (parameter convention m = k²). They are Carlson's symmetric forms
 * (DLMF 19.25.5, 19.25.9, 19.25.14) summed by the duplication theorem
 * (DLMF 19.36(i)), the method of the machine kernels in
 * `special-functions.ts`.
 *
 * A kernel answers one of three ways:
 *
 * - a number, correct to the working precision;
 * - NaN, when the value is not real or not finite (`m` past 1 for a
 *   period of the amplitude, `m·sin²φ > 1`), so that `applyN` goes on to
 *   the complex kernel;
 * - `null`, when the kernel cannot vouch for the digits asked (a loop cap
 *   is reached, or more digits are lost than `ELLIPTIC_MAX_EXTRA_DIGITS` can
 *   absorb), so that the call stays unevaluated instead of answering in
 *   doubles.
 *
 * Π(n; φ|m) with 1 − n sin²φ < 0 is the Cauchy principal value, as for the
 * machine kernel (compute-engine#422).
 */

/** Digits carried beyond the working precision. */
const ELLIPTIC_GUARD_DIGITS = 15;

/**
 * The most digits a retry may add to cover cancellation (a sum of terms
 * larger than itself, an amplitude within 10⁻ᵈ of π/2 or of a multiple of
 * π). F(φ|1) at φ within 10⁻⁴⁰⁰ of π/2 needs all of them; past it the
 * kernel declines.
 */
const ELLIPTIC_MAX_EXTRA_DIGITS = 400;

/** Duplication steps. Each divides the spread of the arguments by 4. */
const CARLSON_MAX_DUPLICATIONS = 1000;

/** Largest |e| for which R_C(1, 1 + e) is summed as a power series. */
const RC_SERIES_BOUND = 0.01;

const BIG_THREE = new BigDecimal(3);
const BIG_FOUR = new BigDecimal(4);

interface Loss {
  /** Decimal digits of the result that the arithmetic so far may have lost. */
  digits: number;
  /** Polled once per duplication of R_J, whose cost grows with the precision. */
  deadline: DeadlineFrame | undefined;
}

function bigMax(...xs: BigDecimal[]): BigDecimal {
  return xs.reduce((a, b) => (b.gt(a) ? b : a));
}

/** log₁₀|x|, also when |x| is outside the range of a double. */
function log10Abs(x: BigDecimal, prec: number): number {
  if (x.isZero()) return -Infinity;
  const v = Math.abs(x.toNumber());
  if (v > 0 && Number.isFinite(v)) return Math.log10(v);
  return x.abs().ln(prec).toNumber() / Math.LN10;
}

/** Records that a value of size `value` came from terms as large as `terms`. */
function noteCancellation(
  loss: Loss,
  terms: BigDecimal,
  value: BigDecimal,
  prec: number
): void {
  if (terms.isZero()) return;
  loss.digits = Math.max(
    loss.digits,
    log10Abs(terms, prec) - log10Abs(value, prec)
  );
}

/**
 * Runs `attempt` at the target precision plus guard digits (its `working`
 * precision), and again with more digits when it reports more loss than the
 * guard holds.
 */
function carlsonResult(
  ce: ComputeEngine,
  target: number,
  attempt: (loss: Loss, working: number) => BigDecimal | null
): BigDecimal | null {
  let extra = ELLIPTIC_GUARD_DIGITS;
  for (;;) {
    const loss: Loss = { digits: 0, deadline: ce._deadlineFrame };
    const value = attempt(loss, target + extra);
    if (value === null) return null;
    if (value.isNaN() || !value.isFinite()) return value;
    if (loss.digits <= extra - 5) return value.toPrecision(target);
    extra = Math.ceil(loss.digits) + ELLIPTIC_GUARD_DIGITS;
    if (!(extra <= ELLIPTIC_MAX_EXTRA_DIGITS)) return null;
  }
}

/** R_C(1, 1 + e) for −1 < e, by series for small |e|, else by atan/atanh. */
function rc1(e: BigDecimal, loss: Loss, prec: number): BigDecimal | null {
  if (e.isZero()) return BigDecimal.ONE;
  if (e.abs().lte(RC_SERIES_BOUND)) {
    // Σ (−e)ᵏ/(2k+1); the ratio of the terms is at most RC_SERIES_BOUND, so
    // the tail after a term is under 1.02 times that term.
    const tol = new BigDecimal(10).pow(-(prec + 2), prec);
    const ne = e.neg();
    let power = BigDecimal.ONE;
    let sum = BigDecimal.ONE;
    for (let k = 1; k <= prec; k++) {
      power = power.mulBounded(ne, prec);
      const term = power.div(2 * k + 1, prec);
      sum = sum.add(term, prec);
      if (term.abs().lt(tol)) return sum;
    }
    return null;
  }
  if (e.gt(0)) {
    const t = e.sqrt(prec);
    return t.atan(prec).div(t, prec);
  }
  // 1 + e < 0.01 loses digits of 1 + e; the next attempt carries them
  const y = BigDecimal.ONE.add(e, prec);
  if (!y.gt(0)) return null;
  loss.digits = Math.max(loss.digits, -log10Abs(y, prec));
  const t = e.neg().sqrt(prec);
  return t.atanh(prec).div(t, prec);
}

/** R_F(x, y, z) for x, y, z ≥ 0 with at most one zero (DLMF 19.36.1). */
function carlsonRF(
  x: BigDecimal,
  y: BigDecimal,
  z: BigDecimal,
  prec: number
): BigDecimal | null {
  const zeros =
    (x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0);
  if (zeros > 1) return BigDecimal.POSITIVE_INFINITY;
  const A0 = x.add(y, prec).add(z, prec).div(BIG_THREE, prec);
  const spread = bigMax(
    A0.sub(x, prec).abs(),
    A0.sub(y, prec).abs(),
    A0.sub(z, prec).abs()
  );
  // The series after the duplications is in X = spread/A·4⁻ᵐ and is
  // truncated at order 6 (Carlson 1995, eq. 2.2), so the relative truncation
  // error is of the order of X⁶; X < 10^(−precision/6) makes it negligible
  // against a unit in the last place.
  const small = new BigDecimal(Math.pow(10, -prec / 6));
  let [xm, ym, zm] = [x, y, z];
  let A = A0;
  let pow4 = BigDecimal.ONE;
  let converged = false;
  for (let i = 0; i < CARLSON_MAX_DUPLICATIONS; i++) {
    if (spread.mul(pow4).lt(small.mul(A))) {
      converged = true;
      break;
    }
    const sx = xm.sqrt(prec);
    const sy = ym.sqrt(prec);
    const sz = zm.sqrt(prec);
    const lm = sx.mul(sy).add(sx.mul(sz), prec).add(sy.mul(sz), prec);
    A = A.add(lm, prec).div(BIG_FOUR, prec);
    xm = xm.add(lm, prec).div(BIG_FOUR, prec);
    ym = ym.add(lm, prec).div(BIG_FOUR, prec);
    zm = zm.add(lm, prec).div(BIG_FOUR, prec);
    pow4 = pow4.div(BIG_FOUR, prec);
  }
  if (!converged) return null;
  const t = pow4.div(A, prec);
  const X = A0.sub(x, prec).mul(t);
  const Y = A0.sub(y, prec).mul(t);
  const Z = X.add(Y, prec).neg();
  const E2 = X.mul(Y).sub(Z.mul(Z), prec);
  const E3 = X.mul(Y).mul(Z);
  const series = new BigDecimal(9240)
    .sub(E2.mul(924), prec)
    .add(E2.mul(E2).mul(385), prec)
    .add(E3.mul(660), prec)
    .sub(E2.mul(E3).mul(630), prec)
    .div(9240, prec);
  return series.div(A.sqrt(prec), prec);
}

/** R_J(x, y, z, p) for x, y, z ≥ 0 with at most one zero and p > 0 (DLMF 19.36.1). */
function carlsonRJ(
  x: BigDecimal,
  y: BigDecimal,
  z: BigDecimal,
  p: BigDecimal,
  loss: Loss,
  prec: number
): BigDecimal | null {
  const zeros =
    (x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0);
  if (zeros > 1) return BigDecimal.POSITIVE_INFINITY;
  if (p.isNegative()) return carlsonRJPrincipal(x, y, z, p, loss, prec);
  const A0 = x.add(y, prec).add(z, prec).add(p.mul(2), prec).div(5, prec);
  const delta = p.sub(x, prec).mul(p.sub(y, prec)).mul(p.sub(z, prec));
  const spread = bigMax(
    A0.sub(x, prec).abs(),
    A0.sub(y, prec).abs(),
    A0.sub(z, prec).abs(),
    A0.sub(p, prec).abs()
  );
  // As for R_F, with the series of Carlson (1995, eq. 2.7) at order 6.
  const small = new BigDecimal(Math.pow(10, -(prec + 1) / 6));
  let [xm, ym, zm, pm] = [x, y, z, p];
  let A = A0;
  let pow4 = BigDecimal.ONE;
  let S = BigDecimal.ZERO;
  let converged = false;
  for (let i = 0; i < CARLSON_MAX_DUPLICATIONS; i++) {
    checkDeadline(loss.deadline);
    const sx = xm.sqrt(prec);
    const sy = ym.sqrt(prec);
    const sz = zm.sqrt(prec);
    const sp = pm.sqrt(prec);
    const lm = sx.mul(sy).add(sx.mul(sz), prec).add(sy.mul(sz), prec);
    const A1 = A.add(lm, prec).div(BIG_FOUR, prec);
    xm = xm.add(lm, prec).div(BIG_FOUR, prec);
    ym = ym.add(lm, prec).div(BIG_FOUR, prec);
    zm = zm.add(lm, prec).div(BIG_FOUR, prec);
    pm = pm.add(lm, prec).div(BIG_FOUR, prec);
    const dm = sp.add(sx, prec).mul(sp.add(sy, prec)).mul(sp.add(sz, prec));
    if (spread.mul(pow4).lt(small.mul(A))) {
      converged = true;
      break;
    }
    const em = delta.mul(pow4).mul(pow4).mul(pow4).div(dm.mul(dm), prec);
    const rc = rc1(em, loss, prec);
    if (rc === null) return null;
    S = S.add(rc.mul(pow4).div(dm, prec), prec);
    pow4 = pow4.div(BIG_FOUR, prec);
    A = A1;
  }
  if (!converged) return null;
  const t = pow4.div(A, prec);
  const X = A0.sub(x, prec).mul(t);
  const Y = A0.sub(y, prec).mul(t);
  const Z = A0.sub(z, prec).mul(t);
  const P = X.add(Y, prec).add(Z, prec).neg().div(2, prec);
  const E2 = X.mul(Y)
    .add(X.mul(Z), prec)
    .add(Y.mul(Z), prec)
    .sub(P.mul(P).mul(3), prec);
  const XYZ = X.mul(Y).mul(Z);
  const E3 = XYZ.add(E2.mul(P).mul(2), prec).add(P.mul(P).mul(P).mul(4), prec);
  const E4 = XYZ.mul(2)
    .add(E2.mul(P), prec)
    .add(P.mul(P).mul(P).mul(3), prec)
    .mul(P);
  const E5 = XYZ.mul(P).mul(P);
  const series = new BigDecimal(24024)
    .sub(E2.mul(5148), prec)
    .add(E2.mul(E2).mul(2457), prec)
    .add(E3.mul(4004), prec)
    .sub(E2.mul(E3).mul(4158), prec)
    .sub(E4.mul(3276), prec)
    .add(E5.mul(2772), prec)
    .div(24024, prec);
  return pow4
    .mul(series)
    .div(A.mul(A.sqrt(prec)), prec)
    .add(S.mul(6), prec);
}

/** R_C(x, y) for x ≥ 0 and y > 0, by homogeneity from R_C(1, 1 + e). */
function carlsonRC(
  x: BigDecimal,
  y: BigDecimal,
  loss: Loss,
  prec: number
): BigDecimal | null {
  if (x.isZero()) return BigDecimal.pi(prec).div(y.sqrt(prec).mul(2), prec);
  const r = rc1(y.div(x, prec).sub(BigDecimal.ONE, prec), loss, prec);
  return r === null ? null : r.div(x.sqrt(prec), prec);
}

/**
 * R_J(x, y, z, p) for p < 0: the Cauchy principal value, as the machine
 * kernel gives it (DLMF 19.20.14, for x ≤ y ≤ z):
 * (z + q)·R_J = (p' − z)·R_J(x, y, z, p') − 3R_F(x, y, z)
 *               + 3·sqrt(xyz/(xy + p'q))·R_C(xy + p'q, p'q),
 * with q = −p and p' = (z(x + y + q) − xy)/(z + q) > 0.
 */
function carlsonRJPrincipal(
  x0: BigDecimal,
  y0: BigDecimal,
  z0: BigDecimal,
  p: BigDecimal,
  loss: Loss,
  prec: number
): BigDecimal | null {
  const [x, y, z] = [x0, y0, z0].sort((u, v) =>
    u.lt(v) ? -1 : u.gt(v) ? 1 : 0
  );
  const q = p.neg();
  const pn = z
    .mul(x.add(y, prec).add(q, prec))
    .sub(x.mul(y), prec)
    .div(z.add(q, prec), prec);
  const rj = carlsonRJ(x, y, z, pn, loss, prec);
  const rf = carlsonRF(x, y, z, prec);
  if (rj === null || rf === null || !rj.isFinite() || !rf.isFinite())
    return null;
  const first = pn.sub(z, prec).mul(rj);
  const second = rf.mul(BIG_THREE);
  let third = BigDecimal.ZERO;
  const xy = x.mul(y);
  if (!xy.isZero()) {
    const pq = pn.mul(q);
    const rc = carlsonRC(xy.add(pq, prec), pq, loss, prec);
    if (rc === null) return null;
    third = xy
      .mul(z)
      .div(xy.add(pq, prec), prec)
      .sqrt(prec)
      .mul(rc)
      .mul(BIG_THREE);
  }
  const v = first.sub(second, prec).add(third, prec);
  noteCancellation(loss, bigMax(first.abs(), second, third), v, prec);
  return v.div(z.add(q, prec), prec);
}

/** The reduced amplitude φ = kπ ± u, with 0 ≤ u ≤ π/2, as s = sin u and c = cos u. */
interface Amplitude {
  k: BigDecimal;
  negative: boolean;
  s: BigDecimal;
  c: BigDecimal;
}

/**
 * Reduces φ to kπ + r with |r| ≤ π/2 and gives sin|r| and cos|r|. Near
 * π/2, c comes from the distance δ = π/2 − |r| (c = sin δ) so that it keeps
 * its relative accuracy; the digits that the subtraction loses are recorded.
 */
function reduceAmplitude(phi: BigDecimal, loss: Loss, prec: number): Amplitude {
  const pi = BigDecimal.pi(prec);
  const half = pi.div(2, prec);
  let k = BigDecimal.ZERO;
  let r = phi;
  if (phi.abs().gt(half)) {
    k = phi.div(pi, prec).round();
    r = phi.sub(k.mul(pi), prec);
    loss.digits = Math.max(loss.digits, log10Abs(k, prec) + 1);
  }
  const negative = r.isNegative();
  const u = r.abs();
  if (u.lte(half.div(2, prec)))
    return { k, negative, s: u.sin(prec), c: u.cos(prec) };
  const delta = half.sub(u, prec);
  loss.digits = Math.max(loss.digits, -log10Abs(delta, prec) + 1);
  return { k, negative, s: delta.cos(prec), c: delta.abs().sin(prec) };
}

/** y = 1 − t·s² = c² + (1 − t)s², which keeps its digits for t near 1. */
function oneMinusTimesSin2(
  t: BigDecimal,
  a: Amplitude,
  loss: Loss,
  prec: number
): BigDecimal {
  const c2 = a.c.mul(a.c);
  const second = BigDecimal.ONE.sub(t, prec).mul(a.s).mul(a.s);
  const y = c2.add(second, prec);
  // Terms of opposite signs (t > 1) can cancel to a small y
  if (!y.isZero()) noteCancellation(loss, bigMax(c2, second.abs()), y, prec);
  return y;
}

/** 2kC ± T, with the loss of digits recorded. */
function addPeriods(
  k: BigDecimal,
  complete: BigDecimal,
  negative: boolean,
  part: BigDecimal,
  loss: Loss,
  prec: number
): BigDecimal {
  const signed = negative ? part.neg() : part;
  if (k.isZero()) return signed;
  const periods = k.mul(2).mul(complete);
  const total = periods.add(signed, prec);
  noteCancellation(loss, bigMax(periods.abs(), signed.abs()), total, prec);
  return total;
}

function isUndefined(...xs: BigDecimal[]): boolean {
  return xs.some((x) => x.isNaN() || !x.isFinite());
}

/**
 * Incomplete elliptic integral of the first kind F(φ|m) (parameter
 * convention) for real φ and m, where the value is real.
 */
export function bigEllipticF(
  ce: ComputeEngine,
  phi: BigDecimal,
  m: BigDecimal,
  prec: number
): BigDecimal | null {
  if (isUndefined(phi, m)) return BigDecimal.NAN;
  if (phi.isZero()) return BigDecimal.ZERO;
  return carlsonResult(ce, prec, (loss, working) => {
    const a = reduceAmplitude(phi, loss, working);
    let K = BigDecimal.ZERO;
    if (!a.k.isZero()) {
      // F(φ + kπ|m) = F(φ|m) + 2kK(m); K is complex or infinite for m ≥ 1.
      // At m = 1 the value is not finite: no fallback to the machine kernel,
      // whose double φ can fall below π/2 when φ is just above it.
      if (m.eq(BigDecimal.ONE)) return null;
      if (m.gt(BigDecimal.ONE)) return BigDecimal.NAN;
      K = bigEllipticK(ce, m, working);
    }
    const y = oneMinusTimesSin2(m, a, loss, working);
    if (y.isNegative()) return BigDecimal.NAN;
    const rf = carlsonRF(a.c.mul(a.c), y, BigDecimal.ONE, working);
    if (rf === null || !rf.isFinite()) return rf;
    return addPeriods(a.k, K, a.negative, a.s.mul(rf), loss, working);
  });
}

/**
 * Incomplete elliptic integral of the second kind E(φ|m) (parameter
 * convention) for real φ and m, where the value is real.
 */
export function bigEllipticEIncomplete(
  ce: ComputeEngine,
  phi: BigDecimal,
  m: BigDecimal,
  prec: number
): BigDecimal | null {
  if (isUndefined(phi, m)) return BigDecimal.NAN;
  if (phi.isZero()) return BigDecimal.ZERO;
  return carlsonResult(ce, prec, (loss, working) => {
    const a = reduceAmplitude(phi, loss, working);
    let E = BigDecimal.ZERO;
    if (!a.k.isZero()) {
      if (m.gt(BigDecimal.ONE)) return BigDecimal.NAN;
      E = bigEllipticE(ce, m, working);
    }
    const y = oneMinusTimesSin2(m, a, loss, working);
    if (y.isNegative()) return BigDecimal.NAN;
    const x = a.c.mul(a.c);
    const rf = carlsonRF(x, y, BigDecimal.ONE, working);
    if (rf === null) return null;
    const rd = carlsonRJ(x, y, BigDecimal.ONE, BigDecimal.ONE, loss, working);
    // E(π/2|1) is 1, but both integrals diverge there, and the kernel does
    // not take the difference of two infinities
    if (rd === null || !rf.isFinite() || !rd.isFinite()) return null;
    const first = a.s.mul(rf);
    const second = m.div(BIG_THREE, working).mul(a.s).mul(a.s).mul(a.s).mul(rd);
    const part = first.sub(second, working);
    noteCancellation(loss, bigMax(first.abs(), second.abs()), part, working);
    return addPeriods(a.k, E, a.negative, part, loss, working);
  });
}

/**
 * Complete elliptic integral of the third kind Π(n|m) for m < 1. `+∞` at
 * n = 1 or m = 1, NaN for m > 1 (complex). For n > 1 it is the Cauchy
 * principal value, the real kernel's ruling (compute-engine#422).
 */
export function bigEllipticPiComplete(
  ce: ComputeEngine,
  n: BigDecimal,
  m: BigDecimal,
  prec: number
): BigDecimal | null {
  if (isUndefined(n, m)) return BigDecimal.NAN;
  if (n.eq(1) || m.eq(1)) return BigDecimal.POSITIVE_INFINITY;
  if (m.gt(1)) return BigDecimal.NAN;
  // The principal value of Π(n|0) = ∫₀^∞ dt/(1 + (1 − n)t²) is 0 for n > 1:
  // the sum below cancels to it, which `carlsonResult` reads as all digits lost
  if (m.isZero() && n.gt(1)) return BigDecimal.ZERO;
  return carlsonResult(ce, prec, (loss, working) => {
    // Π(n|m) = R_F(0, 1−m, 1) + (n/3)·R_J(0, 1−m, 1, 1−n)  (DLMF 19.25.14)
    const y = BigDecimal.ONE.sub(m, working);
    const rf = carlsonRF(BigDecimal.ZERO, y, BigDecimal.ONE, working);
    const rj = carlsonRJ(
      BigDecimal.ZERO,
      y,
      BigDecimal.ONE,
      BigDecimal.ONE.sub(n, working),
      loss,
      working
    );
    if (rf === null || rj === null) return null;
    const second = n.div(BIG_THREE, working).mul(rj);
    const total = rf.add(second, working);
    noteCancellation(loss, bigMax(rf.abs(), second.abs()), total, working);
    return total;
  });
}

/**
 * Incomplete elliptic integral of the third kind Π(n; φ|m) for real
 * operands where m·sin²φ < 1; NaN where the value is complex because of m.
 * Where 1 − n·sin²φ < 0 it is the Cauchy principal value, as for the
 * machine kernel (compute-engine#422).
 */
export function bigEllipticPiIncomplete(
  ce: ComputeEngine,
  n: BigDecimal,
  phi: BigDecimal,
  m: BigDecimal,
  prec: number
): BigDecimal | null {
  if (isUndefined(n, phi, m)) return BigDecimal.NAN;
  if (phi.isZero()) return BigDecimal.ZERO;
  return carlsonResult(ce, prec, (loss, working) => {
    const a = reduceAmplitude(phi, loss, working);
    let P = BigDecimal.ZERO;
    if (!a.k.isZero()) {
      // At m = 1 the value is not finite (see `bigEllipticF`)
      if (m.eq(BigDecimal.ONE)) return null;
      if (m.gt(BigDecimal.ONE)) return BigDecimal.NAN;
      const complete = bigEllipticPiComplete(ce, n, m, working);
      if (complete === null) return null;
      // Π(n|m) infinite: the machine kernel's NaN, then the complex kernel
      if (!complete.isFinite()) return BigDecimal.NAN;
      P = complete;
    }
    const y = oneMinusTimesSin2(m, a, loss, working);
    if (y.isNegative()) return BigDecimal.NAN;
    const p = oneMinusTimesSin2(n, a, loss, working);
    if (p.isZero()) return BigDecimal.POSITIVE_INFINITY;
    const x = a.c.mul(a.c);
    const rf = carlsonRF(x, y, BigDecimal.ONE, working);
    const rj = carlsonRJ(x, y, BigDecimal.ONE, p, loss, working);
    if (rf === null || rj === null || !rf.isFinite() || !rj.isFinite())
      return null;
    const first = a.s.mul(rf);
    const second = n.div(BIG_THREE, working).mul(a.s).mul(a.s).mul(a.s).mul(rj);
    const part = first.add(second, working);
    noteCancellation(loss, bigMax(first.abs(), second.abs()), part, working);
    return addPeriods(a.k, P, a.negative, part, loss, working);
  });
}
