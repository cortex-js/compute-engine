/**
 * The classical orthogonal polynomials of an integer degree n:
 *
 * - `ChebyshevT`: Tₙ, first kind, T₀ = 1, T₁ = x, Tₖ₊₁ = 2x Tₖ − Tₖ₋₁
 * - `ChebyshevU`: Uₙ, second kind, U₀ = 1, U₁ = 2x, Uₖ₊₁ = 2x Uₖ − Uₖ₋₁
 * - `LegendreP`: Pₙ, P₀ = 1, P₁ = x, (k+1) Pₖ₊₁ = (2k+1) x Pₖ − k Pₖ₋₁
 * - `HermiteH`: Hₙ, the physicists' polynomials, H₀ = 1, H₁ = 2x,
 *   Hₖ₊₁ = 2x Hₖ − 2k Hₖ₋₁
 * - `LaguerreL`: Lₙ, L₀ = 1, L₁ = 1 − x,
 *   (k+1) Lₖ₊₁ = (2k+1−x) Lₖ − k Lₖ₋₁; and the generalized Lₙ⁽ᵅ⁾,
 *   L₁⁽ᵅ⁾ = 1 + α − x, (k+1) Lₖ₊₁⁽ᵅ⁾ = (2k+1+α−x) Lₖ⁽ᵅ⁾ − (k+α) Lₖ₋₁⁽ᵅ⁾
 *   (DLMF 18.9.13), which is Lₙ at α = 0
 *
 * (DLMF §18.9.) A negative degree has a value for the Chebyshev and Legendre
 * polynomials (DLMF 18.5.E1, 18.5.E2 and 14.9.E5): T₋ₙ = Tₙ, U₋₁ = 0,
 * U₋ₙ = −Uₙ₋₂ for n ≥ 2, and P₋ₙ = Pₙ₋₁. The Hermite and Laguerre
 * polynomials have no negative degree: the kernels return NaN there, and
 * the library leaves the call unevaluated.
 *
 * The numeric kernels use the three-term recurrences; the exact kernels give
 * the coefficients as bigints over a common denominator.
 */

import { Complex } from 'complex.js';
import { BigDecimal } from '../../big-decimal/index.js';

export type OrthogonalPolynomial =
  'ChebyshevT' | 'ChebyshevU' | 'LegendreP' | 'HermiteH' | 'LaguerreL';

/** The largest |degree| that the numeric kernels compute: past it they
 *  return NaN (the interpreter leaves the call unevaluated), so that a
 *  degree such as 10¹⁵ does not run a loop of that length. */
export const MAX_NUMERIC_DEGREE = 1_000_000;

/** The largest |degree| that the exact kernels expand: the coefficients of
 *  a degree past it hold too many digits to be useful. */
export const MAX_EXACT_DEGREE = 500;

/** The largest degree for which `LaguerreL(n, a, x)` of a parameter `a` that
 *  is not an exact rational is expanded: the polynomial has about n²/2 terms
 *  in a and x. */
export const MAX_SYMBOLIC_PARAMETER_DEGREE = 20;

/** The largest degree of `LaguerreL(n, a, x)` for a < −1 that the numeric
 *  kernels compute (by the explicit sum, a loop of n steps of big decimals):
 *  past it they return NaN. */
export const MAX_NEGATIVE_PARAMETER_DEGREE = 1000;

/** The most guard digits the explicit sum of `LaguerreL(n, a, x)` for a < −1
 *  adds to the digits asked: a sum that cancels more than that returns NaN. */
const MAX_GUARD_DIGITS = 400;

/**
 * The nonnegative degree of the same polynomial and its sign, or
 * `undefined` when the degree has no value (a negative degree of `HermiteH`
 * or `LaguerreL`) or is not an integer.
 */
export function normalizedDegree(
  kind: OrthogonalPolynomial,
  n: number
): { degree: number; sign: 1 | -1 | 0 } | undefined {
  if (!Number.isInteger(n)) return undefined;
  if (n >= 0) return { degree: n, sign: 1 };
  switch (kind) {
    case 'ChebyshevT':
      return { degree: -n, sign: 1 };
    case 'ChebyshevU':
      return n === -1 ? { degree: 0, sign: 0 } : { degree: -n - 2, sign: -1 };
    case 'LegendreP':
      return { degree: -n - 1, sign: 1 };
    default:
      return undefined;
  }
}

/** The value of the polynomial `kind` of degree `n` at a real `x`. `alpha`
 *  is the parameter α of the generalized Laguerre polynomial. */
export function orthogonalPolynomial(
  kind: OrthogonalPolynomial,
  n: number,
  x: number,
  alpha = 0
): number {
  const d = normalizedDegree(kind, n);
  if (d === undefined || d.degree > MAX_NUMERIC_DEGREE) return NaN;
  if (Number.isNaN(x) || Number.isNaN(alpha)) return NaN;
  if (kind === 'LaguerreL' && alpha < -1)
    return laguerreNegativeParameter(d.degree, x, alpha);
  if (d.sign === 0) return 0;
  let p0 = 1;
  if (d.degree === 0) return d.sign * p0;
  let p1 = kind === 'LaguerreL' ? 1 + alpha - x : firstDegree(kind, x);
  for (let k = 1; k < d.degree; k++) {
    let p2: number;
    switch (kind) {
      case 'ChebyshevT':
      case 'ChebyshevU':
        p2 = 2 * x * p1 - p0;
        break;
      case 'LegendreP':
        p2 = ((2 * k + 1) * x * p1 - k * p0) / (k + 1);
        break;
      case 'HermiteH':
        p2 = 2 * x * p1 - 2 * k * p0;
        break;
      case 'LaguerreL':
        p2 = ((2 * k + 1 + alpha - x) * p1 - (k + alpha) * p0) / (k + 1);
        break;
    }
    p0 = p1;
    p1 = p2;
  }
  return d.sign * p1;
}

/** Lₙ⁽ᵅ⁾(x) for α < −1 in doubles, through `bigLaguerreExplicit` (the
 *  recurrence cancels there: see that function). */
function laguerreNegativeParameter(
  n: number,
  x: number,
  alpha: number
): number {
  if (!Number.isFinite(x) || !Number.isFinite(alpha)) return NaN;
  return bigLaguerreExplicit(
    n,
    new BigDecimal(x),
    new BigDecimal(alpha),
    DOUBLE_DIGITS
  ).toNumber();
}

/** The digits the doubles of the explicit sum are computed to. */
const DOUBLE_DIGITS = 25;

function firstDegree(kind: OrthogonalPolynomial, x: number): number {
  switch (kind) {
    case 'ChebyshevU':
    case 'HermiteH':
      return 2 * x;
    case 'LaguerreL':
      return 1 - x;
    default:
      return x;
  }
}

/** The value of the polynomial `kind` of degree `n` at a complex `z`. */
export function orthogonalPolynomialComplex(
  kind: OrthogonalPolynomial,
  n: number,
  z: Complex,
  alpha: Complex = Complex.ZERO
): Complex {
  const d = normalizedDegree(kind, n);
  if (
    d === undefined ||
    d.degree > MAX_NUMERIC_DEGREE ||
    z.isNaN() ||
    alpha.isNaN()
  )
    return Complex.NAN;
  // The recurrence cancels for α < −1 (`bigLaguerreExplicit`), and the
  // explicit sum is real only.
  if (kind === 'LaguerreL' && alpha.re < -1) return Complex.NAN;
  if (d.sign === 0) return Complex.ZERO;
  let p0 = Complex.ONE;
  if (d.degree === 0) return p0.mul(d.sign);
  let p1 =
    kind === 'ChebyshevU' || kind === 'HermiteH'
      ? z.mul(2)
      : kind === 'LaguerreL'
        ? Complex.ONE.add(alpha).sub(z)
        : z;
  for (let k = 1; k < d.degree; k++) {
    let p2: Complex;
    switch (kind) {
      case 'ChebyshevT':
      case 'ChebyshevU':
        p2 = z.mul(2).mul(p1).sub(p0);
        break;
      case 'LegendreP':
        p2 = z
          .mul(2 * k + 1)
          .mul(p1)
          .sub(p0.mul(k))
          .div(k + 1);
        break;
      case 'HermiteH':
        p2 = z
          .mul(2)
          .mul(p1)
          .sub(p0.mul(2 * k));
        break;
      case 'LaguerreL':
        p2 = new Complex(2 * k + 1)
          .add(alpha)
          .sub(z)
          .mul(p1)
          .sub(p0.mul(alpha.add(k)))
          .div(k + 1);
        break;
    }
    p0 = p1;
    p1 = p2;
  }
  return p1.mul(d.sign);
}

/** The value of the polynomial `kind` of degree `n` at a real `x`, to
 *  `precision` significant digits. */
export function bigOrthogonalPolynomial(
  kind: OrthogonalPolynomial,
  n: number,
  x: BigDecimal,
  precision: number,
  alpha: BigDecimal = BigDecimal.ZERO
): BigDecimal {
  const d = normalizedDegree(kind, n);
  if (
    d === undefined ||
    d.degree > MAX_NUMERIC_DEGREE ||
    x.isNaN() ||
    alpha.isNaN()
  )
    return BigDecimal.NAN;
  if (d.sign === 0) return BigDecimal.ZERO;
  if (kind === 'LaguerreL' && alpha.lt(-1))
    return bigLaguerreExplicit(d.degree, x, alpha, precision);
  let p0 = BigDecimal.ONE;
  if (d.degree === 0) return d.sign < 0 ? p0.neg() : p0;
  // Each step adds at most a few units of rounding error: guard digits for
  // the number of steps.
  const p = precision + 10 + Math.ceil(Math.log10(d.degree + 1));
  const two = new BigDecimal(2);
  const twoX = x.mul(two);
  let p1 =
    kind === 'ChebyshevU' || kind === 'HermiteH'
      ? twoX
      : kind === 'LaguerreL'
        ? BigDecimal.ONE.add(alpha).sub(x)
        : x;
  for (let k = 1; k < d.degree; k++) {
    let p2: BigDecimal;
    switch (kind) {
      case 'ChebyshevT':
      case 'ChebyshevU':
        p2 = twoX.mul(p1).sub(p0);
        break;
      case 'LegendreP':
        p2 = x
          .mul(2 * k + 1)
          .mul(p1)
          .sub(p0.mul(k))
          .div(k + 1, p);
        break;
      case 'HermiteH':
        p2 = twoX.mul(p1).sub(p0.mul(2 * k));
        break;
      case 'LaguerreL':
        p2 = new BigDecimal(2 * k + 1)
          .add(alpha)
          .sub(x)
          .mul(p1)
          .sub(p0.mul(alpha.add(k)))
          .div(k + 1, p);
        break;
    }
    p0 = p1;
    p1 = p2.toPrecision(p);
  }
  return (d.sign < 0 ? p1.neg() : p1).toPrecision(precision);
}

/**
 * Lₙ⁽ᵅ⁾(x) for α < −1, to `precision` digits, by the explicit sum
 * Σₖ C(n+α, n−k) (−x)ᵏ / k! (DLMF 18.5.12), or NaN when that cannot be
 * vouched for.
 *
 * The recurrence of DLMF 18.9.13 cancels there, as its coefficient k + α
 * changes sign: L₅₀⁽⁻³⁰·⁵⁾(x) came out with a relative error of 10⁷ in
 * doubles and of 10⁻¹⁹ at 30 digits. The terms of the sum are formed by
 * the ratio (n−k)(−x) / ((k+1)(α+k+1)), from the first nonzero one: k = 0, or
 * k = −α for an integer α in [−n, −1] (the terms before it are 0). The sum
 * is retried with more guard digits until they cover its cancellation
 * log₁₀(Σ|tₖ| / |Σ tₖ|), up to `MAX_GUARD_DIGITS`.
 */
export function bigLaguerreExplicit(
  n: number,
  x: BigDecimal,
  alpha: BigDecimal,
  precision: number
): BigDecimal {
  if (n > MAX_NEGATIVE_PARAMETER_DEGREE || !x.isFinite() || !alpha.isFinite())
    return BigDecimal.NAN;
  const integerAlpha = alpha.isInteger();
  let k0 = 0;
  if (integerAlpha && alpha.gte(-n)) k0 = -alpha.toNumber();
  const negX = x.neg();
  for (let guard = 20; guard <= MAX_GUARD_DIGITS; guard *= 2) {
    const p = precision + guard;
    // The first term
    let t = BigDecimal.ONE;
    if (k0 === 0) {
      for (let j = 1; j <= n; j++) t = t.mul(alpha.add(j)).div(j, p);
    } else {
      for (let j = 1; j <= k0; j++) t = t.mul(negX).div(j, p);
    }
    let sum = BigDecimal.ZERO;
    let scale = BigDecimal.ZERO;
    for (let k = k0; ; k++) {
      sum = sum.add(t).toPrecision(p);
      scale = scale.add(t.abs()).toPrecision(p);
      if (k >= n) break;
      t = t
        .mul(negX)
        .mul(n - k)
        .div(alpha.add(k + 1).mul(k + 1), p)
        .toPrecision(p);
    }
    if (sum.isZero()) return BigDecimal.NAN;
    const lost = Math.log10(scale.div(sum.abs(), 5).toNumber());
    if (!Number.isFinite(lost)) return BigDecimal.NAN;
    // Rounding at each of about 3n operations adds a relative error of
    // 10⁻ᵖ to the terms
    if (lost + Math.log10(3 * n + 3) + 2 <= guard)
      return sum.toPrecision(precision);
  }
  return BigDecimal.NAN;
}

/**
 * The coefficients of the polynomial `kind` of a nonnegative degree `n`:
 * the polynomial is (Σₖ `numerators[k]` xᵏ) / `denominator`.
 */
export function orthogonalPolynomialCoefficients(
  kind: OrthogonalPolynomial,
  n: number,
  alpha?: readonly [bigint, bigint]
): { numerators: bigint[]; denominator: bigint } {
  const N = BigInt(n);
  if (kind === 'LaguerreL' && alpha !== undefined)
    return generalizedLaguerreCoefficients(n, alpha[0], alpha[1]);
  switch (kind) {
    case 'LegendreP': {
      // Pₙ(x) = 2⁻ⁿ Σₖ (−1)ᵏ C(n, k) C(2n − 2k, n) xⁿ⁻²ᵏ (DLMF 18.5.E8)
      const numerators: bigint[] = new Array(n + 1).fill(0n);
      for (let k = 0; 2 * k <= n; k++) {
        const c = binomial(N, BigInt(k)) * binomial(2n * (N - BigInt(k)), N);
        numerators[n - 2 * k] = k % 2 === 0 ? c : -c;
      }
      return { numerators, denominator: 1n << N };
    }
    case 'LaguerreL': {
      // Lₙ(x) = Σₖ (−1)ᵏ C(n, k) xᵏ / k! (DLMF 18.5.E12), over n!
      const numerators: bigint[] = [];
      let nFactorialOverKFactorial = factorial(N);
      for (let k = 0; k <= n; k++) {
        if (k > 0) nFactorialOverKFactorial /= BigInt(k);
        const c = binomial(N, BigInt(k)) * nFactorialOverKFactorial;
        numerators.push(k % 2 === 0 ? c : -c);
      }
      return { numerators, denominator: factorial(N) };
    }
    default: {
      // Tₙ, Uₙ and Hₙ have integer coefficients: run the recurrence on the
      // coefficient lists.
      let p0: bigint[] = [1n];
      if (n === 0) return { numerators: p0, denominator: 1n };
      let p1: bigint[] = kind === 'ChebyshevT' ? [0n, 1n] : [0n, 2n];
      for (let k = 1; k < n; k++) {
        const c0 = kind === 'HermiteH' ? 2n * BigInt(k) : 1n;
        const p2: bigint[] = new Array(k + 2).fill(0n);
        for (let i = 0; i < p1.length; i++) p2[i + 1] += 2n * p1[i];
        for (let i = 0; i < p0.length; i++) p2[i] -= c0 * p0[i];
        p0 = p1;
        p1 = p2;
      }
      return { numerators: p1, denominator: 1n };
    }
  }
}

/**
 * The coefficients of Lₙ⁽ᵅ⁾, α = p/q with q > 0, over the denominator n! qⁿ:
 * Lₙ⁽ᵅ⁾(x) = Σₖ (−1)ᵏ C(n+α, n−k) xᵏ / k! (DLMF 18.5.12), whose xᵏ
 * coefficient is (−1)ᵏ Πⱼ₌₁ⁿ⁻ᵏ (p + (k+j) q) · C(n, k) qᵏ / (n! qⁿ).
 */
function generalizedLaguerreCoefficients(
  n: number,
  p: bigint,
  q: bigint
): { numerators: bigint[]; denominator: bigint } {
  const N = BigInt(n);
  const numerators: bigint[] = [];
  for (let k = 0; k <= n; k++) {
    const K = BigInt(k);
    let product = 1n;
    for (let j = 1n; j <= N - K; j++) product *= p + (K + j) * q;
    const c = product * binomial(N, K) * q ** K;
    numerators.push(k % 2 === 0 ? c : -c);
  }
  return { numerators, denominator: factorial(N) * q ** N };
}

/**
 * Lₙ⁽ᵅ⁾ for a symbolic α, over the denominator n!: `numerators[k]` lists the
 * coefficients, by increasing power of α, of the integer polynomial
 * (−1)ᵏ C(n, k) Πⱼ₌₁ⁿ⁻ᵏ (α + k + j), the coefficient of xᵏ (DLMF 18.5.12).
 */
export function generalizedLaguerreInAlpha(n: number): {
  numerators: bigint[][];
  denominator: bigint;
} {
  const N = BigInt(n);
  const numerators: bigint[][] = [];
  for (let k = 0; k <= n; k++) {
    const K = BigInt(k);
    // Multiply out Πⱼ (α + k + j)
    let poly: bigint[] = [1n];
    for (let j = 1n; j <= N - K; j++) {
      const next: bigint[] = new Array(poly.length + 1).fill(0n);
      for (let i = 0; i < poly.length; i++) {
        next[i] += poly[i] * (K + j);
        next[i + 1] += poly[i];
      }
      poly = next;
    }
    const c = binomial(N, K) * (k % 2 === 0 ? 1n : -1n);
    numerators.push(poly.map((v) => v * c));
  }
  return { numerators, denominator: factorial(N) };
}

function binomial(n: bigint, k: bigint): bigint {
  if (k < 0n || k > n) return 0n;
  if (k > n - k) k = n - k;
  let result = 1n;
  for (let i = 1n; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

function factorial(n: bigint): bigint {
  let result = 1n;
  for (let i = 2n; i <= n; i++) result *= i;
  return result;
}
