import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { checkDeadlineEvery } from '../../common/interruptible.js';

/**
 * Arbitrary-precision Dedekind eta η(τ) for Im(τ) > 0, at
 * `BigDecimal.precision` digits.
 *
 * τ is first moved into the fundamental domain with the two generators of the
 * modular group (DLMF 23.15.1, 23.15.2): `η(τ + 1) = e^{iπ/12} η(τ)` and
 * `η(−1/τ) = √(−iτ) η(τ)` (principal root, Re(−iτ) = Im τ > 0). Each shift
 * by the nearest integer n and each inversion multiplies η by a factor, kept
 * as an integer count of the 24th roots of unity (n mod 24, exact for any
 * Re τ) and a complex product. The loop ends at |τ| ≥ 1, |Re τ| ≤ ½, where
 * Im τ ≥ √3/2 and |q| = e^{−2π Im τ} ≤ 0.0044.
 *
 * Euler's pentagonal number theorem then gives
 * `η(τ) = e^{iπτ/12} Σ_k (−1)^k q^{k(3k−1)/2}`, whose terms have distinct
 * exponents, so the tail from exponent N is at most `|q|^N/(1 − |q|)`: N is
 * chosen so that this is below the working precision, a bound and not a
 * convergence test.
 *
 * An inversion at |τ| < 1 amplifies the absolute error of τ by 1/|τ|²; the
 * digits that costs are counted and added to the working precision. The
 * value is accurate to the digits asked for relative to |η(τ)| in each
 * part; a part that is much smaller than the modulus is correspondingly less
 * accurate in its own digits. The kernel declines (`undefined`) past
 * `ETA_BIG_MAX_REDUCTIONS` modular steps, or if the digits lost to them pass
 * `ETA_BIG_MAX_EXTRA_DIGITS`.
 */

export interface BigComplex {
  re: BigDecimal;
  im: BigDecimal;
}

/** Modular steps (an inversion each) before the kernel declines. */
const ETA_BIG_MAX_REDUCTIONS = 500;

/**
 * Im τ below this declines. The reductions have been checked against mpmath
 * down to Im τ = 10^-3 (τ = 0.5 + 0.001i, 0.4999999999999 + 0.01i, 0.001 +
 * 0.001i); a τ this close to the real line needs many inversions, and the
 * digits they lose have not been measured below it.
 */
const ETA_BIG_MIN_IMAGINARY = 1e-3;

/** Digits carried past the ones asked for, before the reductions are counted. */
const ETA_BIG_GUARD_DIGITS = 20;

/** Most digits the reductions may cost; past this the kernel declines. */
const ETA_BIG_MAX_EXTRA_DIGITS = 2000;

/** The largest exponent of q that the pentagonal sum can need. */
const ETA_BIG_MAX_EXPONENT = 20000;

const mul = (a: BigComplex, b: BigComplex): BigComplex => ({
  re: a.re.mul(b.re).sub(a.im.mul(b.im)),
  im: a.re.mul(b.im).add(a.im.mul(b.re)),
});

/** √(a + ib) for Re > 0 (the principal root, without cancellation). */
function sqrtRightHalfPlane(a: BigDecimal, b: BigDecimal): BigComplex {
  const modulus = a.mul(a).add(b.mul(b)).sqrt();
  return {
    re: modulus.add(a).div(2).sqrt(),
    im: b.isNegative()
      ? modulus.sub(a).div(2).sqrt().neg()
      : modulus.sub(a).div(2).sqrt(),
  };
}

/** e^{iπ m/12} for an integer 0 ≤ m < 24. */
function root24(m: number): BigComplex {
  const angle = BigDecimal.PI.mul(m).div(12);
  return { re: angle.cos(), im: angle.sin() };
}

/** η(τ) at the working precision, with the digits the reductions cost. */
function etaAt(
  ce: ComputeEngine,
  re: BigDecimal,
  im: BigDecimal
): { value: BigComplex; lost: number } | undefined {
  let factor: BigComplex = { re: BigDecimal.ONE, im: BigDecimal.ZERO };
  let shifts = 0n;
  let lost = 0;
  let tauRe = re;
  let tauIm = im;
  let reduced = false;
  for (let step = 0; step <= ETA_BIG_MAX_REDUCTIONS; step++) {
    checkDeadlineEvery(ce._deadlineFrame, 0x3f);
    const n = tauRe.round();
    shifts += n.toBigInt();
    tauRe = tauRe.sub(n);
    const norm = tauRe.mul(tauRe).add(tauIm.mul(tauIm));
    if (norm.gte(BigDecimal.ONE)) {
      reduced = true;
      break;
    }
    // τ ← −1/τ, and η(τ) = √(−i·τ') η(τ') with τ' = −1/τ
    lost += Math.max(0, -Math.log10(norm.toNumber()) * 2);
    const nextRe = tauRe.neg().div(norm);
    const nextIm = tauIm.div(norm);
    factor = mul(factor, sqrtRightHalfPlane(nextIm, nextRe.neg()));
    tauRe = nextRe;
    tauIm = nextIm;
  }
  if (!reduced) return undefined;

  // The q-series at |q| = e^{−2π Im τ}
  const twoPi = BigDecimal.PI.mul(2);
  const decay = tauIm.mul(twoPi);
  const terms = Math.ceil(
    ((BigDecimal.precision + 2) * Math.LN10) / decay.toNumber()
  );
  if (terms > ETA_BIG_MAX_EXPONENT) return undefined;
  const absQ = decay.neg().exp();
  const phase = tauRe.mul(twoPi);
  const q: BigComplex = {
    re: absQ.mul(phase.cos()),
    im: absQ.mul(phase.sin()),
  };
  const powers: BigComplex[] = [{ re: BigDecimal.ONE, im: BigDecimal.ZERO }];
  for (let n = 1; n <= terms; n++) powers.push(mul(powers[n - 1], q));
  let sum: BigComplex = { re: BigDecimal.ZERO, im: BigDecimal.ZERO };
  for (
    let k = -Math.ceil(Math.sqrt(terms)) - 1;
    k <= Math.ceil(Math.sqrt(terms)) + 1;
    k++
  ) {
    const exponent = (k * (3 * k - 1)) / 2;
    if (exponent > terms) continue;
    const p = powers[exponent];
    sum =
      k % 2 === 0
        ? { re: sum.re.add(p.re), im: sum.im.add(p.im) }
        : { re: sum.re.sub(p.re), im: sum.im.sub(p.im) };
  }
  const angle = tauRe.mul(BigDecimal.PI).div(12);
  const magnitude = tauIm.mul(BigDecimal.PI).div(12).neg().exp();
  const prefactor: BigComplex = {
    re: magnitude.mul(angle.cos()),
    im: magnitude.mul(angle.sin()),
  };
  let value = mul(mul(prefactor, sum), factor);
  value = mul(value, root24(Number(((shifts % 24n) + 24n) % 24n)));
  return { value, lost };
}

/**
 * η(re + i·im) for im > 0 at `BigDecimal.precision` digits, or `undefined`
 * where the kernel declines.
 */
export function bigDedekindEta(
  ce: ComputeEngine,
  re: BigDecimal,
  im: BigDecimal
): BigComplex | undefined {
  if (!re.isFinite() || !im.isFinite() || im.lt(ETA_BIG_MIN_IMAGINARY))
    return undefined;
  const digits = BigDecimal.precision;
  // The integer part of Re τ is subtracted exactly, so it needs its digits
  const wholeDigits = Math.max(0, re.exponent + re._digitCount());
  let extra = ETA_BIG_GUARD_DIGITS + wholeDigits;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      BigDecimal.precision = digits + extra;
      const result = etaAt(ce, re, im);
      if (result === undefined) return undefined;
      const needed =
        ETA_BIG_GUARD_DIGITS + wholeDigits + Math.ceil(result.lost);
      if (needed <= extra)
        return {
          re: result.value.re.toPrecision(digits),
          im: result.value.im.toPrecision(digits),
        };
      if (needed > ETA_BIG_MAX_EXTRA_DIGITS) return undefined;
      extra = needed;
    }
    return undefined;
  } finally {
    BigDecimal.precision = digits;
  }
}
