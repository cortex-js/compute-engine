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
        ).toThrow(/Could not compile/);
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
          ).toThrow(/Could not compile/);
      });
});

// `Last` reads the last component of a `vec2`/`vec3`/`vec4`, so its
// swizzle follows the static width of the operand. A list of unknown length
// has no last position known at compile time, so it has no lowering.
describe('Last reads the component at the static width', () => {

  test('a list of unknown length declines', () => {
    ce.declare('v', 'list<real>');
    expect(() =>
      compile(ce.box(['Last', 'v']), { to: 'glsl', fallback: false })
    ).toThrow(
      /Could not compile/
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
