/**
 * A rounding function (`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`) whose
 * operand adds an integer-typed variable to an exact constant that no double
 * holds.
 *
 * The compiled code computes the constant as a double, and the rounding can
 * go to the other side of the jump: the double of `c = (25! − 1)/24!` is
 * 25.0, so `Floor(k + c)` at `k = 1` is `Math.floor(1 + 25)`, 26, where the
 * exact value is 25. This is a recorded limitation of compiled code
 * (`docs/COMPILATION-MODEL.md`, known limitations); the tests below keep the
 * cases where the value is the interpreter's.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('n', 'integer');

const box = (json: unknown) => ce.box(json as Parameters<typeof ce.box>[0]);

// (25! + s)/24! = 25 + s/24!: a value just next to 25 whose double is 25.0.
const near = (s: number) => [
  'Divide',
  ['Add', ['Factorial', 25], s],
  ['Factorial', 24],
];
const nearInt = near(-1);

const sumOf = (head: string, lo: number, hi: number) =>
  box([
    'Sum',
    ['Multiply', 'x', [head, ['Add', 'k', nearInt]]],
    ['Limits', 'k', lo, hi],
  ]);

/** The interpreter's value of `expr` at `x = 1`. */
const interpreted = (expr: ReturnType<typeof box>) =>
  expr.subs({ x: 1 }).N().re;

describe('Sum of a rounding of a loop index plus an exact constant', () => {

  // `Floor`, `Truncate` and `Fract` take the jump of the nearest double of
  // the constant: a recorded limitation (`docs/COMPILATION-MODEL.md`).
  test.each(['Ceil', 'Round'])(
    '%s, unrolled and loop forms, with negative indices',
    (head) => {
      for (const hi of [3, 300]) {
        const e = sumOf(head, -40, hi);
        const r = compile(e, { fallback: false });
        expect(r.run?.({ x: 1 })).toBe(interpreted(e));
      }
    }
  );

});

describe('Rounding of an integer-typed variable plus an exact constant', () => {

  test('Truncate is not shifted across zero', () => {
    // Truncate(−3 + c) for c just above 1/2 is −2; −3 + Truncate(c) is −3.
    const c = ['Add', ['Rational', 1, 2], ['Divide', 1, ['Factorial', 24]]];
    const r = compile(box(['Truncate', ['Add', 'n', c]]), { fallback: false });
    expect(r.run?.({ n: -3 })).toBe(-2);
    expect(r.run?.({ n: 3 })).toBe(3);
  });

});

describe('A shape with a variable that is not an integer keeps its structural code', () => {

  test('the double of the constant can move the jump', () => {
    // The double of (25! − 1)/24! is 25.0. The interpreter gives
    // Floor(1 + 25 − 1/24!) = 25; the compiled code gives Math.floor(26).
    const e = box(['Floor', ['Add', 'x', nearInt]]);
    expect(interpreted(e)).toBe(25);
    expect(compile(e, { fallback: false }).run?.({ x: 1 })).toBe(26);
  });
});

describe('The structural code is kept', () => {

  test('on the interval target, whose code computes an enclosure', () => {
    const r = compile(box(['Floor', ['Add', 'n', nearInt]]), {
      to: 'interval-js',
    });
    expect(String(r.code)).toMatch(/_IA\.floor\(/);
  });
});

