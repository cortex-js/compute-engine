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
 * Stage 6 — `D`: **ATTEMPTED, REVERTED, BLOCKED on a ruling** (2026-07-26).
 *
 * `D` is still `scoped: true` with a scope that is minted and never populated;
 * its variables are operands 1..n, bound wherever the CALLER had them. The
 * defect is real and was measured: `ce.parse('\\frac{d}{dx} x^2')` and
 * `ce.function('D', [ce.parse('x^2'), ce.symbol('x')])` are NOT `isSame`.
 *
 * `scoped: operandsFrom(1)` (a new variadic selector) plus the pre-budgeted
 * `rebindEscapingCurrentScope` in the evaluate handler fixed that and every
 * named stage-6 pin, including the value shield (`d/dx x² → 2x` with `x := 5`);
 * NO double-shielding was observed. It went red on THREE tests in
 * `explain.test.ts › explain: D receiver forms`, one of them a stored snapshot:
 *
 *   - `ce.box(['D', ce.parse('x^2'), 'x']).explain('D').initial.op1` no longer
 *     `isSame`s a free-standing `ce.parse('x^2')`, because post-phase step 6
 *     rebinds the pre-boxed body's `x` to the binder's own scope — which is the
 *     mechanism working as specified, and is ALREADY true of the landed
 *     `Sum`/`Product` adopters (`ce.parse('\\sum_{k=1}^{3} k').op1` does not
 *     `isSame` `ce.box('k')` either).
 *   - two `derivative.simplify` steps appear in the explain trace.
 *
 * Landing it therefore requires either updating those expectations and the
 * snapshot, or a per-operator opt-out of step 6 that the mechanism does not
 * have. Both are design decisions, so the stage was reverted intact.
 */

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
