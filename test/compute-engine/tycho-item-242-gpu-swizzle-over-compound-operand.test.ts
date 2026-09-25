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
    expect(
      code(
        '\\mathrm{PointX}\\left(\\left(x,y\\right)+\\left(1,2\\right)\\right)',
        'glsl'
      )
    ).toBe('(vec2(x, y) + vec2(1.0, 2.0)).x');
    expect(
      code(
        '\\mathrm{PointX}\\left(\\left(x,y\\right)+\\left(1,2\\right)\\right)',
        'wgsl'
      )
    ).toBe('(vec2f(x, y) + vec2f(1.0, 2.0)).x');
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
    expect(
      code('\\mathrm{PointX}\\left(2\\left(x,y\\right)\\right)', 'glsl')
    ).toBe('(2.0 * vec2(x, y)).x');
    expect(
      code(
        '\\mathrm{PointY}\\left(-\\left(\\left(x,y\\right)+\\left(1,2\\right)\\right)\\right)',
        'glsl'
      )
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
    expect(
      code('\\mathrm{PointX}\\left(\\left(x,y\\right)\\right)', 'glsl')
    ).toBe('vec2(x, y).x');
    expect(
      code('\\mathrm{PointY}\\left(-\\left(x,y\\right)\\right)', 'glsl')
    ).toBe('vec2(-x, -y).y');
    ce.declare('p', 'tuple<number, number>');
    expect(code('\\mathrm{PointY}(p)', 'glsl')).toBe('p.y');
  });
});

// An absent operand (`Missing`, `Undefined`) compiles to the SCALAR NaN of
// the target. A scalar has no components: WGSL rejects `.x` on an `f32`, so
// the component read of an absent point is that NaN, with no swizzle.
describe('a component read over an absent operand', () => {
  for (const op of [
    'PointX',
    'PointY',
    'PointZ',
    'First',
    'Second',
    'Third',
    'Last',
  ])
    for (const arg of ['Missing', 'Undefined'])
      test(`${op}(${arg})`, () => {
        const glsl = compile(ce.box([op, arg]), {
          to: 'glsl',
          fallback: false,
        });
        expect(glsl.code).toBe('_gpu_nan()');
        const wgsl = compile(ce.box([op, arg]), {
          to: 'wgsl',
          fallback: false,
        });
        expect(wgsl.code).toBe('bitcast<f32>(0x7fc00000u)');
        expect(wgsl.code).not.toMatch(/\.[xyzw]$/);
      });
});

// `Last` reads the last component of a `vec2`/`vec3`/`vec4`, so its
// swizzle follows the static width of the operand. An operand with no static
// width of 2 to 4 (a list of unknown or greater length) has no lowering.
describe('Last reads the component at the static width', () => {
  test('a point of each width, and a compound operand', () => {
    ce.declare('p2', 'tuple<number, number>');
    ce.declare('p3', 'tuple<number, number, number>');
    ce.declare('p4', 'list<real^4>');
    const glsl = (e: unknown) =>
      compile(ce.box(e as any), { to: 'glsl', fallback: false }).code;
    expect(glsl(['Last', 'p2'])).toBe('p2.y');
    expect(glsl(['Last', 'p3'])).toBe('p3.z');
    expect(glsl(['Last', 'p4'])).toBe('p4.w');
    expect(glsl(['Last', ['Add', ['Tuple', 'x', 'y'], ['Tuple', 1, 2]]])).toBe(
      '(vec2(x, y) + vec2(1.0, 2.0)).y'
    );
    expect(
      compile(ce.box(['Last', 'p3']), { to: 'wgsl', fallback: false }).code
    ).toBe('p3.z');
  });

  test('a list of unknown length declines', () => {
    ce.declare('v', 'list<real>');
    expect(() =>
      compile(ce.box(['Last', 'v']), { to: 'glsl', fallback: false })
    ).toThrow(/Could not compile `Last`: the operand must be a point/);
  });
});

describe('a multi-component read of an absent operand', () => {
  // `gpuSwizzle` with several components on the scalar NaN builds a vector
  // of it: `.xy` on an `f32` is rejected by WGSL as `.x` is.
  test('is a vector of the scalar NaN on both targets', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Tuple', 'Missing', 'Missing']);
    expect(compile(p, { to: 'glsl' }).code).not.toMatch(
      /_gpu_nan\(\)\.[xyzw]{2,}/
    );
    expect(compile(p, { to: 'wgsl' }).code).not.toMatch(
      /0x7fc00000u\)\.[xyzw]{2,}/
    );
  });
});
