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

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic } from '../../src/compute-engine/interval/index';

const range = IntervalArithmetic.range as (...bounds: unknown[]) => unknown;
const pt = (v: number) => ({ lo: v, hi: v });

const third = ['Divide', 'n', 3];

/** `c ≔ 0; Loop(c ≔ c + k, k ∈ range); c` */
function sumLoop(range: unknown) {
  return [
    'Block',
    ['Assign', 'c', 0],
    ['Loop', ['Assign', 'c', ['Add', 'c', 'k']], ['Element', 'k', range]],
    'c',
  ];
}

function run(json: unknown, n: number) {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  const result = compile(ce.box(json as any), { to: 'interval-js' });
  expect(result.success).toBe(true);
  return result.run!({ n }) as any;
}

/** The numeric value of the interpreter at `n`. */
function interpret(json: unknown, n: number): number | number[] {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.assign('n', n);
  const value = ce.box(json as any).evaluate().N();
  return value.isCollection ? [...value.each()].map((x) => x.re) : value.re;
}

function expectEncloses(iv: { lo: number; hi: number }, x: number) {
  expect(iv.lo).toBeLessThanOrEqual(x);
  expect(iv.hi).toBeGreaterThanOrEqual(x);
}

describe('interval-js: a Range with a wide computed bound', () => {
  test('a wide upper bound with a known count gives point elements', () => {
    const json = sumLoop(['Range', 1, ['Multiply', 10, third]]);
    expect(interpret(json, 1)).toBe(6);
    expect(run(json, 1)).toEqual({ kind: 'interval', value: { lo: 6, hi: 6 } });
  });

  test('a wide lower bound gives enclosures of the interpreter values', () => {
    const json = sumLoop(['Range', third, 5]);
    const expected = interpret(json, 1) as number;
    const result = run(json, 1);
    expect(result.kind).toBe('interval');
    expectEncloses(result.value, expected);
  });

  test('Comprehension: each element encloses the interpreter element', () => {
    const json = ['Comprehension', 'k', ['Element', 'k', ['Range', third, 3]]];
    const expected = interpret(json, 1) as number[];
    const result = run(json, 1);
    expect(result).toHaveLength(expected.length);
    expected.forEach((x, i) => {
      expect(result[i].kind).toBe('interval');
      expectEncloses(result[i].value, x);
    });
  });

  test('a two-operand range whose direction is known counts down', () => {
    // Range(1, 1/3): the step is -1, and the one element is 1.
    const json = sumLoop(['Range', 1, third]);
    expect(interpret(json, 1)).toBe(1);
    expect(run(json, 1)).toEqual({ kind: 'interval', value: { lo: 1, hi: 1 } });
  });

  test('a count that can change inside the bounds gives entire', () => {
    // 2 / (1/3) is 6, near a whole number: the count is 6 or 7 inside the
    // enclosure of the step.
    expect(run(sumLoop(['Range', 0, 2, third]), 1)).toEqual({
      kind: 'entire',
    });
    // The two enclosures overlap, so the direction is not known.
    expect(run(sumLoop(['Range', third, third]), 1)).toEqual({
      kind: 'entire',
    });
  });
});

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
