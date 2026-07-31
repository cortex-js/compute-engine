/**
 * Compile lowering for the derivative heads (`D`, `Derivative`, `ND`).
 *
 * The differentiation itself has no runtime counterpart on any target, but
 * its closed form is an ordinary expression the compiler already handles, so
 * the per-operator `compile` handler evaluates first and compiles the result.
 * When there is no closed form, the handler must DECLINE (return `undefined`)
 * rather than throw — a throw from a per-operator handler would pre-empt a
 * custom target that does map the head.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();

/** Central difference of `f` at `x` — an independent numeric reference. */
function finiteDiff(latex: string, x: number): number {
  const f = ce.parse(latex);
  const h = 1e-5;
  const hi = f.subs({ x: ce.number(x + h) }).N().re!;
  const lo = f.subs({ x: ce.number(x - h) }).N().re!;
  return (hi - lo) / (2 * h);
}

describe('COMPILE DERIVATIVE — closed-form lowering', () => {
  test('D(x^2, x) compiles on javascript', () => {
    const result = compile(ce.box(['D', ['Power', 'x', 2], 'x']));
    expect(result.success).toBe(true);
    expect(result.code).toBe('2 * _.x');
  });

  test('\\frac{d}{dx} x^2 compiles on javascript', () => {
    const result = compile(ce.parse('\\frac{d}{dx} x^2'));
    expect(result.success).toBe(true);
    expect(result.code).toBe('2 * _.x');
  });

  test('\\frac{d}{dx}\\sin(x) compiles on javascript', () => {
    const result = compile(ce.parse('\\frac{d}{dx}\\sin(x)'));
    expect(result.success).toBe(true);
    expect(result.code).toBe('Math.cos(_.x)');
  });

  test("Derivative-spelled \\sin'(x) compiles on javascript", () => {
    const result = compile(ce.parse("\\sin'(x)"));
    expect(result.success).toBe(true);
    expect(result.code).toBe('(((x) => Math.cos(x)))(_.x)');
  });

  test('a bare Derivative(Sin) compiles to a callable on javascript', () => {
    const result = compile(ce.box(['Derivative', 'Sin']));
    expect(result.success).toBe(true);
    expect(result.code).toBe('((x) => Math.cos(x))');
  });

  test('ND at a numeric point compiles to its value', () => {
    const result = compile(
      ce.box(['ND', ['Function', ['Sin', 'x'], 'x'], 1.5])
    );
    expect(result.success).toBe(true);
    expect(Number(result.code)).toBeCloseTo(Math.cos(1.5), 10);
  });

  test('a derivative nested in a larger expression compiles', () => {
    const result = compile(ce.parse('2 + \\frac{d}{dx} x^3'));
    expect(result.success).toBe(true);
    expect(result.code).toBe('3 * (_.x * _.x) + 2');
  });
});

describe('COMPILE DERIVATIVE — glsl', () => {
  const glsl = new GLSLTarget();

  test('D(x^2, x) compiles on glsl', () => {
    expect(glsl.compile(ce.box(['D', ['Power', 'x', 2], 'x'])).code).toBe(
      '2.0 * x'
    );
  });

  test('\\frac{d}{dx}\\sin(x) compiles on glsl', () => {
    expect(glsl.compile(ce.parse('\\frac{d}{dx}\\sin(x)')).code).toBe('cos(x)');
  });

  test('\\frac{d}{dx}(x^3 + \\cos(x)) compiles on glsl', () => {
    expect(glsl.compile(ce.parse('\\frac{d}{dx}(x^3+\\cos(x))')).code).toBe(
      '3.0 * (x * x) + -sin(x)'
    );
  });
});

describe('COMPILE DERIVATIVE — other targets', () => {
  test.each(['python', 'interval-js'] as const)(
    '\\frac{d}{dx}\\sin(x) compiles on %s',
    (to) => {
      const result = compile(ce.parse('\\frac{d}{dx}\\sin(x)'), { to });
      expect(result.success).toBe(true);
      expect(result.code).not.toContain('D(');
    }
  );
});

describe('COMPILE DERIVATIVE — numeric agreement with the interpreter', () => {
  const cases: [string, string][] = [
    ['\\frac{d}{dx} x^2', 'x^2'],
    ['\\frac{d}{dx}\\sin(x)', '\\sin(x)'],
    ['\\frac{d}{dx}(x^3+\\cos(x))', 'x^3+\\cos(x)'],
    ['\\frac{d}{dx} e^{2x}', 'e^{2x}'],
    ["\\sin'(x)", '\\sin(x)'],
  ];

  test.each(cases)(
    '%s matches the interpreter and a finite difference',
    (latex, base) => {
      const expr = ce.parse(latex);
      const result = compile(expr);
      expect(result.success).toBe(true);
      const fn = result.run as (scope: { x: number }) => number;
      // The derivative binds `x` in its own scope, so substitute into the
      // EVALUATED closed form to get the interpreter's value at a point.
      const closedForm = expr.evaluate();
      for (const x of [0.3, 1, 2.5, -1.7]) {
        const compiled = fn({ x });
        const interpreted = closedForm.subs({ x: ce.number(x) }).N().re!;
        expect(compiled).toBeCloseTo(interpreted, 12);
        expect(compiled).toBeCloseTo(finiteDiff(base, x), 4);
      }
    }
  );
});

describe('COMPILE DERIVATIVE — no closed form declines cleanly', () => {
  test('D of an opaque function declines with the standard message', () => {
    const engine = new ComputeEngine();
    engine.declare('f', 'function');
    const result = compile(engine.box(['D', ['f', 'x'], 'x']));
    expect(result.success).toBe(false);
    expect(result.error).toContain('D: cannot compile');
    expect(result.error).toContain('Fail closed (D6)');
  });

  test('ND at a symbolic point declines with the standard message', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'number');
    const result = compile(
      engine.box(['ND', ['Function', ['Power', 'x', 2], 'x'], 'y'])
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('ND: cannot compile');
    expect(result.error).toContain('Fail closed (D6)');
  });

  test('the decline does not throw out of compile() on glsl', () => {
    const engine = new ComputeEngine();
    engine.declare('f', 'function');
    const expr = engine.box(['D', ['f', 'x'], 'x']);
    expect(() => new GLSLTarget().compile(expr)).toThrow();
    const result = compile(expr, { to: 'glsl' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('D: cannot compile');
  });

  test('a closed form the target cannot lower declines, without throwing', () => {
    // `d/dx Γ(x) = Γ(x)ψ(x)` — a closed form, but glsl has no `Digamma`.
    // The handler catches the inner throw and DECLINES, so the report is the
    // generic `D`-level decline, not the more informative inner
    // `Digamma: … no lowering` message. That trade-off is deliberate: a
    // per-operator handler runs BEFORE the target's function table, so letting
    // the inner error escape would pre-empt a custom target that maps
    // `Digamma`. Do not "restore" the leaked inner message here.
    const expr = ce.box(['D', ['Gamma', 'x'], 'x']);
    expect(compile(expr).success).toBe(true);
    let result: ReturnType<typeof compile>;
    expect(() => {
      result = compile(expr, { to: 'glsl' });
    }).not.toThrow();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain('D: cannot compile');
    expect(result!.error).toContain('Fail closed (D6)');
    expect(result!.error).not.toContain('Digamma');
  });
});

describe('COMPILE DERIVATIVE — an impure body is not evaluated at compile time', () => {
  test('ND of a random body declines instead of freezing a sample', () => {
    // Evaluating would run the numerical stencil during COMPILATION, consuming
    // random draws and baking one sampled number into the emitted code.
    const engine = new ComputeEngine();
    const expr = engine.box(['ND', ['Function', ['Random'], 'x'], 1.5]);
    expect(expr.isPure).toBe(false);
    const first = compile(expr);
    const second = compile(expr);
    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
    expect(first.error).toContain('ND: cannot compile');
    expect(first.error).toContain('Fail closed (D6)');
  });

  test('a pure ND is still evaluated and compiled', () => {
    const engine = new ComputeEngine();
    const result = compile(
      engine.box(['ND', ['Function', ['Sin', 'x'], 'x'], 1.5])
    );
    expect(result.success).toBe(true);
    expect(Number(result.code)).toBeCloseTo(Math.cos(1.5), 10);
  });
});

describe('COMPILE DERIVATIVE — the no-closed-form guard is head-aware', () => {
  test('a closed form containing a free symbol named `D` compiles', () => {
    // `d/dx (D·x²) = 2D·x`, where `D` is an ordinary free symbol (a diffusion
    // coefficient, say). The guard must detect a surviving `D` APPLICATION,
    // not a symbol of the same name.
    const engine = new ComputeEngine();
    const expr = engine.box(['D', ['Multiply', 'D', ['Power', 'x', 2]], 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toBe('2 * _.D * _.x');
  });

  test('a surviving derivative APPLICATION still declines', () => {
    const engine = new ComputeEngine();
    engine.declare('f', 'function');
    const value = engine.box(['D', ['f', 'x'], 'x']).evaluate();
    // `Apply(Derivative(f, 1), x)` — a derivative head survives.
    expect(value.getSubexpressions('Derivative').length).toBeGreaterThan(0);
    const result = compile(engine.box(['D', ['f', 'x'], 'x']));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Fail closed (D6)');
  });
});

describe('COMPILE DERIVATIVE — compiling does not mutate the engine', () => {
  // Route matters. Boxing `["D", ["Multiply", "D", …], "x"]` canonicalizes
  // eagerly, so the devolution lands in the node's OWN `localScope` and never
  // reaches the engine. Parsing defers it, so the declaration happens during
  // the handler's `evaluate()` — the route that leaked.
  test.each([
    ['parse', (ce: ComputeEngine) => ce.parse('\\frac{d}{dx}(D x^2)')],
    [
      'box',
      (ce: ComputeEngine) =>
        ce.box(['D', ['Multiply', 'D', ['Power', 'x', 2]], 'x']),
    ],
  ] as const)(
    'a free symbol in the closed form does not shadow the `D` operator (%s route)',
    (_route, make) => {
      // The handler obtains the closed form by EVALUATING, and canonicalizing
      // `D·x²` devolves the un-applied builtin `D` into a variable by declaring
      // it (`devolveUnappliedOperator`). That declaration must stay inside the
      // handler's throwaway scope: landing it in the caller's scope would
      // replace the `D` OPERATOR definition for the engine's lifetime.
      const engine = new ComputeEngine();
      expect(Object.keys(engine.lookupDefinition('D')!)).toEqual(['operator']);

      const result = compile(make(engine));
      expect(result.success).toBe(true);
      expect(result.code).toBe('2 * _.D * _.x');

      expect(Object.keys(engine.lookupDefinition('D')!)).toEqual(['operator']);

      // ...and a later derivative still compiles on the same engine.
      const later = compile(engine.box(['D', ['Power', 'x', 2], 'x']));
      expect(later.success).toBe(true);
      expect(later.code).toBe('2 * _.x');
    }
  );

  test('a user variable named `D` does not hide the derivative lowering', () => {
    // Operator position resolves through `lookupApplicable`, which defers a
    // non-applicable shadow to the builtin — the rule binding already follows,
    // so an expression that EVALUATES must also compile.
    const engine = new ComputeEngine();
    engine.assign('D', 3);
    expect(engine.box(['D', ['Power', 'x', 2], 'x']).evaluate().toString()).toBe(
      '2x'
    );
    const result = compile(engine.box(['D', ['Power', 'x', 2], 'x']));
    expect(result.success).toBe(true);
    expect(result.code).toBe('2 * _.x');
  });
});
