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
 * - `singular`: Contains a discontinuity, needs subdivision. Two cases share
 *   the kind, told apart by the presence of `value`:
 *   - A POLE (no `value`): the function is unbounded on the input, e.g.
 *     `1/x` over `[-1, 1]`. There is no finite enclosure.
 *   - A finite JUMP (`value` present): the function is bounded on the input
 *     but not continuous, e.g. `floor(x)` over `[0.5, 1.5]`. `value` is a
 *     sound enclosure of every value the function takes on the input
 *     (`[0, 1]` for that example), so a consumer that only needs a bound —
 *     an implicit-curve sign test, a range estimate — can use it and keep
 *     refining, while a consumer that draws the curve still sees the break.
 *   `at` locates the first discontinuity in the input's coordinate and
 *   `continuity` says which side the value at `at` belongs to. Both are
 *   given when the operation knows them.
 *   Every operation propagates a jump: `floor(x) - 3` over `[0.5, 1.5]` is
 *   `singular` with `value: [-3, -2]`, still carrying floor's `at`.
 * - `partial`: Valid interval with domain clipping info
 */
export type IntervalResult =
  | { kind: 'interval'; value: Interval }
  | { kind: 'empty' }
  | { kind: 'entire' }
  | {
      kind: 'singular';
      at?: number;
      continuity?: 'left' | 'right';
      value?: Interval;
    }
  | { kind: 'partial'; value: Interval; domainClipped: 'lo' | 'hi' | 'both' };

/**
 * Three-valued logic for interval comparisons.
 *
 * - `true`: Definitely true for all values in the intervals
 * - `false`: Definitely false for all values in the intervals
 * - `maybe`: Indeterminate - intervals overlap
 */
export type BoolInterval = 'true' | 'false' | 'maybe';
