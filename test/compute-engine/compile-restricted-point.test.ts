/**
 * Arithmetic over a RESTRICTED POINT: `t·P{c}`, the Desmos-style point `P`
 * shown only where the condition `c` holds.
 *
 * `When(PointList(0, 1), c)` is typed `missing | tuple<integer, integer>` and
 * lowers to `c ? [0, 1] : undefined`. The `missing` arm hid the tuple from the
 * type tests that decide whether an operand is an array at run time, so the
 * JavaScript target compiled `t·P{c}` to the scalar `_.t * [0, 1]`, which ran
 * to NaN (Tycho ask 312). A restricted point now broadcasts as a point does,
 * and the shapes the interpreter refuses for a point (the product of two
 * points, a division by a point, a point added to a number) fail closed on
 * every target instead of compiling a component-wise value.
 *
 * Every value case is checked against the INTERPRETER.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

const P = ['PointList', 't', 1];
/** `P` shown only when `1 < t`. */
const gated = (v: unknown = P) => ['When', v, ['Less', 1, 't']];

function run(json: unknown, t: number, to = 'javascript'): unknown {
  const r = compile(ce.box(json as never), { to } as never);
  expect(r.success).toBe(true);
  return r.run!({ t } as never);
}

function interpreted(json: unknown, t: number): number[] {
  return ce
    .box(json as never)
    .subs({ t: ce.number(t) })
    .N()
    .ops!.map((c) => c.re);
}

function declines(json: unknown, to: string): boolean {
  return compile(ce.box(json as never), { to } as never).success === false;
}

describe('A restricted point in arithmetic, JavaScript target', () => {
  test.each([
    [
      'the parsed product',
      't\\operatorname{PointList}(0,1)\\left\\{0<1\\right\\}',
    ],
    [
      'the parsed product with an explicit dot',
      't\\cdot(\\operatorname{PointList}(0,1)\\left\\{0<1\\right\\})',
    ],
  ])('%s broadcasts over the point', (_label, latex) => {
    const expr = ce.parse(latex);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.5 } as never)).toEqual([0, 0.5]);
  });

  test('the product summed with a point', () => {
    const expr = ce.parse(
      't\\operatorname{PointList}(0,1)\\left\\{0<1\\right\\}+\\operatorname{PointList}(t,0)'
    );
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.5 } as never)).toEqual([0.5, 0.5]);
  });

  test.each([
    ['a scalar times the point', ['Multiply', 't', gated()]],
    ['the point divided by a scalar', ['Divide', gated(), 't']],
    ['the negated point', ['Negate', gated()]],
    ['a function of the point', ['Sin', gated()]],
    ['a power of the point', ['Power', gated(), 2]],
    ['the point plus a point', ['Add', gated(), ['PointList', 2, 't']]],
  ])('%s matches the interpreter when the point is present', (_l, json) => {
    expect(run(json, 2)).toEqual(
      interpreted(json, 2).map((x) => expect.closeTo(x, 12))
    );
  });

  test('a scalar times the point is NaN when the point is absent', () => {
    expect(run(['Multiply', 't', gated()], 0.5)).toBeNaN();
  });

  test('the magnitude of the point is its norm', () => {
    expect(run(['Abs', gated()], 2)).toBeCloseTo(Math.sqrt(5), 12);
  });
});

describe('Shapes the interpreter refuses for a restricted point', () => {
  test.each([
    [
      'the product of two points',
      ['Multiply', gated(), gated(['PointList', 2, 't'])],
    ],
    [
      'a restricted point times a point',
      ['Multiply', ['PointList', 2, 't'], gated()],
    ],
    ['a scalar divided by the point', ['Divide', 't', gated()]],
    ['a number plus the point', ['Add', 't', gated()]],
    ['a list times the point', ['Multiply', ['List', 1, 2, 3], gated()]],
    ['an ordering of the point', ['Less', gated(), 3]],
  ])('%s fails closed on JavaScript', (_l, json) => {
    expect(declines(json, 'javascript')).toBe(true);
  });

  test.each([
    [
      'the product of two points',
      ['Multiply', gated(), gated(['PointList', 2, 't'])],
    ],
    [
      'a restricted point times a point',
      ['Multiply', ['PointList', 2, 't'], gated()],
    ],
    ['a scalar divided by the point', ['Divide', 't', gated()]],
    ['a number plus the point', ['Add', 't', gated()]],
    ['a number plus a plain point', ['Add', 't', P]],
  ])('%s fails closed on the shader targets', (_l, json) => {
    expect(declines(json, 'glsl')).toBe(true);
    expect(declines(json, 'wgsl')).toBe(true);
  });

  test.each([
    ['a scalar times the point', ['Multiply', 't', gated()]],
    ['the point divided by a scalar', ['Divide', gated(), 't']],
  ])('%s fails closed on Python', (_l, json) => {
    expect(declines(json, 'python')).toBe(true);
  });

  test('the magnitude of the point is its norm on Python, not a component-wise abs', () => {
    const r = compile(ce.box(['Abs', gated()] as never), {
      to: 'python',
    } as never);
    expect(r.success).toBe(true);
    expect(r.code).toContain('np.linalg.norm');
  });
});

describe('Shader targets keep the supported shapes', () => {
  test.each([
    ['a scalar times the point', ['Multiply', 't', gated()]],
    ['the point divided by a scalar', ['Divide', gated(), 't']],
    ['the point plus a point', ['Add', gated(), ['PointList', 2, 't']]],
    ['two plain points', ['Add', P, ['PointList', 2, 't']]],
  ])('%s compiles', (_l, json) => {
    expect(declines(json, 'glsl')).toBe(false);
    expect(declines(json, 'wgsl')).toBe(false);
  });
});
