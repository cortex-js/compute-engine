/**
 * Interval arithmetic types for reliable function evaluation
 *
 * @module interval/types
 */

/**
 * A closed interval [lo, hi] representing a range of real numbers.
 *
 * Bounds may be -Infinity or +Infinity for unbounded ranges.
 * Invariant: lo <= hi (empty intervals are represented differently)
 */
export interface Interval {
  /** Lower bound (toward -Infinity), may be -Infinity */
  lo: number;
  /** Upper bound (toward +Infinity), may be +Infinity */
  hi: number;
}

/**
 * Result of an interval operation.
 *
 * Operations return structured results that preserve information for plotting:
 * - `interval`: Normal computation with valid interval
 * - `empty`: No valid values (e.g., ln([-2, -1]))
 * - `entire`: Result spans all reals (-Infinity, +Infinity)
 * - `singular`: Contains pole/asymptote, needs subdivision
 * - `partial`: Valid interval with domain clipping info
 */
export type IntervalResult =
  | { kind: 'interval'; value: Interval }
  | { kind: 'empty' }
  | { kind: 'entire' }
  | { kind: 'singular'; at?: number; continuity?: 'left' | 'right' }
  | { kind: 'partial'; value: Interval; domainClipped: 'lo' | 'hi' | 'both' };

/**
 * Three-valued logic for interval comparisons.
 *
 * - `true`: Definitely true for all values in the intervals
 * - `false`: Definitely false for all values in the intervals
 * - `maybe`: Indeterminate - intervals overlap
 */
export type BoolInterval = 'true' | 'false' | 'maybe';
