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
    // The derivative's closed form is a function literal, which a
    // scalar-parameter literal's broadcast-aware wrapper binds before the
    // application.
    expect(result.code).toBe(
      '(((_tv1) => (_tv2) => Array.isArray(_tv2) ? _SYS.bcastFn(_tv1, _tv2) : ' +
        '_tv1(_tv2))(((x) => Math.cos(x))))(_.x)'
    );
  });

  test('a bare Derivative(Sin) compiles to a callable on javascript', () => {
    const result = compile(ce.box(['Derivative', 'Sin']));
    expect(result.success).toBe(true);
    expect(result.code).toBe(
      '((_tv1) => (_tv2) => Array.isArray(_tv2) ? _SYS.bcastFn(_tv1, _tv2) : ' +
        '_tv1(_tv2))(((x) => Math.cos(x)))'
    );
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

describe('COMPILE DERIVATIVE — partial derivatives of Arctan2', () => {
  // The closed forms −y/(x² + y²) and x/(x² + y²) compile on every target.
  // Before Arctan2 had a derivative, `D` stayed an inert
  // `Apply(Derivative("Arctan2", …), y, x)`: the javascript target used a
  // numeric derivative (`_SYS.nd`) and the other targets declined.
  test.each([
    ['javascript', 'x'],
    ['javascript', 'y'],
    ['interval-js', 'x'],
    ['interval-js', 'y'],
    ['glsl', 'x'],
    ['glsl', 'y'],
    ['wgsl', 'x'],
    ['wgsl', 'y'],
  ] as const)('D(Arctan2(y, x), %s) compiles on %s', (to, v) => {
    const expr = ce.box(['D', ['Arctan2', 'y', 'x'], v]);
    const result = compile(expr, { to, fallback: false });
    expect(result.success).toBe(true);
    expect(result.code).not.toContain('_SYS.nd');
    expect(result.code).not.toContain('Derivative');
  });

  test.each(['javascript', 'interval-js', 'glsl', 'wgsl'] as const)(
    'D(Mod(x, m), m) compiles on %s',
    (to) => {
      const result = compile(ce.box(['D', ['Mod', 'x', 'm'], 'm']), {
        to,
        fallback: false,
      });
      expect(result.success).toBe(true);
      expect(result.code).not.toContain('_SYS.nd');
    }
  );

  test('the multi-index form compiles on javascript', () => {
    // The other targets are checked in the group "applied derivative of a
    // function of two arguments" below.
    for (const expr of [
      ce.box(['Apply', ['Derivative', 'Arctan2', 1, 0], 'y', 'x']),
      ce.box(['Apply', ['Derivative', 'Power', 0, 1], 'x', 'n']),
    ]) {
      const result = compile(expr, { fallback: false });
      expect(result.success).toBe(true);
      expect(result.code).not.toContain('_SYS.nd');
    }
    const run = compile(
      ce.box(['Apply', ['Derivative', 'Arctan2', 1, 0], 'y', 'x'])
    ).run!;
    expect(run({ x: -1.4, y: -0.9 }) as number).toBeCloseTo(
      -1.4 / (1.4 * 1.4 + 0.9 * 0.9),
      12
    );
  });

  test('the javascript closed form matches a finite difference', () => {
    const dx = compile(ce.box(['D', ['Arctan2', 'y', 'x'], 'x'])).run!;
    const dy = compile(ce.box(['D', ['Arctan2', 'y', 'x'], 'y'])).run!;
    const h = 1e-6;
    for (const [x, y] of [
      [1.3, 0.7],
      [-0.8, 1.7],
      [-1.4, -0.9],
      [0.6, -1.1],
    ]) {
      const fdx = (Math.atan2(y, x + h) - Math.atan2(y, x - h)) / (2 * h);
      const fdy = (Math.atan2(y + h, x) - Math.atan2(y - h, x)) / (2 * h);
      expect(dx({ x, y }) as number).toBeCloseTo(fdx, 6);
      expect(dy({ x, y }) as number).toBeCloseTo(fdy, 6);
    }
  });
});

describe('COMPILE DERIVATIVE — applied derivative of a function of two arguments', () => {
  // `Apply(Derivative(F, k₁, k₂), a, b)` evaluates to a closed form, and
  // every target compiles that closed form. The interval and shader targets
  // read it through `BaseCompiler.appliedDerivativeLiteral()`, which accepted
  // one argument only, so they declined this application.
  const CALLEES: [string, number, number][] = [
    ['Power', 1, 0],
    ['Power', 0, 1],
    ['Log', 0, 1],
    ['Arctan2', 1, 0],
    ['Arctan2', 0, 1],
    ['Mod', 0, 1],
    ['h', 1, 0],
    ['h', 0, 1],
    ['h', 1, 1],
  ];
  const POINTS = [
    [1.7, 2.3],
    [0.4, 3.1],
    [2.5, 0.6],
  ];

  for (const unit of ['rad', 'deg'] as const) {
    const ce2 = new ComputeEngine();
    ce2.angularUnit = unit;
    ce2.declare('h', 'function');
    ce2.assign('h', ce2.parse('(u, w) \\mapsto u^2 \\sin(w)'));

    test.each(CALLEES)(
      `${unit}: Derivative(%s, %i, %i) applied to (x, n) agrees with the closed form`,
      (f, k1, k2) => {
        const expr = ce2.box(['Apply', ['Derivative', f, k1, k2], 'x', 'n']);
        const closedForm = expr.evaluate();
        expect(closedForm.has('Derivative')).toBe(false);
        const js = compile(expr, { to: 'javascript', fallback: false });
        const iv = compile(expr, { to: 'interval-js', fallback: false });
        expect(js.success).toBe(true);
        expect(iv.success).toBe(true);
        expect(js.code).not.toContain('_SYS.nd');
        for (const [x, n] of POINTS) {
          const expected = closedForm.subs({ x, n }).N().re;
          const actual = js.run!({ x, n });
          expect(typeof actual).toBe('number');
          expect(actual as number).toBeCloseTo(expected, 10);
          const r = iv.run!({ x, n }) as any;
          const v = (r.kind === 'interval' ? r.value : r) as {
            lo: number;
            hi: number;
          };
          expect(v.lo).toBeLessThanOrEqual(expected + 1e-12);
          expect(v.hi).toBeGreaterThanOrEqual(expected - 1e-12);
        }
        for (const to of ['glsl', 'wgsl'] as const) {
          const gpu = compile(expr, { to, fallback: false });
          expect(gpu.success).toBe(true);
          expect(gpu.code).not.toContain('Derivative');
        }
      }
    );
  }

  /** The error of a compilation that declines, thrown or returned. */
  function declineMessage(expr: ReturnType<typeof ce.box>, to: string) {
    try {
      const r = compile(expr, { to, fallback: false } as never) as {
        success: boolean;
        error?: string;
      };
      expect(r.success).toBe(false);
      return r.error ?? '';
    } catch (e) {
      return String(e);
    }
  }

  test.each([
    // The derivative of `BesselJ` in its order and of the upper incomplete
    // `Gamma` in its first argument have no closed form.
    ['BesselJ', 'javascript'],
    ['BesselJ', 'interval-js'],
    ['BesselJ', 'glsl'],
    ['BesselJ', 'wgsl'],
    ['Gamma', 'javascript'],
    ['Gamma', 'interval-js'],
    ['Gamma', 'glsl'],
    ['Gamma', 'wgsl'],
  ])('Derivative(%s, 1, 0) with no closed form declines on %s', (f, to) => {
    const expr = ce.box(['Apply', ['Derivative', f, 1, 0], 's', 'x']);
    expect(declineMessage(expr, to)).toMatch(
      /Could not compile `Apply`: the derivative has no closed form/
    );
  });

  test.each(['javascript', 'interval-js', 'glsl', 'wgsl'])(
    'a high mixed order of a large function of two arguments declines quickly on %s',
    (to) => {
      // The closed form of this mixed derivative of order 3 takes more than
      // 20 seconds to compute and has more than 20,000 nodes. The size of
      // the body and the total order decide before any differentiation, with
      // the measure used for a function of one argument. The javascript
      // target has no numerical derivative of a function of two arguments.
      const ceBig = new ComputeEngine();
      ceBig.declare('H', 'function');
      ceBig.assign(
        'H',
        ceBig.parse(
          '(u, w) \\mapsto \\sqrt{u+\\sqrt{w+\\sqrt{u w+\\sqrt{u+w}}}}'
        )
      );
      const expr = ceBig.box(['Apply', ['Derivative', 'H', 2, 1], 'x', 'y']);
      const start = Date.now();
      expect(declineMessage(expr, to)).toMatch(
        /Could not compile `Apply`: the closed form of the derivative is too large to write out/
      );
      // The decline with the interpreter fallback does not compute the
      // closed form either.
      const fallback = compile(expr, { to, fallback: true } as never) as {
        success: boolean;
      };
      expect(fallback.success).toBe(false);
      // The time depends on the load of the machine, so the limit is asserted
      // only in a `CE_PERF=1` run. The decline checks above do not depend on
      // time.
      if (process.env.CE_PERF === '1')
        expect(Date.now() - start).toBeLessThan(2000);
      // The first derivative of the same body has a closed form of a useful
      // size, as for a function of one argument.
      const first = ceBig.box(['Apply', ['Derivative', 'H', 1, 0], 'x', 'y']);
      expect(
        (
          compile(first, { to, fallback: false } as never) as {
            success: boolean;
          }
        ).success
      ).toBe(true);
    }
  );

  test('each decline gives its true reason', () => {
    // A closed form with the wrong number of parameters is an arity decline,
    // not a missing closed form.
    for (const to of ['javascript', 'interval-js', 'glsl', 'wgsl']) {
      expect(
        declineMessage(
          ce.box(['Apply', ['Derivative', 'Power', 0, 1], 'x']),
          to
        )
      ).toContain('takes 2 parameter(s) but 1 argument(s)');
      expect(
        declineMessage(
          ce.box(['Apply', ['Derivative', 'Sin', 1], 'x', 'y']),
          to
        )
      ).toContain('takes 1 parameter(s) but 2 argument(s)');
    }
    // A third derivative of a large body has a closed form, but it is too
    // large to write out. The javascript target compiles it with
    // forward-mode differentiation; the other targets decline it.
    const ceBig = new ComputeEngine();
    ceBig.parse('f(x):=\\sqrt{x+\\sqrt{x+\\sqrt{x+\\sqrt{x+x}}}}').evaluate();
    const big = ceBig.box(['Apply', ['Derivative', 'f', 3], 'x']);
    for (const to of ['interval-js', 'glsl', 'wgsl'])
      expect(declineMessage(big, to)).toMatch(
        /the closed form of the derivative is too large to write out/
      );
  });

  test('javascript declines an application with the wrong number of arguments', () => {
    // The interpreter curries `((a, b) ↦ a + b)(x)` into a function of one
    // argument, and rejects `(a ↦ a + 1)(x, y)`. A JavaScript call does
    // neither: it answered `NaN` and `x + 1`.
    for (const [expr, message] of [
      [
        ['Apply', ['Function', ['Add', 'a', 'b'], 'a', 'b'], 'x'],
        'takes 2 parameter(s) but 1 argument(s)',
      ],
      [
        ['Apply', ['Function', ['Add', 'a', 1], 'a'], 'x', 'y'],
        'takes 1 parameter(s) but 2 argument(s)',
      ],
      [
        ['Apply', ['Derivative', 'Power', 0, 1], 'x'],
        'takes 2 parameter(s) but 1 argument(s)',
      ],
    ] as const) {
      expect(declineMessage(ce.box(expr as never), 'javascript')).toContain(
        message
      );
    }
  });
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
    expect(result.error).toContain('Could not compile `D`: ');
    expect(result.error).toContain('Could not compile');
  });

  test('ND at a RUNTIME point compiles to the numeric stencil', () => {
    // Changed by the item-177 shared-budget numeric fallback (user-ruled
    // 2026-08-14): a symbolic (runtime) evaluation point previously
    // declined ("ND at a symbolic point stays put"); it now lowers to
    // `_SYS.nd`, the same `centeredDiffHigherOrder` stencil the interpreted
    // `ND` evaluate handler runs, evaluated at the runtime value.
    const engine = new ComputeEngine();
    engine.declare('y', 'number');
    const result = compile(
      engine.box(['ND', ['Function', ['Power', 'x', 2], 'x'], 'y'])
    );
    expect(result.success).toBe(true);
    const run = result.run as (arg: { y: number }) => number;
    // d/dx x² = 2x; the 8th-order stencil is exact for polynomials up to
    // roundoff.
    expect(run({ y: 1.5 })).toBeCloseTo(3, 9);
    expect(run({ y: -0.25 })).toBeCloseTo(-0.5, 9);
  });

  test('the decline does not throw out of compile() on glsl', () => {
    const engine = new ComputeEngine();
    engine.declare('f', 'function');
    const expr = engine.box(['D', ['f', 'x'], 'x']);
    expect(() => new GLSLTarget().compile(expr)).toThrow();
    const result = compile(expr, { to: 'glsl' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not compile `D`: ');
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
    expect(result!.error).toContain('Could not compile `D`: ');
    expect(result!.error).toContain('Could not compile');
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
    expect(first.error).toContain('Could not compile `ND`: ');
    expect(first.error).toContain('Could not compile');
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
    expect(result.error).toContain('Could not compile');
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
    expect(
      engine
        .box(['D', ['Power', 'x', 2], 'x'])
        .evaluate()
        .toString()
    ).toBe('2x');
    const result = compile(engine.box(['D', ['Power', 'x', 2], 'x']));
    expect(result.success).toBe(true);
    expect(result.code).toBe('2 * _.x');
  });
});
