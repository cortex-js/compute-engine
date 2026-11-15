import { Complex } from 'complex.js';
import { BigDecimal } from '../../big-decimal/index.js';
import {
  checkDeadlineEvery,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import { bernoulliRational } from './bernoulli.js';

/**
 * Normalized Eisenstein series Eₖ(τ) of even weight `k ≥ 2`, for `Im(τ) > 0`.
 *
 *   Eₖ(τ) = 1 − (2k / Bₖ) · Σ_{m≥1} m^{k−1} · qᵐ/(1 − qᵐ),   q = e^{2πiτ}
 *
 * This is the Lambert-series form of `1 − (2k/Bₖ) Σ σ_{k−1}(n) qⁿ` (Fungrim
 * 10cdf4/f8dfaf/e20db0). The coefficient `2k/Bₖ` is 24, 240, 504, … for
 * k = 2, 4, 6, …
 *
 * The terms are about m^{k−1}·|q|ᵐ. They rise until m ≈ (k−1)/(2π Im τ)
 * before they fall, so the sum cannot stop on |q|ᵐ alone, and for a large
 * weight they are far above Eₖ(τ) itself: at k = 400, τ = 0.4 + 0.87i the
 * terms reach 10²⁴ for a value of 3·10⁷. The sum is therefore stopped by a
 * tail bound, and the digits it cancels are measured: the double-precision
 * sum answers when it keeps its digits, and otherwise the sum is repeated in
 * `BigDecimal` at the precision that the cancellation needs. A weight or a
 * point for which that takes more than the caps below leaves the call
 * unevaluated (NaN) rather than a partial sum.
 */

/** Heaviest weight the kernel computes (the Bernoulli number is exact). */
const EISENSTEIN_MAX_WEIGHT = 1000;

/** Terms of the double-precision sum before the kernel declines. */
const MAX_TERMS_DOUBLE = 100_000;

/** Terms of the `BigDecimal` sum before the kernel declines. */
const MAX_TERMS_BIG = 20_000;

/** Largest working precision, in digits, of the `BigDecimal` sum. */
const MAX_DIGITS = 800;

/** Digits kept past the cancellation of the `BigDecimal` sum. */
const BIG_GUARD_DIGITS = 25;

/** Relative size of the discarded tail, for the double-precision sum. */
const DOUBLE_TAIL_TOLERANCE = 1e-17;

/** Relative size of the discarded tail, for the `BigDecimal` sum. */
const BIG_TAIL_TOLERANCE = 1e-22;

/**
 * Largest relative rounding error of the double-precision sum that is
 * accepted; a sum that cancels more is repeated in `BigDecimal`.
 */
const DOUBLE_ACCEPT = 5e-14;

/**
 * Eₖ(τ) is normalized to 1 at the cusp, so a value below this is only
 * resolved to this absolute error: an exact zero (E₆(i)), or a point within
 * rounding of one (E₄ at e^{2πi/3}, as a double), has no digits to chase.
 */
const ZERO_FLOOR = 1e-30;

/** The largest ln of a term for which the double-precision sum cannot overflow. */
const DOUBLE_MAX_LN = 600;

/** Consecutive falling terms before the tail bound is trusted. */
const FALLING_TERMS = 3;

const LN10 = Math.LN10;

/** ln of a positive bigint, also beyond the double range. */
function lnBigInt(n: bigint): number {
  const digits = n.toString();
  const head = Number(digits.slice(0, 15));
  return Math.log(head) + (digits.length - Math.min(15, digits.length)) * LN10;
}

/**
 * ln Σ_{m>N} |term_m|·(an upper bound), or `undefined` while the terms are
 * not known to fall.
 *
 * With r = |q| and u_m = m^{k−1}·rᵐ, the ratio u_{m+1}/u_m =
 * (1 + 1/m)^{k−1}·r decreases in m. Once ρ = (1 + 1/(N+1))^{k−1}·r < 1 the
 * ratios of every later pair are at most ρ, so the tail of u is at most
 * u_{N+1}/(1 − ρ). Each term is m^{k−1}·|qᵐ|/|1 − qᵐ| ≤ u_m/(1 − r^{N+1}) for
 * m > N, hence
 *
 *   Σ_{m>N} |term_m| ≤ u_{N+1} / ((1 − r^{N+1})·(1 − ρ)).
 *
 * `lnr` is ln r = −2π Im τ.
 */
function lnTail(k: number, lnr: number, N: number): number | undefined {
  const lnRho = (k - 1) * Math.log1p(1 / (N + 1)) + lnr;
  if (!(lnRho <= -1e-6)) return undefined;
  const lnU = (k - 1) * Math.log(N + 1) + lnr * (N + 1);
  return (
    lnU - Math.log(-Math.expm1(lnr * (N + 1))) - Math.log(-Math.expm1(lnRho))
  );
}

/** True when u_{N−2} > u_{N−1} > u_N > u_{N+1} (the ratios decrease, so one check is enough). */
function isFalling(k: number, lnr: number, N: number): boolean {
  if (N < FALLING_TERMS) return false;
  const m = N - FALLING_TERMS + 1;
  return (k - 1) * Math.log1p(1 / m) + lnr < 0;
}

/** ln(eᵃ + eᵇ). */
function lnAddExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const hi = Math.max(a, b);
  return hi + Math.log1p(Math.exp(Math.min(a, b) - hi));
}

/** The exact value of a double. */
function exactBig(x: number): BigDecimal {
  if (x === 0) return BigDecimal.ZERO;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & 0xfffffffffffffn;
  if (biased !== 0) mantissa |= 1n << 52n;
  const e2 = (biased === 0 ? 1 : biased) - 1075; // x = ±mantissa·2^e2
  const signed = x < 0 ? -mantissa : mantissa;
  if (e2 >= 0) return new BigDecimal(signed << BigInt(e2));
  // m/2ⁿ = m·5ⁿ/10ⁿ
  return new BigDecimal(`${signed * 5n ** BigInt(-e2)}e${e2}`);
}

interface Coefficient {
  /** 2k/Bₖ as a double, or NaN when it is outside the range of a double. */
  value: number;
  ln: number;
  negative: boolean;
  num: bigint;
  den: bigint;
}

/** 2k/Bₖ = 2k·den/num for Bₖ = num/den. */
function coefficient(k: number): Coefficient | undefined {
  const [num, den] = bernoulliRational(k);
  if (num === 0n) return undefined;
  const negative = num < 0n;
  const absNum = negative ? -num : num;
  const ln = Math.log(2 * k) + lnBigInt(den) - lnBigInt(absNum);
  const fNum = Number(num);
  const fDen = Number(den);
  const value =
    Number.isFinite(fNum) && Number.isFinite(fDen)
      ? (2 * k * fDen) / fNum
      : Math.abs(ln) < DOUBLE_MAX_LN
        ? (negative ? -1 : 1) * Math.exp(ln)
        : NaN;
  return { value, ln, negative, num, den };
}

/** ln of the largest term m^{k−1}·rᵐ, over real m ≥ 1. */
function lnPeak(k: number, lnr: number): number {
  const mStar = (k - 1) / -lnr;
  return mStar < 1 ? lnr : (k - 1) * Math.log(mStar) + lnr * mStar;
}

type Outcome =
  | { kind: 'value'; value: Complex }
  | { kind: 'retry'; digits: number }
  | { kind: 'decline' };

/**
 * The sum in doubles. It answers when its rounding error, estimated from the
 * size of the terms, is below `DOUBLE_ACCEPT` of the result; otherwise it
 * reports `retry`, and `decline` when it cannot vouch for the sum at all.
 */
function sumDouble(
  k: number,
  q: Complex,
  lnr: number,
  coeff: Coefficient,
  deadline: DeadlineFrame | undefined
): Outcome {
  if (Number.isNaN(coeff.value)) return { kind: 'retry', digits: 0 };
  if (lnPeak(k, lnr) > DOUBLE_MAX_LN) return { kind: 'retry', digits: 0 };

  let sum = new Complex(0, 0);
  let qm = q; // qᵐ
  let size = 0; // Σ |coeff·term|
  const one = new Complex(1, 0);
  for (let m = 1; m <= MAX_TERMS_DOUBLE; m++) {
    if ((m & 0x3f) === 0) checkDeadlineEvery(deadline, 0);
    const term = qm.div(one.sub(qm)).mul(new Complex(Math.pow(m, k - 1), 0));
    sum = sum.add(term);
    size += term.abs();
    if (isFalling(k, lnr, m)) {
      const lnTailBound = lnTail(k, lnr, m);
      if (lnTailBound !== undefined) {
        const delta = Math.exp(coeff.ln + lnTailBound + Math.LN2);
        const e = one.sub(sum.mul(new Complex(coeff.value, 0)));
        const abs = e.abs();
        if (!Number.isFinite(abs)) return { kind: 'retry', digits: 0 };
        const scale = 1 + Math.abs(coeff.value) * size;
        const floored = Math.max(abs, ZERO_FLOOR);
        if (delta < floored / 2 && delta <= DOUBLE_TAIL_TOLERANCE * floored) {
          // Rounding in q (relative error ε) moves term m by m·ε, and each
          // qᵐ gathers a further error that grows like √m.
          const rounding =
            Number.EPSILON * scale * (4 + 2 * Math.min(m, (k - 1) / -lnr + 1));
          if (rounding <= DOUBLE_ACCEPT * floored)
            return { kind: 'value', value: e };
          return {
            kind: 'retry',
            digits: Math.ceil(Math.log10(scale) - Math.log10(floored)),
          };
        }
      }
    }
    qm = qm.mul(q);
  }
  return { kind: 'decline' };
}

/** log of |a + bi| for big parts, also beyond the double range. */
function lnAbsBig(re: BigDecimal, im: BigDecimal): number {
  const a = re.toNumber();
  const b = im.toNumber();
  const h = Math.hypot(a, b);
  if (Number.isFinite(h) && h > 1e-290) return Math.log(h);
  if (re.isZero() && im.isZero()) return -Infinity;
  const ar = re.abs();
  const ai = im.abs();
  const big = ar.gt(ai) ? ar : ai;
  const lnBig = big.ln().toNumber();
  const ratio = (ar.gt(ai) ? ai : ar).div(big).toNumber();
  return lnBig + 0.5 * Math.log1p(ratio * ratio);
}

/**
 * The sum in `BigDecimal` at `digits` digits. It reports `retry` with the
 * precision that its own measure of the cancellation asks for when `digits`
 * is not enough.
 */
function sumBig(
  k: number,
  x: number,
  y: number,
  lnr: number,
  coeff: Coefficient,
  digits: number,
  deadline: DeadlineFrame | undefined
): Outcome {
  const saved = BigDecimal.precision;
  BigDecimal.precision = digits;
  try {
    const round = (v: BigDecimal): BigDecimal => v.toPrecision(digits);
    const twoPi = BigDecimal.PI.mul(2);
    const r = twoPi.mul(exactBig(y)).neg().exp();
    // The angle from x mod 1, which is exact for a double.
    const theta = twoPi.mul(exactBig(x).mod(1));
    const qRe = round(r.mul(theta.cos()));
    const qIm = round(r.mul(theta.sin()));
    const coeffBig = new BigDecimal(2n * BigInt(k) * coeff.den).div(
      new BigDecimal(coeff.num)
    );

    let aRe = qRe; // qᵐ
    let aIm = qIm;
    let sRe = BigDecimal.ZERO;
    let sIm = BigDecimal.ZERO;
    let lnSize = 0; // ln(1 + Σ |coeff·term|)
    for (let m = 1; m <= MAX_TERMS_BIG; m++) {
      if ((m & 0x7) === 0) checkDeadlineEvery(deadline, 0);
      // qᵐ/(1 − qᵐ) = qᵐ·conj(1 − qᵐ)/|1 − qᵐ|²
      const wRe = BigDecimal.ONE.sub(aRe);
      const wIm = aIm.neg();
      const den = round(wRe.mul(wRe).add(wIm.mul(wIm)));
      const nRe = aRe.mul(wRe).add(aIm.mul(wIm));
      const nIm = aIm.mul(wRe).sub(aRe.mul(wIm));
      const scale = new BigDecimal(m).pow(k - 1).div(den);
      sRe = sRe.add(round(nRe.mul(scale)));
      sIm = sIm.add(round(nIm.mul(scale)));

      const lnW = Math.log(Math.hypot(wRe.toNumber(), wIm.toNumber()));
      lnSize = lnAddExp(
        lnSize,
        coeff.ln + (k - 1) * Math.log(m) + lnr * m - lnW
      );

      if (isFalling(k, lnr, m)) {
        const lnTailBound = lnTail(k, lnr, m);
        if (lnTailBound !== undefined) {
          const lnDelta = coeff.ln + lnTailBound + Math.LN2;
          const eRe = BigDecimal.ONE.sub(round(coeffBig.mul(sRe)));
          const eIm = round(coeffBig.mul(sIm)).neg();
          const lnE = Math.max(lnAbsBig(eRe, eIm), Math.log(ZERO_FLOOR));
          if (
            lnDelta < lnE - Math.LN2 &&
            lnDelta <= Math.log(BIG_TAIL_TOLERANCE) + lnE
          ) {
            const lost = (lnSize - lnE) / LN10;
            if (digits < lost + BIG_GUARD_DIGITS)
              return {
                kind: 'retry',
                digits: Math.ceil(lost) + 2 * BIG_GUARD_DIGITS,
              };
            const re = eRe.toNumber();
            const im = eIm.toNumber();
            if (!Number.isFinite(re) || !Number.isFinite(im))
              return { kind: 'decline' };
            return { kind: 'value', value: new Complex(re, im) };
          }
        }
      }
      const nextRe = round(aRe.mul(qRe).sub(aIm.mul(qIm)));
      aIm = round(aIm.mul(qRe).add(aRe.mul(qIm)));
      aRe = nextRe;
    }
    return { kind: 'decline' };
  } finally {
    BigDecimal.precision = saved;
  }
}

/**
 * Eₖ(τ) of even weight `k ≥ 2`, for `Im(τ) > 0`.
 *
 * Returns NaN outside the upper half-plane, for a weight that is odd or
 * above `EISENSTEIN_MAX_WEIGHT`, and when the sum cannot be vouched for: a
 * point too close to the real axis for the terms to fall within the term
 * caps, or one whose cancellation takes more than `MAX_DIGITS` digits.
 */
export function eisensteinE(
  s: number,
  tau: Complex,
  deadline?: DeadlineFrame
): Complex {
  const NaNC = new Complex(NaN, NaN);
  if (tau.isNaN()) return NaNC;
  if (!Number.isInteger(s) || s < 2 || s % 2 !== 0) return NaNC;
  if (s > EISENSTEIN_MAX_WEIGHT) return NaNC;
  if (!(tau.im > 0) || !Number.isFinite(tau.re) || !Number.isFinite(tau.im))
    return NaNC;

  const lnr = -2 * Math.PI * tau.im;
  const q = tau.mul(new Complex(0, 2 * Math.PI)).exp(); // e^{2πiτ}
  if (q.abs() >= 1) return NaNC;

  const coeff = coefficient(s);
  if (coeff === undefined) return NaNC;

  const first = sumDouble(s, q, lnr, coeff, deadline);
  if (first.kind === 'value') return first.value;
  if (first.kind === 'decline') return NaNC;

  // The cancellation is at least the size of the largest term over a value
  // of about 1; later attempts use the loss that the previous one measured.
  let digits = Math.max(
    first.digits,
    Math.ceil((lnPeak(s, lnr) + coeff.ln) / LN10)
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    digits = Math.max(digits, 0) + 2 * BIG_GUARD_DIGITS;
    if (digits > MAX_DIGITS) return NaNC;
    const outcome = sumBig(s, tau.re, tau.im, lnr, coeff, digits, deadline);
    if (outcome.kind === 'value') return outcome.value;
    if (outcome.kind === 'decline') return NaNC;
    digits = outcome.digits;
  }
  return NaNC;
}
