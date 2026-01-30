import { extrapolate } from './richardson';
import { primeFactors } from './primes';

// Number of significant digits for Decimal
// The Decimal implementation groups digits by 7
export const DEFAULT_PRECISION = 21;

// IEEE 754 double precision floating point numbers have 53 bits of precision
export const MACHINE_PRECISION_BITS = 53;
export const MACHINE_PRECISION = Math.floor(
  Math.log10(Math.pow(2, MACHINE_PRECISION_BITS))
); // ≈ 15.95 = 15 number of digits of precision

// Number of digits at the end of the number that are ignored for sameness
// evaluation, 7-bit ≈ 2.10721 digits.
// export const MACHINE_TOLERANCE_BITS = 7;
// export const MACHINE_TOLERANCE = Math.pow(
//   2,
//   -(MACHINE_PRECISION_BITS - MACHINE_TOLERANCE_BITS)
// );

// Mathematica has a default tolerance of 10^-10
// Numpy has a default absolute tolerance of 1e-8 (1e-5 for relative)
export const DEFAULT_TOLERANCE = 1e-10;

// When applying simplifications, only considers integers whose absolute value
// is less than SMALL_INTEGER. This avoid loss of precision by preventing
// simplification for `1e199 + 1`.
// Note: SMALL_INTEGER ≈ 10^(MACHINE_PRECISION / 2)
// so that the product of two small integers does not lose precision
export const SMALL_INTEGER = 1000000;

/** The largest number of digits of a bigint */
export const MAX_BIGINT_DIGITS = 1024;

// When doing a calculation via iteration (e.g. to calculate a sum)
// do not iterate more than this value
// Reduced from 1,000,000 to 10,000 for better test performance
// while still being sufficient for most practical calculations
export const MAX_ITERATION = 10000;

// When doing a symbolic calculations using multiple terms, do
// not expand beyond this many terms
export const MAX_SYMBOLIC_TERMS = 200;

/**
 * Returns the smallest floating-point number greater than x.
 * Denormalized values may not be supported.
 */

export function nextUp(x: number): number {
  if (x !== x) return x;
  if (x === -1 / 0) return -Number.MAX_VALUE;
  if (x === 1 / 0) return +1 / 0;
  if (x === Number.MAX_VALUE) return +1 / 0;
  let y = x * (x < 0 ? 1 - Number.EPSILON / 2 : 1 + Number.EPSILON);
  if (y === x)
    y =
      Number.MIN_VALUE * Number.EPSILON > 0
        ? x + Number.MIN_VALUE * Number.EPSILON
        : x + Number.MIN_VALUE;
  if (y === +1 / 0) y = +Number.MAX_VALUE;
  const b = x + (y - x) / 2;
  if (x < b && b < y) y = b;
  const c = (y + x) / 2;
  if (x < c && c < y) y = c;
  return y === 0 ? -0 : y;
}

export function nextDown(x: number): number {
  return -nextUp(-x);
}

/* @todo Consider https://cp-algorithms.com/algebra/factorization.html */

/** Return `[factor, root]` such that
 * pow(n, 1/exponent) = factor * pow(root, 1/exponent)
 *
 * canonicalInteger(75, 2) -> [5, 3] = 5^2 * 3
 *
 */
export function canonicalInteger(
  n: number,
  exponent: number
): readonly [factor: number, root: number] {
  if (n >= Number.MAX_SAFE_INTEGER) return [1, n];
  if (n === 0) return [0, 0];
  if (n === 1) return [1, 1];
  // @todo: handle negative n
  console.assert(Number.isInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER);
  if (exponent === 2) {
    const result = (
      [
        [0, 0],
        [1, 1],
        [1, 2],
        [1, 3],
        [2, 1],
        [1, 5],
        [1, 6],
        [1, 7],
        [1, 8],
        [3, 1],
        [1, 10],
        [1, 11],
        [2, 3],
        [1, 13],
        [1, 14],
        [1, 15],
        [4, 1],
        [1, 17],
        [3, 2],
        [1, 19],
        [1, 20],
      ] as const
    )[n];
    if (result) return result;
  }
  const factors = primeFactors(n);
  let f = 1;
  let r = 1;
  for (const k of Object.keys(factors)) {
    const v = parseInt(k);
    f = f * Math.pow(v, Math.floor(factors[k] / exponent));
    r = r * Math.pow(v, factors[k] % exponent);
  }
  return [f, r];
}

export function gcd(a: number, b: number): number {
  if (a === 0) return b;
  if (b === 0) return a;
  if (a === b) return a;
  //https://github.com/Yaffle/bigint-gcd/blob/main/gcd.js
  if (!Number.isInteger(a) || !Number.isInteger(b)) return NaN;
  while (b !== 0) [a, b] = [b, a % b];
  return a < 0 ? -a : a;
}
/* 
  Consider implementing a Binary GCD algorithm.
  Performance is not necessarily better, so benchmark before adopting.

var gcd = function (a, b) {
    if (a === 0) return b;
    if (b === 0) return a;
    if (a === b) return a;
    // remove even divisors
    var sa = 0;
    while (!(a & 1)) sa++, a >>= 1;
    var sb = 0;
    while (!(b & 1)) sb++, b >>= 1;
    var p = sa < sb ? sa : sb; // Power part of 2^p Common Divisor
    // euclidean algorithm: limited only odd numbers
    while (a !== b) {// both a and b should be odd
        if (b > a) [a,  b] = [b, a]
        a -= b; // a is even because of odd - odd
        do a >>= 1; while (!(a & 1)); // a become odd
    }
    return a << p; // Odd-Common-Divisor * 2^p
};
*/

export function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

export function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n >= 170) return Infinity;
  let val = 1;
  for (let i = 2; i <= n; i++) val = val * i;
  return val;
}

export function factorial2(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n < 0) return NaN;
  if (n <= 1) return 1;

  let result = n;
  while (n > 2) {
    n -= 2;
    result *= n;
  }

  return result;
}

export function chop(n: number, tolerance = DEFAULT_TOLERANCE): 0 | number {
  if (typeof n === 'number' && Math.abs(n) <= tolerance) return 0;
  return n;
}

/**
 * An 8th-order centered difference approximation can be used to get a highly
 * accurate approximation of the first derivative of a function.
 * The formula for the 8th-order centered difference approximation for the
 * first derivative is given by:
 *
 * $$ f'(x) \approx \frac{1}{280h} \left[ -f(x-4h) + \frac{4}{3}f(x-3h) - \frac{1}{5}f(x-2h) + \frac{8}{5}f(x-h) - \frac{8}{5}f(x+h) + \frac{1}{5}f(x+2h) - \frac{4}{3}f(x+3h) + f(x+4h) \right]$$
 *
 * Note: Mathematica uses an 8th order approximation for the first derivative
 *
 * f: the function
 * x: the point at which to approximate the derivative
 * h: the step size
 *
 * See https://en.wikipedia.org/wiki/Finite_difference_coefficient
 */
export function centeredDiff8thOrder(
  f: (number) => number,
  x: number,
  h = 0.1
) {
  return (
    (f(x - 4 * h) / 280 -
      (4 * f(x - 3 * h)) / 105 +
      f(x - 2 * h) / 5 -
      (4 * f(x - h)) / 5 +
      (4 * f(x + h)) / 5 -
      f(x + 2 * h) / 5 +
      (4 * f(x + 3 * h)) / 105 -
      f(x + 4 * h) / 280) /
    h
  );
}

/**
 *
 * @param f
 * @param x
 * @param dir Direction of approach: > 0 for right, < 0 for left, 0 for both
 * @returns
 */
export function limit(f: (x: number) => number, x: number, dir = 1): number {
  if (dir === 0) {
    // Approach from both sides
    const left = limit(f, x, -1);
    const right = limit(f, x, 1);
    if (left === undefined || right === undefined) return NaN;
    if (Math.abs(left - right) > 1e-5) return NaN;
    return (left + right) / 2;
  }

  const [val, _err] = extrapolate(f, x, { step: dir > 0 ? 1 : -1 });
  return val;
}

export function* cantorEnumerateRationals(): Generator<[number, number]> {
  yield [0, 1];

  for (let s = 1; ; s++) {
    // s = sum of numerator + denominator
    for (let n = 0; n <= s; n++) {
      const d = s - n;
      if (d === 0) continue;

      // Reduce fraction by skipping if not coprime
      if (gcd(n, d) !== 1) continue;

      yield [n, d];
      yield [-n, d];
    }
  }
}

export function* cantorEnumeratePositiveRationals(): Generator<
  [number, number]
> {
  yield [0, 1];

  for (let s = 1; ; s++) {
    // s = sum of numerator + denominator
    for (let n = 0; n <= s; n++) {
      const d = s - n;
      if (d === 0) continue;

      // Reduce fraction by skipping if not coprime
      if (gcd(n, d) !== 1) continue;

      yield [n, d];
    }
  }
}

export function* cantorEnumerateComplexNumbers(): Generator<[number, number]> {
  yield [0, 0];

  for (let s = 1; ; s++) {
    for (let na = 0; na <= s; na++) {
      const da = s - na;
      if (da === 0 || gcd(na, da) !== 1) continue;
      const a = na / da;

      for (let nb = 0; nb <= s; nb++) {
        const db = s - nb;
        if (db === 0 || gcd(nb, db) !== 1) continue;
        const b = nb / db;

        // Yield all sign combinations
        yield [a, b];
        yield [-a, b];
        yield [a, -b];
        yield [-a, -b];
      }
    }
  }
}

export function* cantorEnumerateIntegers(): Generator<number> {
  yield 0;

  for (let n = 1; ; n++) {
    yield n;
    yield -n;
  }
}

export function* cantorEnumerateNaturalNumbers(): Generator<number> {
  for (let n = 0; ; n++) yield n;
}
