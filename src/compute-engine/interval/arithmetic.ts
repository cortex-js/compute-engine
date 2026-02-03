/**
 * Basic interval arithmetic operations
 *
 * @module interval/arithmetic
 */

import type { Interval, IntervalResult } from './types';
import { ok, unwrapOrPropagate } from './util';

/**
 * Add two intervals (or IntervalResults).
 *
 * [a, b] + [c, d] = [a + c, b + d]
 *
 * Addition is always defined and produces a valid interval.
 * If inputs are IntervalResults, propagates errors (empty, entire, singular).
 */
export function add(
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
export function sub(
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
export function negate(x: Interval | IntervalResult): IntervalResult {
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
  const products = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
  return { lo: Math.min(...products), hi: Math.max(...products) };
}

/**
 * Multiply two intervals (or IntervalResults).
 *
 * All four endpoint products are computed and the result
 * spans from minimum to maximum.
 * If inputs are IntervalResults, propagates errors (empty, entire, singular).
 */
export function mul(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return ok(_mul(aVal, bVal));
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
export function div(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [aVal, bVal] = unwrapped;
  return _div(aVal, bVal);
}

/**
 * Internal division that works on plain Intervals.
 */
function _div(a: Interval, b: Interval): IntervalResult {
  // Case 1: Divisor entirely positive or negative - safe division
  if (b.lo > 0 || b.hi < 0) {
    return ok(_mul(a, { lo: 1 / b.hi, hi: 1 / b.lo }));
  }

  // Case 2: Divisor strictly contains zero - singularity
  // For plotting, we signal this and let the algorithm subdivide
  if (b.lo < 0 && b.hi > 0) {
    return { kind: 'singular' };
  }

  // Case 3: Divisor is exactly [0, c] (touches zero at lower bound)
  if (b.lo === 0 && b.hi > 0) {
    // Dividing by [0+, c]: approaches +Infinity or -Infinity from one side
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
