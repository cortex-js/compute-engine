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

function withPrecision<T>(digits: number, fn: () => T): T {
  const saved = BigDecimal.precision;
  BigDecimal.precision = digits;
  try {
    return fn();
  } finally {
    BigDecimal.precision = saved;
  }
}

function bigMax(...xs: BigDecimal[]): BigDecimal {
  return xs.reduce((a, b) => (b.gt(a) ? b : a));
}

/** log₁₀|x|, also when |x| is outside the range of a double. */
function log10Abs(x: BigDecimal): number {
  if (x.isZero()) return -Infinity;
  const v = Math.abs(x.toNumber());
  if (v > 0 && Number.isFinite(v)) return Math.log10(v);
  return x.abs().ln().toNumber() / Math.LN10;
}

/** Records that a value of size `value` came from terms as large as `terms`. */
function noteCancellation(
  loss: Loss,
  terms: BigDecimal,
  value: BigDecimal
): void {
  if (terms.isZero()) return;
  loss.digits = Math.max(loss.digits, log10Abs(terms) - log10Abs(value));
}

/**
 * Runs `attempt` at the target precision plus guard digits, and again with
 * more digits when it reports more loss than the guard holds.
 */
function carlsonResult(
  ce: ComputeEngine,
  target: number,
  attempt: (loss: Loss) => BigDecimal | null
): BigDecimal | null {
  let extra = ELLIPTIC_GUARD_DIGITS;
  for (;;) {
    const loss: Loss = { digits: 0, deadline: ce._deadlineFrame };
    const value = withPrecision(target + extra, () => attempt(loss));
    if (value === null) return null;
    if (value.isNaN() || !value.isFinite()) return value;
    if (loss.digits <= extra - 5) return value.toPrecision(target);
    extra = Math.ceil(loss.digits) + ELLIPTIC_GUARD_DIGITS;
    if (!(extra <= ELLIPTIC_MAX_EXTRA_DIGITS)) return null;
  }
}

/** R_C(1, 1 + e) for −1 < e, by series for small |e|, else by atan/atanh. */
function rc1(e: BigDecimal, loss: Loss): BigDecimal | null {
  if (e.isZero()) return BigDecimal.ONE;
  if (e.abs().lte(RC_SERIES_BOUND)) {
    // Σ (−e)ᵏ/(2k+1); the ratio of the terms is at most RC_SERIES_BOUND, so
    // the tail after a term is under 1.02 times that term.
    const tol = new BigDecimal(10).pow(-(BigDecimal.precision + 2));
    const ne = e.neg();
    let power = BigDecimal.ONE;
    let sum = BigDecimal.ONE;
    for (let k = 1; k <= BigDecimal.precision; k++) {
      power = power.mulBounded(ne);
      const term = power.div(2 * k + 1);
      sum = sum.add(term);
      if (term.abs().lt(tol)) return sum;
    }
    return null;
  }
  if (e.gt(0)) {
    const t = e.sqrt();
    return t.atan().div(t);
  }
  // 1 + e < 0.01 loses digits of 1 + e; the next attempt carries them
  const y = BigDecimal.ONE.add(e);
  if (!y.gt(0)) return null;
  loss.digits = Math.max(loss.digits, -log10Abs(y));
  const t = e.neg().sqrt();
  return t.atanh().div(t);
}

/** R_F(x, y, z) for x, y, z ≥ 0 with at most one zero (DLMF 19.36.1). */
function carlsonRF(
  x: BigDecimal,
  y: BigDecimal,
  z: BigDecimal
): BigDecimal | null {
  const zeros =
    (x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0);
  if (zeros > 1) return BigDecimal.POSITIVE_INFINITY;
  const A0 = x.add(y).add(z).div(BIG_THREE);
  const spread = bigMax(A0.sub(x).abs(), A0.sub(y).abs(), A0.sub(z).abs());
  // The series after the duplications is in X = spread/A·4⁻ᵐ and is
  // truncated at order 6 (Carlson 1995, eq. 2.2), so the relative truncation
  // error is of the order of X⁶; X < 10^(−precision/6) makes it negligible
  // against a unit in the last place.
  const small = new BigDecimal(Math.pow(10, -BigDecimal.precision / 6));
  let [xm, ym, zm] = [x, y, z];
  let A = A0;
  let pow4 = BigDecimal.ONE;
  let converged = false;
  for (let i = 0; i < CARLSON_MAX_DUPLICATIONS; i++) {
    if (spread.mul(pow4).lt(small.mul(A))) {
      converged = true;
      break;
    }
    const sx = xm.sqrt();
    const sy = ym.sqrt();
    const sz = zm.sqrt();
    const lm = sx.mul(sy).add(sx.mul(sz)).add(sy.mul(sz));
    A = A.add(lm).div(BIG_FOUR);
    xm = xm.add(lm).div(BIG_FOUR);
    ym = ym.add(lm).div(BIG_FOUR);
    zm = zm.add(lm).div(BIG_FOUR);
    pow4 = pow4.div(BIG_FOUR);
  }
  if (!converged) return null;
  const t = pow4.div(A);
  const X = A0.sub(x).mul(t);
  const Y = A0.sub(y).mul(t);
  const Z = X.add(Y).neg();
  const E2 = X.mul(Y).sub(Z.mul(Z));
  const E3 = X.mul(Y).mul(Z);
  const series = new BigDecimal(9240)
    .sub(E2.mul(924))
    .add(E2.mul(E2).mul(385))
    .add(E3.mul(660))
    .sub(E2.mul(E3).mul(630))
    .div(9240);
  return series.div(A.sqrt());
}

/** R_J(x, y, z, p) for x, y, z ≥ 0 with at most one zero and p > 0 (DLMF 19.36.1). */
function carlsonRJ(
  x: BigDecimal,
  y: BigDecimal,
  z: BigDecimal,
  p: BigDecimal,
  loss: Loss
): BigDecimal | null {
  const zeros =
    (x.isZero() ? 1 : 0) + (y.isZero() ? 1 : 0) + (z.isZero() ? 1 : 0);
  if (zeros > 1) return BigDecimal.POSITIVE_INFINITY;
  if (p.isNegative()) return carlsonRJPrincipal(x, y, z, p, loss);
  const A0 = x.add(y).add(z).add(p.mul(2)).div(5);
  const delta = p.sub(x).mul(p.sub(y)).mul(p.sub(z));
  const spread = bigMax(
    A0.sub(x).abs(),
    A0.sub(y).abs(),
    A0.sub(z).abs(),
    A0.sub(p).abs()
  );
  // As for R_F, with the series of Carlson (1995, eq. 2.7) at order 6.
  const small = new BigDecimal(Math.pow(10, -(BigDecimal.precision + 1) / 6));
  let [xm, ym, zm, pm] = [x, y, z, p];
  let A = A0;
  let pow4 = BigDecimal.ONE;
  let S = BigDecimal.ZERO;
  let converged = false;
  for (let i = 0; i < CARLSON_MAX_DUPLICATIONS; i++) {
    checkDeadline(loss.deadline);
    const sx = xm.sqrt();
    const sy = ym.sqrt();
    const sz = zm.sqrt();
    const sp = pm.sqrt();
    const lm = sx.mul(sy).add(sx.mul(sz)).add(sy.mul(sz));
    const A1 = A.add(lm).div(BIG_FOUR);
    xm = xm.add(lm).div(BIG_FOUR);
    ym = ym.add(lm).div(BIG_FOUR);
    zm = zm.add(lm).div(BIG_FOUR);
    pm = pm.add(lm).div(BIG_FOUR);
    const dm = sp.add(sx).mul(sp.add(sy)).mul(sp.add(sz));
    if (spread.mul(pow4).lt(small.mul(A))) {
      converged = true;
      break;
    }
    const em = delta.mul(pow4).mul(pow4).mul(pow4).div(dm.mul(dm));
    const rc = rc1(em, loss);
    if (rc === null) return null;
    S = S.add(rc.mul(pow4).div(dm));
    pow4 = pow4.div(BIG_FOUR);
    A = A1;
  }
  if (!converged) return null;
  const t = pow4.div(A);
  const X = A0.sub(x).mul(t);
  const Y = A0.sub(y).mul(t);
  const Z = A0.sub(z).mul(t);
  const P = X.add(Y).add(Z).neg().div(2);
  const E2 = X.mul(Y).add(X.mul(Z)).add(Y.mul(Z)).sub(P.mul(P).mul(3));
  const XYZ = X.mul(Y).mul(Z);
  const E3 = XYZ.add(E2.mul(P).mul(2)).add(P.mul(P).mul(P).mul(4));
  const E4 = XYZ.mul(2).add(E2.mul(P)).add(P.mul(P).mul(P).mul(3)).mul(P);
  const E5 = XYZ.mul(P).mul(P);
  const series = new BigDecimal(24024)
    .sub(E2.mul(5148))
    .add(E2.mul(E2).mul(2457))
    .add(E3.mul(4004))
    .sub(E2.mul(E3).mul(4158))
    .sub(E4.mul(3276))
    .add(E5.mul(2772))
    .div(24024);
  return pow4.mul(series).div(A.mul(A.sqrt())).add(S.mul(6));
}

/** R_C(x, y) for x ≥ 0 and y > 0, by homogeneity from R_C(1, 1 + e). */
function carlsonRC(
  x: BigDecimal,
  y: BigDecimal,
  loss: Loss
): BigDecimal | null {
  if (x.isZero()) return BigDecimal.PI.div(y.sqrt().mul(2));
  const r = rc1(y.div(x).sub(BigDecimal.ONE), loss);
  return r === null ? null : r.div(x.sqrt());
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
  loss: Loss
): BigDecimal | null {
  const [x, y, z] = [x0, y0, z0].sort((u, v) =>
    u.lt(v) ? -1 : u.gt(v) ? 1 : 0
  );
  const q = p.neg();
  const pn = z.mul(x.add(y).add(q)).sub(x.mul(y)).div(z.add(q));
  const rj = carlsonRJ(x, y, z, pn, loss);
  const rf = carlsonRF(x, y, z);
  if (rj === null || rf === null || !rj.isFinite() || !rf.isFinite())
    return null;
  const first = pn.sub(z).mul(rj);
  const second = rf.mul(BIG_THREE);
  let third = BigDecimal.ZERO;
  const xy = x.mul(y);
  if (!xy.isZero()) {
    const pq = pn.mul(q);
    const rc = carlsonRC(xy.add(pq), pq, loss);
    if (rc === null) return null;
    third = xy.mul(z).div(xy.add(pq)).sqrt().mul(rc).mul(BIG_THREE);
  }
  const v = first.sub(second).add(third);
  noteCancellation(loss, bigMax(first.abs(), second, third), v);
  return v.div(z.add(q));
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
function reduceAmplitude(phi: BigDecimal, loss: Loss): Amplitude {
  const pi = BigDecimal.PI;
  const half = pi.div(2);
  let k = BigDecimal.ZERO;
  let r = phi;
  if (phi.abs().gt(half)) {
    k = phi.div(pi).round();
    r = phi.sub(k.mul(pi));
    loss.digits = Math.max(loss.digits, log10Abs(k) + 1);
  }
  const negative = r.isNegative();
  const u = r.abs();
  if (u.lte(half.div(2))) return { k, negative, s: u.sin(), c: u.cos() };
  const delta = half.sub(u);
  loss.digits = Math.max(loss.digits, -log10Abs(delta) + 1);
  return { k, negative, s: delta.cos(), c: delta.abs().sin() };
}

/** y = 1 − t·s² = c² + (1 − t)s², which keeps its digits for t near 1. */
function oneMinusTimesSin2(
  t: BigDecimal,
  a: Amplitude,
  loss: Loss
): BigDecimal {
  const c2 = a.c.mul(a.c);
  const second = BigDecimal.ONE.sub(t).mul(a.s).mul(a.s);
  const y = c2.add(second);
  // Terms of opposite signs (t > 1) can cancel to a small y
  if (!y.isZero()) noteCancellation(loss, bigMax(c2, second.abs()), y);
  return y;
}

/** 2kC ± T, with the loss of digits recorded. */
function addPeriods(
  k: BigDecimal,
  complete: BigDecimal,
  negative: boolean,
  part: BigDecimal,
  loss: Loss
): BigDecimal {
  const signed = negative ? part.neg() : part;
  if (k.isZero()) return signed;
  const periods = k.mul(2).mul(complete);
  const total = periods.add(signed);
  noteCancellation(loss, bigMax(periods.abs(), signed.abs()), total);
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
  m: BigDecimal
): BigDecimal | null {
  if (isUndefined(phi, m)) return BigDecimal.NAN;
  if (phi.isZero()) return BigDecimal.ZERO;
  return carlsonResult(ce, BigDecimal.precision, (loss) => {
    const a = reduceAmplitude(phi, loss);
    let K = BigDecimal.ZERO;
    if (!a.k.isZero()) {
      // F(φ + kπ|m) = F(φ|m) + 2kK(m); K is complex or infinite for m ≥ 1.
      // At m = 1 the value is not finite: no fallback to the machine kernel,
      // whose double φ can fall below π/2 when φ is just above it.
      if (m.eq(BigDecimal.ONE)) return null;
      if (m.gt(BigDecimal.ONE)) return BigDecimal.NAN;
      K = bigEllipticK(ce, m);
    }
    const y = oneMinusTimesSin2(m, a, loss);
    if (y.isNegative()) return BigDecimal.NAN;
    const rf = carlsonRF(a.c.mul(a.c), y, BigDecimal.ONE);
    if (rf === null || !rf.isFinite()) return rf;
    return addPeriods(a.k, K, a.negative, a.s.mul(rf), loss);
  });
}

/**
 * Incomplete elliptic integral of the second kind E(φ|m) (parameter
 * convention) for real φ and m, where the value is real.
 */
export function bigEllipticEIncomplete(
  ce: ComputeEngine,
  phi: BigDecimal,
  m: BigDecimal
): BigDecimal | null {
  if (isUndefined(phi, m)) return BigDecimal.NAN;
  if (phi.isZero()) return BigDecimal.ZERO;
  return carlsonResult(ce, BigDecimal.precision, (loss) => {
    const a = reduceAmplitude(phi, loss);
    let E = BigDecimal.ZERO;
    if (!a.k.isZero()) {
      if (m.gt(BigDecimal.ONE)) return BigDecimal.NAN;
      E = bigEllipticE(ce, m);
    }
    const y = oneMinusTimesSin2(m, a, loss);
    if (y.isNegative()) return BigDecimal.NAN;
    const x = a.c.mul(a.c);
    const rf = carlsonRF(x, y, BigDecimal.ONE);
    if (rf === null) return null;
    const rd = carlsonRJ(x, y, BigDecimal.ONE, BigDecimal.ONE, loss);
    // E(π/2|1) is 1, but both integrals diverge there, and the kernel does
    // not take the difference of two infinities
    if (rd === null || !rf.isFinite() || !rd.isFinite()) return null;
    const first = a.s.mul(rf);
    const second = m.div(BIG_THREE).mul(a.s).mul(a.s).mul(a.s).mul(rd);
    const part = first.sub(second);
    noteCancellation(loss, bigMax(first.abs(), second.abs()), part);
    return addPeriods(a.k, E, a.negative, part, loss);
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
  m: BigDecimal
): BigDecimal | null {
  if (isUndefined(n, m)) return BigDecimal.NAN;
  if (n.eq(1) || m.eq(1)) return BigDecimal.POSITIVE_INFINITY;
  if (m.gt(1)) return BigDecimal.NAN;
  // The principal value of Π(n|0) = ∫₀^∞ dt/(1 + (1 − n)t²) is 0 for n > 1:
  // the sum below cancels to it, which `carlsonResult` reads as all digits lost
  if (m.isZero() && n.gt(1)) return BigDecimal.ZERO;
  return carlsonResult(ce, BigDecimal.precision, (loss) => {
    // Π(n|m) = R_F(0, 1−m, 1) + (n/3)·R_J(0, 1−m, 1, 1−n)  (DLMF 19.25.14)
    const y = BigDecimal.ONE.sub(m);
    const rf = carlsonRF(BigDecimal.ZERO, y, BigDecimal.ONE);
    const rj = carlsonRJ(
      BigDecimal.ZERO,
      y,
      BigDecimal.ONE,
      BigDecimal.ONE.sub(n),
      loss
    );
    if (rf === null || rj === null) return null;
    const second = n.div(BIG_THREE).mul(rj);
    const total = rf.add(second);
    noteCancellation(loss, bigMax(rf.abs(), second.abs()), total);
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
  m: BigDecimal
): BigDecimal | null {
  if (isUndefined(n, phi, m)) return BigDecimal.NAN;
  if (phi.isZero()) return BigDecimal.ZERO;
  return carlsonResult(ce, BigDecimal.precision, (loss) => {
    const a = reduceAmplitude(phi, loss);
    let P = BigDecimal.ZERO;
    if (!a.k.isZero()) {
      // At m = 1 the value is not finite (see `bigEllipticF`)
      if (m.eq(BigDecimal.ONE)) return null;
      if (m.gt(BigDecimal.ONE)) return BigDecimal.NAN;
      const complete = bigEllipticPiComplete(ce, n, m);
      if (complete === null) return null;
      // Π(n|m) infinite: the machine kernel's NaN, then the complex kernel
      if (!complete.isFinite()) return BigDecimal.NAN;
      P = complete;
    }
    const y = oneMinusTimesSin2(m, a, loss);
    if (y.isNegative()) return BigDecimal.NAN;
    const p = oneMinusTimesSin2(n, a, loss);
    if (p.isZero()) return BigDecimal.POSITIVE_INFINITY;
    const x = a.c.mul(a.c);
    const rf = carlsonRF(x, y, BigDecimal.ONE);
    const rj = carlsonRJ(x, y, BigDecimal.ONE, p, loss);
    if (rf === null || rj === null || !rf.isFinite() || !rj.isFinite())
      return null;
    const first = a.s.mul(rf);
    const second = n.div(BIG_THREE).mul(a.s).mul(a.s).mul(a.s).mul(rj);
    const part = first.add(second);
    noteCancellation(loss, bigMax(first.abs(), second.abs()), part);
    return addPeriods(a.k, P, a.negative, part, loss);
  });
}
