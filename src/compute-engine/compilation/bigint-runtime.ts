/**
 * The runtime helpers of `mode: 'bigint'` on the JavaScript target (CE-715).
 *
 * Compiled code of the mode computes every integer as a JavaScript `bigint`.
 * The helpers below are added to the `_SYS` object of the JavaScript runtime
 * (`SYS_HELPERS` in `javascript-runtime.ts`), and only the code of the mode
 * calls them.
 *
 * Each helper takes and returns `bigint` values. A value that is not finite
 * (a "pole": `n!` at `n < 0`, a division by zero, `0^0`) has no `bigint`
 * form, so the helper throws a `NonFiniteValue` that carries the `number`
 * the double mode gives for it: `Infinity` for the interpreter's `~oo`, and
 * `NaN` for its `NaN`. The compiled entry catches it and returns
 * that `number`. Every helper tests a zero divisor itself, so the native
 * `RangeError` of a `bigint` division by `0n` is never thrown.
 *
 * Two other cases throw a `RangeError`: a checked exact division with a
 * remainder (the value is not an integer, and the code promised one), and a
 * result whose estimated size is above `MAX_EXACT_DIGITS` decimal digits,
 * the limit of the interpreter, which leaves such an expression unevaluated.
 *
 * The values at zero and at a pole are the table of §3.6 of
 * `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`.
 */

import {
  estimatedBinomialDigits,
  estimatedFactorialDigits,
} from '../numerics/special-functions.js';
import { integerDigitCount } from '../numerics/bigint.js';

/**
 * Thrown by a bigint helper at a pole. `value` is the `number` that the
 * compiled entry returns for it: `Infinity` or `NaN`. The compiled code of
 * the mode has no other way to give a value that is not finite: a `bigint`
 * cannot hold one, and the operators between the pole and the result must
 * not receive a `number`.
 */
export class NonFiniteValue extends Error {
  readonly value: number;
  constructor(value: number) {
    super(
      `The value is not finite (${String(value)}): it has no bigint representation`
    );
    this.name = 'NonFiniteValue';
    this.value = value;
  }
}

/**
 * The largest result, in decimal digits, that a guarded helper computes.
 * It is the limit of the interpreter (`MAX_EXACT_COMBINATORICS_DIGITS` in
 * `library/combinatorics.ts`, and `MAX_EXACT_POW_DIGITS` in
 * `boxed-expression/arithmetic-power.ts`): above it the interpreter leaves
 * the expression unevaluated, and the helper throws a `RangeError`.
 */
const MAX_EXACT_DIGITS = 1_000_000;

/** log10 of the golden ratio: `F(n)` has about `n · log10(φ)` digits. */
const LOG10_PHI = Math.log10((1 + Math.sqrt(5)) / 2);

function sizeLimitError(operation: string, digits: number): RangeError {
  return new RangeError(
    `${operation}: the result has about ${Number.isFinite(digits) ? Math.round(digits) : 'infinitely many'} decimal digits, more than the limit of ${MAX_EXACT_DIGITS} of the bigint mode`
  );
}

function abs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

/** Throw the pole of a division of `a` by zero: `NaN` for `0/0`, and
 * `Infinity` for any other dividend. */
function divisionByZero(a: bigint): never {
  throw new NonFiniteValue(a === 0n ? NaN : Infinity);
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

/** `Floor(a / b)`. */
export function bfloorDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) divisionByZero(a);
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

/** `Mod(a, b)`: the remainder with the sign of the divisor. */
export function bfloorMod(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new NonFiniteValue(NaN);
  const r = a % b;
  return r !== 0n && r < 0n !== b < 0n ? r + b : r;
}

/**
 * `Remainder(a, b)`: `a − b·k`, where `k` is `a/b` rounded to the nearest
 * integer, a tie rounded toward `+∞`. This is the rule of the interpreter
 * (`exactRemainder` and `integerRemainder` in `library/arithmetic.ts`) and
 * of the double mode (`Math.round`): `Remainder(25, 15) = −5`,
 * `Remainder(5, 2) = −1`, `Remainder(−7, 3) = −1`, `Remainder(7, −3) = 1`.
 * `k = ⌊a/b + 1/2⌋ = ⌊(2a + b) / 2b⌋`.
 */
export function bremainder(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new NonFiniteValue(NaN);
  return a - b * bfloorDiv(2n * a + b, 2n * b);
}

// ---------------------------------------------------------------------------
// Powers and roots
// ---------------------------------------------------------------------------

/**
 * `a^e` for `e ≥ 0`. `0^0` is a pole carrying `NaN`. A base of absolute
 * value 1 or less has no size limit (`1^(10^7)` is `1n`). A negative
 * exponent is accepted for a base `±1` only; for a base `0` it is a pole
 * carrying `Infinity`, and for any other base the value is not an integer,
 * which throws a `RangeError`.
 */
export function bpow(a: bigint, e: bigint): bigint {
  if (e === 0n) {
    if (a === 0n) throw new NonFiniteValue(NaN);
    return 1n;
  }
  if (a === 0n) {
    if (e < 0n) throw new NonFiniteValue(Infinity);
    return 0n;
  }
  if (a === 1n) return 1n;
  if (a === -1n) return e % 2n === 0n ? 1n : -1n;
  if (e < 0n)
    throw new RangeError(
      `The power ${String(a)}^${String(e)} is not an integer`
    );
  // The estimate is the estimate of the interpreter (`integerDigitCount` in
  // `numerics/bigint.ts`, which `boxed-expression/arithmetic-power.ts`
  // uses): the count of decimal digits of `|a|` times `e`. It is larger
  // than the true size of `a^e`, and the helper must throw for each power
  // that the interpreter leaves unevaluated: `9^1000001` has 954,244
  // digits, but the estimate is 1,000,001. An estimate of `Infinity` or
  // `NaN` also throws.
  const digits = integerDigitCount(a) * Number(e);
  if (!(digits <= MAX_EXACT_DIGITS))
    throw sizeLimitError(`Power(${String(a)}, ${String(e)})`, digits);
  return a ** e;
}

// ---------------------------------------------------------------------------
// Sign, extrema, divisors
// ---------------------------------------------------------------------------

export function babs(a: bigint): bigint {
  return abs(a);
}

export function bsign(a: bigint): bigint {
  return a > 0n ? 1n : a < 0n ? -1n : 0n;
}

export function bmin(...xs: bigint[]): bigint {
  let m = xs[0];
  for (const x of xs) if (x < m) m = x;
  return m;
}

export function bmax(...xs: bigint[]): bigint {
  let m = xs[0];
  for (const x of xs) if (x > m) m = x;
  return m;
}

function gcd2(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

/** The greatest common divisor of the operands, non-negative:
 * `GCD(0, 0) = 0`, `GCD(0, 5) = 5`, `GCD(−4, 6) = 2`. */
export function bgcd(...xs: bigint[]): bigint {
  let g = 0n;
  for (const x of xs) g = gcd2(g, x);
  return g;
}

/** The least common multiple of the operands, non-negative:
 * `LCM(0, 5) = 0`, `LCM(−4, 6) = 12`. */
export function blcm(...xs: bigint[]): bigint {
  if (xs.length === 0) return 1n;
  let l = abs(xs[0]);
  for (const x of xs.slice(1)) {
    if (l === 0n || x === 0n) return 0n;
    l = (l / gcd2(l, x)) * abs(x);
  }
  return l;
}

// ---------------------------------------------------------------------------
// Combinatorics
// ---------------------------------------------------------------------------

/** The product `lo · (lo + step) · … ` of the terms up to `hi`, split in
 * halves so that the operands of each multiplication have about the same
 * size, which is much faster than a product from left to right. */
function product(lo: bigint, hi: bigint, step: bigint): bigint {
  if (lo > hi) return 1n;
  const count = (hi - lo) / step + 1n;
  if (count <= 8n) {
    let r = 1n;
    for (let x = lo; x <= hi; x += step) r *= x;
    return r;
  }
  const mid = lo + (count / 2n) * step;
  return product(lo, mid - step, step) * product(mid, hi, step);
}

/** `n!`. A negative `n` is a pole carrying `Infinity` (the interpreter
 * gives `~oo`). */
export function bfactorial(n: bigint): bigint {
  if (n < 0n) throw new NonFiniteValue(Infinity);
  const digits = estimatedFactorialDigits(Number(n));
  if (!(digits <= MAX_EXACT_DIGITS))
    throw sizeLimitError(`Factorial(${String(n)})`, digits);
  return product(2n, n, 1n);
}

/**
 * `Binomial(n, k)`, extended to negative operands as the interpreter
 * extends it (`binomialBigint` in `library/combinatorics.ts`):
 * - `k < 0` gives `0`, except when `n` is a negative integer with `n ≥ k`,
 *   where the poles of `Γ` cancel: `(−1)^(n−k) · Binomial(−k−1, −n−1)`;
 * - `n < 0 ≤ k` gives `(−1)^k · Binomial(k − n − 1, k)`;
 * - `k > n ≥ 0` gives `0`.
 * For example `Binomial(−1, 2) = 1`, `Binomial(5, −1) = 0`,
 * `Binomial(5, 7) = 0`, `Binomial(−3, −5) = 6`.
 */
export function bbinomial(n: bigint, k: bigint): bigint {
  if (k < 0n) {
    if (n >= 0n || n < k) return 0n;
    const sign = (n - k) % 2n === 0n ? 1n : -1n;
    return sign * bbinomial(-k - 1n, -n - 1n);
  }
  if (n < 0n) {
    const sign = k % 2n === 0n ? 1n : -1n;
    return sign * bbinomial(k - n - 1n, k);
  }
  if (k > n) return 0n;
  const kk = k < n - k ? k : n - k;
  if (kk === 0n) return 1n;
  const digits = estimatedBinomialDigits(n, kk);
  if (!(digits <= MAX_EXACT_DIGITS))
    throw sizeLimitError(`Binomial(${String(n)}, ${String(k)})`, digits);
  let result = 1n;
  for (let i = 1n; i <= kk; i++) result = (result * (n - kk + i)) / i;
  return result;
}

/** The Fibonacci number `F(n)`, extended to a negative `n` by
 * `F(−n) = (−1)^(n+1) · F(n)` (`F(−3) = 2`), as the interpreter extends
 * it. Computed by the doubling formulas `F(2m) = F(m)·(2F(m+1) − F(m))` and
 * `F(2m+1) = F(m)² + F(m+1)²`. */
export function bfibonacci(n: bigint): bigint {
  const m = abs(n);
  const digits = Number(m) * LOG10_PHI;
  if (!(digits <= MAX_EXACT_DIGITS))
    throw sizeLimitError(`Fibonacci(${String(n)})`, digits);
  let a = 0n; // F(j)
  let b = 1n; // F(j + 1)
  for (const bit of m.toString(2)) {
    const c = a * (2n * b - a);
    const d = a * a + b * b;
    if (bit === '1') {
      a = d;
      b = c + d;
    } else {
      a = c;
      b = d;
    }
  }
  if (n < 0n && m % 2n === 0n) return -a;
  return a;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * The 0-based position of the 1-based index `i` in a list of `length`
 * elements: a positive index counts from the start, a negative one from the
 * end. An index `0`, an index beyond `±length` and any index of an empty
 * list have no element: a pole carrying `NaN`, the value that the double
 * mode gives for the absence marker of the interpreter.
 */
export function bindex(i: bigint, length: number): number {
  const len = BigInt(length);
  if (i === 0n || i > len || i < -len) throw new NonFiniteValue(NaN);
  return i > 0n ? Number(i) - 1 : length + Number(i);
}

/** `At(list, i)`, `First(list)` (`i = 1`), `Last(list)` (`i = −1`). */
export function bat(list: ReadonlyArray<unknown>, i: bigint): unknown {
  return list[bindex(i, list.length)];
}

/** The position from 0 of the index `i` (from 1, from the end when
 * negative) of a list of `n` elements, for a read or a write: `wix` of
 * the double mode.
 * An index that is 0 or out of range throws, where the interpreter leaves
 * the form unevaluated. */
export function bwix(n: bigint, i: bigint): bigint {
  const k = i > 0n ? i - 1n : n + i;
  if (i !== 0n && k >= 0n && k < n) return k;
  throw new Error(`out-of-range: the index ${i} of a list of ${n} elements`);
}

/** `Sort(list)` of integers: a sorted copy, ascending. */
export function bsort(list: ReadonlyArray<bigint>): bigint[] {
  return [...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The element count of the range `lo..hi` by `step`: `0` for a zero step
 * or a step whose sign does not agree with the direction from `lo` to `hi`.
 * The `bigint` form of `rangeCount` (`numerics/range-count.ts`), which is
 * exact at any size. */
export function brangeCount(lo: bigint, hi: bigint, step: bigint): bigint {
  if (step === 0n) return 0n;
  const q = bfloorDiv(hi - lo, step);
  return q < 0n ? 0n : q + 1n;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** The helpers of the mode, as they are added to `_SYS`. */
export const BIGINT_HELPERS = {
  NonFiniteValue,
  bfloorDiv,
  bfloorMod,
  bremainder,
  bpow,
  babs,
  bsign,
  bmin,
  bmax,
  bgcd,
  blcm,
  bfactorial,
  bbinomial,
  bfibonacci,
  bat,
  bsort,
  bwix,
  brangeCount,
};
