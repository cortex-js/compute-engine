/**
 * Comparison and conditional interval operations
 *
 * @module interval/comparison
 */

import type { Interval, IntervalResult, BoolInterval } from './types';
import { unionResults, unwrapOrPropagate } from './util';

/** Normalize a value that may be a plain Interval or an IntervalResult. */
function toResult(x: Interval | IntervalResult): IntervalResult {
  if ('kind' in x) return x;
  return { kind: 'interval', value: x };
}

/**
 * Less than comparison for intervals.
 *
 * Returns:
 * - 'true' if a is entirely less than b (a.hi < b.lo)
 * - 'false' if a is entirely greater than or equal to b (a.lo >= b.hi)
 * - 'maybe' if intervals overlap
 */
export function less(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.hi < bVal.lo) return 'true';
  if (aVal.lo >= bVal.hi) return 'false';
  return 'maybe';
}

/**
 * Less than or equal comparison for intervals.
 */
export function lessEqual(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.hi <= bVal.lo) return 'true';
  if (aVal.lo > bVal.hi) return 'false';
  return 'maybe';
}

/**
 * Greater than comparison for intervals.
 */
export function greater(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.lo > bVal.hi) return 'true';
  if (aVal.hi <= bVal.lo) return 'false';
  return 'maybe';
}

/**
 * Greater than or equal comparison for intervals.
 */
export function greaterEqual(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  if (aVal.lo >= bVal.hi) return 'true';
  if (aVal.hi < bVal.lo) return 'false';
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
export function equal(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
  const unwrapped = unwrapOrPropagate(a, b);
  if (!Array.isArray(unwrapped)) return 'maybe';
  const [aVal, bVal] = unwrapped;
  // Equal only if both are point intervals with same value
  if (aVal.lo === aVal.hi && bVal.lo === bVal.hi && aVal.lo === bVal.lo)
    return 'true';
  // Definitely not equal if intervals don't overlap
  if (aVal.hi < bVal.lo || bVal.hi < aVal.lo) return 'false';
  return 'maybe';
}

/**
 * Not equal comparison for intervals.
 */
export function notEqual(
  a: Interval | IntervalResult,
  b: Interval | IntervalResult
): BoolInterval {
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
  xOrCond: Interval | IntervalResult | BoolInterval,
  conditionOrTrue:
    | ((x: Interval) => BoolInterval)
    | (() => Interval | IntervalResult),
  trueOrFalse:
    | ((x: Interval) => Interval | IntervalResult)
    | (() => Interval | IntervalResult),
  falseBranch?: (x: Interval) => Interval | IntervalResult
): IntervalResult {
  if (xOrCond === 'true' || xOrCond === 'false' || xOrCond === 'maybe') {
    const cond = xOrCond;
    const trueBranch = conditionOrTrue as () => Interval | IntervalResult;
    const falseBranchFn = trueOrFalse as () => Interval | IntervalResult;
    switch (cond) {
      case 'true':
        return toResult(trueBranch());
      case 'false':
        return toResult(falseBranchFn());
      case 'maybe':
        return unionResults(toResult(trueBranch()), toResult(falseBranchFn()));
    }
  }

  const x = xOrCond as Interval | IntervalResult;
  const condition = conditionOrTrue as (x: Interval) => BoolInterval;
  const trueBranch = trueOrFalse as (
    x: Interval
  ) => Interval | IntervalResult;
  const falseBranchFn = falseBranch as (
    x: Interval
  ) => Interval | IntervalResult;

  const unwrapped = unwrapOrPropagate(x);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal] = unwrapped;
  const cond = condition(xVal);

  switch (cond) {
    case 'true':
      return toResult(trueBranch(xVal));
    case 'false':
      return toResult(falseBranchFn(xVal));
    case 'maybe':
      // Condition is indeterminate - must evaluate both branches
      // and return their union
      const t = toResult(trueBranch(xVal));
      const f = toResult(falseBranchFn(xVal));
      return unionResults(t, f);
  }
}

/**
 * Clamp an interval to a range.
 *
 * clamp(x, lo, hi) returns x clamped to [lo, hi].
 */
export function clamp(
  x: Interval | IntervalResult,
  lo: Interval | IntervalResult,
  hi: Interval | IntervalResult
): IntervalResult {
  const unwrapped = unwrapOrPropagate(x, lo, hi);
  if (!Array.isArray(unwrapped)) return unwrapped;
  const [xVal, loVal, hiVal] = unwrapped;
  // Use the most restrictive bounds
  const resultLo = Math.max(xVal.lo, loVal.lo);
  const resultHi = Math.min(xVal.hi, hiVal.hi);

  if (resultLo > resultHi) {
    return { kind: 'empty' };
  }

  return { kind: 'interval', value: { lo: resultLo, hi: resultHi } };
}
