/**
 * The numeric-derivative fallback for a POINT-valued function, on both
 * routes.
 *
 * The Frenet-frame document `frthw0ihk5` of the Tycho code-generation audit
 * defines a space curve `f(t) = PointList(x(t), y(t), z(t))` and its unit
 * tangent `F_0(t) = f'(t)/|f'(t)|`, then reads `F_0'(t)`. The symbolic
 * differentiator gives the derivative of the norm of a point-valued call
 * from the components of its expansion (CE-1563), so `F_0'` has a closed
 * form. An INCOMPLETE closed form (a `D` residue in a differentiated body)
 * is no closed form: the node stays inert, and `N()` of the application
 * takes the same stencil fallback as the compiled route
 * (`numericDerivativeOfApply`, library/calculus.ts). Both stencils
 * differentiate a point- or list-valued function component by component.
 */

import { ComputeEngine } from '../../src/compute-engine';

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
  test('the unit tangent derivative has a numeric value', () => {
    // `f'(t) = (cos t, −sin t, 1)`, `|f'| = √2` is constant, so
    // `F_0'(t) = f''(t)/√2 = (−sin t, −cos t, 0)/√2`.
    const want = [-Math.sin(X) / Math.SQRT2, -Math.cos(X) / Math.SQRT2, 0];
    const interpreted = atX(String.raw`F_0^{\prime}(u)`).N();
    expect(interpreted.operator).toBe('Tuple');
    components(interpreted).forEach((v, i) =>
      expect(v).toBeCloseTo(want[i], 8)
    );
  });

  test('the unit tangent derivative has a closed form (CE-1563)', () => {
    const exact = atX(String.raw`F_0^{\prime}(u)`).evaluate();
    expect(exact.operator).toBe('Tuple');
    expect(JSON.stringify(exact.json)).not.toContain('"D"');
    expect(ce.box(['Derivative', 'F_0', 1]).evaluate().operator).toBe(
      'Function'
    );
    const want = [-Math.sin(X) / Math.SQRT2, -Math.cos(X) / Math.SQRT2, 0];
    components(exact.N()).forEach((v, i) =>
      expect(v).toBeCloseTo(want[i], 12)
    );
  });

  test('an incomplete closed form is inert, and N() takes the stencil', () => {
    // `|h(t)|` of a list is elementwise, not a norm, and the norm rule has
    // no components for it: the closed form of `H′` would hold a `D`.
    define('H', String.raw`\frac{h(t)}{\vert h(t)\vert}`);
    expect(ce.box(['Derivative', 'H', 1]).evaluate().operator).toBe(
      'Derivative'
    );
    // `H(t)` is `[1, 1]` near 0.3, so its derivative is `[0, 0]`.
    const v = ce.box(['Apply', ['Derivative', 'H', 1], X]).N();
    expect(v.operator).toBe('List');
    components(v).forEach((c) => expect(c).toBeCloseTo(0, 6));
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

  test('a component the stencil cannot compute is NaN in place', () => {
    // `√t` has no real value at the samples left of zero, at every step
    // when `t = 0`; `t` is fine.
    define('q', String.raw`(\sqrt{t}, t)`);
    const interpreted = ce.box(['ND', 'q', 0]).N();
    expect(interpreted.operator).toBe('Tuple');
    const got = components(interpreted);
    expect(got[0]).toBeNaN();
    expect(got[1]).toBeCloseTo(1, 8);
  });

  test('a point near the edge of the domain narrows the stencil (Tycho row 420)', () => {
    // At `t = 0.2` the first window, ±0.4, reaches below 0, where `√t` has
    // no real value; the stencil narrows until it does not.
    define('qEdge', String.raw`(\sqrt{t}, t)`);
    const got = components(ce.box(['ND', 'qEdge', 0.2]).N());
    expect(got[0]).toBeCloseTo(1 / (2 * Math.sqrt(0.2)), 8);
    expect(got[1]).toBeCloseTo(1, 8);
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
    // The interpreted stencil declines and the expression stays symbolic
    // (the scalar contract for a NaN value).
    expect(ce.box(['ND', 'z', 0.3]).N().operator).toBe('ND');
  });
});
