/**
 * On `interval-js`, the run-time range `_IA.range` answered `entire` for
 * every bound that is not a point interval. A bound that inexact interval
 * arithmetic computes is such a wide interval even at a point input: at
 * `n = 1`, `n/3` is the enclosure of 1/3, one ulp wide on each side. So
 * `Loop(c ≔ c + k, k ∈ Range(n/3, 5))` gave `entire`, where the interpreter
 * gives 11.67. Now a range has an array value when its element count is the
 * same for every value inside the bounds (`knownRangeCount` in
 * `interval/collections.ts`), and each element encloses `lo + i·step`. When
 * the count can change inside the bounds, the answer is still `entire`.
 */

import { IntervalArithmetic } from '../../src/compute-engine/interval/index';

const range = IntervalArithmetic.range as (...bounds: unknown[]) => unknown;
const pt = (v: number) => ({ lo: v, hi: v });

describe('_IA.range at run time', () => {
  test('one operand: Range(hi) is Range(1, hi), with the same direction rule', () => {
    // The interpreter's `literalRange`: `Range(0)` is the range [1, 0].
    expect(range(0)).toEqual([pt(1), pt(0)]);
    expect(range(3)).toEqual([pt(1), pt(2), pt(3)]);
    // Every value in [0.1, 0.2] is below 1: the step is −1.
    expect(range({ lo: 0.1, hi: 0.2 })).toEqual([pt(1)]);
  });

  test('an element that floating point rounds is an enclosure', () => {
    // The interpreter computes this integer range exactly: its fourth
    // element is -13510798882111492 + 3 · 4503599627370497 = -1. In
    // floating point, 3 · 4503599627370497 rounds, and gives 0.
    const result = range(
      -13510798882111492,
      { lo: 2333333333333333, hi: 2333333333333334 },
      4503599627370497
    ) as Array<{ lo: number; hi: number }>;
    expect(result).toHaveLength(4);
    expect(result[3].lo).toBeLessThanOrEqual(-1);
    expect(result[3].hi).toBeGreaterThanOrEqual(-1);
  });

  test('a partial or singular bound gives entire', () => {
    // A range element cannot carry the flag of such a bound.
    expect(
      range(1, { kind: 'partial', value: pt(3), domainClipped: 'lo' })
    ).toEqual({ kind: 'entire' });
    expect(
      range(1, { kind: 'singular', value: { lo: 2, hi: 3 }, at: 2.5 })
    ).toEqual({ kind: 'entire' });
    expect(range(1, { kind: 'interval', value: pt(3) })).toEqual([
      pt(1),
      pt(2),
      pt(3),
    ]);
  });
});
