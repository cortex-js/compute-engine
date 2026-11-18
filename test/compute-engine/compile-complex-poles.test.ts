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
  const r = compile(ce.box(json as never), {
    fallback: false,
    mode: 'complex',
  });
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

});

describe('The complex kernels at an exact pole', () => {
  const ZERO = { re: 0, im: 0 };
  test.each([
    ['Cot', '~oo'],
    ['Csc', '~oo'],
    ['Coth', '~oo'],
    ['Csch', '~oo'],
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

