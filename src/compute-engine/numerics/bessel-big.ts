import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { checkDeadlineEvery } from '../../common/interruptible.js';
import { bigGamma, type HurwitzOperand } from './special-functions.js';
import {
  bigWithCancellation,
  magnitude,
  type Scaled,
} from './bignum-cancellation.js';

/**
 * Arbitrary-precision Bessel functions J, Y, I and K of a real order ν and a
 * real argument x, at `BigDecimal.precision` digits.
 *
 * - Power series about x = 0 (DLMF 10.2.2, 10.25.2) for J and I:
 *   `(x/2)^ν Σ (±x²/4)^k / (k! Γ(ν+k+1))`. The ratio of two terms decreases
 *   once ν + k + 1 > 0, so once it is at most ½ the tail is at most the last
 *   term. The J series alternates and loses about 0.43·x digits
 *   (`bigWithCancellation` measures them).
 * - For an integer order, the finite sum and the digamma series of DLMF 10.8.1
 *   (Y) and 10.31.1 (K); for a non-integer order DLMF 10.4.6 and 10.27.4,
 *   `Y_ν = (J_ν cos νπ − J_{−ν}) / sin νπ` and
 *   `K_ν = π (I_{−ν} − I_ν) / (2 sin νπ)`, whose cancellation near an
 *   integer order is measured the same way.
 * - Hankel's expansions (DLMF 10.17.3–10.17.4, 10.40.2) for J, Y and K at
 *   large x, where the series would lose too many digits (J, Y) or
 *   compute a tiny K from huge terms. The terms `a_k(ν)/x^k` decrease while
 *   `(2k−1)² < 4ν²` fails, then grow again: the sum stops at the smallest term
 *   once that is below the working precision. For real ν and x > 0 the
 *   remainder is bounded by the first neglected term when k ≥ ν − ½
 *   (DLMF 10.17(iii), 10.40(ii)), so no term before that index ends the sum.
 *
 * A kernel that cannot reach the digits (the argument or the order past the
 * caps, a Hankel sum whose smallest term is above the tolerance and an
 * argument too large for the series, a cancellation past
 * `CANCELLATION_MAX_EXTRA_DIGITS`) returns `undefined`.
 */

/** Orders above this decline: Γ(ν + 1) and the finite sums grow with ν. */
export const BESSEL_BIG_MAX_ORDER = 1000;

/** The power series decline past this argument: J loses 0.43·x digits. */
export const BESSEL_BIG_MAX_SERIES_ARGUMENT = 1000;

/** Below this argument Hankel's expansion is not tried: its smallest term is about e^{−2x}. */
const BESSEL_HANKEL_MIN_ARGUMENT = 12;

/** Terms of a power series or of Hankel's expansion before the kernel declines. */
const BESSEL_BIG_MAX_TERMS = 20000;

/** Consecutive terms below the tolerance that end a series (the tail bound is already ≤ the term). */
const BESSEL_BIG_CONSECUTIVE = 2;

export type BesselKind = 'J' | 'Y' | 'I' | 'K';

/** Digits added to read an operand: a rational order or argument is divided at this many more. */
const BESSEL_OPERAND_DIGITS = 30;

const HALF = BigDecimal.HALF;

/** The operand as a big decimal at the working precision (a rational is divided there). */
function toBig(x: HurwitzOperand): BigDecimal {
  return x instanceof BigDecimal
    ? x
    : new BigDecimal(x[0]).div(new BigDecimal(x[1]));
}

/** 10^−working, the relative tolerance of a sum. */
function tolerance(): BigDecimal {
  return new BigDecimal(`1e-${BigDecimal.precision}`);
}

function bigInt(n: number): BigDecimal {
  return new BigDecimal(n);
}

/** n! as a big decimal. */
function factorial(n: number): BigDecimal {
  let f = 1n;
  for (let k = 2n; k <= BigInt(n); k++) f *= k;
  return new BigDecimal(f);
}

/** 1/Γ(ν + 1). */
function reciprocalGammaPlusOne(ce: ComputeEngine, nu: BigDecimal): BigDecimal {
  if (nu.isInteger() && !nu.isNegative())
    return BigDecimal.ONE.div(factorial(nu.toNumber()));
  return BigDecimal.ONE.div(bigGamma(ce, nu.add(BigDecimal.ONE)));
}

/** base^ν for base > 0, with the digits that the exponent's size costs. */
function power(base: BigDecimal, nu: BigDecimal): BigDecimal {
  if (nu.isInteger()) return base.pow(nu);
  const saved = BigDecimal.precision;
  const y0 = base.ln().mul(nu);
  BigDecimal.precision = saved + Math.max(0, magnitude(y0) + 2);
  try {
    return base.ln().mul(nu).exp().toPrecision(saved);
  } finally {
    BigDecimal.precision = saved;
  }
}

/**
 * Σ_k (sign·q)^k / (k! Γ(ν+k+1)) with the largest term, for q = x²/4 > 0.
 * The series is summed until `BESSEL_BIG_CONSECUTIVE` terms in a row are
 * below the tolerance times the largest term, while the next ratio is at most
 * ½ and ν + k + 1 > 0 (the ratios then keep decreasing).
 */
function powerSeries(
  ce: ComputeEngine,
  nu: BigDecimal,
  q: BigDecimal,
  sign: 1 | -1
): Scaled | undefined {
  const tol = tolerance();
  const signedQ = sign === 1 ? q : q.neg();
  let term = reciprocalGammaPlusOne(ce, nu);
  let sum = term;
  let peak = term.abs();
  let small = 0;
  for (let k = 0; k < BESSEL_BIG_MAX_TERMS; k++) {
    checkDeadlineEvery(ce._deadlineFrame, 0x3f);
    const d = nu.add(k + 1);
    const ratio = signedQ.div(d.mul(k + 1));
    term = term.mul(ratio);
    sum = sum.add(term);
    const size = term.abs();
    if (size.gt(peak)) peak = size;
    const next = signedQ.div(nu.add(k + 2).mul(k + 2)).abs();
    if (
      d.isPositive() &&
      next.lte(HALF) &&
      (term.isZero() || size.lte(tol.mul(peak)))
    ) {
      if (++small >= BESSEL_BIG_CONSECUTIVE) return { value: sum, peak };
    } else small = 0;
  }
  return undefined;
}

/** I_ν(x) or J_ν(x) for x > 0 from the power series. */
function besselIJSeries(
  ce: ComputeEngine,
  kind: 'I' | 'J',
  nu: BigDecimal,
  x: BigDecimal
): Scaled | undefined {
  const half = x.div(2);
  const series = powerSeries(ce, nu, half.mul(half), kind === 'I' ? 1 : -1);
  if (series === undefined) return undefined;
  const scale = power(half, nu);
  return { value: series.value.mul(scale), peak: series.peak.mul(scale) };
}

/**
 * Y_n(x) or K_n(x) for an integer n ≥ 0 and x > 0 (DLMF 10.8.1, 10.31.1):
 *
 *   Y_n = −h^{−n}/π F(+) + (2/π) ln h · h^n S₁(−) − h^n/π S₂(−)
 *   K_n = ½ h^{−n} F(−) + (−1)^{n+1} ln h · h^n S₁(+) + (−1)^n ½ h^n S₂(+)
 *
 * with h = x/2, q = h², F(σ) = Σ_{k<n} (n−k−1)!/k! (σq)^k,
 * S₁(s) = Σ (sq)^k/(k!(n+k)!) and S₂(s) = Σ (ψ(k+1) + ψ(n+k+1)) (sq)^k/(k!(n+k)!),
 * where ψ(m+1) = −γ + H_m. S₁ and S₂ share their terms and their stopping
 * rule, as in `powerSeries`.
 */
function besselIntegerOrderKY(
  ce: ComputeEngine,
  kind: 'K' | 'Y',
  n: number,
  x: BigDecimal
): Scaled | undefined {
  const tol = tolerance();
  const h = x.div(2);
  const q = h.mul(h);
  const s: 1 | -1 = kind === 'K' ? 1 : -1;
  const sq = s === 1 ? q : q.neg();

  // F: the finite sum, with sigma = −s
  let finite = BigDecimal.ZERO;
  let qPower = BigDecimal.ONE;
  let factorialK = BigDecimal.ONE;
  const factorialN = factorial(Math.max(0, n - 1));
  // (n−k−1)! = (n−1)!/((n−1)(n−2)…(n−k)); built downward from (n−1)!
  let upper = factorialN;
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      factorialK = factorialK.mul(k);
      upper = upper.div(n - k);
    }
    finite = finite.add(upper.div(factorialK).mul(qPower));
    qPower = qPower.mul(q).mul(-s);
  }

  // S₁ and S₂ with their terms t_k = (sq)^k / (k! (n+k)!)
  let term = BigDecimal.ONE.div(factorial(n));
  let harmonicK = BigDecimal.ZERO;
  let harmonicNK = BigDecimal.ZERO;
  for (let j = 1; j <= n; j++)
    harmonicNK = harmonicNK.add(BigDecimal.ONE.div(j));
  const twoGamma = BigDecimal.EULER_GAMMA.mul(2);
  let s1 = BigDecimal.ZERO;
  let s2 = BigDecimal.ZERO;
  let peak = BigDecimal.ZERO;
  let small = 0;
  for (let k = 0; k < BESSEL_BIG_MAX_TERMS; k++) {
    checkDeadlineEvery(ce._deadlineFrame, 0x3f);
    const weighted = term.mul(harmonicK.add(harmonicNK).sub(twoGamma));
    s1 = s1.add(term);
    s2 = s2.add(weighted);
    for (const t of [term, weighted]) if (t.abs().gt(peak)) peak = t.abs();
    // ratio of the next term: sq / ((k+1)(n+k+1)), at most ½ from here on
    const next = sq.div(bigInt((k + 1) * (n + k + 1))).abs();
    if (
      next.lte(HALF) &&
      weighted.abs().lte(tol.mul(peak)) &&
      term.abs().lte(tol.mul(peak))
    ) {
      if (++small >= BESSEL_BIG_CONSECUTIVE) break;
    } else small = 0;
    if (k === BESSEL_BIG_MAX_TERMS - 1) return undefined;
    term = term.mul(sq).div((k + 1) * (n + k + 1));
    harmonicK = harmonicK.add(BigDecimal.ONE.div(k + 1));
    harmonicNK = harmonicNK.add(BigDecimal.ONE.div(n + k + 1));
  }

  const hn = power(h, bigInt(n));
  const lnH = h.ln();
  const parity = n % 2 === 0 ? 1 : -1;
  const parts: BigDecimal[] =
    kind === 'K'
      ? [
          finite.div(hn).div(2),
          lnH.mul(hn).mul(s1).mul(-parity),
          hn.mul(s2).mul(parity).div(2),
        ]
      : [
          finite.div(hn).div(BigDecimal.PI).neg(),
          lnH.mul(hn).mul(s1).mul(2).div(BigDecimal.PI),
          hn.mul(s2).div(BigDecimal.PI).neg(),
        ];
  let largest = hn.mul(peak);
  const lnPeak = lnH.abs().gt(BigDecimal.ONE) ? lnH.abs() : BigDecimal.ONE;
  largest = largest.mul(lnPeak);
  for (const part of parts) if (part.abs().gt(largest)) largest = part.abs();
  return { value: parts.reduce((a, b) => a.add(b)), peak: largest };
}

/** sin(νπ) for a non-integer ν, with the digits that reducing a large ν costs. */
function sinPi(nu: BigDecimal): BigDecimal {
  const saved = BigDecimal.precision;
  BigDecimal.precision = saved + Math.max(0, magnitude(nu) + 2);
  try {
    return nu.mul(BigDecimal.PI).sin().toPrecision(saved);
  } finally {
    BigDecimal.precision = saved;
  }
}

/** Y_ν or K_ν for a non-integer ν and x > 0 from the series of J_{±ν} or I_{±ν}. */
function besselNonIntegerKY(
  ce: ComputeEngine,
  kind: 'K' | 'Y',
  nu: BigDecimal,
  x: BigDecimal
): Scaled | undefined {
  const base = kind === 'K' ? 'I' : 'J';
  const plus = besselIJSeries(ce, base, nu, x);
  const minus = besselIJSeries(ce, base, nu.neg(), x);
  if (plus === undefined || minus === undefined) return undefined;
  const sin = sinPi(nu);
  const piNu = nu.mul(BigDecimal.PI);
  const peak = plus.peak.add(minus.peak);
  if (kind === 'K') {
    const k = minus.value.sub(plus.value).mul(BigDecimal.PI).div(sin.mul(2));
    return {
      value: k,
      peak: peak.mul(BigDecimal.PI).div(sin.abs().mul(2)),
    };
  }
  const y = plus.value.mul(piNu.cos()).sub(minus.value).div(sin);
  return { value: y, peak: peak.div(sin.abs()) };
}

/**
 * Hankel's expansion at x ≥ `BESSEL_HANKEL_MIN_ARGUMENT` (DLMF 10.17.3–10.17.4
 * for J and Y, 10.40.2 for K): the terms t_k = a_k(ν)/x^k,
 * `t_k = t_{k−1} (4ν² − (2k−1)²) / (8 k x)`. The sum ends at the first k ≥ |ν|
 * whose term and the next are below the tolerance times the largest term and
 * decrease; if the terms grow again before that, the expansion cannot reach
 * the digits and the kernel declines.
 */
function hankel(
  ce: ComputeEngine,
  kind: 'J' | 'Y' | 'K',
  nu: BigDecimal,
  x: BigDecimal
): Scaled | undefined {
  const tol = tolerance();
  const mu = nu.mul(nu).mul(4);
  const startCheck = Math.ceil(nu.abs().toNumber()) + 1;
  const eightX = x.mul(8);
  let term = BigDecimal.ONE;
  let p = BigDecimal.ONE; // for K: the whole sum
  let qSum = BigDecimal.ZERO;
  let peak = BigDecimal.ONE;
  let small = 0;
  let previous = BigDecimal.ONE;
  for (let k = 1; k < BESSEL_BIG_MAX_TERMS; k++) {
    checkDeadlineEvery(ce._deadlineFrame, 0x3f);
    const odd = bigInt(2 * k - 1);
    term = term.mul(mu.sub(odd.mul(odd))).div(eightX.mul(k));
    const size = term.abs();
    if (size.gt(peak)) peak = size;
    const converged = size.lte(tol.mul(peak)) && size.lte(previous);
    if (k >= startCheck && converged) {
      if (++small >= BESSEL_BIG_CONSECUTIVE) break;
    } else {
      small = 0;
      // Past the index where the bound holds, a term above its predecessor
      // starts the divergent part of the expansion
      if (k >= startCheck && size.gt(previous)) return undefined;
    }
    if (kind === 'K') p = p.add(term);
    else if (k % 2 === 0) p = (k / 2) % 2 === 0 ? p.add(term) : p.sub(term);
    else qSum = ((k - 1) / 2) % 2 === 0 ? qSum.add(term) : qSum.sub(term);
    previous = size;
    if (k === BESSEL_BIG_MAX_TERMS - 1) return undefined;
  }
  if (small < BESSEL_BIG_CONSECUTIVE) return undefined;

  if (kind === 'K') {
    const prefactor = BigDecimal.PI.div(x.mul(2)).sqrt().mul(x.neg().exp());
    return { value: prefactor.mul(p), peak: prefactor.mul(peak) };
  }
  // χ = x − (ν/2 + 1/4)π, reduced at the digits that x costs
  const saved = BigDecimal.precision;
  BigDecimal.precision = saved + Math.max(0, magnitude(x) + 2);
  let cos: BigDecimal;
  let sin: BigDecimal;
  try {
    const chi = x.sub(nu.div(2).add(0.25).mul(BigDecimal.PI));
    cos = chi.cos().toPrecision(saved);
    sin = chi.sin().toPrecision(saved);
  } finally {
    BigDecimal.precision = saved;
  }
  const amplitude = BigDecimal.TWO.div(BigDecimal.PI.mul(x)).sqrt();
  const value =
    kind === 'J'
      ? p.mul(cos).sub(qSum.mul(sin))
      : p.mul(sin).add(qSum.mul(cos));
  return { value: amplitude.mul(value), peak: amplitude.mul(peak) };
}

/**
 * The Bessel function `kind` of order `order` at `x`, at `BigDecimal.precision`
 * digits, or `undefined` when the kernel declines: x = 0 (the caller's exact
 * values), a negative x for Y and K or for J and I of a non-integer order
 * (the value is complex), the order or the argument past the caps above, or
 * the digits not reached.
 */
export function bigBessel(
  ce: ComputeEngine,
  kind: BesselKind,
  order: HurwitzOperand,
  argument: HurwitzOperand
): BigDecimal | undefined {
  const digits = BigDecimal.precision;
  // The operands are read at a working precision so that an exact rational
  // keeps all its digits.
  BigDecimal.precision = digits + BESSEL_OPERAND_DIGITS;
  let nu: BigDecimal;
  let x: BigDecimal;
  try {
    nu = toBig(order).toPrecision(digits + BESSEL_OPERAND_DIGITS);
    x = toBig(argument).toPrecision(digits + BESSEL_OPERAND_DIGITS);
  } finally {
    BigDecimal.precision = digits;
  }
  if (!nu.isFinite() || !x.isFinite() || x.isZero()) return undefined;
  if (nu.abs().gt(BESSEL_BIG_MAX_ORDER)) return undefined;
  const integer = nu.isInteger();
  const direct = kind === 'J' || kind === 'I';
  if (x.isNegative() && !(direct && integer)) return undefined;
  const absX = x.abs();

  // The symmetries of an integer order: J_{−n} = (−1)^n J_n, Y_{−n} = (−1)^n Y_n,
  // I_{−n} = I_n, K_{−ν} = K_ν; and J_n(−x) = (−1)^n J_n(x), I_n(−x) = (−1)^n I_n(x).
  const oddOrder = integer && nu.abs().toNumber() % 2 === 1;
  let negate = false;
  if (integer && nu.isNegative() && (kind === 'J' || kind === 'Y') && oddOrder)
    negate = true;
  if (x.isNegative() && oddOrder) negate = !negate;
  const order0 = kind === 'K' || integer ? nu.abs() : nu;

  let value: BigDecimal | undefined;
  if (
    absX.gte(BESSEL_HANKEL_MIN_ARGUMENT) &&
    (kind === 'J' || kind === 'Y' || kind === 'K')
  )
    value = bigWithCancellation(() => hankel(ce, kind, order0, absX));
  if (value === undefined && absX.lte(BESSEL_BIG_MAX_SERIES_ARGUMENT)) {
    if (kind === 'I' || kind === 'J')
      value = bigWithCancellation(() => besselIJSeries(ce, kind, order0, absX));
    else if (integer)
      value = bigWithCancellation(() =>
        besselIntegerOrderKY(ce, kind, order0.toNumber(), absX)
      );
    else
      value = bigWithCancellation(() =>
        besselNonIntegerKY(ce, kind, order0, absX)
      );
  }
  return value === undefined ? undefined : negate ? value.neg() : value;
}
