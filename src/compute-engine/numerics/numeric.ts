import Complex from 'complex.js';
import { Decimal } from 'decimal.js';

import { extrapolate } from './richardson';
import { primeFactors } from './primes';

export const MACHINE_PRECISION_BITS = 53;
export const MACHINE_PRECISION = Math.log10(
  Math.pow(2, MACHINE_PRECISION_BITS)
); // ≈ 15.95 = number of digits of precision

// Numerical tolerance is in number of digits at the end of the number that
// are ignored for sameness evaluation, 7-bit ≈ 2.10721 digits.
export const MACHINE_TOLERANCE_BITS = 7;
export const MACHINE_TOLERANCE = Math.pow(
  2,
  -(MACHINE_PRECISION_BITS - MACHINE_TOLERANCE_BITS)
);

// Positive values smaller than NUMERIC_TOLERANCE are considered to be zero
export const NUMERIC_TOLERANCE = Math.pow(10, -10);

// When applying simplifications, only considers integers whose absolute value
// is less than SMALL_INTEGER. This avoid loss of precision by preventing
// simplification for `1e199 + 1`.
// Note: SMALL_INTEGER ≈ 10^(MACHINE_PRECISION / 2)
// so that the product of two small integers does not lose precision
export const SMALL_INTEGER = 1000000;

// When doing a calculation via iteration (e.g. to calculate a sum)
// do not iterate more than this value
export const MAX_ITERATION = 1000000;

// When doing a symbolic calculations using multiple terms, do
// not expand beyond these many terms
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

/**
 * Return a, b, c such that n = a * b^c
 * @param n
 *
 */
export function canonicalInteger(n: number): [a: number, b: number, c: number] {
  console.assert(Number.isInteger(n));
  if (n === 0) return [0, 1, 1];
  let sign = 1;
  if (n < 0) {
    n = -n;
    sign = -1;
  }
  if (n === 1) return [sign, 1, 1];
  const factors = primeFactors(n);
  let a = 1;
  let b = 1;
  let c = 1;
  for (const k of Object.keys(factors)) {
    const v = parseInt(k);
    if (factors[k] % 2 === 0) {
      a = a * Math.pow(v, factors[k] / 2);
    } else {
      b = b * v;
      c = c * factors[k];
    }
  }
  return [sign * a, b, c];
}

/** Return `[factor, root]` such that
 * pow(n, 1/exponent) = factor * pow(root, 1/exponent)
 *
 * factorPower(75, 2) -> [5, 3] = 5^2 * 3
 *
 */
export function factorPower(
  n: number,
  exponent: number
): [factor: number, root: number] {
  if (n >= Number.MAX_SAFE_INTEGER) return [1, n];
  if (n === 0) return [0, 0];
  // @todo: handle negative n
  console.assert(Number.isInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER);
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

const gammaG = 7;
const lanczos_7_c = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

// const gammaGLn = 607 / 128;
// const gammaPLn = [
//   0.999999999999997, 57.156235665862923, -59.59796035547549, 14.13609797474174,
//   -0.4919138160976202, 0.3399464998481188e-4, 0.4652362892704857e-4,
//   -0.9837447530487956e-4, 0.1580887032249125e-3, -0.21026444172410488e-3,
//   0.2174396181152126e-3, -0.16431810653676389e-3, 0.8441822398385274e-4,
//   -0.261908384015814e-4, 0.3689918265953162e-5,
// ];

export function gammaln(z: number): number {
  // From WikiPedia:
  // \ln \Gamma (z)=z\ln z-z-{\tfrac {1}{2}}\ln z+{\tfrac {1}{2}}\ln 2\pi +{\frac {1}{12z}}-{\frac {1}{360z^{3}}}+{\frac {1}{1260z^{5}}}+o\left({\frac {1}{z^{5}}}\right)

  if (z < 0) return NaN;
  const pi = Math.PI;
  const z3 = z * z * z;
  return (
    z * Math.log(z) -
    z -
    0.5 * Math.log(z) +
    0.5 * Math.log(2 * pi) +
    1 / (12 * z) -
    1 / (360 * z3) +
    1 / (1260 * z3 * z * z)
  );

  // Spouge approximation (suitable for large arguments)
  // if (z < 0) return NaN;
  // let x = gammaPLn[0];
  // for (let i = gammaPLn.length - 1; i > 0; --i) x += gammaPLn[i] / (z + i);
  // const t = z + gammaGLn + 0.5;
  // return (
  //   0.5 * Math.log(2 * Math.PI) +
  //   (z + 0.5) * Math.log(t) -
  //   t +
  //   Math.log(x) -
  //   Math.log(z)
  // );
}

// From https://github.com/substack/gamma.js/blob/master/index.js
export function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  if (z > 100) return Math.exp(gammaln(z));

  z -= 1;
  let x = lanczos_7_c[0];
  for (let i = 1; i < gammaG + 2; i++) x += lanczos_7_c[i] / (z + i);

  const t = z + gammaG + 0.5;

  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function chop(n: number, tolerance: number): number;
export function chop(n: Decimal, tolerance: number): 0 | Decimal;
export function chop(n: Complex, tolerance: number): 0 | Complex;
export function chop(
  n: number | Decimal | Complex,
  tolerance: number
): 0 | number | Decimal | Complex {
  if (typeof n === 'number' && Math.abs(n) <= tolerance) return 0;

  if (n instanceof Decimal && n.abs().lte(tolerance)) return 0;

  if (
    n instanceof Complex &&
    Math.abs(n.re) <= tolerance &&
    Math.abs(n.im) <= tolerance
  )
    return 0;

  return n;
}

/**
 * An approximation of the gaussian error function, Erf(), using
 * Abramowitz and Stegun approximation.
 * 
 * Thoughts for future improvements:
 * - https://math.stackexchange.com/questions/321569/approximating-the-error-function-erf-by-analytical-functions
 * - https://en.wikipedia.org/wiki/Error_function#Approximation_with_elementary_functions

 * 
 * References:
 * - NIST: https://dlmf.nist.gov/7.24#i
 */

export function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  // Save the sign of x
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  // Abramowitz and Stegun approximation
  // https://personal.math.ubc.ca/~cbm/aands/page_299.htm
  const t = 1.0 / (1.0 + p * x);
  const y = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;

  return sign * (1 - y * Math.exp(-x * x));
}

/**
 * Trivial function, used when compiling.
 */
export function erfc(x: number): number {
  return 1 - erf(x);
}

/**
 * Inverse Error Function.
 *
 */
export function erfInv(x: number): number {
  // From https://en.wikipedia.org/wiki/Error_function#Numerical_approximations
  // {\displaystyle \operatorname {erf} ^{-1}z={\frac {\sqrt {\pi }}{2}}\left(z+{\frac {\pi }{12}}z^{3}+{\frac {7\pi ^{2}}{480}}z^{5}+{\frac {127\pi ^{3}}{40320}}z^{7}+{\frac {4369\pi ^{4}}{5806080}}z^{9}+{\frac {34807\pi ^{5}}{182476800}}z^{11}+\cdots \right).}

  const pi = Math.PI;
  const pi2 = pi * pi;
  const pi3 = pi2 * pi;
  const x2 = x * x;
  const x3 = x * x2;
  const x5 = x3 * x2;
  const x7 = x5 * x2;

  return (
    (Math.sqrt(pi) / 2) *
    (x +
      (pi / 12) * x3 +
      ((7 * pi2) / 480) * x5 +
      ((127 * pi3) / 40320) * x7 +
      ((4369 * pi2 * pi2) / 5806080) * x7 * x2 +
      ((34807 * pi3 * pi2) / 182476800) * x7 * x2 * x2)
  );

  // const a = 0.147;
  // const b = 2 / (Math.PI * a) + Math.log(1 - x ** 2) / 2;
  // const sqrt1 = Math.sqrt(b ** 2 - Math.log(1 - x ** 2) / a);
  // const sqrt2 = Math.sqrt(sqrt1 - b);
  // return sqrt2 * Math.sign(x);
}

/**
 * An 8th-order centered difference approximation can be used to get a highly
 * accurate approximation of the first derivative of a function.
 * The formula for the 8th-order centered difference approximation for the
 * first derivative is given by:
 *
 * \[
 * f'(x) \approx \frac{1}{280h} \left[ -f(x-4h) + \frac{4}{3}f(x-3h) - \frac{1}{5}f(x-2h) + \frac{8}{5}f(x-h) - \frac{8}{5}f(x+h) + \frac{1}{5}f(x+2h) - \frac{4}{3}f(x+3h) + f(x+4h) \right]
 * \]
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
 * Return a numerical approximation of the integral
 * of the function `f` from `a` to `b` using Monte Carlo integration.
 *
 * Thoughts for future improvements:
 * - use a MISER algorithm to improve the accuracy
 * - use a stratified sampling to improve the accuracy
 * - use a quasi-Monte Carlo method to improve the accuracy
 * - use a Markov Chain Monte Carlo method to improve the accuracy
 * - use a Metropolis-Hastings algorithm to improve the accuracy
 * - use a Hamiltonian Monte Carlo algorithm to improve the accuracy
 * - use a Gibbs sampling algorithm to improve the accuracy
 *
 *
 * See:
 * - https://64.github.io/monte-carlo/
 *
 */
export function monteCarloEstimate(
  f: (x: number) => number,
  a: number,
  b: number,
  n = 1e5
): number {
  let sum = 0;

  if (a === -Infinity && b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = Math.tan(Math.PI * (u - 0.5));
      const jacobian = Math.PI * (1 + x * x);
      sum += f(x) / jacobian;
    }
  } else if (a === -Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = b - Math.log(1 - u);
      const jacobian = 1 / (1 - u);
      sum += f(x) / jacobian;
    }
  } else if (b === Infinity) {
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const x = a + Math.log(u);
      const jacobian = 1 / u;
      sum += f(x) / jacobian;
    }
  } else {
    // Proper integral
    for (let i = 0; i < n; i++) sum += f(a + Math.random() * (b - a));
  }

  return (sum / n) * (b - a);
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

  const [val, err] = extrapolate(f, x, { step: dir > 0 ? 1 : -1 });
  return val;
}

export function fromRoman(roman: string): [result: number, rest: string] {
  if (roman === 'N') return [0, ''];

  const romanMap = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };

  let total = 0;
  let prevValue = 0;

  roman = roman.toUpperCase();

  for (let i = roman.length - 1; i >= 0; i--) {
    const currentValue = romanMap[roman[i]];
    if (currentValue === undefined) return [total, roman.slice(i)];

    if (currentValue < prevValue) total -= currentValue;
    else total += currentValue;

    prevValue = currentValue;
  }

  return [total, ''];
}

export function fromDigits(
  s: string,
  baseInput?: string | number
): [result: number, rest: string] {
  s = s.trim();
  if (s.length === 0) return [NaN, ''];
  if (s.startsWith('+')) return fromDigits(s.slice(1), baseInput);
  if (s.startsWith('-')) {
    const [v, r] = fromDigits(s.slice(1), baseInput);
    return [-v, r];
  }
  let base = 10;
  if (typeof baseInput === 'string') baseInput = baseInput.toLowerCase();
  if (s.startsWith('0x')) {
    base = 16;
    s = s.slice(2);
  } else if (s.startsWith('0b')) {
    base = 2;
    s = s.slice(2);
  } else if (baseInput === 'roman') {
    return fromRoman(s);
  } else if (baseInput === 'base64' || baseInput === 'base-64') {
    try {
      return [parseInt(btoa(s)), ''];
    } catch (e) {
      return [NaN, ''];
    }
  } else if (typeof baseInput === 'number') {
    base = baseInput;
  } else if (typeof baseInput === 'string') {
    base = parseInt(baseInput);
  }

  let value = 0;
  for (let i = 0; i < s.length; i++) {
    const k = {
      ' ': -1,
      '\u00a0': -1, // NBS
      '\u2000': -1, // EN QUAD
      '\u2001': -1, // EM QUAD
      '\u2002': -1, // EN SPACE
      '\u2003': -1, // EM SPACE
      '\u2004': -1, // THREE-PER-EM SPACE
      '\u2005': -1, // FOUR-PER-EM SPACE
      '\u2006': -1, // SIX-PER-EM SPACE
      '\u2007': -1, // FIGURE SPACE
      '\u2008': -1, // PUNCTUATION SPACE
      '\u2009': -1, // THIN SPACE
      '\u200a': -1, // HAIR SPACE
      '\u200b': -1, // ZWS
      '\u202f': -1, // NARROW NBS
      '\u205f': -1, // MEDIUM MATHEMATICAL SPACE
      '_': -1,
      ',': -1,
      '0': 0,
      '1': 1,
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
      'a': 10,
      'b': 11,
      'c': 12,
      'd': 13,
      'e': 14,
      'f': 15,
      'g': 16,
      'h': 17,
      'i': 18,
      'j': 19,
      'k': 20,
      'l': 21,
      'm': 22,
      'n': 23,
      'o': 24,
      'p': 25,
      'q': 26,
      'r': 27,
      's': 28,
      't': 29,
      'u': 30,
      'v': 31,
      'w': 32,
      'x': 33,
      'y': 34,
      'z': 35,
    }[s[i]];
    if (k !== -1) {
      if (k === undefined) return [value, s.substring(i)];
      if (k >= base) return [value, s.substring(i)];
      value = value * base + k;
    }
  }

  return [value, ''];
}
