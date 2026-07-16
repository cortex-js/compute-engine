import { extrapolate } from './richardson.js';
import { primeFactors } from './primes.js';
import {
  checkDeadline,
  getAmbientDeadline,
} from '../../common/interruptible.js';

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

/**
 * Accurate real n-th root of a non-negative machine double.
 *
 * `Math.pow(x, 1/n)` is not correctly rounded — the reciprocal `1/n` is itself
 * rounded, so e.g. `Math.pow(64, 1/3)` = 3.9999999999999996 and
 * `Math.pow(1000, 1/3)` = 9.999999999999998. Refine with one Newton step on
 * `f(r) = rⁿ − x`, i.e. `r ← ((n−1)·r + x/r^{n−1}) / n`, then snap to the exact
 * integer root when `x` is a perfect n-th power (so `Root(64,3).N()` prints 4,
 * not 3.999…). Callers handle the sign of a negative radicand. (NU-P1-7)
 */
export function machineNthRoot(x: number, n: number): number {
  if (n === 1) return x;
  if (n === 2) return Math.sqrt(x);
  if (n === 3) return Math.cbrt(x);
  // Newton correction and integer snapping only make sense for an integer
  // degree; a non-integer degree is just a power.
  if (!Number.isInteger(n)) return Math.pow(x, 1 / n);
  if (x === 0 || !Number.isFinite(x) || x < 0) return Math.pow(x, 1 / n);

  let r = Math.pow(x, 1 / n);
  if (!Number.isFinite(r) || r === 0) return r;

  // One Newton correction step (the seed is already ~15 digits, so a single
  // step reaches full double precision).
  r = ((n - 1) * r + x / Math.pow(r, n - 1)) / n;

  // Snap to an exact integer root: if `x` is a perfect n-th power, return the
  // integer exactly rather than a value one ulp away.
  const ri = Math.round(r);
  if (ri > 0 && Math.abs(r - ri) <= 8 * Number.EPSILON * ri && ri ** n === x)
    return ri;

  return r;
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
        [2, 2], // √8 = 2√2
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
        [2, 5], // √20 = 2√5
      ] as const
    )[n];
    if (result) return result;
  }
  const factors = primeFactors(n);
  let f = BigInt(1);
  let r = BigInt(1);
  for (const k of Object.keys(factors)) {
    const v = BigInt(parseInt(k));
    const exponentBase = BigInt(exponent);
    f = f * v ** (BigInt(factors[Number(k)]) / exponentBase);
    r = r * v ** (BigInt(factors[Number(k)]) % exponentBase);
  }
  return [Number(f), Number(r)];
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
  if (a === 0 || b === 0) return 0;
  // The least common multiple is non-negative by convention, regardless of the
  // signs of the operands.
  let res = (BigInt(a) * BigInt(b)) / BigInt(gcd(a, b));
  if (res < 0n) res = -res;
  return Number(res);
}

/**
 * Relative tolerance for the real (non-integer) GCD/LCM — the ε of the tolerant
 * floating Euclidean algorithm (two reals are "commensurate" when a remainder
 * falls below `ε · max(|a|, |b|)`). Deliberately its OWN constant, NOT tied to
 * `ce.tolerance`: this ε governs float-commensurability, a different (and much
 * looser) notion than the engine's numeric-equality tolerance — coupling them
 * would force a consumer to corrupt every comparison in the engine to tune the
 * GCD. `1e-6` is the de-facto float-GCD value (Desmos uses it). The result is
 * inherently discontinuous in the inputs, so this is meaningful only for
 * numeric approximation (`.N()`, compiled plots), never as a symbolic identity.
 */
export const REAL_GCD_TOLERANCE = 1e-6;

/**
 * GCD extended to non-integer reals via a tolerant floating Euclidean
 * algorithm — the standard "float GCD" (repeated `a mod b`, terminating at a
 * small `|b|` relative to the input scale rather than exact zero). Integer
 * inputs take an exact path (no tolerance), so this never regresses integer
 * GCD. This is an inherently discontinuous, tolerance-parameterized operation:
 * it is meaningful for numeric approximation (`.N()`, compiled plots), not as a
 * symbolic identity.
 */
export function realGcd(
  a: number,
  b: number,
  eps = REAL_GCD_TOLERANCE
): number {
  a = Math.abs(a);
  b = Math.abs(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  if (a === 0) return b;
  if (b === 0) return a;
  // Exact integer path: preserves large-integer correctness, no tolerance.
  if (Number.isInteger(a) && Number.isInteger(b)) {
    while (b !== 0) [a, b] = [b, a % b];
    return a;
  }
  // Tolerant floating Euclidean algorithm for non-integer reals.
  const tol = eps * Math.max(a, b);
  // Bounded loop: Euclid converges fast; the cap guards against a pathological
  // float residue that never dips below `tol`.
  for (let i = 0; i < 10000 && b > tol; i++) [a, b] = [b, a % b];
  return a;
}

/**
 * LCM extended to non-integer reals, consistent with {@linkcode realGcd}:
 * `lcm(a, b) = |a·b| / gcd(a, b)`. Integer inputs go through the exact integer
 * {@linkcode lcm}; non-integer inputs use the tolerant float GCD.
 */
export function realLcm(
  a: number,
  b: number,
  eps = REAL_GCD_TOLERANCE
): number {
  if (a === 0 || b === 0) return 0;
  if (Number.isInteger(a) && Number.isInteger(b)) return lcm(a, b);
  const g = realGcd(a, b, eps);
  if (!Number.isFinite(g) || g === 0) return NaN;
  return Math.abs((a * b) / g);
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
  f: (x: number) => number,
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
/**
 * Probe the geometric sample ladder that `extrapolate()` uses for a numeric
 * limit and report how many leading samples are *trustworthy*.
 *
 * Returns `Infinity` when the ladder is well-behaved (the common case — no cap
 * needed), or a finite count when the function crosses a floating-point
 * "horizon" before the samples settle:
 *  - a non-finite sample (overflow / `Inf − Inf`), or
 *  - catastrophic cancellation: the magnitude grows to an interior peak and
 *    then collapses to ~0.
 *
 * Beyond that horizon the samples are floating-point garbage. Left unchecked,
 * a collapse to a run of identical `0`s makes `extrapolate` report `err = 0`
 * (perfect "convergence") and return a spurious value — e.g.
 * `lim_{x→∞} (e^{x·e^{−x}/…} − eˣ)/x = −e²`, whose two `eˣ` terms cancel to 0
 * around x ≈ 40 and overflow to `NaN` past x ≈ 710, yielding a wrong `0`.
 * Capping `extrapolate`'s `maxeval` to the clean prefix makes it report
 * non-convergence instead, so `limit()` returns `NaN` (not-evaluable).
 *
 * The schedule here must mirror `extrapolate()` (default `contract = 0.125`,
 * and the `x = 1/u` change of variables for an infinite target).
 */
function reliableLimitSamples(
  f: (x: number) => number,
  x0: number,
  step: number,
  deadline?: number
): number {
  const CONTRACT = 0.125; // must match extrapolate()'s default contract
  const MAX = 60;
  const inf = !Number.isFinite(x0);
  // The actual argument passed to `f` for a given step `h` (with the `x = 1/u`
  // change of variables for an infinite target, matching extrapolate()).
  const arg = (h: number) => (inf ? 1 / h : x0 + h);

  // A run of (nearly) identical samples can be a real limit, or a
  // floating-point artifact: a function whose numerically-meaningful window is
  // narrower than the ladder spacing reads as a constant because every ladder
  // point lands in an overflow/underflow region (e.g. a denominator with a
  // triple exponential overflows for all x ≳ 2, so f ≈ 0 at x = 1, 8, 64 …
  // while the true value lives near x ≈ 1.5). Corroborate by probing a few
  // points *between* the two ladder steps; the settle is real only if they all
  // match.
  const settleIsReal = (hA: number, hB: number, v: number): boolean => {
    // A generous tolerance: we are separating real fp noise (a converging
    // sequence such as (1+1/x)^x is noisy to ~x·ε near its limit) from a
    // genuinely skipped window (an overflow artifact's true value differs by an
    // O(1) amount, not a few ulps).
    const tol = 1e-2 * Math.max(1, Math.abs(v));
    for (let i = 1; i <= 5; i++) {
      checkDeadline(deadline);
      const y = f(arg(hA * Math.pow(hB / hA, i / 6)));
      if (!Number.isFinite(y) || Math.abs(y - v) > tol) return false;
    }
    return true;
  };

  let h = inf ? 1 / step : step;
  let peak = 0;
  let grew = false;
  let prev = NaN;
  let prevH = NaN;
  for (let k = 1; k <= MAX; k++) {
    // Each rung multiplies the argument by 1/CONTRACT = 8×, so a rung can be
    // arbitrarily expensive (e.g. a compiled Sum with a variable bound):
    // check the evaluation deadline between rungs, like extrapolate() does.
    checkDeadline(deadline);
    const y = f(arg(h));
    if (!Number.isFinite(y)) return k - 1; // overflow / NaN horizon
    const a = Math.abs(y);
    if (k === 1) {
      peak = a;
      prev = a;
      prevH = h;
      h *= CONTRACT;
      continue;
    }
    // Settled onto a stable value: trust extrapolate only if a denser probe
    // agrees; otherwise the ladder skipped a narrow window -> not-evaluable.
    if (Math.abs(a - prev) <= 1e-10 * Math.max(1, a))
      return settleIsReal(prevH, h, y) ? Infinity : 0;
    // Grew to an interior peak, then collapsed to ~0: catastrophic cancellation.
    if (grew && peak > 1e-6 && a < 1e-8 * peak) return k - 1;
    if (a > peak) {
      grew = true;
      peak = a;
    }
    prev = a;
    prevH = h;
    h *= CONTRACT;
  }
  return Infinity;
}

/**
 * `iterationBudget` used when compiling an expression for the numeric limit
 * ladder (here and in the symbolic-limit growth probes). The ladder samples
 * at geometrically increasing arguments (8^k up to 8^60 for a limit at ∞), so
 * a compiled `Sum`/`Product` whose bound depends on the limit variable would
 * otherwise run an astronomically long — or, for an infinite bound, endless —
 * uninterruptible loop inside a single sample (the Stage-2 corpus-audit
 * deadline escape: `γ = lim (Hₙ − ln n)` with `ce.timeLimit = 2000` ran
 * unbounded). Over-budget samples evaluate to NaN, the ladder's existing
 * "horizon" signal: `reliableLimitSamples` caps the rungs to the clean prefix
 * and Richardson extrapolation converges from those (γ still comes out
 * correct to ~1e-10 from the ≤ 8⁶-term rungs).
 */
export const LIMIT_PROBE_ITERATION_BUDGET = 1e6;

export function limit(
  f: (x: number) => number,
  x: number,
  dir = 1,
  deadline?: number
): number {
  // A call reached through compiled code (`_SYS.limit`) has no deadline of
  // its own: inherit the ambient one (see interruptible.ts).
  deadline ??= getAmbientDeadline();
  if (dir === 0) {
    // Approach from both sides
    const left = limit(f, x, -1, deadline);
    const right = limit(f, x, 1, deadline);
    if (left === undefined || right === undefined) return NaN;
    if (Math.abs(left - right) > 1e-5) return NaN;
    return (left + right) / 2;
  }

  const step = dir > 0 ? 1 : -1;
  // Don't let floating-point overflow/cancellation past the numeric horizon
  // feed `extrapolate` garbage that masquerades as convergence (see
  // `reliableLimitSamples`).
  const clean = reliableLimitSamples(f, x, step, deadline);
  if (clean === 0) return NaN; // no trustworthy samples -> not-evaluable
  const [val, err] = extrapolate(f, x, {
    step,
    deadline,
    ...(Number.isFinite(clean) ? { maxeval: clean } : {}),
  });
  // Reject low-confidence estimates: for an oscillatory or non-convergent
  // function (e.g. sinc at ∞) Richardson extrapolation returns a small but
  // meaningless value with an error estimate of the same order. Converged
  // limits report err ≲ 1e-10 relative; require 1e-6.
  if (Number.isFinite(val) && err > 1e-6 * Math.max(1, Math.abs(val)))
    return NaN;
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
