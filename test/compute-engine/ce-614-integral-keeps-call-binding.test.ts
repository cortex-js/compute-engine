import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';

// ROADMAP CE-614: a call keeps the binding of the function it was written
// with (`docs/SCOPING-MODEL.md`, "Callable resolution"). An integral of a call
// of a user function, made while `g := t ↦ t`, and evaluated in a scope that
// declares another `g`, integrates `t ↦ t`. The integration inlined the body
// of the function that the NAME `g` had in the current scope
// (`userFunctionLiteral()`, `boxed-expression/utils.ts`), and `D` did the same
// (`symbolic/derivative.ts`): `∫₀¹ g(x) dx` was 100 with the inner
// `g := t ↦ 100`. Under `N()`, the compiled kernel was declined for a call
// whose function differs from the function of its name, and the interpreter
// could not compute a nested integral.

type Route = 'parse' | 'box';

function integral(ce: ComputeEngine, route: Route): Expression {
  return route === 'parse'
    ? ce.parse('\\int_0^1 g(x)\\,dx')
    : ce.box(['Integrate', ['g', 'x'], ['Limits', 'x', 0, 1]]);
}

/** A scope that declares another `g`, a function with the value 100. */
function pushShadowingG(ce: ComputeEngine): void {
  ce.pushScope();
  ce.declare('g', 'function');
  ce.assign('g', ce.expr(['Function', 100, 't']));
}

describe('CE-614: an integral keeps the binding of the function it calls', () => {
  for (const route of ['parse', 'box'] as const) {
    test(`a function held as a value (${route} route)`, () => {
      const ce = new ComputeEngine();
      ce.declare('g', 'function');
      ce.assign('g', ce.expr(['Function', 't', 't']));
      const I = integral(ce, route);
      pushShadowingG(ce);
      expect(I.evaluate().json).toEqual(['Rational', 1, 2]);
      expect(I.N().re).toBeCloseTo(0.5, 12);
      // A call made in the inner scope reads the inner `g`.
      expect(ce.parse('g(3)').evaluate().json).toEqual(100);
      ce.popScope();
    });

    test(`a function defined with := (${route} route)`, () => {
      const ce = new ComputeEngine();
      ce.parse('g(t) := t').evaluate();
      const I = integral(ce, route);
      pushShadowingG(ce);
      expect(I.evaluate().json).toEqual(['Rational', 1, 2]);
      expect(I.N().re).toBeCloseTo(0.5, 12);
      ce.popScope();
    });
  }

  test('the derivative and the limit of a call keep its binding', () => {
    for (const define of ['value', 'operator'] as const) {
      const ce = new ComputeEngine();
      if (define === 'operator') ce.parse('g(t) := t^2').evaluate();
      else {
        ce.declare('g', 'function');
        ce.assign('g', ce.expr(['Function', ['Power', 't', 2], 't']));
      }
      const D = ce.parse('\\frac{d}{dx} g(x)');
      const L = ce.parse('\\lim_{x\\to 2} g(x)');
      pushShadowingG(ce);
      expect(D.evaluate().json).toEqual(['Multiply', 2, 'x']);
      expect(L.evaluate().json).toEqual(4);
      ce.popScope();
    }
  });

  test('a call in the body of a call is followed with its binding', () => {
    // `D(g(k)², x)` is 0 when `g(k)` does not depend on `x`: the test reads
    // the body of `g` (`dependsOnVariable()`, `derivative.ts`).
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.expr(['Function', ['Multiply', 'a', 'x'], 'a']));
    const D = ce.box(['D', ['Power', ['g', 'k'], 2], 'x']);
    const outer = D.evaluate().json;
    pushShadowingG(ce);
    expect(D.evaluate().json).toEqual(outer);
    expect(outer).not.toEqual(0);
    ce.popScope();
  });

  test('two calls of one name with different functions are not merged by the dependency test', () => {
    // The test of `D` that asks whether an operand depends on `x` cached
    // its answer by the name and the arity of a function: the answer for the
    // inner `g` (no `x`) was used for the outer `g` (`t·x`), and the
    // derivative was 0.
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.expr(['Function', ['Multiply', 't', 'x'], 't']));
    const gOuter = ce.box(['g', 'k']);
    pushShadowingG(ce);
    const gInner = ce.box(['g', 'm']);
    const e = ce.function('Power', [ce.function('Add', [gInner, gOuter]), 2]);
    const d = ce.function('D', [e, 'x']).evaluate();
    // d/dx (k·x + 100)² = 2k(k·x + 100)
    for (const [k, x] of [
      [2, 3],
      [-1, 0.5],
    ])
      expect(d.subs({ k, x }).N().re).toBeCloseTo(2 * k * (k * x + 100), 10);
    ce.popScope();
  });

  describe('a compiled kernel reads the functions that the bodies call', () => {
    // `c(t) := n(t) + 1` and `n := t ↦ t²`, then a scope that declares
    // another `c` and another `n`. A compilation of `c(x)` compiles the
    // body of `c`, whose call of `n` must read the outer `n`.
    function engine(cKind: 'value' | 'operator', nKind: 'value' | 'operator') {
      const ce = new ComputeEngine();
      if (nKind === 'operator') ce.parse('n(t) := t^2').evaluate();
      else {
        ce.declare('n', 'function');
        ce.assign('n', ce.expr(['Function', ['Power', 't', 2], 't']));
      }
      if (cKind === 'operator') ce.parse('c(t) := n(t) + 1').evaluate();
      else {
        ce.declare('c', 'function');
        ce.assign('c', ce.expr(['Function', ['Add', ['n', 't'], 1], 't']));
      }
      return ce;
    }
    function pushShadowingCAndN(ce: ComputeEngine): void {
      ce.pushScope();
      ce.declare('n', 'function');
      ce.assign('n', ce.expr(['Function', 100, 't']));
      ce.declare('c', 'function');
      ce.assign('c', ce.expr(['Function', 7, 't']));
    }

    for (const cKind of ['value', 'operator'] as const)
      for (const nKind of ['value', 'operator'] as const)
        test(`c ${cKind}, n ${nKind}`, () => {
          const ce = engine(cKind, nKind);
          const call = ce.box(['c', 'x']);
          const NI = ce.box([
            'NIntegrate',
            ['Function', ['c', 'x'], 'x'],
            0,
            1,
          ]);
          pushShadowingCAndN(ce);
          const compiled = implicitCompile(ce, call) as
            | { success: boolean; run: (v: { x: number }) => unknown }
            | undefined;
          expect(compiled?.success).toBe(true);
          expect(compiled!.run({ x: 2 })).toBe(5);
          expect(NI.evaluate().re).toBeCloseTo(4 / 3, 12);
          ce.popScope();
        });

    test('one name with two functions declines', () => {
      // `c(x)` reaches the outer `n` through its body, and `n(x)` is a call
      // of the inner `n`: no scope gives each call its function.
      const ce = engine('operator', 'value');
      const call = ce.box(['c', 'x']);
      pushShadowingCAndN(ce);
      const both = ce.function('Add', [call, ce.box(['n', 'x'])]);
      expect(implicitCompile(ce, both)).toBeUndefined();
      // The interpreter gives (x² + 1) + 100.
      expect(both.evaluate().json).toEqual(['Add', ['Power', 'x', 2], 101]);
      ce.popScope();
    });
  });

  for (const kind of ['value', 'operator'] as const)
    test(`a stored value that calls another function of the same name declines (${kind})`, () => {
      // `a` holds a call of the inner `g`, and the expression holds a call
      // of the outer `g`. The compiler can compile the value of `a` in place
      // of `a`, and no single scope gives both calls their function. A
      // compilation of both with the outer `g` gave 4 at x = 2.
      const ce = new ComputeEngine();
      if (kind === 'operator') ce.parse('g(t) := t').evaluate();
      else {
        ce.declare('g', 'function');
        ce.assign('g', ce.expr(['Function', 't', 't']));
      }
      const outerCall = ce.box(['g', 'x']);
      ce.pushScope();
      ce.declare('g', 'function');
      ce.assign('g', ce.expr(['Function', ['Multiply', 100, 't'], 't']));
      ce.assign('a', ce.box(['g', 'x']));
      for (const e of [
        ce.function('Add', [outerCall, ce.symbol('a')]),
        ce.function('Function', [
          ce.function('Add', [outerCall, ce.symbol('a')]),
          'x',
        ]),
      ]) {
        const compiled = implicitCompile(ce, e) as
          | { success: boolean; run: (...args: unknown[]) => unknown }
          | undefined;
        if (compiled?.success) {
          const v =
            e.operator === 'Function'
              ? compiled.run(2)
              : compiled.run({ x: 2 });
          expect(v).toBe(202);
        } else expect(compiled).toBeUndefined();
      }
      expect(
        ce.function('Add', [outerCall, ce.symbol('a')]).evaluate().json
      ).toEqual(['Multiply', 101, 'x']);
      ce.popScope();
    });

  test('a user function with the name of a library function', () => {
    const ce = new ComputeEngine();
    ce.assign('Sin', ce.expr(['Function', ['Add', 't', 1], 't']));
    const I = ce.box(['Integrate', ['Sin', 'x'], ['Limits', 'x', 0, 1]]);
    expect(I.evaluate().json).toEqual(['Rational', 3, 2]);
    ce.pushScope();
    ce.declare('Sin', 'function');
    ce.assign('Sin', ce.expr(['Function', 100, 't']));
    expect(I.evaluate().json).toEqual(['Rational', 3, 2]);
    ce.popScope();
  });

  test('the numeric value of a nested integral under a scope that declares another function', () => {
    // The Tycho case of ROADMAP CE-604.
    const ce = new ComputeEngine();
    for (const definition of [
      String.raw`d(x,r)\coloneq\max\left(0,\sqrt{x^2+r^2}-1\right)`,
      String.raw`n(x,r,e_{ps})\coloneq\frac{1}{\max\left(e_{ps},d\left(x,r\right)\right)}\begin{cases}\begin{cases}1&x<-\sqrt{1-r^2}\\0&\text{otherwise}\end{cases}&r\le1\\1&\text{otherwise}\end{cases}`,
      String.raw`c(y,D,e_{ps})\coloneq\int_{-D}^Dn\left(x,y,e_{ps}\right)dx`,
    ])
      ce.parse(definition).evaluate();
    ce.parse('L := 0.5').evaluate();
    const I = ce.parse(
      String.raw`\int_{0}^{1}y\cdot c\left(y,L,0.001\right)dy`
    );
    const outer = I.N().re;
    expect(Number.isFinite(outer)).toBe(true);
    // An independent midpoint sum of the same integral gives 1.98348.
    expect(outer).toBeCloseTo(1.9838, 3);
    ce.pushScope();
    ce.declare('c', 'function');
    ce.assign('c', ce.expr(['Function', 7, 'p', 'q', 'r']));
    const inner = I.N().re;
    ce.popScope();
    expect(inner).toBeCloseTo(outer, 10);
  });

  test('a free variable reads the declaration of the current scope', () => {
    // A symbol that is not in a call position keeps the compatibility
    // reading of `docs/SCOPING-MODEL.md`: its value is read from the
    // innermost binding of its name, so a later declaration of `a` in a
    // pushed scope is read.
    const ce = new ComputeEngine();
    ce.assign('a', 2);
    const I = ce.parse('\\int_0^1 a x\\,dx');
    expect(I.evaluate().json).toEqual(1);
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assign('a', 10);
    expect(I.evaluate().json).toEqual(5);
    expect(I.N().re).toBeCloseTo(5, 12);
    ce.popScope();
    expect(I.evaluate().json).toEqual(1);
  });
});
