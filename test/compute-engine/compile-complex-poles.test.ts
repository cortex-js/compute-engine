/**
 * The compiled COMPLEX lane of the JavaScript target at a POLE, and a
 * broadcast head over a list that MIXES complex and real cells.
 *
 * The interpreter answers the unsigned pole `~oo` (`ComplexInfinity`) for
 * `1 / (0·i)`, `+∞` for its absolute value, and `0` for its reciprocal. The
 * compiled complex lane spells `~oo` as `{ re: ∞, im: ∞ }`. Its quotient
 * formula and several kernels of the complex library answered `NaN`, or a
 * signed infinity, at those points.
 *
 * An element-wise `Which` with a complex arm beside a real one answers a list
 * whose cells are `{ re, im }` objects at some positions and plain numbers at
 * the others. `Add`, `Subtract`, `Multiply` and `Negate` read such a list
 * through run-time dispatching helpers; every other head declined. It now
 * reads each cell through `_SYS.cplx`.
 *
 * Both were found on the Tycho corpus document `s8ishknvhe`, a stereographic
 * projection of a list of points, which reaches a pole at every point with
 * z = 0. Every value is checked against the INTERPRETER.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('z', 'complex');
ce.declare('L', 'list<number>');
ce.declare('Z', 'list<complex>');
ce.declare('C', 'list<tuple<number, number, number>>');

type Cell = number | { re: number; im: number };

function run(json: unknown, vars: Record<string, unknown>): unknown {
  const r = compile(ce.box(json as never), { fallback: false });
  expect(r.success).toBe(true);
  return r.run!(vars as never);
}

/** The interpreter's value, as a number, `'~oo'`, or a `[re, im]` pair. */
function interpreted(json: unknown, bindings: Record<string, unknown>) {
  const value = ce
    .box(json as never)
    .subs(
      Object.fromEntries(
        Object.entries(bindings).map(([k, v]) => [k, ce.box(v as never)])
      )
    )
    .N();
  const read = (e: typeof value): unknown => {
    if (e.operator === 'List' || e.operator === 'Tuple')
      return e.ops!.map(read);
    const [re, im] = [e.re, e.im ?? 0];
    if (im !== 0 && (Math.abs(re) === Infinity || Math.abs(im) === Infinity))
      return '~oo';
    return im !== 0 ? [re, im] : re;
  };
  return read(value);
}

/** A compiled cell in the same spelling as {@link interpreted}. */
function spelled(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(spelled);
  if (typeof v === 'number') return v;
  const c = v as { re: number; im: number };
  if (Math.abs(c.re) === Infinity || Math.abs(c.im) === Infinity)
    return c.im !== 0 ? '~oo' : c.re;
  return c.im === 0 ? c.re : [c.re, c.im];
}

const I_TIMES = (a: unknown) => ['Multiply', 'ImaginaryUnit', a];

describe('A compiled complex quotient at a pole', () => {
  test.each([
    ['1 / (i·x)', ['Divide', 1, I_TIMES('x')]],
    ['(i·x)⁻¹', ['Power', I_TIMES('x'), -1]],
    ['(2 + i) / (i·x)', ['Divide', ['Complex', 2, 1], I_TIMES('x')]],
  ])('%s at x = 0 is the unsigned pole', (_label, json) => {
    expect(spelled(run(json, { x: 0 }))).toBe('~oo');
    expect(interpreted(json, { x: 0 })).toBe('~oo');
  });

  test('0 / 0 stays NaN', () => {
    const json = ['Divide', I_TIMES('x'), I_TIMES('y')];
    const got = run(json, { x: 0, y: 0 }) as Cell;
    expect(typeof got === 'number' ? got : got.re).toBeNaN();
    expect(interpreted(json, { x: 0, y: 0 })).toBeNaN();
  });

  test.each([
    ['|1 / (i·x)|', ['Abs', ['Divide', 1, I_TIMES('x')]], Infinity],
    ['1 / (1 / (i·x))', ['Divide', 1, ['Divide', 1, I_TIMES('x')]], 0],
    [
      '1 / (1 / (i·x) + 1)',
      ['Divide', 1, ['Add', ['Divide', 1, I_TIMES('x')], 1]],
      0,
    ],
  ])('%s at x = 0', (_label, json, want) => {
    expect(spelled(run(json, { x: 0 }))).toBe(want);
    expect(interpreted(json, { x: 0 })).toBe(want);
  });

  test('away from the pole the quotient is unchanged', () => {
    const json = ['Divide', ['Complex', 2, 1], I_TIMES('x')];
    expect(run(json, { x: 2 })).toEqual({ re: 0.5, im: -1 });
    expect(interpreted(json, { x: 2 })).toEqual([0.5, -1]);
  });

  test.each([
    ['large', 1e200, 5e-201],
    ['small', 1e-200, 5e199],
  ])('a very %s finite divisor is not a pole', (_label, x, part) => {
    // The squares of the divisor's parts overflow to `∞` or underflow to
    // `0`, the two values the pole case tests for, but `1 / (x + i·x)` is
    // the ordinary number `(1 − i) / (2x)`.
    const json = ['Divide', 1, ['Add', 'x', I_TIMES('x')]];
    const got = run(json, { x }) as { re: number; im: number };
    expect(got.re / part).toBeCloseTo(1, 12);
    expect(got.im / part).toBeCloseTo(-1, 12);
  });

  test('a list of divisors is answered cell by cell', () => {
    const json = ['Abs', ['Power', I_TIMES('L'), -1]];
    expect(run(json, { L: [0, 2] })).toEqual([Infinity, 0.5]);
    expect(interpreted(json, { L: ['List', 0, 2] })).toEqual([Infinity, 0.5]);
  });
});

describe('The complex kernels at an exact pole', () => {
  const ZERO = { re: 0, im: 0 };
  test.each([
    ['Cot', '~oo'],
    ['Csc', '~oo'],
    ['Coth', Infinity],
    ['Csch', Infinity],
    ['Arsech', Infinity],
  ])('%s(z) at z = 0', (head, want) => {
    expect(spelled(run([head, 'z'], { z: ZERO }))).toBe(want);
    expect(interpreted([head, 0], {})).toBe(want);
  });

  test.each([['Arcsec'], ['Arccsc']])('%s(z) at z = 0 is NaN', (head) => {
    const got = run([head, 'z'], { z: ZERO }) as Cell;
    expect(typeof got === 'number' ? got : got.re).toBeNaN();
    expect(interpreted([head, 0], {})).toBeNaN();
  });

  test.each([
    [-2, '~oo'],
    [-1, '~oo'],
    [-0.5, '~oo'],
    [2, 0],
    [0.5, 0],
  ])('z^%p at z = 0', (exponent, want) => {
    expect(spelled(run(['Power', 'z', exponent], { z: ZERO }))).toBe(want);
    expect(interpreted(['Power', 0, exponent], {})).toBe(want);
  });

  test.each([
    ['i', ['Complex', 0, 1]],
    ['-1 + i', ['Complex', -1, 1]],
  ])('z^(%s) at z = 0 is NaN', (_label, exponent) => {
    const got = run(['Power', 'z', exponent], { z: ZERO }) as Cell;
    expect(typeof got === 'number' ? got : got.re).toBeNaN();
    expect(interpreted(['Power', 0, exponent], {})).toBeNaN();
  });

  test('z^y at z = 0 and y = 0 is NaN', () => {
    // A literal exponent `0` is folded to `1` before the compiler sees it.
    const got = run(['Power', 'z', 'y'], { z: ZERO, y: 0 }) as Cell;
    expect(typeof got === 'number' ? got : got.re).toBeNaN();
    expect(interpreted(['Power', 0, 0], {})).toBeNaN();
  });

  test('the argument of the unsigned pole is NaN', () => {
    const json = ['Argument', ['Divide', 1, I_TIMES('x')]];
    expect(run(json, { x: 0 })).toBeNaN();
    expect(interpreted(json, { x: 0 })).toBeNaN();
  });
});

describe('A broadcast head over a list of mixed complex and real cells', () => {
  // Complex where `0 < L`, the real `0` elsewhere.
  const MIXED = ['Which', ['Less', 0, 'L'], I_TIMES('L'), 'True', 0];
  const AT = { L: [2, -3, 0.5] };
  const BOUND = { L: ['List', 2, -3, 0.5] };

  test('the selection itself keeps its mixed cells', () => {
    expect(run(MIXED, AT)).toEqual([{ re: 0, im: 2 }, 0, { re: 0, im: 0.5 }]);
  });

  test.each([
    ['Abs', ['Abs', MIXED]],
    ['Real', ['Real', MIXED]],
    ['Imaginary', ['Imaginary', MIXED]],
    ['Divide', ['Divide', MIXED, ['Add', ['Power', ['Abs', MIXED], 2], 1]]],
    ['Exp', ['Exp', MIXED]],
    ['Sqrt', ['Sqrt', MIXED]],
    ['Sign', ['Sign', MIXED]],
  ])('%s agrees with the interpreter', (_label, json) => {
    const got = spelled(run(json, AT)) as unknown[];
    const want = interpreted(json, BOUND) as unknown[];
    expect(got).toHaveLength(want.length);
    got.forEach((cell, k) => {
      const [gr, gi] = Array.isArray(cell) ? cell : [cell, 0];
      const w = want[k];
      const [wr, wi] = Array.isArray(w) ? w : [w, 0];
      expect(gr).toBeCloseTo(wr as number, 12);
      expect(gi).toBeCloseTo(wi as number, 12);
    });
  });

  test.each([
    ['Add over Sin', ['Add', ['Sin', 'Z'], 1]],
    ['Multiply over Sign', ['Multiply', 2, ['Sign', 'Z']]],
    ['Sqrt over Sin', ['Sqrt', ['Sin', 'Z']]],
    ['Abs over Divide', ['Abs', ['Divide', 'Z', 'y']]],
    ['Exp over Divide over Sin', ['Exp', ['Divide', ['Sin', 'Z'], 'y']]],
  ])('%s: a head over the result of another agrees with the interpreter', (_label, json) => {
    // The result of a head over a `list<complex>` symbol is itself a list of
    // cells of either shape, so the enclosing head must read it the same way.
    const cells = [{ re: 1, im: 2 }, 3, { re: 0, im: -0.5 }];
    const got = spelled(run(json, { Z: cells, y: 2 })) as unknown[];
    const want = interpreted(json, {
      Z: ['List', ['Complex', 1, 2], 3, ['Complex', 0, -0.5]],
      y: 2,
    }) as unknown[];
    expect(got).toHaveLength(want.length);
    got.forEach((cell, k) => {
      const [gr, gi] = Array.isArray(cell) ? cell : [cell, 0];
      const w = want[k];
      const [wr, wi] = Array.isArray(w) ? w : [w, 0];
      expect(gr).toBeCloseTo(wr as number, 12);
      expect(gi).toBeCloseTo(wi as number, 12);
    });
  });

  test('a real-only head keeps its rule: NaN at a complex cell', () => {
    // `Floor` has no complex lowering. Its operand is projected onto the real
    // numbers before the head is applied, as it was before the mixed operand
    // compiled elsewhere; the interpreter reports an error at those cells.
    const got = run(['Floor', MIXED], AT) as number[];
    expect(got[0]).toBeNaN();
    expect(got[1]).toBe(0);
    expect(got[2]).toBeNaN();
  });
});

describe('The stereographic projection of a list of points', () => {
  const X = ['PointX', 'C'];
  const Y = ['PointY', 'C'];
  const Z = ['PointZ', 'C'];
  // w = conj(z / (x + i·y)), or 0 or ~oo on the axis x = y = 0.
  const W = [
    'Which',
    ['Less', 0, ['Add', ['Abs', Y], ['Abs', X]]],
    ['Conjugate', ['Divide', Z, ['Add', I_TIMES(Y), X]]],
    'True',
    ['Which', ['Equal', Z, 0], 0, 'True', 'ComplexInfinity'],
  ];
  const MODULUS_SQUARED = ['Power', ['Abs', W], 2];
  const PROJECTION = [
    'Which',
    ['Less', 0, ['Abs', ['Power', W, -1]]],
    [
      'PointList',
      ['Real', ['Divide', W, ['Add', MODULUS_SQUARED, 1]]],
      ['Imaginary', ['Divide', W, ['Add', MODULUS_SQUARED, 1]]],
      ['Power', ['Add', ['Power', MODULUS_SQUARED, -1], 1], -1],
    ],
    'True',
    ['PointList', 0, 0, 1],
  ];
  const POINTS = [
    [0.3, -0.4, 0.5],
    [1, 2, -3],
    // z = 0: w is 0, its reciprocal is the pole.
    [-0.5, 0.25, 0],
    [2, 0, 0],
    // The axis x = y = 0.
    [0, 0, 0],
    [0, 0, 2],
    [0, 0, -1],
    [0, -3, 1e-3],
  ];

  test('compiles, and agrees with the interpreter at the poles', () => {
    const got = run(PROJECTION, { C: POINTS }) as number[][];
    const want = interpreted(PROJECTION, {
      C: ['List', ...POINTS.map((p) => ['Tuple', ...p])],
    }) as number[][];
    expect(got).toHaveLength(POINTS.length);
    got.forEach((point, i) =>
      point.forEach((c, k) => expect(c).toBeCloseTo(want[i][k], 12))
    );
  });
});
