/**
 * The numeric-derivative fallback for a POINT-valued function, on both
 * routes.
 *
 * The Frenet-frame document `frthw0ihk5` of the Tycho code-generation audit
 * defines a space curve `f(t) = PointList(x(t), y(t), z(t))` and its unit
 * tangent `F_0(t) = f'(t)/|f'(t)|`, then reads `F_0'(t)`. The symbolic
 * differentiator has no rule for the derivative of the norm of a
 * point-valued function, so the closed form of `F_0'` was INCOMPLETE: a
 * `D(|f'(t)|, t)` residue inside an otherwise differentiated body. The
 * interpreter returned that residue from `N()` (no numeric value at all),
 * and the compiled JavaScript target, which falls back to the numeric
 * stencil for the whole application, answered `NaN`: the stencil helper
 * `_SYS.nd` read the point the function returns as a non-number.
 *
 * Now the `Derivative` handler treats an incomplete closed form as no
 * closed form (the node stays inert), so `N()` of the application takes
 * the same stencil fallback as the compiled route
 * (`numericDerivativeOfApply`, library/calculus.ts), and both stencils
 * differentiate a point- or list-valued function component by component.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('u', 'real');
function define(name: string, body: string): void {
  ce.declare(name, 'function');
  ce.assign(name, ce.parse(String.raw`t \mapsto ${body}`));
}
define('f', String.raw`\operatorname{PointList}(\sin t, \cos t, t)`);
define('F_0', String.raw`\frac{f^{\prime}(t)}{\vert f^{\prime}(t)\vert}`);
define('h', String.raw`\bigl\lbrack t^2, \sin t\bigr\rbrack`);
define('s', String.raw`\vert (t, t^2) \vert`);

const X = 0.3;
const atX = (latex: string) => ce.parse(latex).subs({ u: ce.number(X) });
const components = (e: any): number[] =>
  [...e.each()].map((c: any) => c.re as number);

describe('Derivative of a point-valued function through the stencil', () => {
  test('the unit tangent derivative has a numeric value on both routes', () => {
    // `f'(t) = (cos t, −sin t, 1)`, `|f'| = √2` is constant, so
    // `F_0'(t) = f''(t)/√2 = (−sin t, −cos t, 0)/√2`.
    const want = [-Math.sin(X) / Math.SQRT2, -Math.cos(X) / Math.SQRT2, 0];
    const interpreted = atX(String.raw`F_0^{\prime}(u)`).N();
    expect(interpreted.operator).toBe('Tuple');
    components(interpreted).forEach((v, i) =>
      expect(v).toBeCloseTo(want[i], 8)
    );
    const r = compile(ce.parse(String.raw`F_0^{\prime}(u)`), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    const compiled = r.run!({ u: X }) as number[];
    expect(compiled.length).toBe(3);
    compiled.forEach((v, i) => expect(v).toBeCloseTo(want[i], 8));
    // The two routes run the same stencil: bit-identical.
    expect(compiled).toEqual(components(interpreted));
  });

  test('evaluate() keeps the exactness contract: the application stays symbolic', () => {
    const exact = atX(String.raw`F_0^{\prime}(u)`).evaluate();
    expect(exact.operator).toBe('Apply');
    expect(JSON.stringify(exact.json)).not.toContain('"D"');
    // The derivative function itself stays inert rather than carrying the
    // unresolved residue.
    expect(ce.box(['Derivative', 'F_0', 1]).evaluate().operator).toBe(
      'Derivative'
    );
  });

  test('a complete closed form is still taken', () => {
    const v = atX(String.raw`f^{\prime}(u)`).N();
    expect(v.operator).toBe('Tuple');
    components(v).forEach((c, i) =>
      expect(c).toBeCloseTo([Math.cos(X), -Math.sin(X), 1][i], 12)
    );
    expect(atX(String.raw`s^{\prime}(u)`).N().re).toBeCloseTo(
      (X + 2 * X ** 3) / Math.sqrt(X * X + X ** 4),
      10
    );
  });

  test('a list-valued function differentiates to a list', () => {
    // No closed-form gap here; force the stencil through `ND`-free means:
    // the compiled route's `_SYS.nd` is exercised directly below.
    const r = compile(ce.box(['ND', 'h', 'u']), { fallback: false });
    expect(r.success).toBe(true);
    const got = r.run!({ u: X }) as number[];
    expect(got.length).toBe(2);
    expect(got[0]).toBeCloseTo(2 * X, 8);
    expect(got[1]).toBeCloseTo(Math.cos(X), 8);
    const interpreted = ce.box(['ND', 'h', X]).N();
    expect(['List', 'Tuple']).toContain(interpreted.operator);
  });

  test('a component the stencil cannot compute is NaN in place on both routes', () => {
    // `√t` has no real value at the samples left of zero, `t` is fine.
    define('q', String.raw`(\sqrt{t}, t)`);
    const interpreted = ce.box(['ND', 'q', 0.2]).N();
    expect(interpreted.operator).toBe('Tuple');
    const got = components(interpreted);
    expect(got[0]).toBeNaN();
    expect(got[1]).toBeCloseTo(1, 8);
    const r = compile(ce.box(['ND', 'q', 'u']), { fallback: false });
    const compiled = r.run!({ u: 0.2 }) as number[];
    expect(compiled[0]).toBeNaN();
    expect(compiled[1]).toBe(got[1]);
  });

  test('an exact constant inside the value is numericized on the interpreted vehicle', () => {
    const engine = new ComputeEngine();
    engine.jit = 'off';
    engine.declare('k', 'function');
    engine.assign(
      'k',
      engine.parse(String.raw`t \mapsto \bigl\lbrack \sin 1, t^2\bigr\rbrack`)
    );
    const v = engine.box(['ND', 'k', 0.3]).N();
    expect(v.operator).toBe('List');
    const got = [...(v as any).each()].map((c: any) => c.re as number);
    expect(got[0]).toBeCloseTo(0, 8);
    expect(got[1]).toBeCloseTo(0.6, 8);
  });

  test('a complex sample is rejected, not read as its real part', () => {
    define('z', String.raw`\mathrm{i} t`);
    // The compiled route answers NaN; the interpreted stencil declines and
    // the expression stays symbolic (the scalar contract for a NaN value).
    const r = compile(ce.box(['ND', 'z', 'u']), { fallback: false });
    expect(r.run!({ u: 0.3 })).toBeNaN();
    expect(ce.box(['ND', 'z', 0.3]).N().operator).toBe('ND');
  });

  test('the emitted helper carries the value shape read from the type', () => {
    const r = compile(ce.box(['ND', 'F_0', 'u']), { fallback: false });
    expect(r.code).toContain("'vector'");
    const scalar = compile(ce.box(['ND', 's', 'u']), { fallback: false });
    expect(scalar.code).toContain("'scalar'");
  });

  test('the compiled stencil helper differentiates each component', () => {
    const r = compile(ce.box(['ND', 'F_0', 'u']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.nd(');
    const got = r.run!({ u: X }) as number[];
    expect(got[0]).toBeCloseTo(-Math.sin(X) / Math.SQRT2, 8);
    expect(got[2]).toBeCloseTo(0, 8);
  });
});
