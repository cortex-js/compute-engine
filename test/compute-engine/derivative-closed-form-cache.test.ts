/**
 * The closed form of `Derivative(f, n)` is cached per function literal. The
 * cached result used to be valid only at the engine generation it was
 * computed at, and every call of a user function advances that generation
 * (the call declares the parameters in a new activation scope). So
 * `Apply(Derivative(f, 3), x).N()` evaluated at many points differentiated
 * and simplified the closed form again at every point.
 *
 * The cached result now also records the definitions of the symbols its
 * simplification read, and stays valid while those definitions, the
 * semantic version of the engine (assignments, assumptions, configuration)
 * and the fact-suppression bit are unchanged. These tests pin that the cache
 * is hit across points and that it still misses whenever the answer can
 * change.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import * as DerivativeModule from '../../src/compute-engine/symbolic/derivative';
import { markActivation } from '../../src/compute-engine/boxed-expression/binders';

const F = ['Function', ['Multiply', ['Sin', 'x'], ['Exp', 'x']], 'x'];

function machineEngine(): ComputeEngine {
  const ce = new ComputeEngine({ precision: 'machine' });
  ce.assign('f', ce.box(F));
  return ce;
}

function thirdDerivativeAt(ce: ComputeEngine, fn: string, x: number): number {
  return ce.box(['Apply', ['Derivative', fn, 3], x]).N().re;
}

/** The value of `(sin x · e^x)'''`, by central differences of the second
 * derivative computed in closed form: `f'' = 2 e^x cos x`. */
function referenceThirdDerivative(x: number): number {
  const h = 1e-5;
  const f2 = (t: number) => 2 * Math.exp(t) * Math.cos(t);
  return (f2(x + h) - f2(x - h)) / (2 * h);
}

function relative(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.abs(b));
}

/** Count the calls of the differentiation entry point `derivative()` made
 * while `run` runs. */
function derivativeCalls(run: () => void): number {
  const spy = jest.spyOn(DerivativeModule, 'derivative');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

const POINTS = [-1.3, -0.2, 0.5, 1.1, 2.7];

describe('the closed form of Derivative(f, n) across evaluation points', () => {
  test('values equal a cold computation and a numeric derivative', () => {
    const ce = machineEngine();
    for (const x of POINTS) {
      const warm = thirdDerivativeAt(ce, 'f', x);
      // A new engine at each point has nothing cached: the answer the cache
      // must reproduce.
      const cold = thirdDerivativeAt(machineEngine(), 'f', x);
      expect(warm).toBe(cold);
      expect(relative(warm, referenceThirdDerivative(x))).toBeLessThan(1e-6);
    }
  });

  test('the closed form is computed once across 100 points', () => {
    const ce = machineEngine();
    const calls = derivativeCalls(() => {
      for (let i = 0; i < 100; i++) thirdDerivativeAt(ce, 'f', 0.1 + i / 50);
    });
    expect(calls).toBe(1);
  });

  test('reassigning the function gives the new derivative', () => {
    const ce = machineEngine();
    thirdDerivativeAt(ce, 'f', 0.5);
    thirdDerivativeAt(ce, 'f', 0.7);
    ce.assign('f', ce.box(['Function', ['Power', 'x', 4], 'x']));
    // (x⁴)''' = 24x
    expect(thirdDerivativeAt(ce, 'f', 0.5)).toBeCloseTo(12, 12);
    expect(thirdDerivativeAt(ce, 'f', 2)).toBeCloseTo(48, 12);
  });

  test('reassigning a function that f calls gives the new derivative', () => {
    const ce = new ComputeEngine({ precision: 'machine' });
    ce.assign('g', ce.box(['Function', ['Power', 'x', 2], 'x']));
    ce.assign('f', ce.box(['Function', ['Power', ['g', 'x'], 2], 'x']));
    // f = x⁴, f''' = 24x
    expect(thirdDerivativeAt(ce, 'f', 1)).toBeCloseTo(24, 12);
    expect(thirdDerivativeAt(ce, 'f', 2)).toBeCloseTo(48, 12);
    ce.assign('g', ce.box(['Function', ['Power', 'x', 3], 'x']));
    // f = x⁶, f''' = 120x³
    expect(thirdDerivativeAt(ce, 'f', 1)).toBeCloseTo(120, 10);
    expect(thirdDerivativeAt(ce, 'f', 2)).toBeCloseTo(960, 10);
  });

  test('changing the angular unit gives the derivative in the new unit', () => {
    const ce = new ComputeEngine({ precision: 'machine' });
    ce.assign('f', ce.box(['Function', ['Sin', 'x'], 'x']));
    // sin''' = -cos
    expect(thirdDerivativeAt(ce, 'f', 0)).toBeCloseTo(-1, 12);
    expect(thirdDerivativeAt(ce, 'f', 1)).toBeCloseTo(-Math.cos(1), 12);
    ce.angularUnit = 'deg';
    // With x in degrees, sin(x)''' = -(π/180)³ cos(x°).
    const k = Math.PI / 180;
    for (const x of [0, 30, 60]) {
      expect(
        relative(thirdDerivativeAt(ce, 'f', x), -(k ** 3) * Math.cos(k * x))
      ).toBeLessThan(1e-9);
    }
  });

  test('an assumption on a free symbol of the body is not served from the cache', () => {
    // `sin(πb)` is zero for an integer `b`, so the closing simplify of the
    // closed form reads the assumption.
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    const before = ce.box(['Derivative', 'f', 2]).evaluate().toString();
    expect(before).toEqual(expect.stringContaining('sin'));
    ce.assume(ce.parse('b \\in \\Z'));
    const after = ce.box(['Derivative', 'f', 2]).evaluate().toString();
    expect(after).not.toEqual(expect.stringContaining('sin'));
  });

  test('a type written onto a free symbol after calls of f is not served from the cache', () => {
    // Calls of `f` between the two requests advance the generation, so the
    // second request goes through the validation by definitions. The type
    // write bumps the version of the definition of `b`.
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    expect(ce.box(['Derivative', 'f', 2]).evaluate().toString()).toEqual(
      expect.stringContaining('sin')
    );
    ce.box(['f', 2]).evaluate();
    ce.box('b').type = 'integer';
    ce.box(['f', 3]).evaluate();
    expect(ce.box(['Derivative', 'f', 2]).evaluate().toString()).not.toEqual(
      expect.stringContaining('sin')
    );
  });

  test('a write to the definition of a free symbol is not served from the cache', () => {
    // The type setter of the definition reports a `type-write` event, which
    // advances the generation but not the semantic version, and bumps the
    // version of the definition. The cached result records that version, so
    // the validation by definitions misses.
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    const f = ce.box('f');
    expect(DerivativeModule.derivative(f, 2)!.toString()).toEqual(
      expect.stringContaining('sin')
    );
    ce.box('b').valueDefinition!.type = ce.type('integer');
    expect(DerivativeModule.derivative(f, 2)!.toString()).not.toEqual(
      expect.stringContaining('sin')
    );
  });

  test('a result computed with the assumptions hidden is not served with them in force', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'real');
    ce.assume(ce.parse('b \\in \\Z'));
    ce.parse('f(x):=x^3\\sin(b\\pi)').evaluate();
    const f = ce.box('f');
    const hidden = ce._withoutFacts(() =>
      DerivativeModule.derivative(f, 2)!.toString()
    );
    expect(hidden).toEqual(expect.stringContaining('sin'));
    // A call of `f` advances the generation, so the next request goes
    // through the validation by definitions.
    ce.box(['f', 2]).evaluate();
    expect(DerivativeModule.derivative(f, 2)!.toString()).not.toEqual(
      expect.stringContaining('sin')
    );
  });

  test('a derivative of a closure answers per call of the enclosing function', () => {
    // `g(t) = (y ↦ t·y³)'''(1) = 6t`. The literal `y ↦ t·y³` is one node of
    // the body of `g`, shared by every call, so its cached closed form must
    // not carry the value of `t` of an earlier call.
    const ce = new ComputeEngine({ precision: 'machine' });
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Apply',
          [
            'Derivative',
            ['Function', ['Multiply', 't', ['Power', 'y', 3]], 'y'],
            3,
          ],
          1,
        ],
        't',
      ])
    );
    for (const t of [2, 3, 5]) {
      const v: Expression = ce.box(['g', t]).N();
      expect(v.re).toBeCloseTo(6 * t, 12);
    }
  });

  test('a closure whose simplification reads the value of the captured parameter answers per call', () => {
    // `g(t) = (y ↦ |t|·y³)'''(1) = 6|t|` and `(y ↦ sign(t)·y³)'''(1) =
    // 6·sign(t)`. Inside a call of `g`, `t` reads its value from the call
    // frame's parameter activation, which each call writes without bumping a
    // `_writeVersion`. A closed form whose simplification read the sign of
    // `t` in one call must not be served in the next call.
    const ce = new ComputeEngine({ precision: 'machine' });
    const closure = (factor: unknown) =>
      ce.box([
        'Function',
        [
          'Apply',
          [
            'Derivative',
            ['Function', ['Multiply', factor, ['Power', 'y', 3]], 'y'],
            3,
          ],
          1,
        ],
        't',
      ]);
    ce.assign('gAbs', closure(['Abs', 't']));
    ce.assign('gSign', closure(['Sign', 't']));
    for (const t of [2, -3, 5, -1]) {
      expect(ce.box(['gAbs', t]).N().re).toBeCloseTo(6 * Math.abs(t), 12);
      expect(ce.box(['gAbs', t]).evaluate().N().re).toBeCloseTo(
        6 * Math.abs(t),
        12
      );
      expect(ce.box(['gSign', t]).N().re).toBeCloseTo(6 * Math.sign(t), 12);
      expect(ce.box(['gSign', t]).evaluate().N().re).toBeCloseTo(
        6 * Math.sign(t),
        12
      );
    }
  });

  test('inside a call, a closed form that reads a parameter is recorded without symbol dependencies', () => {
    // Inside a call of a user function, a parameter reads its value from the
    // call frame's parameter ACTIVATION, which each call declares and writes
    // without bumping a `_writeVersion`. So a closed form recorded there is
    // valid only at its exact generation, and the next call (a new
    // generation) must do the closing `simplify()` again.
    //
    // Evaluating `g(t)` cannot show this: each call evaluates a new copy of
    // the inner function literal, and the cache is keyed on the literal
    // object. So the test differentiates ONE literal inside simulated call
    // frames, declared as `declareParameterActivation` in
    // `function-utils.ts` declares them.
    const ce = new ComputeEngine({ precision: 'machine' });
    const g = ce.box([
      'Function',
      [
        'Apply',
        [
          'Derivative',
          ['Function', ['Multiply', ['Abs', 't'], ['Power', 'y', 3]], 'y'],
          3,
        ],
        1,
      ],
      't',
    ]);
    const find = (
      e: Expression,
      test: (x: Expression) => boolean
    ): Expression | undefined => {
      if (test(e)) return e;
      for (const op of e.ops ?? []) {
        const found = find(op, test);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const literal = find(g, (x) => x.operator === 'Function' && x !== g)!;
    const t = find(literal, (x) => x.toString() === 't')!;
    const staticBinding = t.valueDefinition!;
    expect(staticBinding).toBeDefined();

    const inCall = (value: number): Expression | undefined => {
      ce.pushScope();
      const scope = ce.context.lexicalScope;
      ce.declare('t', { value, inferred: true });
      const activation = scope.bindings.get('t');
      if (activation === undefined || !('value' in activation))
        throw new Error('no activation');
      markActivation(activation.value, staticBinding);
      try {
        return DerivativeModule.derivative(literal, 3);
      } finally {
        ce.popScope();
      }
    };

    const first = inCall(2);
    expect(first?.toString()).toBe('6 * |t|');
    // Count the `simplify()` calls of the second call.
    const simplify = jest.spyOn(Object.getPrototypeOf(first), 'simplify');
    try {
      const second = inCall(-3);
      expect(second?.toString()).toBe('6 * |t|');
      expect(simplify).toHaveBeenCalled();
    } finally {
      simplify.mockRestore();
    }
  });

  test('a recursive function that applies the derivative is unaffected', () => {
    // h(n) = f'''(n) + h(n - 1), h(0) = 0: each level is a new call of `h`
    // (a new activation), and each reads the cached closed form.
    const ce = machineEngine();
    ce.assign(
      'h',
      ce.box([
        'Function',
        [
          'If',
          ['LessEqual', 'n', 0],
          0,
          [
            'Add',
            ['Apply', ['Derivative', 'f', 3], 'n'],
            ['h', ['Subtract', 'n', 1]],
          ],
        ],
        'n',
      ])
    );
    let expected = 0;
    for (let n = 1; n <= 5; n++) expected += referenceThirdDerivative(n);
    expect(relative(ce.box(['h', 5]).N().re, expected)).toBeLessThan(1e-6);
  });
});

/** Count the calls of `differentiate()` from outside its module made while
 * `run` runs. Each partial derivative that is computed calls it at least
 * once; a partial derivative served from the cache does not call it. */
function differentiateCalls(run: () => void): number {
  const spy = jest.spyOn(DerivativeModule, 'differentiate');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe('the closed form of Derivative(f, k1, ..., kn) across evaluation points', () => {
  const partialAt = (
    ce: ComputeEngine,
    fn: string,
    orders: number[],
    x: number,
    y: number
  ): number =>
    ce.box(['Apply', ['Derivative', fn, ...orders], x, y]).N().re;

  test('a partial derivative of a library operator is computed once across 100 points', () => {
    const once = differentiateCalls(() =>
      partialAt(new ComputeEngine(), 'Arctan2', [1, 0], 0.5, 2)
    );
    expect(once).toBeGreaterThan(0);
    const ce = new ComputeEngine();
    const calls = differentiateCalls(() => {
      for (let i = 0; i < 100; i++) {
        const y = 0.1 + i / 50;
        // ∂/∂y atan2(y, x) = x / (x² + y²)
        expect(partialAt(ce, 'Arctan2', [1, 0], y, 2)).toBeCloseTo(
          2 / (4 + y * y),
          12
        );
      }
    });
    expect(calls).toBe(once);
  });

  test('a partial derivative of a user function of two arguments is computed once across 100 points', () => {
    const define = (ce: ComputeEngine) =>
      ce.parse('u(a, b) \\coloneq a^2 \\sin(b)').evaluate();
    const once = differentiateCalls(() => {
      const ce = new ComputeEngine();
      define(ce);
      partialAt(ce, 'u', [1, 1], 0.5, 2);
    });
    expect(once).toBeGreaterThan(0);
    const ce = new ComputeEngine();
    define(ce);
    const calls = differentiateCalls(() => {
      for (let i = 0; i < 100; i++) {
        const a = 0.1 + i / 50;
        // ∂²/∂a∂b a²·sin(b) = 2a·cos(b)
        expect(partialAt(ce, 'u', [1, 1], a, 0.7)).toBeCloseTo(
          2 * a * Math.cos(0.7),
          12
        );
      }
    });
    expect(calls).toBe(once);
  });

  test('redefining the function gives the new partial derivative', () => {
    const ce = new ComputeEngine();
    ce.parse('u(a, b) \\coloneq a^2 \\sin(b)').evaluate();
    expect(partialAt(ce, 'u', [1, 1], 1, 0)).toBeCloseTo(2, 12);
    expect(partialAt(ce, 'u', [1, 1], 2, 0)).toBeCloseTo(4, 12);
    ce.parse('u(a, b) \\coloneq a^3 b^2').evaluate();
    // ∂²/∂a∂b a³b² = 6a²b
    expect(partialAt(ce, 'u', [1, 1], 1, 1)).toBeCloseTo(6, 12);
    expect(partialAt(ce, 'u', [1, 1], 2, 3)).toBeCloseTo(72, 12);
  });

  test('reassigning a function that the function calls gives the new partial derivative', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Power', 'x', 2], 'x']));
    ce.parse('u(a, b) \\coloneq g(a) b').evaluate();
    // ∂/∂a a²·b = 2ab
    expect(partialAt(ce, 'u', [1, 0], 3, 2)).toBeCloseTo(12, 12);
    expect(partialAt(ce, 'u', [1, 0], 1, 2)).toBeCloseTo(4, 12);
    ce.assign('g', ce.box(['Function', ['Power', 'x', 3], 'x']));
    // ∂/∂a a³·b = 3a²b
    expect(partialAt(ce, 'u', [1, 0], 3, 2)).toBeCloseTo(54, 12);
    expect(partialAt(ce, 'u', [1, 0], 1, 2)).toBeCloseTo(6, 12);
  });

  test('assigning a free symbol of the function gives the new partial derivative', () => {
    const ce = new ComputeEngine();
    ce.assign('c', 2);
    ce.parse('u(a, b) \\coloneq c a b').evaluate();
    expect(partialAt(ce, 'u', [1, 1], 3, 4)).toBeCloseTo(2, 12);
    expect(partialAt(ce, 'u', [1, 1], 5, 6)).toBeCloseTo(2, 12);
    ce.assign('c', 5);
    expect(partialAt(ce, 'u', [1, 1], 3, 4)).toBeCloseTo(5, 12);
  });

  test('a partial derivative of a closure answers per call of the enclosing function', () => {
    // `g(t) = ((a, b) ↦ t·a²·b)` differentiated twice in `a` and once in `b`
    // is `2t`. The literal is one node of the body of `g`, shared by every
    // call, so its cached partial derivative must not carry the value of `t`
    // of an earlier call.
    const ce = new ComputeEngine({ precision: 'machine' });
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Apply',
          [
            'Derivative',
            [
              'Function',
              ['Multiply', 't', ['Power', 'a', 2], 'b'],
              'a',
              'b',
            ],
            2,
            1,
          ],
          1,
          1,
        ],
        't',
      ])
    );
    for (const t of [2, 3, 5, -1])
      expect(ce.box(['g', t]).N().re).toBeCloseTo(2 * t, 12);
  });

  test('a partial derivative with no closed form is cached as inert', () => {
    // The partial of `Round(x, y)` in `y` holds an unresolved `D`: the node
    // stays inert. The memo records that answer, so a second request does
    // not differentiate again, and it does not serve the function literal
    // with the free `D` that the arm made before.
    const ce = new ComputeEngine();
    ce.parse('f(x, y) \\coloneq \\operatorname{Round}(x, y)').evaluate();
    const first = differentiateCalls(() =>
      expect(ce.box(['Derivative', 'f', 0, 1]).evaluate().json).toEqual([
        'Derivative',
        'f',
        0,
        1,
      ])
    );
    expect(first).toBeGreaterThan(0);
    const second = differentiateCalls(() =>
      expect(ce.box(['Derivative', 'f', 0, 1]).evaluate().json).toEqual([
        'Derivative',
        'f',
        0,
        1,
      ])
    );
    expect(second).toBe(0);
  });

  test('declares nothing in the caller scope', () => {
    const ce = new ComputeEngine();
    for (let i = 0; i < 3; i++) partialAt(ce, 'Arctan2', [1, 1], 0.5 + i, 2);
    for (const name of ['_1', '_2', 'x_1', 'x_2'])
      expect(ce.lookupDefinition(name)).toBeUndefined();
  });
});
