/**
 * Comparison and conditional interval operations
 *
 * @module interval/comparison
 */

import type { Interval, IntervalResult, BoolInterval } from './types';
import { unionResults } from './util';

/**
 * Less than comparison for intervals.
 *
 * Returns:
 * - 'true' if a is entirely less than b (a.hi < b.lo)
 * - 'false' if a is entirely greater than or equal to b (a.lo >= b.hi)
 * - 'maybe' if intervals overlap
 */
export function less(a: Interval, b: Interval): BoolInterval {
  if (a.hi < b.lo) return 'true';
  if (a.lo >= b.hi) return 'false';
  return 'maybe';
}

/**
 * Less than or equal comparison for intervals.
 */
export function lessEqual(a: Interval, b: Interval): BoolInterval {
  if (a.hi <= b.lo) return 'true';
  if (a.lo > b.hi) return 'false';
  return 'maybe';
}

/**
 * Greater than comparison for intervals.
 */
export function greater(a: Interval, b: Interval): BoolInterval {
  if (a.lo > b.hi) return 'true';
  if (a.hi <= b.lo) return 'false';
  return 'maybe';
}

/**
 * Greater than or equal comparison for intervals.
 */
export function greaterEqual(a: Interval, b: Interval): BoolInterval {
  if (a.lo >= b.hi) return 'true';
  if (a.hi < b.lo) return 'false';
  return 'maybe';
}

/**
 * Equality comparison for intervals.
 *
 * Returns:
 * - 'true' only if both are point intervals with same value
 * - 'false' if intervals don't overlap
 * - 'maybe' if intervals overlap
 */
export function equal(a: Interval, b: Interval): BoolInterval {
  // Equal only if both are point intervals with same value
  if (a.lo === a.hi && b.lo === b.hi && a.lo === b.lo) return 'true';
  // Definitely not equal if intervals don't overlap
  if (a.hi < b.lo || b.hi < a.lo) return 'false';
  return 'maybe';
}

/**
 * Not equal comparison for intervals.
 */
export function notEqual(a: Interval, b: Interval): BoolInterval {
  const eq = equal(a, b);
  if (eq === 'true') return 'false';
  if (eq === 'false') return 'true';
  return 'maybe';
}

/**
 * Logical AND for boolean intervals.
 */
export function and(a: BoolInterval, b: BoolInterval): BoolInterval {
  if (a === 'false' || b === 'false') return 'false';
  if (a === 'true' && b === 'true') return 'true';
  return 'maybe';
}

/**
 * Logical OR for boolean intervals.
 */
export function or(a: BoolInterval, b: BoolInterval): BoolInterval {
  if (a === 'true' || b === 'true') return 'true';
  if (a === 'false' && b === 'false') return 'false';
  return 'maybe';
}

/**
 * Logical NOT for boolean intervals.
 */
export function not(a: BoolInterval): BoolInterval {
  if (a === 'true') return 'false';
  if (a === 'false') return 'true';
  return 'maybe';
}

/**
 * Piecewise (conditional) evaluation for intervals.
 *
 * When the condition is indeterminate ('maybe'), both branches
 * are evaluated and the union (hull) is returned.
 *
 * @param x - Input interval
 * @param condition - Function that evaluates the condition
 * @param trueBranch - Function for when condition is true
 * @param falseBranch - Function for when condition is false
 */
export function piecewise(
  x: Interval,
  condition: (x: Interval) => BoolInterval,
  trueBranch: (x: Interval) => IntervalResult,
  falseBranch: (x: Interval) => IntervalResult
): IntervalResult {
  const cond = condition(x);

  switch (cond) {
    case 'true':
      return trueBranch(x);
    case 'false':
      return falseBranch(x);
    case 'maybe':
      // Condition is indeterminate - must evaluate both branches
      // and return their union
      const t = trueBranch(x);
      const f = falseBranch(x);
      return unionResults(t, f);
  }
}

/**
 * Clamp an interval to a range.
 *
 * clamp(x, lo, hi) returns x clamped to [lo, hi].
 */
export function clamp(x: Interval, lo: Interval, hi: Interval): IntervalResult {
  // Use the most restrictive bounds
  const resultLo = Math.max(x.lo, lo.lo);
  const resultHi = Math.min(x.hi, hi.hi);

  if (resultLo > resultHi) {
    return { kind: 'empty' };
  }

  return { kind: 'interval', value: { lo: resultLo, hi: resultHi } };
}
