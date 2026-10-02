import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';
import {
  checkDeadline,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import { bernoulliRational } from './bernoulli.js';
import {
  type Ball,
  add,
  atDigits,
  certify,
  div,
  exact,
  ln,
  lower,
  mul,
  powInt,
  rational,
  sub,
  upper,
} from './ball.js';

// Generalized Stieltjes constants γₙ(a): the Laurent coefficients of the
// Hurwitz zeta function at its pole,
//   ζ(s, a) = 1/(s−1) + Σₙ (−1)ⁿ γₙ(a) (s−1)ⁿ / n!      (DLMF 25.11.4),
// so γₙ = γₙ(1) are the classical constants (γ₀ = Euler's γ) and
// γ₀(a) = −ψ(a). Wolfram's StieltjesGamma[n, a] and mpmath's stieltjes(n, a)
// use this normalisation.
//
// Both kernels use Euler–Maclaurin (DLMF 2.10.1) on f(x) = lnⁿ(x)/x:
//   γₙ(a) = Σ_{k<N} f(k+a) + ½ f(N+a) − ln^{n+1}(N+a)/(n+1)
//           − Σⱼ B₂ⱼ/(2j)! f^{(2j−1)}(N+a) + R,
// the subtracted power of the logarithm being the integral ∫ f that the
// defining limit removes. The derivatives come from f(x) = n! [tⁿ] x^{t−1}:
//   f^{(m)}(x) = x^{−1−m} Σᵢ pᵢ n!/(n−i)! lnⁿ⁻ⁱ(x),  Π_{j=1}^{m} (t − j) = Σᵢ pᵢ tⁱ,
// with the pᵢ exact integers.

/** The largest order n answered. The partial sum and the subtracted log power
 * are each about ln^{n+1}(N)/(n+1) and cancel, and the double kernel is
 * measured good to ~1e-8 at n = 30 and worse past it. */
export const STIELTJES_MAX_ORDER = 30;

/** The most terms the double kernel sums before the tail point, that is
 * how far left of the origin Re(a) may be: ζ(s, a) at a = −10⁴ costs 10⁴
 * logarithms, and a far larger shift makes the sum cancel by its own size. */
const STIELTJES_MAX_SHIFT = 1e4;

/** Coefficients of Π_{j=1}^{m} (t − j), lowest degree first, as bigints. */
function fallingPolynomial(m: number): bigint[] {
  let p: bigint[] = [1n];
  for (let j = 1; j <= m; j++) p = timesLinear(p, BigInt(j));
  return p;
}

/** `p(t)·(t − c)`, coefficients lowest degree first. */
const timesLinear = (p: readonly bigint[], c: bigint): bigint[] =>
  Array.from(
    { length: p.length + 1 },
    (_, i) => (p[i - 1] ?? 0n) - c * (p[i] ?? 0n)
  );

// --- Double precision --------------------------------------------------

/** Bernoulli pairs kept in the double kernel's tail: B₂ⱼ/(2j)! for j ≤ 16 is
 * below 1e-16 relative to the term it multiplies at the tail point Re ≈ 6. */
const EM_PAIRS = 16;

const EM_COEFFICIENTS: number[] = (() => {
  const c: number[] = [0];
  let factorial = 1;
  for (let j = 1; j <= EM_PAIRS; j++) {
    factorial *= (2 * j - 1) * (2 * j);
    const [num, den] = bernoulliRational(2 * j);
    c[j] = Number(num) / Number(den) / factorial;
  }
  return c;
})();

/** zⁿ for an integer n ≥ 0 by repeated multiplication (exact at z = 0, unlike exp(n ln z)). */
function ipow(z: Complex, n: number): Complex {
  let r = new Complex(1, 0);
  for (let i = 0; i < n; i++) r = r.mul(z);
  return r;
}

/** f^{(m)}(x) for f(x) = lnⁿ(x)/x, with L = ln x supplied. */
function derivative(n: number, m: number, x: Complex, L: Complex): Complex {
  const p = fallingPolynomial(m);
  let acc = new Complex(0, 0);
  let falling = 1; // n!/(n−i)! = n (n−1) … (n−i+1)
  for (let i = 0; i <= Math.min(m, n); i++) {
    if (i > 0) falling *= n - i + 1;
    acc = acc.add(ipow(L, n - i).mul(Number(p[i]) * falling));
  }
  return acc.mul(x.pow(-1 - m));
}

/**
 * γₙ(a) in doubles for an integer 0 ≤ n ≤ `STIELTJES_MAX_ORDER` and a
 * finite complex a that is not a nonpositive integer; `undefined` otherwise.
 */
export function stieltjesGammaComplex(
  n: number,
  a: Complex
): Complex | undefined {
  if (!Number.isInteger(n) || n < 0 || n > STIELTJES_MAX_ORDER)
    return undefined;
  if (!Number.isFinite(a.re) || !Number.isFinite(a.im)) return undefined;
  if (a.im === 0 && a.re <= 0 && Number.isInteger(a.re)) return undefined;
  // The tail point sits near Re ≈ 6: far enough out for the Bernoulli tail to
  // converge, near enough to keep the lnⁿ⁺¹ cancellation down (~1e-12 through
  // n = 15, ~1e-8 at n = 30; a farther tail point is worse for large n).
  const N = Math.max(1, Math.ceil(6 - a.re));
  if (N > STIELTJES_MAX_SHIFT) return undefined;
  let sum = new Complex(0, 0);
  for (let k = 0; k < N; k++) {
    const x = new Complex(a.re + k, a.im);
    sum = sum.add(ipow(x.log(), n).div(x));
  }
  const x = new Complex(a.re + N, a.im);
  const L = x.log();
  sum = sum.add(ipow(L, n).div(x).mul(0.5));
  sum = sum.sub(ipow(L, n + 1).mul(1 / (n + 1)));
  for (let j = 1; j <= EM_PAIRS; j++)
    sum = sum.sub(derivative(n, 2 * j - 1, x, L).mul(EM_COEFFICIENTS[j]));
  return Number.isFinite(sum.re) && Number.isFinite(sum.im) ? sum : undefined;
}

/** γₙ(a) for the compiled lane: a real result for a real a (n ≥ 0, a > 0 or
 * a not an integer ≤ 0 with a real value), NaN where the value is complex or
 * the kernel declines. */
export function stieltjesGammaReal(n: number, a = 1): number {
  const z = stieltjesGammaComplex(n, new Complex(a, 0));
  return z !== undefined && Math.abs(z.im) <= 1e-14 * Math.abs(z.re)
    ? z.re
    : NaN;
}

// --- Arbitrary precision -------------------------------------------------
//
// A real a > 0 to any number of digits, the sum taken in ball arithmetic
// (`ball.ts`) and the remainder R bounded, not dropped. The tail point x grows
// with the digits asked for: the Bernoulli terms shrink until j ≈ πx, where
// they reach about e^{−2πx}, so x ≈ 0.37·digits reaches any precision.
//
// The periodic Bernoulli function never exceeds |B₂ₘ| < 4(2M)!/(2π)^{2M}, so
//   |R| ≤ 4/(2π)^{2M} · ∫ₓ^∞ |f^{(2M)}(t)| dt.
// The shortcut that the integral is |f^{(2M−1)}(x)| needs f^{(2M)} to keep one
// sign past x, and it does not: P₂ₘ has a root near ln x ≈ n·H₂ₘ, beyond the
// tail point for n ≥ 1. So each |cᵢ| lnⁿ⁻ⁱ(t) of |P₂ₘ| is integrated on its own,
//   ∫ₓ^∞ t^{−1−p} lnᵏ(t) dt = x^{−p} Σ_{r≤k} (k!/r!) lnʳ(x) / p^{k−r+1},  p = 2M,
// the incomplete gamma at an integer order, which is a finite sum.

/** Digits carried past the ones asked for. */
const GUARD_DIGITS = 10;

/** The tail point, as a multiple of the working digits: e^{−2πx} < 10^{−digits} past 0.37. */
const TAIL_PER_DIGIT = 0.4;

/** Tail points tried, each half again past the last, before the kernel declines. */
const TAIL_ATTEMPTS = 4;

/** A decimal below 2π, so dividing by its powers overstates the remainder, never under. */
const TWO_PI_BELOW = new BigDecimal('6.283');

/** A real operand: a bignum, or an exact rational `[numerator, denominator]`
 * that the kernel converts at its own working precision. */
export type StieltjesOperand = BigDecimal | readonly [bigint, bigint];

/** Digits past the target that the result's radius must also clear. */
const RESULT_SLACK_DIGITS = 1;

/**
 * γₙ(a) to `digits` significant digits for an integer 0 ≤ n ≤
 * `STIELTJES_MAX_ORDER` and a real a > 0, with the remainder bounded; or
 * `undefined` where that cannot be certified. With a `frame`, the loops check
 * its deadline: at a high precision one call takes seconds.
 */
export function bigStieltjesGamma(
  n: number,
  a: StieltjesOperand,
  digits: number,
  frame?: DeadlineFrame
): BigDecimal | undefined {
  if (!Number.isInteger(n) || n < 0 || n > STIELTJES_MAX_ORDER)
    return undefined;
  const target = digits + GUARD_DIGITS;
  const ad = Array.isArray(a)
    ? Number(a[0]) / Number(a[1])
    : (a as BigDecimal).toNumber();
  if (!(ad > 0) || !Number.isFinite(ad)) return undefined;
  let terms = Math.max(1, Math.ceil(TAIL_PER_DIGIT * target + n / 2 - ad));
  // log10 of the least absolute error the sum may stop at, and the digits
  // that error needs past the working ones, once an attempt has shown the
  // size of γₙ(a): the first pass can only stop relative to the large
  // partial sum, and a small γₙ(a) is short of digits by then.
  let tolerance: number | undefined;
  let small = 0;
  for (let attempt = 0; attempt < TAIL_ATTEMPTS; attempt++) {
    const xd = terms + ad;
    // The partial sum and the subtracted log power are each ~ln^{n+1}(x)/(n+1), and cancel.
    const cancelled = Math.max(
      0,
      (n + 1) * Math.log10(Math.log(xd)) - Math.log10(n + 1)
    );
    const r = atDigits(target + Math.ceil(cancelled) + small, () =>
      certify(() => {
        const ball = Array.isArray(a)
          ? rational(a[0], a[1])
          : exact(a as BigDecimal);
        if (!lower(ball).isPositive()) return undefined;
        return eulerMaclaurin(n, ball, terms, tolerance, frame);
      })
    );
    // The ball's midpoint carries the working digits; past `digits` they are
    // not certified, so they are rounded off.
    if (r !== undefined && wideEnough(r, digits))
      return r.mid.toPrecision(digits);
    if (r !== undefined && !r.mid.isZero()) {
      const size = log10Abs(r.mid);
      tolerance = size - target;
      small = Math.max(0, Math.ceil(-size));
    }
    // The Bernoulli terms turned before reaching the digits the cancellation
    // and a small γₙ(a) call for: move the tail point out.
    terms = Math.ceil(terms * 1.5);
  }
  return undefined;
}

/** The ball's radius is below the last requested digit, with slack. */
function wideEnough(r: Ball, digits: number): boolean {
  if (r.mid.isZero()) return false;
  const limit = r.mid
    .abs()
    .mul(new BigDecimal(`1e-${digits + RESULT_SLACK_DIGITS}`));
  return r.rad.lte(limit);
}

function eulerMaclaurin(
  n: number,
  a: Ball,
  terms: number,
  tolerance?: number,
  frame?: DeadlineFrame
): Ball | undefined {
  const working = BigDecimal.precision;
  let sum = exact(0);
  for (let k = 0; k < terms; k++) {
    if ((k & 0x3f) === 0) checkDeadline(frame);
    const x = add(a, exact(k));
    sum = add(sum, div(powInt(ln(x), n), x));
  }
  const x = add(a, exact(terms));
  const L = ln(x);
  sum = add(sum, div(powInt(L, n), mul(x, exact(2))));
  sum = sub(sum, div(powInt(L, n + 1), exact(n + 1)));
  // L^{n−i} for i = 0 … n, and n!/(n−i)!.
  const powers = Array.from({ length: n + 1 }, (_, i) => powInt(L, n - i));
  const falling: bigint[] = [1n];
  for (let i = 1; i <= n; i++)
    falling.push(falling[i - 1]! * BigInt(n - i + 1));
  const xInv2 = div(exact(1), mul(x, x));
  let xPower = xInv2; // x^{−1−m}, from m = 1
  let poly: bigint[] = [-1n, 1n]; // Π_{j=1}^{m} (t − j), from m = 1
  let factorial = 1n; // (2j)!
  let previous = Infinity;
  const threshold = Math.min(
    log10Abs(sum.mid) - working,
    tolerance ?? Infinity
  );
  for (let j = 1; ; j++) {
    if ((j & 0x3f) === 0) checkDeadline(frame);
    factorial *= BigInt((2 * j - 1) * 2 * j);
    let derivative = exact(0);
    for (let i = 0; i <= Math.min(2 * j - 1, n); i++) {
      const c = poly[i]! * falling[i]!;
      if (c !== 0n)
        derivative = add(derivative, mul(powers[i]!, exact(new BigDecimal(c))));
    }
    const [bn, bd] = bernoulliRational(2 * j);
    const term = mul(mul(derivative, xPower), rational(bn, bd * factorial));
    const size = log10Abs(term.mid);
    if (size > previous) return undefined; // past the smallest term, short of the target
    sum = sub(sum, term);
    // m → m + 1: P₂ⱼ's polynomial, for the remainder after j pairs.
    const even = timesLinear(poly, BigInt(2 * j));
    if (size < threshold) {
      const bound = remainderBound(n, x, L, even, falling, 2 * j);
      return { mid: sum.mid, rad: sum.rad.add(bound) };
    }
    previous = size;
    // m → m + 2: multiply by (t − (m+1))(t − (m+2)), and x^{−1−m} by x^{−2}.
    poly = timesLinear(even, BigInt(2 * j + 1));
    xPower = mul(xPower, xInv2);
  }
}

/** 4/(2π)^p · Σᵢ |cᵢ| ∫ₓ^∞ t^{−1−p} lnⁿ⁻ⁱ(t) dt, cᵢ = poly[i]·n!/(n−i)! the
 * coefficients of P_p, rounded up. x > 1, so ln t > 0 throughout. */
function remainderBound(
  n: number,
  x: Ball,
  L: Ball,
  poly: readonly bigint[],
  falling: readonly bigint[],
  p: number
): BigDecimal {
  return atDigits(20, () => {
    const xp = div(exact(1), powInt(x, p)); // x^{−p}
    let total = exact(0);
    for (let i = 0; i <= Math.min(p, n); i++) {
      const c = poly[i]! * falling[i]!;
      if (c === 0n) continue;
      const k = n - i;
      let integral = exact(0);
      let ratio = 1n; // k!/r!, from r = k down
      for (let r = k; r >= 0; r--) {
        if (r < k) ratio *= BigInt(r + 1);
        const denominator = BigInt(p) ** BigInt(k - r + 1);
        integral = add(
          integral,
          mul(powInt(L, r), rational(ratio, denominator))
        );
      }
      total = add(total, mul(exact(new BigDecimal(c < 0n ? -c : c)), integral));
    }
    const scale = exact(
      new BigDecimal(4).divToward(TWO_PI_BELOW.pow(p), 'ceiling')
    );
    return upper(mul(mul(scale, xp), total));
  });
}

/** log10 |x|, or −∞ for 0. */
const log10Abs = (x: BigDecimal): number =>
  x.isZero() ? -Infinity : Math.log10(Math.abs(x.toNumber()));
