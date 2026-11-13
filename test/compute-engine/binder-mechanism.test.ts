import { ComputeEngine } from '../../src/compute-engine';
// Stage 11 (§2.1) has no public surface: an activation exists only while its
// call frame is pushed, so the pins below read the internal relation directly.
import { sameBindingDef } from '../../src/compute-engine/boxed-expression/binders';
import { compile } from '../../src/compile';

/**
 * Pins for the binders migrated onto the sanctioned binder mechanism in
 * stages 5–8 (`docs/SCOPING-MODEL.md`).
 *
 * The shared guarantee: a binder's bound variable is bound in the binder's OWN
 * scope, so the parse, `ce.box()` and `ce.function()` routes agree about what
 * the same expression is, and a same-named global value cannot reach the bound
 * occurrence.
 */

/**
 * Stage 5 — `Integrate`. The integrand's variable was already owned by its
 * `Function` literal, but the `Limits` operand's index was bound NOWHERE:
 * `canonicalLimits` passed `ops[0]` through untouched, leaving it raw on the
 * parse route and carrying the CALLER's binding on the `ce.function` route.
 * Measured against the unmodified tree: `isSame` was `false`.
 */
describe('Integrate: the limits index is bound by the integral', () => {
  test('the parse, box and function routes agree (definite)', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('\\int_0^1 x^2 \\,dx');
    const boxed = ce.box(['Integrate', ['Square', 'x'], ['Limits', 'x', 0, 1]]);
    const applied = ce.function('Integrate', [
      ce.parse('x^2'),
      ce.function('Limits', [ce.symbol('x'), ce.number(0), ce.number(1)]),
    ]);
    expect(parsed.isSame(boxed)).toBe(true);
    expect(parsed.isSame(applied)).toBe(true);
    expect(applied.evaluate().toString()).toEqual('1/3');
  });

  test('the parse and function routes agree (indefinite)', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('\\int x^2 \\,dx');
    const applied = ce.function('Integrate', [
      ce.parse('x^2'),
      ce.symbol('x'),
    ]);
    expect(parsed.isSame(applied)).toBe(true);
  });

  test('the integration variable is bound by the integral itself', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('\\int_0^1 x^2 \\,dx');
    expect([...(parsed.localScope?.bindings.keys() ?? [])]).toEqual(['x']);
  });

  test('an iterated integral binds both variables', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 1],
    ]);
    expect([...(e.localScope?.bindings.keys() ?? [])].sort()).toEqual([
      'x',
      'y',
    ]);
    expect(e.evaluate().toString()).toEqual('1/4');
  });

  test('a same-named global value does not reach the integral', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    expect(ce.parse('\\int_0^1 x^2 \\,dx').evaluate().toString()).toEqual(
      '1/3'
    );
    expect(ce.parse('\\int x^2 \\,dx').evaluate().toString()).toEqual(
      '1/3 * x^3'
    );
    expect(ce.box('x').evaluate().re).toEqual(5);
  });

  test('an indefinite integral is open in its variable and survives the frame', () => {
    // The result references the integration variable, so it leaves the
    // integral's own scope: `rebindEscapingCurrentScope` must re-point it at
    // the enclosing binding (the `Series` repair, stage 1).
    const ce = new ComputeEngine();
    const anti = ce.parse('\\int x^2 \\,dx').evaluate();
    expect(anti.toString()).toEqual('1/3 * x^3');
    // The escaped occurrence resolves in the ambient scope: assigning `x`
    // afterwards is visible to it.
    ce.assign('x', 3);
    expect(anti.evaluate().toString()).toEqual('9');
  });
});

/**
 * Stage 6 — `D`. It was `scoped: true` with a scope that was minted and never
 * populated; its variables are operands 1..n, and they were bound wherever the
 * CALLER had them. Measured against the unmodified tree:
 * `ce.parse('\\frac{d}{dx} x^2')` and
 * `ce.function('D', [ce.parse('x^2'), ce.symbol('x')])` were NOT `isSame`.
 *
 * Now the `bound` role of operands 1..n (the `operands` handler of `D`) plus the pre-budgeted
 * `rebindEscapingCurrentScope` in the evaluate handler — a derivative, like a
 * `Series` expansion and an antiderivative, is an OPEN expression in the bound
 * variable and would otherwise leave the frame referencing a dying binding.
 * The `withValueShield` at evaluate is unchanged (its retirement is stage 14),
 * and no double-shielding results.
 */
describe('D: the differentiation variables are bound by the derivative', () => {
  test('the parse, box and function routes agree', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('\\frac{d}{dx} x^2');
    const boxed = ce.box(['D', ['Square', 'x'], 'x']);
    const applied = ce.function('D', [ce.parse('x^2'), ce.symbol('x')]);
    expect(parsed.isSame(boxed)).toBe(true);
    expect(parsed.isSame(applied)).toBe(true);
    expect(applied.evaluate().toString()).toEqual('2x');
  });

  test('every variable operand is bound by the derivative itself', () => {
    const ce = new ComputeEngine();
    expect([
      ...(ce.parse('\\frac{d}{dx} x^2').localScope?.bindings.keys() ?? []),
    ]).toEqual(['x']);
    // Variadic: the `bound` role binds ALL the trailing variable operands.
    expect(
      [
        ...(ce
          .box(['D', ['Multiply', 'x', 'y'], 'x', 'y'])
          .localScope?.bindings.keys() ?? []),
      ].sort()
    ).toEqual(['x', 'y']);
  });

  test('a same-named global value does not reach the derivative', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    expect(ce.parse('\\frac{d}{dx} x^2').evaluate().toString()).toEqual('2x');
    // Other free symbols still resolve normally.
    expect(
      ce
        .box(['D', ['Multiply', 'a', ['Square', 'x']], 'x'])
        .evaluate()
        .toString()
    ).toEqual('6x');
    expect(ce.box('x').evaluate().re).toEqual(5);
  });

  test('a constant-named variable is bound by the derivative, not the constant', () => {
    // The `bound` role accepts any bare symbol, so `D(f, Pi)` is
    // user-reachable. Step 5 used to resolve the site with `ce.symbol(id)`,
    // which short-circuits to the interned constant for `Pi` — the node
    // declared a binding for `Pi` that nothing referenced. The defect was in
    // the binding IDENTITY, so that is what this pins; the value was already
    // right.
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Square', 'Pi'], 'Pi']);
    const binding = d.localScope?.bindings.get('Pi');
    const def = binding && 'value' in binding ? binding.value : undefined;
    expect(def).toBeDefined();
    const site = d.ops![1] as any;
    expect(site.symbol).toBe('Pi');
    expect(site.valueDefinition).toBe(def);
    expect(site.isConstant).toBe(false);
    expect(d.evaluate().toString()).toEqual('2pi');
    // The library constant is untouched outside the derivative.
    expect(ce.box('Pi').isConstant).toBe(true);
    expect(ce.box(['Square', 'Pi']).N().re).toBeCloseTo(Math.PI ** 2, 10);
    // ...and the ordinary shield still shields.
    ce.assign('x', 5);
    expect(ce.box(['D', ['Square', 'x'], 'x']).evaluate().toString()).toEqual(
      '2x'
    );
  });

  test('a derivative is open in its variable and survives the frame', () => {
    // Like a `Series` expansion and an indefinite integral, the result is an
    // OPEN expression in the bound variable: `rebindEscapingCurrentScope` must
    // re-point it at the enclosing binding on the way out.
    const ce = new ComputeEngine();
    const d = ce.parse('\\frac{d}{dx}\\sin x').evaluate();
    expect(d.isSame(ce.parse('\\cos x'))).toBe(true);
    ce.assign('x', 0);
    expect(d.evaluate().toString()).toEqual('1');
  });
});

/**
 * The ACCEPTED consequence of the mechanism, pinned for both an operand-site
 * binder (`Sum`) and a rebound-body binder (`D`): a binder's own operands are
 * NOT interchangeable with the same expression written free-standing.
 *
 * The bound variable inside the node denotes THE BINDER's variable; a symbol
 * of the same name outside denotes whatever the ambient scope has. Equality is
 * binding-identity-aware (see `compare.ts`), so the two compare unequal — by
 * design, and the whole point of the repair. Post-phase step 6 extends this to
 * a PRE-BOXED body handed to `ce.box`/`ce.function`: it is rebound to the
 * binder's scope, so it stops being `isSame` the expression it was built from.
 *
 * A consumer that lifts a binder's body back OUT into the ambient scope must
 * therefore re-bind it (`rebindEscaping`) — `explain('D')`, `liftIntegrand`
 * and the Jacobian body lift all do. See
 * `docs/SCOPING-MODEL.md` 5–8 round.
 */
describe('a binder owns its bound variable: body identity is not ambient identity', () => {
  test('Sum: the index inside the sum is not the ambient index', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{k=1}^{3} k').op1.isSame(ce.box('k'))).toBe(false);
    // Including a body that was boxed BEFORE the sum existed.
    expect(
      ce
        .box(['Sum', ce.box('k'), ['Limits', 'k', 1, 3]])
        .op1.isSame(ce.box('k'))
    ).toBe(false);
  });

  test('D: the pre-boxed receiver body is rebound to the derivative', () => {
    const ce = new ComputeEngine();
    const body = ce.parse('x^2');
    const d = ce.box(['D', body, 'x']);
    expect(d.op1.toString()).toEqual('x^2');
    expect(d.op1.isSame(body)).toBe(false);
    // ...because its `x` now denotes the binding `D` declares for it.
    const bound = d.localScope!.bindings.get('x') as { value: unknown };
    expect((d.op1.ops![0] as any).valueDefinition).toBe(bound.value);
  });
});

/**
 * Stage 8 — the quantifiers (`ForAll`, `Exists`, `NotExists`, `ExistsUnique`,
 * `NotForAll`). They were `scoped: true`, `lazy: true`, with NO canonical
 * handler at all: the `localScope` was created and stayed empty forever, and
 * `evaluateExists` recovered the variable by digging
 * (`sym(condition) ?? sym(condition.op1)`). The latent sixth sighting of
 * §The recurring defect.
 *
 * Measured against the unmodified tree: the round-trip pins PASSED (both sides
 * are raw, so they compare syntactically), but the SHADOWING pin failed —
 * `∀x. x > 4` with `x := 5` assigned evaluated to `True`, i.e. the bound
 * occurrence resolved the global's value.
 */
describe('quantifiers: the quantified variable is bound by the quantifier', () => {
  test('round-trip: parse → serialize → parse', () => {
    const ce = new ComputeEngine();
    for (const s of [
      '\\forall x, x \\gt 0',
      '\\exists x, x \\gt 0',
      '\\forall x \\in \\{1,2,3\\}, x \\gt 0',
      '\\exists x \\in \\{1,2,3\\}, x \\gt 2',
      '\\exists! x \\in \\{1,2\\}, x \\gt 1',
    ]) {
      const e = ce.parse(s);
      expect(e.isSame(ce.parse(e.latex))).toBe(true);
    }
  });

  test('the variable is bound by the quantifier itself', () => {
    const ce = new ComputeEngine();
    expect([
      ...(ce.parse('\\forall x, x \\gt 0').localScope?.bindings.keys() ?? []),
    ]).toEqual(['x']);
    expect([
      ...(ce
        .parse('\\exists x \\in \\{1,2,3\\}, x \\gt 2')
        .localScope?.bindings.keys() ?? []),
    ]).toEqual(['x']);
  });

  test('the box and parse routes agree', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .parse('\\forall x, x \\gt 0')
        .isSame(ce.box(['ForAll', 'x', ['Greater', 'x', 0]]))
    ).toBe(true);
    expect(
      ce
        .parse('\\exists x \\in \\{1,2,3\\}, x \\gt 2')
        .isSame(
          ce.box([
            'Exists',
            ['Element', 'x', ['Set', 1, 2, 3]],
            ['Greater', 'x', 2],
          ])
        )
    ).toBe(true);
  });

  test('the bound variable shadows an assigned global', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    // `x` is the QUANTIFIED variable: `x := 5` must not reach it, so neither
    // quantifier can be discharged by the global's value.
    expect(ce.parse('\\forall x, x \\gt 4').evaluate().toString()).not.toEqual(
      '"True"'
    );
    expect(ce.parse('\\exists x, x \\gt 4').evaluate().toString()).not.toEqual(
      '"True"'
    );
    // The global itself is untouched.
    expect(ce.box('x').evaluate().re).toEqual(5);
  });

  test('a finite domain is quantified over its own values, not the global', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    expect(
      ce.parse('\\forall x \\in \\{1,2,3\\}, x \\gt 0').evaluate().toString()
    ).toEqual('"True"');
    expect(
      ce.parse('\\exists x \\in \\{1,2,3\\}, x \\gt 4').evaluate().toString()
    ).toEqual('"False"');
    expect(
      ce.parse('\\forall x \\in \\{1,2,3\\}, x \\gt 4').evaluate().toString()
    ).toEqual('"False"');
    expect(ce.box('x').evaluate().re).toEqual(5);
  });
});

/**
 * Stage 7 — `Limit`. **The design's defect row is FALSIFIED** (measured
 * 2026-07-26): all three paths through the canonical handler — the `To`-form
 * rewrite, the Wolfram-style `Limit(expr, var, point)` form via
 * `canonicalFunctionLiteralArguments`, and the fall-through via
 * `canonicalFunctionLiteral` — already funnel into the SAME canonical shape,
 * `Limit(Function(Block(body), x), point[, dir])`, with the variable owned by
 * the literal's body `Block`. Every route (`parse`, `ce.box`, `ce.function`)
 * already agrees.
 *
 * So `Limit` was NOT migrated: giving it `scoped: lambdaParamSites(0)` was
 * tried and binds the variable a SECOND time in the `Limit` node's own scope,
 * on top of the literal's — the "two live bindings at once" state the mechanism
 * exists to eliminate. `Limit`'s variable is a `Function` literal parameter and
 * belongs to stage 10.
 *
 * These pins lock the uniformity in, so a future change to either
 * `canonicalFunctionLiteral` path cannot silently break it.
 */
describe('Limit: all three canonical paths bind the variable uniformly', () => {
  const body = ['Divide', ['Sin', 'x'], 'x'];

  test('the To-form, Wolfram form and inferred form agree', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('\\lim_{x\\to 0}\\frac{\\sin x}{x}');
    const inferred = ce.box(['Limit', body, 0]);
    const wolfram = ce.box(['Limit', body, 'x', 0]);
    const toForm = ce.box(['Limit', body, ['To', 'x', 0]]);
    const applied = ce.function('Limit', [
      ce.parse('\\frac{\\sin x}{x}'),
      ce.symbol('x'),
      ce.number(0),
    ]);
    for (const e of [inferred, wolfram, toForm, applied])
      expect(parsed.isSame(e)).toBe(true);
    expect(parsed.evaluate().toString()).toEqual('1');
  });

  test('the variable is owned by the Function literal, not by Limit', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\lim_{x\\to 0}\\frac{\\sin x}{x}');
    // A single binding, in the literal's body Block — NOT a second one here.
    expect(e.localScope).toBeUndefined();
    expect([
      ...(e.ops![0].ops![0].localScope?.bindings.keys() ?? []),
    ]).toEqual(['x']);
  });

  test('a same-named global value does not reach the limit', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    expect(
      ce.parse('\\lim_{x\\to 0}\\frac{\\sin x}{x}').evaluate().toString()
    ).toEqual('1');
    expect(ce.box(['Limit', body, 'x', 0]).evaluate().toString()).toEqual('1');
    expect(ce.box('x').evaluate().re).toEqual(5);
  });

  // The implicit form `Limit(expr, point)` does not write its variable. The
  // variable comes from the symbols written in the body, assigned or not, so
  // the order of boxing and assignment does not change it. Before, an
  // assignment made before boxing removed `x` from the unknowns of the body,
  // and `Limit(√x, a)` was the limit of the constant `√4 = 2`.
  describe('the implicit variable ignores an assigned value', () => {
    const make = () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('a', 'real');
      ce.declare('y', 'real');
      return ce;
    };
    const assign = (ce: ComputeEngine) => {
      ce.assign('x', 4);
      ce.assign('a', 3);
      ce.assign('y', 5);
    };
    const cases: [string, any, number][] = [
      ['Limit(√x, a)', ['Limit', ['Sqrt', 'x'], 'a'], Math.sqrt(3)],
      ['Limit(√x, a, 1)', ['Limit', ['Sqrt', 'x'], 'a', 1], Math.sqrt(3)],
      ['NLimit(√x, a)', ['NLimit', ['Sqrt', 'x'], 'a'], Math.sqrt(3)],
      // A parenthesized operand is the expression it holds.
      ['Limit((√x), a)', ['Limit', ['Delimiter', ['Sqrt', 'x']], 'a'], Math.sqrt(3)],
      [
        'NLimit((√x), a)',
        ['NLimit', ['Delimiter', ['Sqrt', 'x']], 'a'],
        Math.sqrt(3),
      ],
      // Several symbols: `x` is the variable, `y` keeps its value.
      ['Limit(x·y, a)', ['Limit', ['Multiply', 'x', 'y'], 'a'], 15],
      // A constant is not a candidate.
      ['Limit(π·x, a)', ['Limit', ['Multiply', 'Pi', 'x'], 'a'], 3 * Math.PI],
      // The index of a `Sum` is bound in the body: not a candidate.
      [
        'Limit(Σ n^x, a)',
        ['Limit', ['Sum', ['Power', 'n', 'x'], ['Limits', 'n', 1, 3]], 'a'],
        36,
      ],
    ];
    // `NLimit` has no compiled form: only the interpreter is checked for it.
    const check = (e: ReturnType<ComputeEngine['box']>, expected: number) => {
      expect(e.N().re).toBeCloseTo(expected, 10);
      if (e.operator === 'Limit') {
        const c = compile(e, { to: 'javascript' });
        expect(c.success).toBe(true);
        expect(c.run!({}) as number).toBeCloseTo(expected, 10);
      }
    };
    for (const [label, json, expected] of cases) {
      test(`${label}: assign, then box`, () => {
        const ce = make();
        assign(ce);
        check(ce.box(json), expected);
      });
      test(`${label}: box, then assign`, () => {
        const ce = make();
        const e = ce.box(json);
        assign(ce);
        check(e, expected);
      });
    }

    test('the exact value and the LaTeX parse', () => {
      const ce = make();
      assign(ce);
      expect(ce.box(['Limit', ['Sqrt', 'x'], 'a']).evaluate().toString()).toBe(
        'sqrt(3)'
      );
      const parsed = ce.parse('\\lim_{x\\to a}\\sqrt{x}');
      expect(parsed.json).toEqual([
        'Limit',
        ['Function', ['Block', ['Sqrt', 'x']], 'x'],
        'a',
      ]);
      expect(parsed.evaluate().toString()).toBe('sqrt(3)');
    });

    // Several symbols and none is `x`: the variable is the first in sorted
    // order, `y`, whether `y` has a value at boxing or not. `z` stays free.
    test('Limit(y·z, 2): the first symbol in sorted order, in both orders', () => {
      const json = ['Limit', ['Multiply', 'y', 'z'], 2];
      for (const assignFirst of [true, false]) {
        const ce = new ComputeEngine();
        if (assignFirst) ce.assign('y', 3);
        const e = ce.box(json);
        if (!assignFirst) ce.assign('y', 3);
        expect(e.evaluate().toString()).toBe('2z');
        const c = compile(e, { to: 'javascript' });
        expect(c.success).toBe(true);
        expect(c.run!({ z: 7 })).toBe(14);
      }
    });

    // With nothing assigned, the variable is the first unknown in sorted
    // order, as before this rule, also when `x` is one of the symbols:
    // `Limit(a·x, 2)` is the limit as a → 2. The literal has `a` as its one
    // parameter, and compiled code reads `x` as a free input.
    test('Limit(a·x, 2) with nothing assigned keeps its variable', () => {
      const ce = new ComputeEngine();
      const e = ce.box(['Limit', ['Multiply', 'a', 'x'], 2]);
      expect(e.evaluate().toString()).toBe('2x');
      const c = compile(e, { to: 'javascript' });
      expect(c.run!({ x: 7 })).toBe(14);
    });
  });

  // `Integrate`, `D`, `Series`, `NIntegrate` and `ND` choose an implicit
  // variable as `Limit` does: from the symbols of the body, with or without
  // a value. The result is the same whether the value is assigned before or
  // after boxing, and it is the result of the form with the variable
  // written.
  describe('the implicit variable of the other calculus operators ignores an assigned value', () => {
    const assign = (ce: ComputeEngine) => {
      ce.assign('x', 4);
      ce.assign('y', 5);
    };
    // The implicit form, the same form with the variable written, and the
    // value of `evaluate()`.
    const cases: [string, any, any, string][] = [
      [
        'Integrate(√x, Limits(0, 1))',
        ['Integrate', ['Sqrt', 'x'], ['Limits', 0, 1]],
        ['Integrate', ['Sqrt', 'x'], ['Limits', 'x', 0, 1]],
        '2/3',
      ],
      // Several symbols: `x` is the variable, `y` keeps its value.
      [
        'Integrate(x·y, Limits(0, 1))',
        ['Integrate', ['Multiply', 'x', 'y'], ['Limits', 0, 1]],
        ['Integrate', ['Multiply', 'x', 'y'], ['Limits', 'x', 0, 1]],
        '5/2',
      ],
      // Two limits, two symbols: `x`, then `y`.
      [
        'Integrate(x·y, Limits(0, 1), Limits(0, 2))',
        ['Integrate', ['Multiply', 'x', 'y'], ['Limits', 0, 1], ['Limits', 0, 2]],
        [
          'Integrate',
          ['Multiply', 'x', 'y'],
          ['Limits', 'x', 0, 1],
          ['Limits', 'y', 0, 2],
        ],
        '1',
      ],
      // A bare symbol is the variable too.
      [
        'Integrate(x, Limits(0, 1))',
        ['Integrate', 'x', ['Limits', 0, 1]],
        ['Integrate', 'x', ['Limits', 'x', 0, 1]],
        '1/2',
      ],
      // A constant is not a candidate.
      [
        'Integrate(π·x, Limits(0, 1))',
        ['Integrate', ['Multiply', 'Pi', 'x'], ['Limits', 0, 1]],
        ['Integrate', ['Multiply', 'Pi', 'x'], ['Limits', 'x', 0, 1]],
        '1/2 * pi',
      ],
      ['D(x^3)', ['D', ['Power', 'x', 3]], ['D', ['Power', 'x', 3], 'x'], '3x^2'],
      // Several symbols and one of them is `x`: `x` is the variable.
      ['D(x·y)', ['D', ['Multiply', 'x', 'y']], ['D', ['Multiply', 'x', 'y'], 'x'], '5'],
      [
        'Series(sin x)',
        ['Series', ['Sin', 'x']],
        ['Series', ['Sin', 'x'], 'x'],
        'x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)',
      ],
      [
        'NIntegrate(√x, 0, 1)',
        ['NIntegrate', ['Sqrt', 'x'], 0, 1],
        ['NIntegrate', ['Function', ['Sqrt', 'x'], 'x'], 0, 1],
        '',
      ],
      [
        'ND(x^3, 1)',
        ['ND', ['Power', 'x', 3], 1],
        ['ND', ['Function', ['Power', 'x', 3], 'x'], 1],
        '',
      ],
    ];
    // The compiled value of `e`, or `'declined'` when the compilation
    // declines (`success: false`). An exception, at compile time or at run
    // time, is not caught: it fails the test.
    const run = (e: ReturnType<ComputeEngine['box']>): unknown => {
      const c = compile(e, { to: 'javascript' });
      return c.success ? c.run!({}) : 'declined';
    };
    for (const [label, implicit, written, value] of cases) {
      for (const assignFirst of [true, false]) {
        test(`${label}: ${assignFirst ? 'assign, then box' : 'box, then assign'}`, () => {
          const ce = new ComputeEngine();
          if (assignFirst) assign(ce);
          const e = ce.box(implicit);
          if (!assignFirst) assign(ce);
          const w = ce.box(written);
          if (value !== '') expect(e.evaluate().toString()).toBe(value);
          // `NIntegrate` gives a float and `Integrate` a measurement: the
          // numeric values are compared.
          const numeric = (x: ReturnType<ComputeEngine['box']>) =>
            x.operator === 'Measurement' ? x.op1.re : x.re;
          const [n, nw] = [e.N(), w.N()];
          if (Number.isNaN(numeric(n)) || Number.isNaN(numeric(nw)))
            expect(n.toString()).toBe(nw.toString());
          else expect(numeric(n)).toBeCloseTo(numeric(nw), 10);
          const compiled = run(e);
          const compiledWritten = run(w);
          if (typeof compiled === 'number')
            expect(compiled).toBeCloseTo(compiledWritten as number, 10);
          else expect(compiled).toEqual(compiledWritten);
        });
      }
    }

    // With nothing assigned, the variable is the one chosen before this rule.
    test('with nothing assigned, the variable is the same', () => {
      const ce = new ComputeEngine();
      expect(ce.box(['D', ['Multiply', 'x', 'y']]).json).toEqual([
        'D',
        ['Multiply', 'x', 'y'],
        'x',
      ]);
      // Several symbols, none is `x`: no variable.
      expect(ce.box(['D', ['Multiply', 'a', 'b']]).json).toEqual([
        'D',
        ['Multiply', 'a', 'b'],
      ]);
      expect(ce.box(['Series', ['Multiply', 'a', 'b']]).json).toEqual([
        'Series',
        ['Multiply', 'a', 'b'],
      ]);
      expect(
        ce.box(['Integrate', ['Sqrt', 'x'], ['Limits', 0, 1]]).evaluate().toString()
      ).toBe('2/3');
    });

    // Several symbols, none is `x`, one has a value: still no variable, in
    // both orders. Before this rule, `a := 2` made `b` the only unknown,
    // and so the variable, when `a` had its value at boxing.
    test('D(a·b) with a := 2 has no variable, in both orders', () => {
      for (const assignFirst of [true, false]) {
        const ce = new ComputeEngine();
        if (assignFirst) ce.assign('a', 2);
        const e = ce.box(['D', ['Multiply', 'a', 'b']]);
        if (!assignFirst) ce.assign('a', 2);
        expect(e.json).toEqual(['D', ['Multiply', 'a', 'b']]);
        expect(e.evaluate().toString()).toBe('D(a * b)');
      }
    });

    // A symbol that cannot hold a number is not a candidate: a list, a
    // string, a function. When its type is declared, both orders agree.
    describe('a symbol whose type is not numeric is not the variable', () => {
      const cases: [string, any, string][] = [
        [
          'Integrate(Sum(L)·t, Limits(0, 1))',
          ['Integrate', ['Multiply', ['Sum', 'L'], 't'], ['Limits', 0, 1]],
          '3',
        ],
        [
          'D(Length(L)·t^2)',
          ['D', ['Multiply', ['Length', 'L'], ['Power', 't', 2]]],
          '6t',
        ],
        ['Limit(Sum(L)·t, 1)', ['Limit', ['Multiply', ['Sum', 'L'], 't'], 1], '6'],
        [
          'NIntegrate(Length(s)·t, 0, 1)',
          ['NIntegrate', ['Multiply', ['Length', 's'], 't'], 0, 1],
          '1',
        ],
        // A function-valued symbol in a raw `Apply`.
        ['D(Apply(f, y))', ['D', ['Apply', 'f', 'y']], '2y'],
      ];
      const assign = (ce: ComputeEngine) => {
        ce.assign('L', ce.box(['List', 1, 2, 3]));
        ce.assign('s', ce.string('hi'));
        ce.assign('f', ce.box(['Function', ['Power', 't', 2], 't']));
      };
      for (const [label, json, value] of cases) {
        for (const assignFirst of [true, false]) {
          test(`${label}, declared: ${assignFirst ? 'assign, then box' : 'box, then assign'}`, () => {
            const ce = new ComputeEngine();
            ce.declare('L', 'list<integer>');
            ce.declare('s', 'string');
            ce.declare('f', 'function');
            if (assignFirst) assign(ce);
            const e = ce.box(json);
            if (!assignFirst) assign(ce);
            expect(e.evaluate().toString()).toBe(value);
            if (Number.isFinite(e.evaluate().re))
              expect(e.N().re).toBeCloseTo(e.evaluate().re, 10);
            else expect(e.N().toString()).toBe(value);
          });
        }
      }
      // With no declaration, the type is known when the value is assigned:
      // assigned before boxing, the symbol is not a candidate. (Assigned
      // after boxing, it was a candidate at boxing; see
      // `implicitVariableCandidates`.)
      test('not declared, assigned before boxing', () => {
        const ce = new ComputeEngine();
        ce.assign('L', ce.box(['List', 1, 2, 3]));
        ce.assign('s', ce.string('hi'));
        for (const [, json, value] of cases.slice(0, 4))
          expect(ce.box(json).evaluate().toString()).toBe(value);
      });
    });

    // The variable of a definite limit that names no variable is bound in
    // the integrand, as a written variable is: it is not an unknown.
    test('the implicit variable of Integrate is not an unknown', () => {
      const ce = new ComputeEngine();
      const xy = ['Multiply', 'x', 'y'];
      expect(ce.box(['Integrate', xy, ['Limits', 0, 1]]).unknowns).toEqual(['y']);
      expect(ce.box(['Integrate', xy, ['Limits', 'x', 0, 1]]).unknowns).toEqual(['y']);
      expect(
        ce.box(['Integrate', xy, ['Limits', 0, 1], ['Limits', 0, 1]]).unknowns
      ).toEqual([]);
      expect(ce.box(['Integrate', 'x', ['Limits', 0, 1]]).unknowns).toEqual([]);
      // The variable of an indefinite integral is not bound.
      expect(ce.box(['Integrate', xy, 'Nothing']).unknowns).toEqual(['x', 'y']);
      expect(ce.box(['NIntegrate', xy, 0, 1]).unknowns).toEqual(['y']);
      expect(ce.box(['ND', xy, 1]).unknowns).toEqual(['y']);
    });

    // CE-699: a non-canonical `Integrate` holds its integrand as written,
    // not as a function literal. It binds the variables that its canonical
    // form chooses, so `subs()` replaces the same symbols in the two forms.
    // Before, `subs({x: 3})` on the non-canonical form replaced `x`, and the
    // integral of `3y` over `y` was 3/2 where the canonical form gave `y/2`.
    describe('a non-canonical Integrate binds the variable of its canonical form', () => {
      const xy = ['Multiply', 'x', 'y'];
      const cases: [string, any][] = [
        ['Limits(Nothing, 0, 1)', ['Integrate', xy, ['Limits', 'Nothing', 0, 1]]],
        ['Limits(0, 1)', ['Integrate', xy, ['Limits', 0, 1]]],
        ['Tuple(Nothing, 0, 1)', ['Integrate', xy, ['Tuple', 'Nothing', 0, 1]]],
        ['Range(0, 1)', ['Integrate', xy, ['Range', 0, 1]]],
        [
          'two limits',
          ['Integrate', xy, ['Limits', 0, 1], ['Limits', 0, 2]],
        ],
        // The variable of an indefinite integral is not bound in either form.
        [
          'indefinite',
          ['Integrate', xy, ['Limits', 'Nothing', 'Nothing', 'Nothing']],
        ],
        // A written variable, and a function literal: unchanged.
        ['Limits(y, 0, 1)', ['Integrate', xy, ['Limits', 'y', 0, 1]]],
        [
          'Function(x·y, x)',
          ['Integrate', ['Function', xy, 'x'], ['Limits', 0, 1]],
        ],
      ];
      for (const [label, json] of cases) {
        test(label, () => {
          const ce = new ComputeEngine();
          const raw = ce.box(json, { form: 'raw' });
          const canonical = ce.box(json);
          expect(raw.isCanonical).toBe(false);
          expect(raw.freeVariables).toEqual(canonical.freeVariables);
          for (const v of ['x', 'y']) {
            // The indefinite integral chooses its variable when it is boxed,
            // so a substitution of that variable gives a different integral.
            if (label === 'indefinite' && v === 'x') continue;
            expect(raw.subs({ [v]: 3 }).canonical.evaluate().json).toEqual(
              canonical.subs({ [v]: 3 }).evaluate().json
            );
          }
        });
      }

      test('Limits(Nothing, 0, 1): the values', () => {
        const ce = new ComputeEngine();
        const raw = ce.box(['Integrate', xy, ['Limits', 'Nothing', 0, 1]], {
          form: 'raw',
        });
        expect(raw.freeVariables).toEqual(['y']);
        expect(raw.subs({ x: 3 }).canonical.evaluate().toString()).toBe(
          '1/2 * y'
        );
        expect(raw.subs({ y: 3 }).canonical.evaluate().toString()).toBe('3/2');
      });

      test('the LaTeX parse with form: raw', () => {
        const ce = new ComputeEngine();
        const raw = ce.parse('\\int_0^1 xy', { form: 'raw' });
        expect(raw.subs({ x: 3 }).canonical.evaluate().toString()).toBe(
          ce.parse('\\int_0^1 xy').subs({ x: 3 }).evaluate().toString()
        );
      });

      // A symbol with a value is a candidate, as in the canonical form: after
      // `x := 4`, `x` is the variable of `√x`, and `subs()` keeps it.
      test('a symbol with a value', () => {
        const ce = new ComputeEngine();
        ce.assign('x', 4);
        const raw = ce.box(['Integrate', ['Sqrt', 'x'], ['Limits', 0, 1]], {
          form: 'raw',
        });
        expect(raw.freeVariables).toEqual([]);
        expect(raw.subs({ x: 9 }).canonical.evaluate().toString()).toBe('2/3');
      });

      // A slot that a nested literal or a `Pipe` stage binds is not a free
      // slot of the integrand: the raw form binds `x`, as the canonical form
      // does.
      test('a slot bound inside the integrand', () => {
        const ce = new ComputeEngine();
        const bodies: any[] = [
          ['Multiply', 'x', ['Apply', ['Function', ['Multiply', '_1', '_1'], '_1'], 2]],
          ['Multiply', 'x', ['Pipe', 'ys', ['Multiply', '_', 2]]],
        ];
        for (const body of bodies) {
          const json = ['Integrate', body, ['Limits', 0, 1]];
          const raw = ce.box(json, { form: 'raw' });
          expect(raw.freeVariables).toEqual(ce.box(json).freeVariables);
          expect(raw.freeVariables).not.toContain('x');
          expect(raw.subs({ x: 3 }).isSame(raw)).toBe(true);
        }
      });

      // Limitation: the raw form reads the candidates from the integrand as
      // written, the canonical form from the canonical integrand. When
      // canonicalization removes a candidate (the `x` of `0·2·x`), the raw
      // form binds `x` and the canonical form binds `y`.
      test('a candidate that canonicalization removes (limitation)', () => {
        const ce = new ComputeEngine();
        const json = [
          'Integrate',
          ['Add', ['Multiply', 0, 2, 'x'], 'y'],
          ['Limits', 0, 1],
        ];
        const raw = ce.box(json, { form: 'raw' });
        const canonical = ce.box(json);
        expect(raw.freeVariables).toEqual(['y']);
        expect(canonical.freeVariables).toEqual([]);
        expect(raw.subs({ y: 3 }).canonical.evaluate().toString()).toBe('3');
        expect(canonical.subs({ y: 3 }).evaluate().toString()).toBe('1/2');
      });

      // The candidates of each raw integral are read with the memo of the
      // walk: with new walks at each level, a chain of 10 nested raw
      // integrals took about 26 s.
      test('a chain of 20 nested raw integrals', () => {
        const ce = new ComputeEngine();
        let json: any = ['Multiply', 'x', 'y'];
        for (let k = 0; k < 20; k++)
          json = ['Integrate', ['Multiply', json, `a${k}`], ['Limits', 0, 1]];
        const raw = ce.box(json, { form: 'raw' });
        // Each integral binds its own `a_k`, the first candidate in sorted
        // order. With one walk per path, the cost was exponential in the
        // depth (about 26 s for 10 levels); the per-test timeout catches a
        // return of that cost.
        expect(raw.freeVariables).toEqual(['x', 'y']);
        raw.subs({ y: 3 });
      });

      // The free slots of the integrand are read once per node and set of
      // bound names (`freeAnonymousSlots()`): a body that shares one node at
      // each level (`Add(d, d)`) inside a `Function` literal is walked once
      // per node, not once per path (2^30 paths for 30 levels).
      test('a shared subtree inside a function literal of the integrand', () => {
        const ce = new ComputeEngine();
        const raw = { form: 'raw' } as const;
        const integral = (depth: number) => {
          let d = ce.symbol('t', { canonical: false });
          for (let k = 0; k < depth; k++) d = ce.function('Add', [d, d], raw);
          const fn = ce.function(
            'Function',
            [d, ce.symbol('t', { canonical: false })],
            raw
          );
          const body = ce.function(
            'Multiply',
            [
              ce.symbol('x', { canonical: false }),
              ce.function('Apply', [fn, ce.number(2)], raw),
            ],
            raw
          );
          return ce.function(
            'Integrate',
            [body, ce.function('Limits', [ce.number(0), ce.number(1)], raw)],
            raw
          );
        };
        const deep = integral(30);
        expect(deep.isCanonical).toBe(false);
        expect(deep.freeVariables).toEqual([]);
        // `subs()` of a raw expression rebuilds a shared subtree once per
        // path, with or without an integral, so it is read at a smaller
        // depth.
        const shallow = integral(8);
        expect(shallow.subs({ x: 3 }).freeVariables).toEqual([]);
        expect(shallow.subs({ x: 3 }).isSame(shallow)).toBe(true);
      });
    });

    // The inner integral binds `x`, so the outer one takes `y`.
    test('nested implicit integrals: ∫_0^1∫_0^1 xy is 1/4', () => {
      for (const order of ['none', 'assign, then box', 'box, then assign']) {
        const ce = new ComputeEngine();
        if (order === 'assign, then box') ce.assign('x', 4);
        const e = ce.parse('\\int_0^1\\int_0^1 xy');
        if (order === 'box, then assign') ce.assign('x', 4);
        expect(e.evaluate().toString()).toBe('1/4');
        expect(e.N().re).toBeCloseTo(0.25, 12);
      }
      // The LaTeX of the form with two limits parses to the nested form,
      // with the same value.
      const ce = new ComputeEngine();
      const single = ce.box([
        'Integrate',
        ['Multiply', 'x', 'y'],
        ['Limits', 0, 1],
        ['Limits', 0, 1],
      ]);
      expect(single.evaluate().toString()).toBe('1/4');
      expect(ce.parse(single.latex).evaluate().toString()).toBe('1/4');
    });

    // With nothing assigned, a symbol that no limit takes is free: the
    // literal has one parameter for one limit.
    test('the canonical form of Integrate(x·y, Limits(0, 1))', () => {
      const ce = new ComputeEngine();
      expect(
        ce.box(['Integrate', ['Multiply', 'x', 'y'], ['Limits', 0, 1]]).json
      ).toEqual([
        'Integrate',
        ['Function', ['Block', ['Multiply', 'x', 'y']], 'x'],
        ['Limits', 'Nothing', 0, 1],
      ]);
      expect(
        ce.box([
          'Integrate',
          ['Multiply', 'x', 'y'],
          ['Limits', 0, 1],
          ['Limits', 0, 2],
        ]).json
      ).toEqual([
        'Integrate',
        ['Function', ['Block', ['Multiply', 'x', 'y']], 'x', 'y'],
        ['Limits', 'Nothing', 0, 1],
        ['Limits', 'Nothing', 0, 2],
      ]);
    });

    // `subs()` does not replace the implicit variable of an `Integrate` in
    // the integrand, as for a written variable. A replacement in a bound, or
    // of another symbol, is applied.
    test('subs() keeps the implicit variable of Integrate', () => {
      const ce = new ComputeEngine();
      const xy = ['Multiply', 'x', 'y'];
      for (const limit of [
        ['Limits', 0, 1],
        ['Limits', 'x', 0, 1],
      ]) {
        expect(
          ce.box(['Integrate', xy, limit]).subs({ x: 3 }).evaluate().toString()
        ).toBe('1/2 * y');
        expect(
          ce.box(['Integrate', xy, limit]).subs({ y: 3 }).evaluate().toString()
        ).toBe('3/2');
      }
      expect(
        ce.box(['Integrate', 'x', ['Limits', 0, 1]]).subs({ x: 3 }).evaluate().toString()
      ).toBe('1/2');
      expect(
        ce
          .box(['Integrate', xy, ['Limits', 0, 'x']])
          .subs({ x: 3 })
          .evaluate()
          .toString()
      ).toBe('9/2 * y');
    });

    // Every symbol of the integrand cannot hold a number: the literal has no
    // parameter, and `L` keeps its value, in both orders.
    test('Integrate(Length(L), Limits(0, 1)) with L: list<integer>', () => {
      for (const assignFirst of [true, false]) {
        const ce = new ComputeEngine();
        ce.declare('L', 'list<integer>');
        if (assignFirst) ce.assign('L', ce.box(['List', 1, 2, 3]));
        const e = ce.box(['Integrate', ['Length', 'L'], ['Limits', 0, 1]]);
        if (!assignFirst) ce.assign('L', ce.box(['List', 1, 2, 3]));
        expect(e.json).toEqual([
          'Integrate',
          ['Function', ['Block', ['Length', 'L']]],
          ['Limits', 'Nothing', 0, 1],
        ]);
        expect(e.evaluate().toString()).toBe('3');
        expect(e.N().re).toBeCloseTo(3, 12);
      }
    });

    // `D` reads its candidates from the canonical operand, as `Series` and
    // `Limit` do: the inner integral binds `x`, so the variable is `y`.
    test('D(∫₀¹ x·y): the variable is y', () => {
      const ce = new ComputeEngine();
      const integral = ['Integrate', ['Multiply', 'x', 'y'], ['Limits', 0, 1]];
      const e = ce.box(['D', integral]);
      expect(e.json).toEqual(ce.box(['D', integral, 'y']).json);
      expect(e.op2.toString()).toBe('y');
    });

    // A constant is not the implicit variable of a bare-symbol integrand:
    // `Pi` is not bound, and `subs()` replaces it.
    test('Integrate(Pi, Limits(0, 1)): Pi is not bound', () => {
      const ce = new ComputeEngine();
      const e = ce.box(['Integrate', 'Pi', ['Limits', 0, 1]]);
      expect(e.evaluate().toString()).toBe('pi');
      expect(e.subs({ Pi: 2 }).evaluate().toString()).toBe('2');
    });

    // A symbol declared `function` has a value definition, not an operator
    // definition. `D` reads it as a function symbol, as it reads a function
    // defined with `g(x) := x^2`: it applies the symbol to the variables, and
    // no implicit variable is chosen.
    test('D of a symbol declared function', () => {
      const ce = new ComputeEngine();
      ce.parse('g(x) := x^2').evaluate();
      ce.declare('f', 'function');
      ce.declare('h', 'function');
      ce.assign('h', ce.box(['Function', ['Power', 't', 3], 't']));
      expect(ce.box(['D', 'g']).json).toEqual(['D', ['g']]);
      expect(ce.box(['D', 'f']).json).toEqual(['D', ['f']]);
      expect(ce.box(['D', 'h']).json).toEqual(['D', ['h']]);
      expect(ce.parse('f \\rhd D').evaluate().toString()).toBe('D(f())');
      expect(ce.box(['D', 'g', 'x']).evaluate().toString()).toBe('2x');
      expect(ce.box(['D', 'f', 'x']).evaluate().toString()).toBe(
        'Apply(Derivative(f, 1), x)'
      );
      expect(ce.box(['D', 'h', 'x']).evaluate().toString()).toBe('3x^2');
    });
  });
});

/**
 * Stage 10 — `Function` parameters. The one binder that is NOT
 * definition-driven: its parameters go through `canonicalFunctionLiteral-
 * Arguments` + `rebindParameters` rather than through a `scoped` selector. It
 * now follows the same discipline all the same — the body `Block`'s binding is
 * the SINGLE authority for the parameter, referenced both by the parameter
 * operand (step 5) and by every occurrence in the body (step 6, which is now
 * literally the same `rebindToBindings` walk the mechanism's post-phase runs).
 *
 * The parameter operand used to be raw on the parse and `ce.box` routes and to
 * carry the CALLER's binding on the `ce.function` route — the same route
 * disagreement `Series` and `Integrate` were migrated to fix.
 *
 * This is also the tripwire for the "two live bindings at once" state that
 * falsified stage 7: a second binder declaring the parameter in ITS OWN scope,
 * on top of the literal's, would show up here as a parameter operand that no
 * longer matches the body's occurrences.
 */
describe('Function literal: the body Block is the single authority for a parameter', () => {
  /** The definition the literal's body Block binds `name` to. */
  const blockBinding = (literal: any, name: string) => {
    const binding = literal.op1.localScope?.bindings.get(name);
    return binding && 'value' in binding ? binding.value : undefined;
  };

  test('the parameter operand and the body occurrences are the SAME definition', () => {
    const ce = new ComputeEngine();
    const literals = [
      ce.box(['Function', ['Add', 'x', 1], 'x']),
      ce.parse('x \\mapsto x + 1'),
      // The `ce.function` route: `x` arrives carrying the CALLER's binding.
      ce.function('Function', [ce.parse('x + 1'), ce.symbol('x')]),
    ];
    for (const f of literals) {
      const def = blockBinding(f, 'x');
      expect(def).toBeDefined();
      // Binding IDENTITY, not `isSame`: the point is that there is exactly one
      // definition, not that two definitions happen to compare equal.
      expect((f.ops![1] as any).valueDefinition).toBe(def);
      // ...and the body's occurrence resolves to that same definition.
      const occurrence = (f.op1.op1 as any).ops[0];
      expect(occurrence.symbol).toBe('x');
      expect(occurrence.valueDefinition).toBe(def);
    }
  });

  test('an annotated parameter keeps its `Typed` wrapper and binds through it', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', 'n', 1],
      ['Typed', 'n', "'integer'"],
    ]);
    expect(f.ops![1].operator).toBe('Typed');
    expect((f.ops![1].op1 as any).valueDefinition).toBe(blockBinding(f, 'n'));
  });

  test('a parameter named after a library constant is bound like any other', () => {
    // The block binding is the authority, on EVERY route. `ce.symbol('Pi')`
    // cannot express it — it short-circuits to the interned constant before the
    // scope chain is consulted — so the binding site and the body's occurrences
    // are built from `scope.bindings` directly (`_bindingSymbol`). Before that,
    // this site "declined" and the `ce.function` route silently lost the
    // parameter: the literal applied to 10 gave `1 + π`.
    const ce = new ComputeEngine();
    const literals = [
      ce.box(['Function', ['Add', 'Pi', 1], 'Pi']),
      ce.parse('\\pi \\mapsto \\pi + 1'),
      ce.function('Function', [ce.parse('\\pi + 1'), ce.symbol('Pi')]),
    ];
    for (const f of literals) {
      const def = blockBinding(f, 'Pi');
      expect(def).toBeDefined();
      expect(f.ops![1].symbol).toBe('Pi');
      expect((f.ops![1] as any).valueDefinition).toBe(def);
      expect((f.ops![1] as any).isConstant).toBe(false);
      expect(ce.box(['Apply', f, 10]).evaluate().re).toEqual(11);
    }
  });

  test('a free constant inside such a literal is still the constant', () => {
    // Only the names the literal BINDS move: `Pi` here is free.
    const ce = new ComputeEngine();
    const f = ce.function('Function', [ce.parse('\\pi + x'), ce.symbol('x')]);
    expect(ce.box(['Apply', f, 0]).evaluate().toString()).toEqual('pi');
  });

  test('beta-reduction and closure capture are unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box([['Function', ['Add', 'x', 1], 'x'], 5]).evaluate().re
    ).toEqual(6);
    // The argument mentions the parameter's name: it must not double-apply.
    expect(
      ce
        .box(['Apply', ['Function', ['Add', 'x', 1], 'x'], ['Add', 'x', 1]])
        .evaluate()
        .toString()
    ).toEqual('x + 2');
  });
});

/**
 * `makeLambda` call frames are activations of the body scope of the literal:
 * the frame holds the literal's own (static) definition of each parameter,
 * and the value of the parameter in this call is in the activation of the
 * frame (`holdBodyLocals()` in `function-utils.ts`). Two calls in progress
 * share the definition and keep their values apart.
 */
describe('Function call frames are activations of the literal binding', () => {
  /** Capture the call frame's binding for `name` from inside the body, by
   * evaluating a probe operator there. The activation only exists while the
   * frame is pushed, so there is no public surface that reaches it. */
  const framesOf = (
    ce: ComputeEngine,
    name: string
  ): { frames: any[]; probe: string } => {
    const frames: any[] = [];
    ce.declare('BmProbe', {
      signature: '() -> number',
      evaluate: () => {
        const binding = ce.context.lexicalScope?.bindings.get(name);
        frames.push(binding && 'value' in binding ? binding.value : undefined);
        return ce.number(0);
      },
    });
    return { frames, probe: 'BmProbe' };
  };

  test('the frame holds the definition of the literal', () => {
    const ce = new ComputeEngine();
    const { frames } = framesOf(ce, 'x');
    const f = ce.box(['Function', ['Add', 'x', ['BmProbe']], 'x']);
    const staticDef = (f.ops![1] as any).valueDefinition;
    expect(staticDef).toBeDefined();

    expect(ce.box(['Apply', f, 5]).evaluate().re).toEqual(5);
    expect(frames.length).toBe(1);
    expect(frames[0]).toBe(staticDef);
    expect(sameBindingDef(frames[0], staticDef)).toBe(true);
    expect(sameBindingDef(staticDef, frames[0])).toBe(true);
  });

  test('N nested activations hold one definition', () => {
    // Several simultaneous calls of one literal share its definition; each
    // keeps its value in its own activation.
    const ce = new ComputeEngine();
    const { frames } = framesOf(ce, 'n');
    ce.box([
      'Assign',
      'bm_fact',
      [
        'Function',
        [
          'If',
          ['LessEqual', 'n', 1],
          1,
          [
            'Add',
            ['BmProbe'],
            ['Multiply', 'n', ['bm_fact', ['Subtract', 'n', 1]]],
          ],
        ],
        'n',
      ],
    ]).evaluate();

    expect(ce.box(['bm_fact', 5]).evaluate().re).toEqual(120);

    // Four frames were live simultaneously (n = 5, 4, 3, 2).
    expect(frames.length).toBe(4);
    expect(new Set(frames).size).toBe(1);
    expect(frames[0]).toBeDefined();
  });

  test('a recursive lambda still evaluates through `Apply`', () => {
    // The self-referencing `makeLambda` application, as opposed to the operator
    // route above: `Apply` on the symbol goes through `makeLambda` directly.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'bm_countdown',
      [
        'Function',
        ['If', ['LessEqual', 'k', 0], 0, ['Apply', 'bm_countdown', ['Subtract', 'k', 1]]],
        'k',
      ],
    ]).evaluate();
    expect(ce.box(['Apply', 'bm_countdown', 4]).evaluate().re).toEqual(0);
  });

  test('two closures from one factory stay distinct', () => {
    // The two closures share the definition of `p`; each keeps the
    // activation of the call that made it, which holds its value of `p`.
    const ce = new ComputeEngine();
    ce.declare('bm_mk', 'function');
    ce.assign(
      'bm_mk',
      ce.expr([
        'Function',
        ['Block', ['Function', ['Block', ['Add', 'q', 'p']], 'q']],
        'p',
      ])
    );
    ce.declare('bm_g', 'function');
    ce.declare('bm_h', 'function');
    ce.assign('bm_g', ce.expr(['bm_mk', 3]).evaluate());
    ce.assign('bm_h', ce.expr(['bm_mk', 7]).evaluate());
    expect(ce.expr(['bm_g', 10]).evaluate().re).toEqual(13);
    expect(ce.expr(['bm_h', 10]).evaluate().re).toEqual(17);
    expect(ce.expr(['bm_g', 10]).evaluate().re).toEqual(13);
  });

  test('an Integrate-derived literal binds its parameter to the Block binding', () => {
    // `Integrate`'s canonical handler passes the integration variables to
    // `canonicalFunctionLiteral` as the intended parameter list, so a
    // shorthand integrand's literal is built by
    // `canonicalFunctionLiteralArguments` — the parameter operand comes back
    // BOUND to the body Block's own binding, and the frame holds that same
    // binding. (An earlier version of the handler rebuilt the
    // literal with `ce._fn('Function', [f.op1, ...vars])`, leaving the
    // parameter operand raw; that route is gone — the raw-parameter fallback
    // is covered by the hand-built test below.)
    const ce = new ComputeEngine();
    const frames: any[] = [];
    ce.declare('BmIntProbe', {
      signature: '() -> number',
      // The probe records the scope it is evaluated in, so it is NOT pure.
      // Declaring it impure also keeps compile-time constant folding from
      // evaluating the argument-free `BmIntProbe()` subtree once, at compile
      // time, outside any call frame — which would replace the activation
      // frames this test inspects with a single non-activation record.
      pure: false,
      evaluate: () => {
        const binding = ce.context.lexicalScope?.bindings.get('x');
        frames.push(binding && 'value' in binding ? binding.value : undefined);
        return ce.number(0);
      },
    });
    const integral: any = ce.box([
      'Integrate',
      ['Add', ['Power', 'x', 2], ['BmIntProbe']],
      ['Limits', 'x', 0, 1],
    ]);
    const literal = integral.op1;
    expect(literal.operator).toBe('Function');
    const binding: any = literal.op1.localScope!.bindings.get('x');
    const blockDef = binding && 'value' in binding ? binding.value : undefined;
    expect(blockDef).toBeDefined();
    // The parameter operand is bound, to the body Block's own binding.
    expect((literal.ops[1] as any).valueDefinition).toBe(blockDef);

    integral.N();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toBe(blockDef);
  });
});
