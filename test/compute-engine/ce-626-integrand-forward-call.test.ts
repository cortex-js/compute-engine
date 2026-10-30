import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';

// ROADMAP CE-626: a call in an integrand to a function that is not defined
// yet is a forward reference (`docs/SCOPING-MODEL.md`, "Callable
// resolution"). It reads the definition that the scope the integral was
// written in holds when the integral is evaluated, as a call in `D` or `Sum`
// does. On the parse route, the head `g` of `g(x)` was first declared as a
// data symbol in the scope of the integrand's `Block`, and the call then
// bound to that valueless local: `∫₀¹ g(x) dx` stayed unevaluated after
// `g(t) := t`, while `N()` gave 0.5 through the compiled route, which reads
// the name. User decision 2026-10-30: the call head refers to the enclosing
// scope. An unknown DATA symbol of the integrand keeps its behavior.
//
// The box route marked the head as a forward reference already, but under a
// scope that declares another `g`, it read that `g` (100): the search for
// the definition followed the parent link of the `Block` scope, which the
// evaluation chains onto the current scope, and the compiled route took the
// placeholder for a local of the `Block` and compiled `g` by name.

type Route = 'parse' | 'box';

function integral(ce: ComputeEngine, route: Route): Expression {
  return route === 'parse'
    ? ce.parse('\\int_0^1 g(x)\\,dx')
    : ce.box(['Integrate', ['g', 'x'], ['Limits', 'x', 0, 1]]);
}

type Definition = 'coloneq' | 'declare-assign';

function defineG(ce: ComputeEngine, how: Definition): void {
  if (how === 'coloneq') ce.parse('g(t) \\coloneq t').evaluate();
  else {
    ce.declare('g', 'function');
    ce.assign('g', ce.expr(['Function', 't', 't']));
  }
}

describe('CE-626: a call in an integrand made before its function exists', () => {
  for (const route of ['parse', 'box'] as const) {
    for (const how of ['coloneq', 'declare-assign'] as const) {
      test(`reads the later definition (${route} route, ${how})`, () => {
        const ce = new ComputeEngine();
        const I = integral(ce, route);
        defineG(ce, how);
        expect(I.evaluate().json).toEqual(['Rational', 1, 2]);
        expect(I.N().re).toBeCloseTo(0.5, 12);
      });
    }

    test(`keeps the outer definition under a scope that declares another g (${route} route)`, () => {
      // CE-614: a call keeps the binding of the scope it was written in.
      const ce = new ComputeEngine();
      const I = integral(ce, route);
      defineG(ce, 'coloneq');
      ce.pushScope();
      ce.declare('g', 'function');
      ce.assign('g', ce.expr(['Function', 100, 't']));
      expect(I.evaluate().json).toEqual(['Rational', 1, 2]);
      expect(I.N().re).toBeCloseTo(0.5, 12);
      ce.popScope();
    });
  }

  test('a call with two arguments reads the later definition', () => {
    const ce = new ComputeEngine();
    const I = ce.parse('\\int_0^1 h(x, 2)\\,dx');
    ce.parse('h(t, u) \\coloneq t u').evaluate();
    expect(I.evaluate().json).toEqual(1);
  });

  test('D and Sum agree', () => {
    const ce = new ComputeEngine();
    const D = ce.parse('\\frac{d}{dx} g(x)');
    const S = ce.parse('\\sum_{k=1}^3 g(k)');
    defineG(ce, 'coloneq');
    expect(D.evaluate().json).toEqual(1);
    expect(S.evaluate().json).toEqual(6);
  });

  test('a function literal written before its callee reads the later definition', () => {
    // The same rule outside an integral: the parse route and the box route
    // of the literal give the same value.
    const ce = new ComputeEngine();
    const F = ce.parse('x \\mapsto q(x)');
    ce.parse('q(t) \\coloneq 10t').evaluate();
    expect(ce.function('Apply', [F, ce.number(2)]).evaluate().json).toEqual(
      20
    );
  });

  for (const route of ['parse', 'box'] as const) {
    test(`a callback passed to Apply in an integrand (${route} route)`, () => {
      // `Apply(f, x)` canonicalizes to the call `f(x)`, after its callee was
      // canonicalized as a symbol of the body.
      const make = (ce: ComputeEngine): Expression =>
        route === 'parse'
          ? ce.parse('\\int_0^1 \\mathrm{Apply}(f, x)\\,dx')
          : ce.box(['Integrate', ['Apply', 'f', 'x'], ['Limits', 'x', 0, 1]]);
      const ce = new ComputeEngine();
      const I = make(ce);
      ce.parse('f(t) \\coloneq t^2').evaluate();
      expect(I.evaluate().json).toEqual(['Rational', 1, 3]);
      expect(I.N().re).toBeCloseTo(1 / 3, 12);
      ce.pushScope();
      ce.declare('f', 'function');
      ce.assign('f', ce.expr(['Function', 100, 't']));
      expect(I.evaluate().json).toEqual(['Rational', 1, 3]);
      expect(I.N().re).toBeCloseTo(1 / 3, 12);
      ce.popScope();
    });

    test(`a callback passed to Map in a function literal (${route} route)`, () => {
      const make = (ce: ComputeEngine): Expression =>
        route === 'parse'
          ? ce.parse('x \\mapsto \\mathrm{Map}(f, [x, 2x])')
          : ce.box([
              'Function',
              ['Map', 'f', ['List', 'x', ['Multiply', 2, 'x']]],
              'x',
            ]);
      const ce = new ComputeEngine();
      const F = make(ce);
      ce.parse('f(t) \\coloneq t^2').evaluate();
      // `Map` is lazy: its elements are read with `.each()`, in the scope
      // that is current when they are read.
      const applied = ce.function('Apply', [F, ce.number(3)]);
      const elements = (): unknown[] =>
        [...applied.evaluate().each()].map((e) => e.json);
      expect(elements()).toEqual([9, 36]);
      ce.pushScope();
      ce.declare('f', 'function');
      ce.assign('f', ce.expr(['Function', 100, 't']));
      expect(elements()).toEqual([9, 36]);
      ce.popScope();
    });
  }

  test('a compiled integrand that calls g and passes g as a callback', () => {
    // The call `g(x)` and the callback `g` of `Map` share the placeholder of
    // the `Block`. Under a scope that declares another `g`, a compilation
    // that puts the outer `g` in scope for the call would change the
    // callback too: the compilation declines, or gives the value of the
    // interpreter.
    const ce = new ComputeEngine();
    const I = ce.box([
      'Integrate',
      ['Add', ['g', 'x'], ['At', ['Map', 'g', ['List', 'x']], 1]],
      ['Limits', 'x', 0, 1],
    ]);
    const F = I.op1;
    ce.parse('g(t) \\coloneq t').evaluate();
    ce.pushScope();
    ce.declare('g', 'function');
    ce.assign('g', ce.expr(['Function', 100, 't']));
    const interpreted = ce
      .function('Apply', [F, ce.number(0.5)])
      .evaluate()
      .re;
    expect(interpreted).toBeCloseTo(1, 12);
    const compiled = implicitCompile(ce, F);
    if (compiled?.success)
      expect((compiled.run as (x: number) => number)(0.5)).toBeCloseTo(
        interpreted,
        12
      );
    expect(I.N().re).toBeCloseTo(1, 12);
    ce.popScope();
  });

  test('an unknown data symbol of the integrand keeps its behavior', () => {
    // `a` is a free coefficient: it is declared in the scope the integral is
    // written in, and the integral reads its value when it has one.
    const ce = new ComputeEngine();
    const I = ce.parse('\\int_0^1 a x\\,dx');
    expect(I.evaluate().json).toEqual(['Multiply', ['Rational', 1, 2], 'a']);
    ce.assign('a', 3);
    expect(I.evaluate().json).toEqual(['Rational', 3, 2]);
    expect(I.N().re).toBeCloseTo(1.5, 12);
  });
});
