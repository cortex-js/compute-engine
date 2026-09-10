/**
 * Basic interval arithmetic operations
 *
 * @module interval/arithmetic
 */

import type { Interval, IntervalResult } from './types.js';
import { ok, unwrapOrPropagate, liftJump } from './util.js';
import {
  outwardUnlessExact,
  exactAdd,
  exactSub,
  exactMul,
  exactDiv,
  exactNegDiv,
} from './rounding.js';

/**
 * Add two intervals (or IntervalResults).
 *
 * [a, b] + [c, d] = [a + c, b + d]
 *
 * Addition is always defined and produces a valid interval.
 * If inputs are IntervalResults, propagates errors (empty, entire, singular).
 */
function addRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return ok({ lo: aVal.lo + bVal.lo, hi: aVal.hi + bVal.hi });
}

/**
 * Subtract two intervals (or IntervalResults).
 *
 * [a, b] - [c, d] = [a - d, b - c]
 *
 * Subtraction is always defined and produces a valid interval.
 * If inputs are IntervalResults, propagates errors (empty, entire, singular).
 */
function subRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return ok({ lo: aVal.lo - bVal.hi, hi: aVal.hi - bVal.lo });
}

/**
 * Negate an interval (or IntervalResult).
 *
 * -[a, b] = [-b, -a]
 */
function negateRaw(x: Interval | IntervalResult): IntervalResult {
  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  return ok({ lo: -xVal.hi, hi: -xVal.lo });
}

/**
 * Internal multiplication helper that returns plain Interval.
 *
 * Used by div() and other operations that need plain interval results.
 */
export function _mul(a: Interval, b: Interval): Interval {
  const products = [
    _prod(a.lo, b.lo),
    _prod(a.lo, b.hi),
    _prod(a.hi, b.lo),
    _prod(a.hi, b.hi),
  ];
  return { lo: Math.min(...products), hi: Math.max(...products) };
}

/**
 * Endpoint product using the interval convention `0 · ±∞ = 0`.
 *
 * A plain `0 * Infinity` is `NaN`, which would poison `Math.min`/`Math.max`
 * and collapse the whole interval to `NaN` — e.g. `[0, 1] · [1, ∞)` or an
 * ordinary expression like `x · ln(x)` evaluated on `[0, 1]`. In interval
 * arithmetic an exact zero endpoint annihilates an infinite one.
 */
function _prod(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return x * y;
}

/**
 * Endpoint quotient. It answers exactly what `_prod(x, 1 / y)` answers —
 * the annihilations included — but divides instead of multiplying by the
 * reciprocal, so an exact quotient stays exact.
 *
 * `1 / y` is an exact zero for an infinite `y` and for nothing else, so the
 * two annihilation conditions of `_prod` (`x === 0` or the reciprocal is
 * zero) become `x === 0` or `y` is infinite. Without them `[1, ∞) / [2, ∞)`
 * would produce a `NaN` corner and `Math.min`/`Math.max` would collapse the
 * whole interval to `NaN`. A `NaN` endpoint falls through to the division
 * and stays `NaN`, as it did through the product.
 */
function _quot(x: number, y: number): number {
  if (x === 0) return 0;
  if (y === Infinity || y === -Infinity) return 0;
  return x / y;
}

/**
 * Multiply two intervals (or IntervalResults).
 *
 * All four endpoint products are computed and the result
 * spans from minimum to maximum.
 * If inputs are IntervalResults, propagates errors (empty, entire, singular).
 */
function mulRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return ok(_mul(aVal, bVal));
}

/**
 * Multiply a POINT interval by an interval.
 *
 * A degenerate first operand `[c, c]` makes two of the four endpoint products
 * of `_mul` duplicates of the other two, so the range is the hull of
 * `c · b.lo` and `c · b.hi` alone. The answer is bit for bit the one `mulRaw`
 * gives — the same two values selected by the same `Math.min`/`Math.max` —
 * with two multiplications and no intermediate array. The compiler emits this
 * routine wherever one factor is a constant point, which is most products of
 * a plotted expression: a coefficient times a variable.
 *
 * A first operand that is not a point (a NaN endpoint included) falls back to
 * the general product, so the routine is safe to call with any operands.
 */
function scaleRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  if (aVal.lo !== aVal.hi) return ok(_mul(aVal, bVal));
  const lo = _prod(aVal.lo, bVal.lo);
  const hi = _prod(aVal.lo, bVal.hi);
  return ok({ lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
}

/**
 * Divide an interval by a POINT interval.
 *
 * The mirror of `scaleRaw` on the divisor side: a degenerate, non-zero second
 * operand `[c, c]` makes two of the four corner quotients of `_div`
 * duplicates, so the range is the hull of `a.lo / c` and `a.hi / c`. A point
 * divisor is never the zero-crossing case, so none of the `singular`,
 * `partial`, `entire` and `empty` answers of the general division can arise
 * here.
 *
 * A divisor that is zero or is not a point falls back to the general
 * division, which owns those answers.
 */
function scaleDivRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  if (bVal.lo !== bVal.hi || bVal.lo === 0) return _div(aVal, bVal);
  const lo = _quot(aVal.lo, bVal.lo);
  const hi = _quot(aVal.hi, bVal.lo);
  return ok({ lo: Math.min(lo, hi), hi: Math.max(lo, hi) });
}

/**
 * Divide two intervals (or IntervalResults).
 *
 * Division by an interval containing zero produces special results:
 * - If divisor strictly contains 0 (not just touching): singular
 * - If divisor is exactly [0, 0]: empty
 * - If divisor touches 0 at one bound: partial result
 *
 * This is the key operation for singularity detection in plotting.
 * If inputs are IntervalResults, propagates errors (empty, entire, singular).
 */
function divRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return _div(aVal, bVal);
}

/**
 * Divide the NEGATION of an interval by another interval: `(−a) / b`.
 *
 * The compiler emits this wherever a negated numerator meets a division
 * (`−⌊n·x⌋ / n` is the shape a lattice snap takes), so the negation does not
 * build an interval the division consumes at once. It answers what
 * `div(negate(a), b)` answers: negation flips the sign of each endpoint, which
 * is exact and needs no outward step, and the division then runs on those
 * endpoints under its own step and its own exactness proof (`exactNegDiv`).
 *
 * The separate negation of the composition is a `liftJump` step of its own,
 * and that step DROPS the jump of an operand whose negated enclosure is a
 * single point. It cannot arise: an operand is only tagged as a jump when its
 * enclosure spans the two sides of a break, so its endpoints differ (`jump` in
 * `util.ts`, and `liftJump`, which re-tags only a non-degenerate enclosure).
 */
function negDivRaw(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return _div({ lo: -aVal.hi, hi: -aVal.lo }, bVal);
}

/**
 * Internal division that works on plain Intervals.
 */
function _div(a: Interval, b: Interval): IntervalResult {
  // Case 1: Divisor entirely positive or negative - safe division
  if (b.lo > 0 || b.hi < 0) {
    // Divide the endpoints. The previous form multiplied by the RECIPROCAL
    // interval `[1/b.hi, 1/b.lo]`, which rounds twice: `[49, 49] / [49, 49]`
    // answered `[0.9999999999999999, …]`, so `floor(x / 49)` at `x = 49`
    // was 0 where the interpreter answers 1. IEEE division is correctly
    // rounded, so an exact quotient comes out exact. Division is monotone
    // in each argument over a sign-constant divisor, so the range is still
    // the hull of the four corner quotients.
    const quotients = [
      _quot(a.lo, b.lo),
      _quot(a.lo, b.hi),
      _quot(a.hi, b.lo),
      _quot(a.hi, b.hi),
    ];
    return ok({ lo: Math.min(...quotients), hi: Math.max(...quotients) });
  }

  // Case 2: Divisor strictly contains zero - singularity
  // For plotting, we signal this and let the algorithm subdivide
  if (b.lo < 0 && b.hi > 0) {
    return { kind: 'singular' };
  }

  // Case 3: Divisor is exactly [0, c] (touches zero at lower bound)
  if (b.lo === 0 && b.hi > 0) {
    // Dividing by [0+, c]: approaches +Infinity or -Infinity from one side.
    //
    // The finite end of the `partial` can itself overflow: `1 / [0, 5·10⁻³²⁴]`
    // has the true lower bound `1 / 5·10⁻³²⁴`, a real number no double holds,
    // and the division answers `Infinity` for it. The outward step turns that
    // inward-facing infinity back into `Number.MAX_VALUE` (`rounding.ts`), so
    // the answer is `[MAX_VALUE, ∞)`: a `partial` with an INFINITE upper bound
    // is the sound reading, because the quotient really is unbounded as the
    // divisor approaches 0, while `[∞, ∞]` would enclose nothing and `empty`
    // would claim there is no value at all.
    if (a.lo >= 0) {
      // Positive / [0+, c] = [a.lo/c, +Infinity)
      return {
        kind: 'partial',
        value: { lo: a.lo / b.hi, hi: Infinity },
        domainClipped: 'hi',
      };
    } else if (a.hi <= 0) {
      // Negative / [0+, c] = (-Infinity, a.hi/c]
      return {
        kind: 'partial',
        value: { lo: -Infinity, hi: a.hi / b.hi },
        domainClipped: 'lo',
      };
    } else {
      // Mixed sign numerator - result is all reals
      return { kind: 'entire' };
    }
  }

  // Case 4: Divisor is exactly [c, 0] (touches zero at upper bound)
  if (b.hi === 0 && b.lo < 0) {
    // Dividing by [c, 0-]: similar logic, opposite signs
    if (a.lo >= 0) {
      return {
        kind: 'partial',
        value: { lo: -Infinity, hi: a.lo / b.lo },
        domainClipped: 'lo',
      };
    } else if (a.hi <= 0) {
      return {
        kind: 'partial',
        value: { lo: a.hi / b.lo, hi: Infinity },
        domainClipped: 'hi',
      };
    } else {
      return { kind: 'entire' };
    }
  }

  // Case 5: Divisor is exactly [0, 0] - division by zero
  return { kind: 'empty' };
}

// Every operation above is exported through `liftJump` so that a finite
// jump in an operand (a `singular` result carrying a `value`) is re-tagged
// on the result instead of being forgotten — see `liftJump` in `util.ts`.
//
// Each operation that rounds is also exported through `outwardUnlessExact`,
// which moves an endpoint one ulp outward unless its prover shows the endpoint
// is the true real value — see `rounding.ts`. Every endpoint here is ONE
// correctly rounded double operation, so one ulp is a proof: the true value is
// within half an ulp of the computed endpoint. `negate` only flips the sign of
// each endpoint, which is exact, so it is not wrapped.
export const add = liftJump(outwardUnlessExact(addRaw, exactAdd));
export const sub = liftJump(outwardUnlessExact(subRaw, exactSub));
export const negate = liftJump(negateRaw);
export const mul = liftJump(outwardUnlessExact(mulRaw, exactMul));
export const div = liftJump(outwardUnlessExact(divRaw, exactDiv));
export const negDiv = liftJump(outwardUnlessExact(negDivRaw, exactNegDiv));
// `scale` and `scaleDiv` answer the same endpoints as `mul` and `div` for the
// operands they specialize, so they take the same outward step under the same
// provers: the prover reads the two operands and the answered enclosure, none
// of which the specialization changes.
export const scale = liftJump(outwardUnlessExact(scaleRaw, exactMul));
export const scaleDiv = liftJump(outwardUnlessExact(scaleDivRaw, exactDiv));

// The same kernels WITHOUT the outward step, for the routines of other modules
// that are BUILT from arithmetic and take their own outward step at their own
// export — `remainder` (`elementary.ts`) and the reciprocal trigonometric and
// hyperbolic routines (`trigonometric.ts`). Going through the rounded
// `sub`/`mul`/`div` above moves an endpoint once per composed operation on top
// of that step, which cost `sech([0, 0])` its exact value of 1 and made
// `acsc([2, 2])` four ulps wide for one division and one arc sine.
//
// They still propagate a finite jump, which those compositions depend on:
// `remainder`'s discontinuities come from the `round` in the middle of it, and
// a raw kernel would drop that jump on the multiplication that follows.
export const subUnrounded = liftJump(subRaw);
export const mulUnrounded = liftJump(mulRaw);
export const divUnrounded = liftJump(divRaw);
