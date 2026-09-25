/**
 * The relative tolerance that `rangeCount()` adds to the quotient
 * `(upper − lower) / step` before it takes the floor. It is a fraction of the
 * quotient (plus an absolute part for a quotient near zero).
 */
export const RANGE_COUNT_TOLERANCE = 1e-12;

/**
 * The largest tolerance `rangeCount()` adds to the quotient, in steps. The
 * relative tolerance grows with the quotient, and for a quotient near 10¹² it
 * would reach a whole step: `Range(0, 10⁹ + 0.0002, 0.001)` has a quotient of
 * 10¹² + 0.2 and 10¹² + 1 elements, but a tolerance of 1 would count one
 * more. The cap keeps the tolerance a small fraction of a step for every
 * quotient. It is reached only for a quotient above 10⁹; there, a double
 * holds the quotient to about 10⁻⁴ of a step, and the cap still absorbs that
 * rounding.
 */
export const RANGE_COUNT_TOLERANCE_CAP = 1e-3;

/**
 * Element count of the arithmetic range `lower, lower + step, …` that stops
 * at the last element that is less than or equal to `upper` (greater than or
 * equal to `upper` for a negative step).
 *
 * The quotient `(upper − lower) / step` is computed in floating point. An end
 * point that lies on a grid point in exact arithmetic can fall one unit in the
 * last place short of it: `0.3 / 0.1` is `2.9999999999999996`, and
 * `(2 − 2/500)π ÷ (2π/500)` is `498.99999999999994`. A plain
 * `floor(quotient) + 1` then drops the last element. A tolerance proportional
 * to the quotient (`RANGE_COUNT_TOLERANCE`, that is 10⁻¹² of the quotient)
 * absorbs that rounding, so such an end point is counted. The tolerance is
 * far below one step (it is capped at `RANGE_COUNT_TOLERANCE_CAP`, a
 * thousandth of a step, for a quotient above 10⁹), so a range that stops
 * short of a grid point is unchanged: `Range(0, 2.5, 1)` still has 3
 * elements. The count is never rounded to the nearest integer:
 * `Range(1, 10, 4)` has 3 elements.
 *
 * When `lower`, `upper` and `step` are all integers, the quotient has no
 * rounding error to absorb, and the tolerance is not applied. Without this
 * exception, an integer range with a span above about 10¹² could count one
 * element too many (`Range(0, 3·10¹² − 1, 3)` has 10¹² elements, and the
 * tolerance would add one).
 *
 * - A zero step gives 0.
 * - Otherwise, a NaN operand gives NaN (the bounds are not known
 *   numerically).
 * - A non-finite `lower` or `upper` gives `Infinity`.
 * - A step whose sign does not agree with the direction from `lower` to
 *   `upper` gives 0 (the range is empty).
 *
 * The JavaScript compile target calls this function at run time as the
 * helper `_SYS.rangeCount` (`compilation/javascript-target.ts`). Code emitted
 * for a target without `_SYS` calls a copy, `RANGE_COUNT_JS_SOURCE` (below),
 * and the Python target emits the same formula (`pyRangeCount()` in
 * `compilation/python-target.ts`). Keep the three in agreement.
 */
export function rangeCount(lower: number, upper: number, step: number): number {
  if (step === 0) return 0;
  // `Number(…)`: the compiled JavaScript routes call this function at run
  // time with whatever value the caller supplied, and a missing variable
  // (`undefined`) must read as NaN, as it does in the arithmetic below.
  if (
    Number.isNaN(Number(lower)) ||
    Number.isNaN(Number(upper)) ||
    Number.isNaN(Number(step))
  )
    return NaN;
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return Infinity;
  const q = (upper - lower) / step;
  const tolerance =
    Number.isInteger(lower) && Number.isInteger(upper) && Number.isInteger(step)
      ? 0
      : Math.min(
          RANGE_COUNT_TOLERANCE * (1 + Math.abs(q)),
          RANGE_COUNT_TOLERANCE_CAP
        );
  return Math.max(0, Math.floor(q + tolerance) + 1);
}

/**
 * JavaScript source of a function expression that computes the same value as
 * `rangeCount()`. Emitted code that runs without the `_SYS` runtime helpers
 * (the `interval-javascript` target) calls it as
 * `${RANGE_COUNT_JS_SOURCE}(lo, hi, step)`. The JavaScript target calls
 * `_SYS.rangeCount`, which is `rangeCount()` itself. A test in
 * `test/compute-engine/range-count-tolerance.test.ts` checks that this source
 * and `rangeCount()` agree.
 */
export const RANGE_COUNT_JS_SOURCE =
  '((a,b,s)=>{' +
  'if(s===0)return 0;' +
  'if(Number.isNaN(Number(a))||Number.isNaN(Number(b))||Number.isNaN(Number(s)))return NaN;' +
  'if(!Number.isFinite(a)||!Number.isFinite(b))return Infinity;' +
  'const q=(b-a)/s;' +
  'const t=Number.isInteger(a)&&Number.isInteger(b)&&Number.isInteger(s)' +
  `?0:Math.min(${RANGE_COUNT_TOLERANCE}*(1+Math.abs(q)),${RANGE_COUNT_TOLERANCE_CAP});` +
  'return Math.max(0,Math.floor(q+t)+1);})';
