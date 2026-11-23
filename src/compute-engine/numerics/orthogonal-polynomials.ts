/**
 * The classical orthogonal polynomials of an integer degree n:
 *
 * - `ChebyshevT`: Tₙ, first kind, T₀ = 1, T₁ = x, Tₖ₊₁ = 2x Tₖ − Tₖ₋₁
 * - `ChebyshevU`: Uₙ, second kind, U₀ = 1, U₁ = 2x, Uₖ₊₁ = 2x Uₖ − Uₖ₋₁
 * - `LegendreP`: Pₙ, P₀ = 1, P₁ = x, (k+1) Pₖ₊₁ = (2k+1) x Pₖ − k Pₖ₋₁
 * - `HermiteH`: Hₙ, the physicists' polynomials, H₀ = 1, H₁ = 2x,
 *   Hₖ₊₁ = 2x Hₖ − 2k Hₖ₋₁
 * - `LaguerreL`: Lₙ, L₀ = 1, L₁ = 1 − x,
 *   (k+1) Lₖ₊₁ = (2k+1−x) Lₖ − k Lₖ₋₁
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
  | 'ChebyshevT'
  | 'ChebyshevU'
  | 'LegendreP'
  | 'HermiteH'
  | 'LaguerreL';

/** The largest |degree| that the numeric kernels compute: past it they
 *  return NaN (the interpreter leaves the call unevaluated), so that a
 *  degree such as 10¹⁵ does not run a loop of that length. */
export const MAX_NUMERIC_DEGREE = 1_000_000;

/** The largest |degree| that the exact kernels expand: the coefficients of
 *  a degree past it hold too many digits to be useful. */
export const MAX_EXACT_DEGREE = 500;

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

/** The value of the polynomial `kind` of degree `n` at a real `x`. */
export function orthogonalPolynomial(
  kind: OrthogonalPolynomial,
  n: number,
  x: number
): number {
  const d = normalizedDegree(kind, n);
  if (d === undefined || d.degree > MAX_NUMERIC_DEGREE) return NaN;
  if (Number.isNaN(x)) return NaN;
  if (d.sign === 0) return 0;
  let p0 = 1;
  if (d.degree === 0) return d.sign * p0;
  let p1 = firstDegree(kind, x);
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
        p2 = ((2 * k + 1 - x) * p1 - k * p0) / (k + 1);
        break;
    }
    p0 = p1;
    p1 = p2;
  }
  return d.sign * p1;
}

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
  z: Complex
): Complex {
  const d = normalizedDegree(kind, n);
  if (d === undefined || d.degree > MAX_NUMERIC_DEGREE || z.isNaN())
    return Complex.NAN;
  if (d.sign === 0) return Complex.ZERO;
  let p0 = Complex.ONE;
  if (d.degree === 0) return p0.mul(d.sign);
  let p1 =
    kind === 'ChebyshevU' || kind === 'HermiteH'
      ? z.mul(2)
      : kind === 'LaguerreL'
        ? Complex.ONE.sub(z)
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
        p2 = z.mul(2).mul(p1).sub(p0.mul(2 * k));
        break;
      case 'LaguerreL':
        p2 = new Complex(2 * k + 1)
          .sub(z)
          .mul(p1)
          .sub(p0.mul(k))
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
  precision: number
): BigDecimal {
  const d = normalizedDegree(kind, n);
  if (d === undefined || d.degree > MAX_NUMERIC_DEGREE || x.isNaN())
    return BigDecimal.NAN;
  if (d.sign === 0) return BigDecimal.ZERO;
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
        ? BigDecimal.ONE.sub(x)
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
          .sub(x)
          .mul(p1)
          .sub(p0.mul(k))
          .div(k + 1, p);
        break;
    }
    p0 = p1;
    p1 = p2.toPrecision(p);
  }
  return (d.sign < 0 ? p1.neg() : p1).toPrecision(precision);
}

/**
 * The coefficients of the polynomial `kind` of a nonnegative degree `n`:
 * the polynomial is (Σₖ `numerators[k]` xᵏ) / `denominator`.
 */
export function orthogonalPolynomialCoefficients(
  kind: OrthogonalPolynomial,
  n: number
): { numerators: bigint[]; denominator: bigint } {
  const N = BigInt(n);
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
