import { BigDecimal } from '../../big-decimal/index.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { checkDeadlineEvery } from '../../common/interruptible.js';
import type { BigComplex } from './dedekind-eta-big.js';

/**
 * Arbitrary-precision Jacobi theta θⱼ(z, τ), j ∈ {1, 2, 3, 4}, Im τ > 0, in
 * the Fungrim convention of `jacobiTheta` (`numeric-complex.ts`): nome
 * q = e^{iπτ}, period 1 in z.
 *
 *   θ₁(z,τ) = 2·Σₙ≥₀ (−1)ⁿ q^{(n+½)²} sin((2n+1)πz)
 *   θ₂(z,τ) = 2·Σₙ≥₀ q^{(n+½)²} cos((2n+1)πz)
 *   θ₃(z,τ) = 1 + 2·Σₙ≥₁ qⁿ² cos(2nπz)
 *   θ₄(z,τ) = 1 + 2·Σₙ≥₁ (−1)ⁿ qⁿ² cos(2nπz)
 *
 * Each term is computed on its own, without a recurrence: the phases
 * `π·Re τ·s` and `kπ·Re z` are reduced modulo 2π exactly before the sine and
 * cosine, so a large real part of z or τ costs no digits. The series stops
 * where the bound `e^{−π Im τ s}·cosh(kπ Im z)` of the next term, with a ratio
 * of at most ½ to the term after it, is below the working precision: a bound,
 * not a convergence test.
 *
 * The error of a term is at most the working precision relative to that
 * bound, so the sum loses the digits between the largest bound and the
 * modulus of the value. The kernel counts them and computes again with them
 * added. The value is accurate to the digits asked for relative to |θⱼ| in
 * each part; a part that is much smaller than the modulus is
 * correspondingly less accurate in its own digits. The kernel declines
 * (`undefined`) where the series needs more than `THETA_BIG_MAX_TERMS` terms
 * (Im τ near 0, or |Im z| much larger than Im τ), where the digits lost pass
 * `THETA_BIG_MAX_EXTRA_DIGITS`, and at a zero of θⱼ that the terms do not
 * give exactly (θ₃(½ + ½τ, τ), θ₁(τ, τ)): there no number of digits reaches
 * a relative accuracy. A value whose every term is exactly 0 (θ₁(0, τ),
 * θ₂(½, τ): the sines and cosines at multiples of ½π are exact) is 0.
 */

/** Digits carried past the ones asked for. */
const THETA_BIG_GUARD_DIGITS = 20;

/** Most digits the cancellation may cost; past this the kernel declines. */
const THETA_BIG_MAX_EXTRA_DIGITS = 2000;

/** The most terms of the series before the kernel declines. */
const THETA_BIG_MAX_TERMS = 5000;

const LN10 = Math.LN10;

/** log10 |x|, to about one unit; −∞ for 0. */
function log10Abs(x: BigDecimal): number {
  if (x.isZero()) return -Infinity;
  return x.exponent + x._digitCount() - 1;
}

/** log10 of the larger part of `x`. */
function log10Modulus(x: BigComplex): number {
  return Math.max(log10Abs(x.re), log10Abs(x.im));
}

const QUARTER_TURNS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * cos(πr) and sin(πr) for an exact r. At a multiple of ½ both are exact, so
 * a term whose sine or cosine is 0 is exactly 0 (θ₁ at an integer z, θ₂ at
 * a half-integer z).
 */
function cosSinPi(
  r: BigDecimal,
  pi: BigDecimal,
  prec: number
): [BigDecimal, BigDecimal] {
  // r mod 2 has the sign of r: move it to [0, 2)
  let t = r.mod(2);
  if (t.isNegative()) t = t.add(2);
  const twice = t.mul(2);
  if (twice.isInteger()) {
    const [c, s] = QUARTER_TURNS[twice.toNumber()];
    return [new BigDecimal(c), new BigDecimal(s)];
  }
  const angle = pi.mul(t);
  return [angle.cos(prec), angle.sin(prec)];
}

/**
 * The sum at `prec` digits, with the log10 of the largest term bound and
 * whether every term was exactly 0, or `undefined` when the series needs too
 * many terms.
 */
function thetaAt(
  ce: ComputeEngine,
  j: 1 | 2 | 3 | 4,
  x: BigDecimal,
  y: BigDecimal,
  a: BigDecimal,
  b: BigDecimal,
  prec: number
): { value: BigComplex; peak: number; allZero: boolean } | undefined {
  const pi = BigDecimal.pi(prec);
  const half = j === 1 || j === 2;
  // In doubles: the log of the bound of term n is −π·b·s(n) + k(n)·π·|y|
  const bNum = b.toNumber();
  const yNum = Math.abs(y.toNumber());
  if (!(bNum > 0) || !Number.isFinite(yNum)) return undefined;
  const s = (n: number) => (half ? (n + 0.5) * (n + 0.5) : n * n);
  const k = (n: number) => (half ? 2 * n + 1 : 2 * n);
  // cosh(t) ≤ e^{|t|}: the bound is within a factor 2 of the largest part
  const logBound = (n: number) =>
    -Math.PI * bNum * s(n) + k(n) * Math.PI * yNum;

  let re = BigDecimal.ZERO;
  let im = BigDecimal.ZERO;
  // log10 of the largest term bound. θ₃ and θ₄ add the constant 1.
  let peak = half ? -Infinity : 0;
  let allZero = true;
  const first = half ? 0 : 1;
  for (let n = first; ; n++) {
    if (n - first >= THETA_BIG_MAX_TERMS) return undefined;
    checkDeadlineEvery(ce._deadlineFrame, 0x7);
    const bound = logBound(n);
    // Stop when the bound of term n, with all later terms (each at most half
    // of the one before it), is below the working precision of the largest
    // bound so far. A bound of −∞ (an Im τ too large for a double) stops too.
    if (
      n > first &&
      bound / LN10 < peak - prec - 1 &&
      !(logBound(n + 1) - bound > -Math.LN2)
    )
      break;

    // q^s = e^{−π b s}·e^{iπ (a s mod 2)}
    const sExact = half
      ? new BigDecimal((2 * n + 1) * (2 * n + 1)).mul(new BigDecimal(0.25))
      : new BigDecimal(n * n);
    const modulus = pi.mul(b.mul(sExact)).neg().exp(prec);
    const [cq, sq] = cosSinPi(a.mul(sExact), pi, prec);
    const qRe = modulus.mul(cq);
    const qIm = modulus.mul(sq);

    // cos(kπz) = cos(kπx)cosh(kπy) − i·sin(kπx)sinh(kπy)
    // sin(kπz) = sin(kπx)cosh(kπy) + i·cos(kπx)sinh(kπy)
    const kn = k(n);
    const [cx, sx] = cosSinPi(x.mul(kn), pi, prec);
    const hy = pi.mul(y.mul(kn));
    const ch = hy.cosh(prec);
    const sh = hy.sinh(prec);
    const tRe = j === 1 ? sx.mul(ch) : cx.mul(ch);
    const tIm = j === 1 ? cx.mul(sh) : sx.mul(sh).neg();

    let termRe = qRe.mul(tRe).sub(qIm.mul(tIm), prec).toPrecision(prec);
    let termIm = qRe.mul(tIm).add(qIm.mul(tRe), prec).toPrecision(prec);
    if ((j === 1 || j === 4) && n % 2 === 1) {
      termRe = termRe.neg();
      termIm = termIm.neg();
    }
    if (!termRe.isZero() || !termIm.isZero()) allZero = false;
    re = re.add(termRe, prec).toPrecision(prec);
    im = im.add(termIm, prec).toPrecision(prec);
    peak = Math.max(peak, log10Abs(modulus.mul(ch)));
  }
  re = re.mul(2);
  im = im.mul(2);
  if (!half) re = re.add(BigDecimal.ONE, prec);
  return { value: { re, im }, peak, allZero };
}

/**
 * θⱼ(x + iy, a + ib) for b > 0 at `prec` digits, or `undefined` where the
 * kernel declines.
 */
export function bigJacobiTheta(
  ce: ComputeEngine,
  j: 1 | 2 | 3 | 4,
  x: BigDecimal,
  y: BigDecimal,
  a: BigDecimal,
  b: BigDecimal,
  prec: number
): BigComplex | undefined {
  if (!x.isFinite() || !y.isFinite() || !a.isFinite() || !b.isFinite())
    return undefined;
  if (!b.isPositive()) return undefined;
  let extra = THETA_BIG_GUARD_DIGITS;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = thetaAt(ce, j, x, y, a, b, prec + extra);
    if (result === undefined) return undefined;
    const { value, peak, allZero } = result;
    // Every term was exactly 0 (θ₁(0, τ), θ₂(½, τ)): the value is 0
    if (allZero) return value;
    // Otherwise a sum of 0 is a cancellation at every precision
    if (value.re.isZero() && value.im.isZero()) return undefined;
    const lost = Math.max(0, Math.ceil(peak - log10Modulus(value)));
    const needed = THETA_BIG_GUARD_DIGITS + lost;
    if (needed <= extra)
      return {
        re: value.re.toPrecision(prec),
        im: value.im.toPrecision(prec),
      };
    if (needed > THETA_BIG_MAX_EXTRA_DIGITS) return undefined;
    extra = needed;
  }
  return undefined;
}
