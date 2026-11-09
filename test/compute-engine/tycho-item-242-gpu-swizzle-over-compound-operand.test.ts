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

function code(latex: string, to: 'glsl'): string {
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

// An absent operand (`Missing`) compiles to the SCALAR NaN of the target.
// (`Undefined` is not an absent value: it is an ordinary symbol, since
// `Missing` became a result only, `docs/ERROR-MODEL.md`.) A scalar has no components: a shader compiler can reject `.x` on a `float`, so
// the coordinate read of an absent point is that NaN, with no swizzle.
describe('a component read over an absent operand', () => {
  for (const op of ['PointX', 'PointY', 'PointZ'])
    for (const arg of ['Missing'])
      test(`${op}(${arg})`, () => {
        // The GLSL fragment has no `Missing` value, so the compilation
        // declines.
        expect(() =>
          compile(ce.box([op, arg]), {
            to: 'glsl',
            fallback: false,
          })
        ).toThrow(/has no type in the GLSL fragment/);
      });

  // A positional read is `At` with a constant index, which declines an
  // absent base: the interpreter gives `Missing`, and a decline is always
  // allowed.
  for (const op of ['First', 'Second', 'Third', 'Last'])
    for (const arg of ['Missing'])
      test(`${op}(${arg}) declines`, () => {
        for (const to of ['glsl'] as const)
          expect(() =>
            compile(ce.box([op, arg]), { to, fallback: false })
          ).toThrow(/has no type in the GLSL fragment/);
      });
});

// `Last` reads the last component of a `vec2`/`vec3`/`vec4`, so its
// swizzle follows the static width of the operand. A list of unknown length
// has no last position known at compile time, so it has no lowering.
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
  });

  test('a list of unknown length declines', () => {
    ce.declare('v', 'list<real>');
    expect(() =>
      compile(ce.box(['Last', 'v']), { to: 'glsl', fallback: false })
    ).toThrow(
      /The list `v` has no static count/
    );
  });
});

describe('a multi-component read of an absent operand', () => {
  // `gpuSwizzle` with several components on the scalar NaN builds a vector
  // of it: a shader compiler can reject `.xy` on a `float` as it can `.x`.
  test('is a vector of the scalar NaN', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Tuple', 'Missing', 'Missing']);
    expect(compile(p, { to: 'glsl' }).code).not.toMatch(
      /_gpu_nan\(\)\.[xyzw]{2,}/
    );
  });
});
