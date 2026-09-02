/**
 * Utility functions for interval arithmetic
 *
 * @module interval/util
 */

import type { Interval, IntervalResult } from './types.js';

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
  // A pole on either side (a `singular` with no enclosure) makes the union
  // a pole, before `entire` gets a say: a pole is the sharper report (it
  // asks for subdivision), and this is the precedence the function always
  // had.
  if (
    (a.kind === 'singular' && a.value === undefined) ||
    (b.kind === 'singular' && b.value === undefined)
  )
    return { kind: 'singular' };
  if (a.kind === 'entire' || b.kind === 'entire') {
    return { kind: 'entire' };
  }
  if (a.kind === 'singular' || b.kind === 'singular') {
    // At least one side is a finite jump: the union is bounded by the hull
    // of the two enclosures and stays `singular`, located at the earliest
    // jump of the two.
    const jumps = [a, b].filter(isJump);
    // Neither side is a pole (ruled out above) nor `empty`/`entire`, so both
    // carry an enclosure.
    const aBound = getValue(a)!;
    const bBound = getValue(b)!;
    return {
      ...earliestJump(jumps),
      kind: 'singular',
      value: {
        lo: Math.min(aBound.lo, bBound.lo),
        hi: Math.max(aBound.hi, bBound.hi),
      },
    };
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
 * Extract the enclosure carried by an IntervalResult, if it carries one.
 *
 * `interval` and `partial` results always do; a `singular` result does when
 * it is a finite jump (see `IntervalResult`). Returns undefined for `empty`,
 * `entire` and a pole.
 */
export function getValue(result: IntervalResult): Interval | undefined {
  if (result.kind === 'interval' || result.kind === 'partial') {
    return result.value;
  }
  if (result.kind === 'singular') return result.value;
  return undefined;
}

/**
 * Unwrap an interval from either a plain Interval or an IntervalResult.
 *
 * Used by arithmetic operations to accept both formats for convenience.
 * Returns undefined if the input is an IntervalResult without an enclosure
 * (empty, entire, or a pole).
 */
export function unwrap(input: Interval | IntervalResult): Interval | undefined {
  // Check if it's an IntervalResult
  if ('kind' in input) return getValue(input);
  // Plain interval
  return input;
}

/**
 * Unwrap and propagate errors from IntervalResult inputs.
 *
 * If any input has no enclosure (empty, entire, or a pole), returns that
 * result. Otherwise returns the unwrapped intervals. A finite jump (a
 * `singular` result that carries a `value`) is unwrapped to its enclosure so
 * the operation computes a bound over it; the caller is expected to be
 * wrapped in `liftJump`, which re-tags the operation's result as the same
 * jump.
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
      if (input.kind === 'singular') {
        if (input.value === undefined) return input;
        result.push(input.value);
        continue;
      }
      // interval or partial - extract value
      result.push(input.value);
    } else {
      // Plain interval
      result.push(input);
    }
  }
  return result;
}

/**
 * A `singular` result for a jump discontinuity located at `at`.
 *
 * The result carries `value` as its enclosure only when that enclosure is
 * finite: a `singular` with a `value` promises a BOUNDED function (see
 * `IntervalResult`), so a step function over an infinite input (`floor` over
 * `[-∞, 3]`) is reported as a pole (no `value`) instead.
 */
export function jump(
  at: number | undefined,
  continuity: 'left' | 'right' | undefined,
  value: Interval
): IntervalResult {
  const r: IntervalResult = { kind: 'singular' };
  if (at !== undefined) r.at = at;
  if (continuity !== undefined) r.continuity = continuity;
  if (Number.isFinite(value.lo) && Number.isFinite(value.hi)) r.value = value;
  return r;
}

/** Whether a value is a `singular` result that carries an enclosure (a
 *  finite jump, as opposed to a pole). */
export function isJump(x: unknown): x is {
  kind: 'singular';
  at?: number;
  continuity?: 'left' | 'right';
  value: Interval;
} {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { kind?: unknown }).kind === 'singular' &&
    (x as { value?: unknown }).value !== undefined
  );
}

/**
 * The location of the earliest of several jumps: the smallest defined `at`,
 * with its `continuity` — omitted when two jumps sit at the same point and
 * disagree on the side (`floor(x) + ceil(x)` at an integer is neither
 * left- nor right-continuous).
 */
function earliestJump(
  jumps: ReadonlyArray<{ at?: number; continuity?: 'left' | 'right' }>
): { at?: number; continuity?: 'left' | 'right' } {
  let first: { at?: number; continuity?: 'left' | 'right' } | undefined;
  for (const j of jumps) {
    if (
      first === undefined ||
      (j.at !== undefined && (first.at === undefined || j.at < first.at))
    ) {
      first = { at: j.at, continuity: j.continuity };
    } else if (j.at === first.at && j.continuity !== first.continuity) {
      first = { at: first.at };
    }
  }
  const r: { at?: number; continuity?: 'left' | 'right' } = {};
  if (first?.at !== undefined) r.at = first.at;
  if (first?.continuity !== undefined) r.continuity = first.continuity;
  return r;
}

/**
 * Make an interval operation propagate a finite jump.
 *
 * `unwrapOrPropagate` hands an operation the ENCLOSURE of a jump operand, so
 * the operation answers a plain `interval` computed over that enclosure — a
 * sound bound, but one that has forgotten the discontinuity. This wrapper
 * restores it: when any operand was a jump and the operation answered a
 * finite, non-constant `interval`, the result is re-tagged `singular` with
 * the operation's bound as its `value`, located at the earliest jump among
 * the operands (`earliestJump`). Every other answer is returned as is:
 * - `empty`, `entire` and `singular` were computed over the enclosure, so
 *   they already account for every value the jump can take, and a
 *   `singular` answer is a discontinuity the operation found on its own;
 * - a `partial` keeps its domain-clip marker, which a `singular` cannot
 *   carry (`sqrt(sign(x))` across 0 is clipped below, and `integrate` reads
 *   that marker) — the jump is the information given up there;
 * - a point result (`floor(x)^0`) means the operation is constant over the
 *   whole enclosure, so there is no discontinuity to report;
 * - a non-finite bound is not a finite jump. It is returned untouched rather
 *   than degraded to a pole, so the collection accessors' absence marker (a
 *   bare `{ lo: NaN, hi: NaN }`, see `collections.ts`) survives an absent
 *   `at(list, floor(x))`, and a division that reaches an infinite bound
 *   keeps the `partial` shape `div` gives it.
 *
 * Every exported operation that takes interval operands and returns an
 * `IntervalResult` is wrapped, so a jump survives an arbitrary expression
 * tree: `2·floor(x) + 1` over `[0.5, 1.5]` is `singular` with
 * `value: [1, 3]`. Operands that are not interval results (a number
 * exponent, a callback, a collection) pass through untouched.
 */
export function liftJump<F extends (...args: never[]) => unknown>(fn: F): F {
  const raw = fn as unknown as (...a: unknown[]) => unknown;
  const lifted = (...args: unknown[]) => {
    const jumps = args.filter(isJump);
    const result = raw(...args);
    if (jumps.length === 0) return result;
    if (typeof result !== 'object' || result === null) return result;
    // A bare `{ lo, hi }` (the collection accessors answer one) or an
    // `interval` result: both carry the bound to re-tag.
    const r = result as Partial<Interval> & { kind?: string; value?: Interval };
    const bound: Interval | undefined =
      r.kind === undefined
        ? (r as Interval)
        : r.kind === 'interval'
          ? r.value
          : undefined;
    if (bound === undefined) return result;
    if (!Number.isFinite(bound.lo) || !Number.isFinite(bound.hi)) return result;
    if (bound.lo === bound.hi) return result;
    return { ...earliestJump(jumps), kind: 'singular', value: bound };
  };
  return lifted as unknown as F;
}
