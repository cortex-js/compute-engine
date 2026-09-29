import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `Round` at a half rounds AWAY FROM ZERO, at every precision and on every
 * route (user decision, 2026-09-21): `Round(-0.5)` is `-1`, `Round(-1.5)` is
 * `-2`, `Round(0.5)` is `1` and `Round(2.5)` is `3`. JavaScript `Math.round`
 * rounds a half toward `+∞` instead, so no route may call it directly for
 * `Round`.
 *
 * The engine is built inside each test, because the precision of the
 * big-number library is module-global: an engine built at one precision
 * changes the precision of an engine built before it.
 */

/** The four values the decision names, and the two other halves beside them. */
const TIES: [number, number][] = [
  [-0.5, -1],
  [0.5, 1],
  [-1.5, -2],
  [2.5, 3],
  [-2.5, -3],
  [1.5, 2],
];

function engineAt(precision: 'machine' | number): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = precision;
  return ce;
}

describe.each(['machine', 21] as const)('Round at a half (precision %s)', (p) => {
  test('a machine float rounds away from zero', () => {
    const ce = engineAt(p);
    for (const [x, want] of TIES)
      expect([x, ce.box(['Round', x]).evaluate().re]).toEqual([x, want]);
  });

  test('an exact rational rounds away from zero', () => {
    const ce = engineAt(p);
    expect(ce.box(['Round', ['Rational', -1, 2]]).evaluate().re).toBe(-1);
    expect(ce.box(['Round', ['Rational', -3, 2]]).evaluate().re).toBe(-2);
    expect(ce.box(['Round', ['Rational', 1, 2]]).evaluate().re).toBe(1);
    expect(ce.box(['Round', ['Rational', 5, 2]]).evaluate().re).toBe(3);
  });

  test('the precision form rounds a half away from zero too', () => {
    const ce = engineAt(p);
    // `Round(x, n)` is `Round(x·10ⁿ)/10ⁿ`, so the tie of the scaled value
    // follows the same rule: −0.125·100 is −12.5, which rounds to −13.
    expect(ce.box(['Round', -0.125, 2]).evaluate().re).toBeCloseTo(-0.13, 12);
    expect(ce.box(['Round', 0.125, 2]).evaluate().re).toBeCloseTo(0.13, 12);
    expect(ce.box(['Round', -1.25, 1]).evaluate().re).toBeCloseTo(-1.3, 12);
    expect(ce.box(['Round', 1.25, 1]).evaluate().re).toBeCloseTo(1.3, 12);
    // A negative `n` rounds to tens, hundreds, … and follows the same rule:
    // −1250·10⁻² is −12.5, which rounds to −13, hence −1300.
    expect(ce.box(['Round', -1250, -2]).evaluate().re).toBe(-1300);
    expect(ce.box(['Round', 1250, -2]).evaluate().re).toBe(1300);
  });

  test('the sign agrees with the value', () => {
    const ce = engineAt(p);
    expect(ce.box(['Round', -0.5]).sgn).toBe('negative');
    expect(ce.box(['Round', -0.5]).evaluate().re).toBe(-1);
  });
});

describe('Round at a half over a list of machine numbers', () => {
  test('a short list rounds every element away from zero', () => {
    const ce = engineAt('machine');
    const r = ce.box(['Round', ['List', -0.5, 0.5, -1.5, 2.5]]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.map((x) => x.re)).toEqual([-1, 1, -2, 3]);
  });

  test('a list of 200 numbers takes the eager kernel and rounds away from zero', () => {
    const ce = engineAt('machine');
    // Above a hundred elements the list is computed at once on doubles
    // (`machine-broadcast.ts`), which is the route this pins. The first six
    // elements are the halves; the rest are quarters, which no rule ties.
    const values = [
      ...TIES.map(([x]) => x),
      ...Array.from({ length: 194 }, (_, i) => i - 97 + 0.25),
    ];
    ce.declare('L', { value: ce.box(['List', ...values]) });
    const r = ce.box(['Round', 'L']).evaluate();
    expect(r.operator).toBe('List');
    const got = r.ops!.map((x) => x.re);
    expect(got.length).toBe(200);
    expect(got.slice(0, 6)).toEqual(TIES.map(([, want]) => want));
    // Every element answers what the same value answers on its own.
    for (let i = 0; i < values.length; i++)
      expect([values[i], got[i]]).toEqual([
        values[i],
        ce.box(['Round', values[i]]).evaluate().re,
      ]);
  });
});

describe('Round at a half in compiled JavaScript', () => {
  test('the compiled value matches the interpreter', () => {
    const ce = engineAt('machine');
    ce.declare('x', 'real');
    const fn = compile(ce.box(['Round', 'x']));
    expect(fn).not.toBeNull();
    for (const [x, want] of TIES)
      expect([x, fn!.run({ x })]).toEqual([x, want]);
  });

  test('the compiled precision form matches the interpreter', () => {
    const ce = engineAt('machine');
    ce.declare('x', 'real');
    const fn = compile(ce.box(['Round', 'x', 2]));
    expect(fn).not.toBeNull();
    expect(fn!.run({ x: -0.125 })).toBeCloseTo(-0.13, 12);
    expect(fn!.run({ x: 0.125 })).toBeCloseTo(0.13, 12);
    const tens = compile(ce.box(['Round', 'x', -2]));
    expect(tens!.run({ x: -1250 })).toBe(-1300);
  });
});

/**
 * The rounding family answers an EXACT number for a float argument, as in
 * Mathematica (cortex-js/compute-engine#351): `Round(2.5)` is the integer `3`,
 * not the float `3.0`, and `Round(3.14159, 2)` is the rational `157/50`. This
 * is an exception to the rule that a float operand makes a numeric result a
 * float. Under `.N()` the result is a float.
 */
describe('Rounding a float gives an exact result', () => {
  test('the precision form gives an exact rational', () => {
    const ce = engineAt('machine');
    const r = ce.box(['Round', 3.14159, 2]).evaluate();
    expect(r.json).toEqual(['Rational', 157, 50]);
    expect(r.isExact).toBe(true);
    // A negative `n` rounds to hundreds and gives an exact integer.
    const tens = ce.box(['Round', 1234.5, -2]).evaluate();
    expect(tens.json).toBe(1200);
    expect(tens.isExact).toBe(true);
  });

  test('Round, Floor, Ceil and Truncate give exact integers', () => {
    const ce = engineAt('machine');
    const cases: [string, number, number][] = [
      ['Round', 2.5, 3],
      ['Floor', 2.7, 2],
      ['Ceil', 2.2, 3],
      ['Truncate', -2.7, -2],
    ];
    for (const [op, x, want] of cases) {
      const r = ce.box([op, x]).evaluate();
      expect([op, x, r.json, r.isExact]).toEqual([op, x, want, true]);
    }
  });

  test('a big-decimal float rounds to an exact integer', () => {
    const ce = engineAt(30);
    const x = ce.parse('2.5');
    expect(x.isExact).toBe(false);
    const r = ce.box(['Round', x]).evaluate();
    expect(r.json).toBe(3);
    expect(r.isExact).toBe(true);
  });

  test('a large float keeps all its digits', () => {
    const ce = engineAt('machine');
    const r = ce.parse('\\lfloor 10^{20} + 0.5 \\rfloor').evaluate();
    expect(r.isExact).toBe(true);
    expect(r.isSame(ce.number(10n ** 20n))).toBe(true);
    const m = ce.box(['Floor', 1e20]).evaluate();
    expect(m.isExact).toBe(true);
    expect(m.isSame(ce.number(10n ** 20n))).toBe(true);
  });

  test('infinities and NaN are unchanged', () => {
    const ce = engineAt('machine');
    expect(ce.box(['Round', 'PositiveInfinity']).evaluate().json).toBe(
      'PositiveInfinity'
    );
    expect(ce.box(['Round', 'NaN']).evaluate().json).toBe('NaN');
  });

  test('under N the result is a float', () => {
    const ce = engineAt('machine');
    const r = ce.box(['Round', 3.14159, 2]).N();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(3.14, 12);
    expect(ce.box(['Round', 2.5]).N().json).toEqual({ num: '3.0' });
  });
});
