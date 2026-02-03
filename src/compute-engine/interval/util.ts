/**
 * Utility functions for interval arithmetic
 *
 * @module interval/util
 */

import type { Interval, IntervalResult } from './types';

/**
 * Wrap a plain interval in an IntervalResult.
 *
 * This is the standard way to return successful interval results.
 */
export function ok(value: Interval): IntervalResult {
  return { kind: 'interval', value };
}

/**
 * Create a point interval from a single number.
 *
 * A point interval [n, n] represents the exact value n.
 */
export function point(n: number): Interval {
  return { lo: n, hi: n };
}

/**
 * Check if an interval contains a periodic extremum.
 *
 * Given an interval [x.lo, x.hi], checks if any point of the form
 * `extremum + n * period` (for some integer n) lies within the interval.
 *
 * Uses inclusive bounds with small epsilon tolerance for floating-point edge cases.
 *
 * @param x - The interval to check
 * @param extremum - The base extremum point (e.g., PI/2 for sin's maximum)
 * @param period - The period of the function (e.g., 2*PI for sin)
 * @returns true if the interval contains an extremum
 */
export function containsExtremum(
  x: Interval,
  extremum: number,
  period: number
): boolean {
  // Find the smallest candidate >= x.lo
  const n = Math.ceil((x.lo - extremum) / period);
  const candidate = extremum + n * period;
  // Epsilon tolerance for floating-point edge cases
  const EPS = 1e-15;
  // Inclusive check: candidate in [x.lo, x.hi]
  return candidate >= x.lo - EPS && candidate <= x.hi + EPS;
}

/**
 * Compute the union (hull) of two interval results.
 *
 * The result contains all values that could result from either input.
 * Used for piecewise functions when the condition is indeterminate.
 */
export function unionResults(
  a: IntervalResult,
  b: IntervalResult
): IntervalResult {
  // Handle special cases
  if (a.kind === 'empty') return b;
  if (b.kind === 'empty') return a;
  if (a.kind === 'singular' || b.kind === 'singular') {
    return { kind: 'singular' };
  }
  if (a.kind === 'entire' || b.kind === 'entire') {
    return { kind: 'entire' };
  }

  // Extract values and domain clip info
  const aVal = a.value;
  const bVal = b.value;
  const aDomainClip = a.kind === 'partial' ? a.domainClipped : null;
  const bDomainClip = b.kind === 'partial' ? b.domainClipped : null;

  const value = {
    lo: Math.min(aVal.lo, bVal.lo),
    hi: Math.max(aVal.hi, bVal.hi),
  };

  // Merge domain clipping info
  if (aDomainClip || bDomainClip) {
    const domainClipped = mergeDomainClip(aDomainClip, bDomainClip);
    return { kind: 'partial', value, domainClipped };
  }

  return { kind: 'interval', value };
}

/**
 * Merge two domain clip indicators.
 *
 * Returns the combined clip indicator when both branches
 * have domain restrictions.
 */
export function mergeDomainClip(
  a: 'lo' | 'hi' | 'both' | null,
  b: 'lo' | 'hi' | 'both' | null
): 'lo' | 'hi' | 'both' {
  if (a === 'both' || b === 'both') return 'both';
  if (a === null) return b!;
  if (b === null) return a;
  if (a === b) return a;
  return 'both'; // 'lo' + 'hi' = 'both'
}

/**
 * Check if an interval is a point interval (lo === hi).
 */
export function isPoint(x: Interval): boolean {
  return x.lo === x.hi;
}

/**
 * Check if an interval contains zero.
 */
export function containsZero(x: Interval): boolean {
  return x.lo <= 0 && x.hi >= 0;
}

/**
 * Check if an interval is entirely positive (lo > 0).
 */
export function isPositive(x: Interval): boolean {
  return x.lo > 0;
}

/**
 * Check if an interval is entirely negative (hi < 0).
 */
export function isNegative(x: Interval): boolean {
  return x.hi < 0;
}

/**
 * Check if an interval is entirely non-negative (lo >= 0).
 */
export function isNonNegative(x: Interval): boolean {
  return x.lo >= 0;
}

/**
 * Check if an interval is entirely non-positive (hi <= 0).
 */
export function isNonPositive(x: Interval): boolean {
  return x.hi <= 0;
}

/**
 * Get the width of an interval.
 */
export function width(x: Interval): number {
  return x.hi - x.lo;
}

/**
 * Get the midpoint of an interval.
 */
export function midpoint(x: Interval): number {
  return (x.lo + x.hi) / 2;
}

/**
 * Extract the interval value from an IntervalResult if available.
 *
 * Returns undefined for empty, entire, or singular results.
 */
export function getValue(result: IntervalResult): Interval | undefined {
  if (result.kind === 'interval' || result.kind === 'partial') {
    return result.value;
  }
  return undefined;
}

/**
 * Unwrap an interval from either a plain Interval or an IntervalResult.
 *
 * Used by arithmetic operations to accept both formats for convenience.
 * Returns undefined if the input is an IntervalResult without a valid interval
 * (empty, entire, or singular).
 */
export function unwrap(input: Interval | IntervalResult): Interval | undefined {
  // Check if it's an IntervalResult
  if ('kind' in input) {
    if (input.kind === 'interval' || input.kind === 'partial') {
      return input.value;
    }
    return undefined;
  }
  // Plain interval
  return input;
}

/**
 * Unwrap and propagate errors from IntervalResult inputs.
 *
 * If any input is an error result (empty, entire, singular), returns that error.
 * Otherwise returns the unwrapped intervals.
 */
export function unwrapOrPropagate(
  ...inputs: Array<Interval | IntervalResult>
): Interval[] | IntervalResult {
  const result: Interval[] = [];
  for (const input of inputs) {
    if ('kind' in input) {
      // It's an IntervalResult
      if (input.kind === 'empty') return { kind: 'empty' };
      if (input.kind === 'entire') return { kind: 'entire' };
      if (input.kind === 'singular') return input;
      // interval or partial - extract value
      result.push(input.value);
    } else {
      // Plain interval
      result.push(input);
    }
  }
  return result;
}
