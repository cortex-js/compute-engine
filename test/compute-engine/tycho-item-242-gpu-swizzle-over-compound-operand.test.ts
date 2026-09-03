/**
 * A shader swizzle over a COMPOUND operand is parenthesized.
 *
 * The GPU `PointX`/`PointY`/`PointZ` (and `First`/`Second`/`Third`) lowerings
 * spliced `.x` onto the operand's emission, so an infix sum bound the read to
 * its LAST term: `PointX((x, y) + (1, 2))` emitted `vec2(x, y) + vec2(1.0,
 * 2.0).x` — legal GLSL (a float broadcasts into a `vec2`) that computes
 * `(x + 1, y + 1)` behind `success: true` (Tycho item 242). A bare
 * identifier, a literal, or a single constructor call keeps the direct suffix.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('x', 'number');
ce.declare('y', 'number');

function code(latex: string, to: 'glsl' | 'wgsl'): string {
  const r = compile(ce.parse(latex), { to });
  expect(r.success).toBe(true);
  return r.code!;
}

describe('a component read over a sum of points', () => {
  test('the minimal shape', () => {
    expect(code('\\mathrm{PointX}\\left(\\left(x,y\\right)+\\left(1,2\\right)\\right)', 'glsl')).toBe(
      '(vec2(x, y) + vec2(1.0, 2.0)).x'
    );
    expect(code('\\mathrm{PointX}\\left(\\left(x,y\\right)+\\left(1,2\\right)\\right)', 'wgsl')).toBe(
      '(vec2f(x, y) + vec2f(1.0, 2.0)).x'
    );
  });

  test('the Desmos rotation: scaled points summed, then read', () => {
    expect(
      code(
        '\\mathrm{PointY}\\left(y\\cdot\\left(0.9,-0.4\\right)+x\\cdot\\left(-0.4,-0.9\\right)+\\left(-0.08,0\\right)\\right)',
        'glsl'
      )
    ).toBe('(x * vec2(-0.4, -0.9) + y * vec2(0.9, -0.4) + vec2(-0.08, 0.0)).y');
  });

  test('a scaled point and a negated sum', () => {
    expect(code('\\mathrm{PointX}\\left(2\\left(x,y\\right)\\right)', 'glsl')).toBe(
      '(2.0 * vec2(x, y)).x'
    );
    expect(
      code('\\mathrm{PointY}\\left(-\\left(\\left(x,y\\right)+\\left(1,2\\right)\\right)\\right)', 'glsl')
    ).toBe('(-(vec2(x, y) + vec2(1.0, 2.0))).y');
  });

  test('First/Second/Third over a sum', () => {
    const e = ['Second', ['Add', ['Tuple', 'x', 'y'], ['Tuple', 1, 2]]];
    const r = compile(ce.box(e), { to: 'glsl' });
    expect(r.success).toBe(true);
    expect(r.code).toBe('(vec2(x, y) + vec2(1.0, 2.0)).y');
  });
});

describe('a primary operand keeps the direct suffix', () => {
  test('a constructor call, an identifier, a negated constructor', () => {
    expect(code('\\mathrm{PointX}\\left(\\left(x,y\\right)\\right)', 'glsl')).toBe('vec2(x, y).x');
    expect(code('\\mathrm{PointY}\\left(-\\left(x,y\\right)\\right)', 'glsl')).toBe('vec2(-x, -y).y');
    ce.declare('p', 'tuple<number, number>');
    expect(code('\\mathrm{PointY}(p)', 'glsl')).toBe('p.y');
  });
});
