import { ComputeEngine } from '../../src/compute-engine';

/**
 * Pins for the binders migrated onto the sanctioned binder mechanism in
 * stages 5–8 (`docs/plans/2026-07-26-binder-mechanism-design.md` §2).
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
 * Now `scoped: operandsFrom(1)` (the variadic selector) plus the pre-budgeted
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
    // Variadic: `operandsFrom(1)` binds ALL the trailing variable operands.
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
    // `scoped: operandsFrom(1)` accepts any bare symbol, so `D(f, Pi)` is
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
 * `docs/plans/2026-07-26-binder-mechanism-design.md` §Stages 5–8 round.
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
