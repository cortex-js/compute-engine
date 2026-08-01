import { ComputeEngine } from '../../src/compute-engine';
import { effectsOf } from '../../src/compute-engine/boxed-expression/effects-of';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * # Stage 2 effect contracts — the consolidated suite
 *
 * `docs/EFFECTS-MODEL.md`, "Migration and sequencing" → **Stage 2 — contracts +
 * runtime channel**, names this file and lists what it must cover:
 *
 * > Tests: `test/compute-engine/effects-contracts.test.ts` (inline / assigned /
 * > opaque `{random}` callbacks, direct and through another HOF; named-callback
 * > pending-draw case; incomplete-estimator frame retention (worked example 6);
 * > `Hold` inertness + `Release` resurfacing; `invokes: false` container
 * > positions; discharge incl. `WithRandomSeed` `{scope}`-passthrough and the
 * > ¬{random} co-finite case; overload arms incl. incomparable-effects
 * > tie-break; partial-application effect timing; confined vs escaping vs
 * > conditional-declare `Assign` inference; forward-reference `{any}` +
 * > trusted-annotation install).
 *
 * One `describe` per list item, in that order, each citing its item.
 *
 * ## What this file is, and is not
 *
 * It is the **end-to-end** view: each item is exercised through the routes a
 * consumer actually uses, and asserted on OBSERVABLE consequences (a value that
 * replays, a frame that survives, a counter that increments) as much as on the
 * effect set itself. Where an item is already pinned in depth elsewhere, this
 * file keeps ONE representative case and names the owning file rather than
 * duplicating it:
 *
 * | Item | Depth owned by |
 * |---|---|
 * | the `effectsOf` projection rule itself | `effects-of.test.ts` |
 * | call-boundary bounds (`incompatible-type`) | `effects-call-boundary.test.ts` |
 * | the literal-construction seam | `effects-seam.test.ts` |
 * | inference (confinement, provenance, truth table) | `user-function-purity.test.ts` |
 * | overload specificity and tie-break | `overload-resolution.test.ts` |
 * | purity-gated currying | `effects-currying.test.ts` |
 * | the grammar and the subtype partial order | `test/common/type/effects.test.ts` |
 * | frame retention and replay semantics | `with-random-seed.test.ts` |
 *
 * ## Route parity
 *
 * Every probe of a lazy/held operator (`WithRandomSeed`, `Hold`,
 * `ReleaseHold`) is run on all three routes — `ce.function(pre-boxed)`,
 * `ce.box(raw MathJSON)`, `ce.parse(latex)`. A `lazy: true` operator's held
 * operands arrive UNBOUND on the box and parse routes, so a suite that only
 * uses `ce.function` cannot see that class of failure at all: the effect walk
 * has to reach an operator definition by NAME there, not through a bound
 * `operatorDefinition`.
 *
 * Engines are per-test wherever a definition, an assignment, or an inferred
 * symbol type would leak between cases.
 */

/** `effectsOf` as a plain value, for `toEqual`. */
function eff(expr: Expression): unknown {
  return effectsOf(expr);
}

/** `x ↦ Random()` — the drawing callback every item below reuses. */
const DRAWING_LAMBDA = ['Function', ['Random'], 'x'];
/** `x ↦ x + 1` — the pure control. */
const PURE_LAMBDA = ['Function', ['Add', 'x', 1], 'x'];

// ───────────────────────────────────────────────────────────────────────────
// Spec item 1: "inline / assigned / opaque `{random}` callbacks, direct and
// through another HOF".
//
// This is hole 1 of "Current state": `Map(xs, f)` with `f` bound to an impure
// function used to report pure, because a bare symbol is always pure and
// neither the `isPure` conjunction nor the pending-draw walk resolved through
// the binding. The three flavors are the three ways a function value reaches an
// application — inline literal, symbol binding, opaque declaration — and the
// design's claim is that all three report through ONE channel, the signature.
// ───────────────────────────────────────────────────────────────────────────
describe('1 — inline / assigned / opaque `{random}` callbacks', () => {
  /** An engine with all three callback flavors installed under one name each,
   * plus the pure control and the second HOF `applyAll: g ↦ Map([1,2], g)`. */
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('assignedDraw', ce.box(DRAWING_LAMBDA));
    ce.assign('assignedPure', ce.box(PURE_LAMBDA));
    // An OPAQUE declaration: no body to infer from, the contract is the
    // signature — the case the whole design exists for.
    ce.declare('opaqueDraw', ce.type('(real) random -> real'));
    ce.declare('opaquePure', ce.type('(real) -> real'));
    ce.assign('applyAll', ce.box(['Function', ['Map', ['List', 1, 2], 'g'], 'g']));
    return ce;
  }

  describe('direct: `Map(xs, f)`', () => {
    it('an INLINE literal contributes its arrow effects', () => {
      const ce = engine();
      expect(eff(ce.box(['Map', ['List', 1, 2], DRAWING_LAMBDA]))).toEqual([
        'random',
      ]);
      expect(eff(ce.box(['Map', ['List', 1, 2], PURE_LAMBDA]))).toBe(undefined);
    });

    it('an ASSIGNED symbol resolves through its CURRENT binding', () => {
      const ce = engine();
      expect(eff(ce.box(['Map', ['List', 1, 2], 'assignedDraw']))).toEqual([
        'random',
      ]);
      expect(eff(ce.box(['Map', ['List', 1, 2], 'assignedPure']))).toBe(
        undefined
      );
    });

    it('an OPAQUE declaration contributes its declared arrow effects', () => {
      const ce = engine();
      expect(eff(ce.box(['Map', ['List', 1, 2], 'opaqueDraw']))).toEqual([
        'random',
      ]);
      expect(eff(ce.box(['Map', ['List', 1, 2], 'opaquePure']))).toBe(undefined);
    });

    it('`isPure` follows, on every flavor — the boolean view of the channel', () => {
      const ce = engine();
      for (const cb of [DRAWING_LAMBDA, 'assignedDraw', 'opaqueDraw'])
        expect(ce.box(['Map', ['List', 1, 2], cb]).isPure).toBe(false);
      for (const cb of [PURE_LAMBDA, 'assignedPure', 'opaquePure'])
        expect(ce.box(['Map', ['List', 1, 2], cb]).isPure).toBe(true);
    });

    it('route parity: box, parse and `ce.function` agree', () => {
      const ce = engine();
      const routes = [
        ce.box(['Map', ['List', 1, 2], 'assignedDraw']),
        ce.parse('\\mathrm{Map}(\\lbrack 1, 2 \\rbrack, \\mathrm{assignedDraw})'),
        ce.function('Map', [ce.box(['List', 1, 2]), ce.symbol('assignedDraw')]),
      ];
      for (const e of routes) {
        expect(eff(e)).toEqual(['random']);
        expect(e.isPure).toBe(false);
      }
    });
  });

  describe('through a second HOF — `(g) ↦ Map(xs, g)` applied to each', () => {
    // The point of "variance lives at applications, not signatures": `applyAll`
    // has ONE fixed signature (its `g` is unannotated, hence optimistically
    // pure), yet each APPLICATION of it projects the actual operand's latent
    // set. Per-call-site precision without effect variables — the sets-not-rows
    // trade of "Sets, not rows", made concrete.
    it('the HOF definition itself infers pure — the unannotated parameter', () => {
      const ce = engine();
      expect(ce.lookupDefinition('applyAll')!['operator'].effects).toBe(
        undefined
      );
    });

    it('each drawing callback still surfaces `{random}` at the application', () => {
      const ce = engine();
      for (const cb of [DRAWING_LAMBDA, 'assignedDraw', 'opaqueDraw']) {
        expect(eff(ce.box(['applyAll', cb]))).toEqual(['random']);
        expect(ce.box(['applyAll', cb]).isPure).toBe(false);
      }
    });

    it('and a pure callback keeps the same expression pure', () => {
      const ce = engine();
      for (const cb of [PURE_LAMBDA, 'assignedPure', 'opaquePure']) {
        expect(eff(ce.box(['applyAll', cb]))).toBe(undefined);
        expect(ce.box(['applyAll', cb]).isPure).toBe(true);
      }
    });

    it('route parity through the HOF', () => {
      const ce = engine();
      const routes = [
        ce.box(['applyAll', 'assignedDraw']),
        ce.parse('\\mathrm{applyAll}(\\mathrm{assignedDraw})'),
        ce.function('applyAll', [ce.symbol('assignedDraw')]),
      ];
      for (const e of routes) expect(eff(e)).toEqual(['random']);
    });

    it('an INLINE second HOF (`Apply((g) ↦ Map(xs, g), f)`) agrees', () => {
      const ce = engine();
      const hof = ['Function', ['Map', ['List', 1, 2], 'g'], 'g'];
      for (const cb of [DRAWING_LAMBDA, 'assignedDraw', 'opaqueDraw'])
        expect(eff(ce.box(['Apply', hof, cb]))).toEqual(['random']);
      for (const cb of [PURE_LAMBDA, 'assignedPure', 'opaquePure'])
        expect(eff(ce.box(['Apply', hof, cb]))).toBe(undefined);
    });
  });

  it('reassigning the callback moves the answer (the generation-guarded memo)', () => {
    // "The generation-guarded memo is what makes *current* honest." Depth:
    // `effects-of.test.ts` → "Resolve through the CURRENT binding (hole 1)".
    const ce = engine();
    const e = ce.box(['applyAll', 'assignedDraw']);
    expect(eff(e)).toEqual(['random']);
    ce.assign('assignedDraw', ce.box(PURE_LAMBDA));
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
  });

  describe('the STATIC walk projects a callback operand', () => {
    // Worked example 1, the inference-time channel — its headline sentence:
    //
    //   > the literal `(xs) ↦ Map(xs, f)` has type `(list) random -> list` —
    //   > the application's effects, stamped onto the enclosing literal's own
    //   > arrow by the static walk
    //
    // The body adds a callback's effects where it "APPLIES (or PROJECTS)" it,
    // and handing `f` to `Map` is projection — for all three kinds of function
    // value the example enumerates: an inline literal, an annotated parameter,
    // and a named global ("resolved ⇒ its binding's arrow").
    //
    // The assertion reads the type AST rather than the serialized string: with
    // an annotated arrow PARAMETER the string has two arrows
    // (`(g: (real) random -> real) random -> …`), and a regex for
    // `) … ->` matches the INNER one first.
    const outerArrowEffects = (e: Expression): unknown => {
      const t = e.type.type;
      if (typeof t === 'string' || t.kind !== 'signature')
        return `not a signature: ${e.type.toString()}`;
      return t.effects;
    };
    const RANDOM_ARROW = { str: '(real) random -> real' };

    it('`(g: (real) random -> real) ↦ Map(xs, g)` carries `random` on its own arrow', () => {
      const ce = new ComputeEngine();
      const literal = ce.box([
        'Function',
        ['Map', ['List', 1, 2], 'g'],
        ['Typed', 'g', RANDOM_ARROW],
      ]);
      expect(outerArrowEffects(literal)).toEqual(['random']);
    });

    it('an `invokes: false` position contributes nothing — `(g) ↦ List(g)` stays pure', () => {
      // The container only STORES the value; the same gate the runtime channel
      // applies to the latent half of a contribution.
      const ce = new ComputeEngine();
      for (const body of [
        ['List', 'g'],
        ['Tuple', 'g', 1],
      ])
        expect(
          outerArrowEffects(
            ce.box(['Function', body, ['Typed', 'g', RANDOM_ARROW]])
          )
        ).toBe(undefined);
    });

    it('direct application is unchanged, and an UNANNOTATED parameter stays optimistic', () => {
      const ce = new ComputeEngine();
      expect(
        outerArrowEffects(
          ce.box([
            'Function',
            ['g'],
            ['Typed', 'g', { str: '() random -> real' }],
          ])
        )
      ).toEqual(['random']);
      // Ruling (c): no boundary check, no contribution — soundness is opt-in
      // via annotation, and the runtime channel keeps the call sites honest.
      expect(
        outerArrowEffects(ce.box(['Function', ['Map', ['List', 1, 2], 'g'], 'g']))
      ).toBe(undefined);
      expect(outerArrowEffects(ce.box(['Function', ['g'], 'g']))).toBe(
        undefined
      );
    });

    it('an INLINE literal operand: `(xs) ↦ Map(xs, x ↦ Random())` carries `random`', () => {
      // This does NOT reopen "literals are inference boundaries": producing or
      // STORING a literal still contributes ∅ (pinned in
      // `user-function-purity.test.ts`, "Literals are inference boundaries").
      // Only an INVOKING position projects the latent set.
      const ce = new ComputeEngine();
      const literal = ce.box([
        'Function',
        ['Map', ['List', 1, 2], DRAWING_LAMBDA],
        'xs',
      ]);
      expect(outerArrowEffects(literal)).toEqual(['random']);
    });

    it('an inline literal in an `invokes: false` position stays pure', () => {
      const ce = new ComputeEngine();
      for (const body of [
        ['List', DRAWING_LAMBDA],
        ['Tuple', DRAWING_LAMBDA, 1],
      ])
        expect(outerArrowEffects(ce.box(['Function', body, 'xs']))).toBe(
          undefined
        );
    });

    it('a RESOLVED named global operand contributes its binding’s arrow', () => {
      const ce = new ComputeEngine();
      ce.box(['Assign', 'globalDraw1', DRAWING_LAMBDA]).evaluate();
      ce.box([
        'Assign',
        'useGlobal1',
        ['Function', ['Map', ['List', 1, 2], 'globalDraw1'], 'xs'],
      ]).evaluate();
      const def = ce.lookupDefinition('useGlobal1')!['operator'];
      expect(def.effects).toEqual(['random']);
      expect(def.pure).toBe(false);
      // The `_inferredDraws` bridge must stay consistent: a projected draw is
      // still a draw, so the definition pins its seed frame.
      expect(def.drawsRandom).toBe(true);
    });

    it('an UNRESOLVED name in a callback position contributes `{any}`', () => {
      // The dependency-order ruling, applied to the operand channel: unknown
      // is `{any}`, exactly as for an unresolved HEAD.
      const ce = new ComputeEngine();
      expect(
        outerArrowEffects(
          ce.box(['Function', ['Map', ['List', 1, 2], 'neverDeclared1'], 'xs'])
        )
      ).toBe('any');
    });

    it('…but an ordinary free symbol under a callback-free head does NOT', () => {
      // The gate that keeps the previous rule from collapsing every literal
      // with a free variable to the top: `Add` declares no callback parameter.
      const ce = new ComputeEngine();
      expect(
        outerArrowEffects(
          ce.box(['Function', ['Add', 'x', 'neverDeclared2'], 'x'])
        )
      ).toBe(undefined);
    });

    it('a NON-function symbol operand contributes nothing', () => {
      // `Map(xs, k)` with `k := 5`: the binding resolves, and it is not
      // callable, so nothing is projected — the resolved-binding gate.
      const ce = new ComputeEngine();
      ce.box(['Assign', 'numericK1', 5]).evaluate();
      expect(
        outerArrowEffects(
          ce.box(['Function', ['Map', ['List', 1, 2], 'numericK1'], 'xs'])
        )
      ).toBe(undefined);
    });

    it('the installed arrow is a construction-time SNAPSHOT; the runtime channel is the honest one', () => {
      // "Signatures are constants; variance lives at applications." The
      // installed arrow does NOT re-stamp when the captured global is
      // reassigned — that residual staleness is hole 3's other half — while
      // `effectsOf` resolves through the CURRENT binding at every application.
      const ce = new ComputeEngine();
      ce.box(['Assign', 'globalDraw2', DRAWING_LAMBDA]).evaluate();
      ce.box([
        'Assign',
        'useGlobal2',
        ['Function', ['Map', ['List', 1, 2], 'globalDraw2'], 'xs'],
      ]).evaluate();
      expect(
        ce.lookupDefinition('useGlobal2')!['operator'].effects
      ).toEqual(['random']);

      // The global becomes pure…
      ce.box(['Assign', 'globalDraw2', PURE_LAMBDA]).evaluate();
      // …the SNAPSHOT does not move (over-declaring, hence sound)…
      expect(
        ce.lookupDefinition('useGlobal2')!['operator'].effects
      ).toEqual(['random']);
      // …while the runtime channel, asked about the operand position itself,
      // follows the new binding.
      expect(eff(ce.box(['Map', ['List', 1, 2], 'globalDraw2']))).toBe(
        undefined
      );
      expect(ce.box(['Map', ['List', 1, 2], 'globalDraw2']).isPure).toBe(true);
    });

    it('the projection is label-blind — a `scope` parameter projects the same way', () => {
      const ce = new ComputeEngine();
      expect(
        outerArrowEffects(
          ce.box([
            'Function',
            ['Map', ['List', 1, 2], 'g'],
            ['Typed', 'g', { str: '(real) scope -> real' }],
          ])
        )
      ).toEqual(['scope']);
      // …and a PURE annotation projects nothing.
      expect(
        outerArrowEffects(
          ce.box([
            'Function',
            ['Map', ['List', 1, 2], 'g'],
            ['Typed', 'g', { str: '(real) -> real' }],
          ])
        )
      ).toBe(undefined);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 2: "named-callback pending-draw case".
//
// The second half of hole 1: the pending-draw walk, not just `isPure`. A body
// that applies a NAMED symbol bound to a drawing function and does not finish
// its draws must keep the seed frame — otherwise the stored partial's later
// draws are live, silently converting seeded randomness into unseeded.
// v2 fixed only the boolean; the re-keyed walk fixes this one.
// ───────────────────────────────────────────────────────────────────────────
describe('2 — a named callback with a pending draw keeps its frame', () => {
  /** `n ↦ RandomShuffle(Range(1, n))` — draws, and cannot finish while `n` is
   * unbound. The technique is `with-random-seed.test.ts`'s WITNESS shape. */
  const SHUFFLER = 'n \\mapsto \\mathrm{RandomShuffle}(\\mathrm{Range}(1, n))';

  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('shuffleTo', ce.parse(SHUFFLER));
    ce.assign('rangeTo', ce.parse('n \\mapsto \\mathrm{Range}(1, n)'));
    return ce;
  }

  it('the named application is `{random}` — the walk can see through the name', () => {
    const ce = engine();
    expect(eff(ce.box(['shuffleTo', 'm']))).toEqual(['random']);
    expect(eff(ce.box(['rangeTo', 'm']))).toBe(undefined);
  });

  it('the survivor keeps the frame on all three routes', () => {
    const ce = engine();
    const routes = {
      box: ce.box(['WithRandomSeed', 123, ['shuffleTo', 'm']]),
      parse: ce.parse('\\mathrm{WithRandomSeed}(123, \\mathrm{shuffleTo}(m))'),
      function: ce.function('WithRandomSeed', [
        ce.number(123),
        ce.box(['shuffleTo', 'm']),
      ]),
    };
    for (const [route, e] of Object.entries(routes))
      expect([route, e.evaluate().operator]).toEqual([route, 'WithRandomSeed']);
  });

  it('completing the survivor replays the same stream as completing the original', () => {
    // The retention is only worth having if the replay is exact: evaluating
    // the survivor later must reproduce the single-evaluation stream.
    const ce = engine();
    const e = ce.box(['WithRandomSeed', 123, ['shuffleTo', 'm']]);
    const direct = e.subs({ m: 5 }).evaluate();
    const viaSurvivor = e.evaluate().subs({ m: 5 }).evaluate();
    expect(viaSurvivor.isSame(direct)).toBe(true);
    // …and it is deterministic across repetitions, not merely equal once.
    expect(e.evaluate().subs({ m: 5 }).evaluate().isSame(direct)).toBe(true);
  });

  it('control: a PURE named callback releases the frame', () => {
    const ce = engine();
    expect(
      ce.box(['WithRandomSeed', 123, ['rangeTo', 'm']]).evaluate().operator
    ).toBe('Range');
  });

  it('control: a drawing named callback that COMPLETES releases it too', () => {
    // Retention is about *unfinished* draws, a runtime fact — not about the
    // label, which is present in both cases.
    const ce = engine();
    expect(
      ce.box(['WithRandomSeed', 123, ['shuffleTo', 4]]).evaluate().operator
    ).toBe('List');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 3: "incomplete-estimator frame retention (worked example 6)".
//
// > `WithRandomSeed(42, NIntegrate(f, 0, n))` with `n` unbound: the Monte-Carlo
// > estimator is a derived sub-stream — *pure*, no label, per the noise-floor
// > convention — so `effectsOf` of the whole expression is `∅`. Yet the
// > partially-evaluated survivor must keep the seed frame pinned so a later
// > completion (binding `n`) replays. That retention rides `NIntegrate`'s
// > `readsRandomFrame: true` — the pending-draw walk's third key, not any
// > effect label.
//
// This is the case that shows why the walk cannot be a pure view of
// `effectsOf`: frame participation and impurity are different axes.
// ───────────────────────────────────────────────────────────────────────────
describe('3 — an incomplete estimator keeps the frame with no label', () => {
  const INTEGRAND = ['Function', ['Sin', 'x'], 'x'];
  const body = ['NIntegrate', INTEGRAND, 0, 'n'];

  it('the expression is PURE — the noise-floor convention', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['WithRandomSeed', 42, body]);
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
    // The estimator itself carries no label either, in or out of a frame.
    expect(eff(ce.box(body))).toBe(undefined);
  });

  it('the reading mode is a FIELD, not a label', () => {
    const ce = new ComputeEngine();
    const def = ce.box(body).operatorDefinition!;
    expect(def.readsRandomFrame).toBe(true);
    expect(def.effects).toBe(undefined);
    expect(def.pure).toBe(true);
  });

  it('the survivor keeps the frame on all three routes', () => {
    const ce = new ComputeEngine();
    const routes = {
      box: ce.box(['WithRandomSeed', 42, body]),
      parse: ce.parse(
        '\\mathrm{WithRandomSeed}(42, \\mathrm{NIntegrate}(x \\mapsto \\sin(x), 0, n))'
      ),
      function: ce.function('WithRandomSeed', [ce.number(42), ce.box(body)]),
    };
    for (const [route, e] of Object.entries(routes))
      expect([route, e.evaluate().operator]).toEqual([route, 'WithRandomSeed']);
  });

  it('binding `n` later replays the value of binding it from the start', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['WithRandomSeed', 42, body]);
    const fromTheStart = e.subs({ n: 1 }).evaluate();
    const viaSurvivor = e.evaluate().subs({ n: 1 }).evaluate();
    expect(viaSurvivor.isSame(fromTheStart)).toBe(true);
  });

  it('control: a frame-blind pure body releases the frame', () => {
    // Same shape, same purity — only the `readsRandomFrame` field differs.
    const ce = new ComputeEngine();
    expect(
      ce.box(['WithRandomSeed', 42, ['Add', 'n', 1]]).evaluate().toString()
    ).toBe('n + 1');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 4: "`Hold` inertness + `Release` resurfacing".
//
// > **Quote/store** (`Hold`): the operator **never** evaluates the content;
// > contribution **∅** — `effectsOf(Hold(Random())) = ∅`, and `isPure` holds
// > […]. The effects resurface at forcing: `Release(h)` (or any evaluation of
// > the held content) is itself an application, and `effectsOf` recurses into
// > the content *there*.
//
// A pleasant consequence the spec calls out: the pending-draw walk's Hold
// exception becomes a DERIVED fact of the quote/release classification rather
// than a special case. Both halves are asserted below.
// ───────────────────────────────────────────────────────────────────────────
describe('4 — `Hold` is inert; `ReleaseHold` resurfaces', () => {
  /** All three routes for a one-operand held application. */
  function routes(
    ce: ComputeEngine,
    operator: string,
    latex: string,
    op: Expression
  ): Record<string, Expression> {
    return {
      box: ce.box([operator, op.json as any]),
      parse: ce.parse(latex),
      function: ce.function(operator, [op]),
    };
  }

  it('`Hold(Random())` is ∅ and pure, on every route', () => {
    const ce = new ComputeEngine();
    for (const [route, e] of Object.entries(
      routes(ce, 'Hold', '\\mathrm{Hold}(\\mathrm{Random}())', ce.box(['Random']))
    )) {
      expect([route, eff(e)]).toEqual([route, undefined]);
      expect([route, e.isPure]).toEqual([route, true]);
    }
  });

  it('`ReleaseHold(Hold(Random()))` is `{random}`, on every route', () => {
    const ce = new ComputeEngine();
    for (const [route, e] of Object.entries(
      routes(
        ce,
        'ReleaseHold',
        '\\mathrm{ReleaseHold}(\\mathrm{Hold}(\\mathrm{Random}()))',
        ce.box(['Hold', ['Random']])
      )
    )) {
      expect([route, eff(e)]).toEqual([route, ['random']]);
      expect([route, e.isPure]).toEqual([route, false]);
    }
  });

  it('a SYMBOL bound to the held value resolves through the binding', () => {
    const ce = new ComputeEngine();
    ce.assign('heldDraw', ce.box(['Hold', ['Random']]));
    expect(eff(ce.box(['ReleaseHold', 'heldDraw']))).toEqual(['random']);
    // …and a held PURE content stays pure through the forcing position.
    ce.assign('heldSum', ce.box(['Hold', ['Add', 1, 2]]));
    expect(eff(ce.box(['ReleaseHold', 'heldSum']))).toBe(undefined);
  });

  it('the inertness is about ACCOUNTING: releasing really does draw', () => {
    const ce = new ComputeEngine();
    const released = ce.box(['ReleaseHold', ['Hold', ['Random']]]);
    const a = released.evaluate().re;
    const b = released.evaluate().re;
    expect(Number.isFinite(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('held content never pins a frame — the Hold exception, now derived', () => {
    const ce = new ComputeEngine();
    for (const [route, e] of Object.entries({
      box: ce.box(['WithRandomSeed', 3, ['Hold', ['Random']]]),
      parse: ce.parse(
        '\\mathrm{WithRandomSeed}(3, \\mathrm{Hold}(\\mathrm{Random}()))'
      ),
      function: ce.function('WithRandomSeed', [
        ce.number(3),
        ce.box(['Hold', ['Random']]),
      ]),
    }))
      expect([route, e.evaluate().operator]).toEqual([route, 'Hold']);
  });

  it('a RELEASE inside a frame does owe the frame its draws', () => {
    // The mirror of the previous case: the quote layer is stripped there, so
    // the draw is a real, framed draw and replays.
    const ce = new ComputeEngine();
    const e = ce.box(['WithRandomSeed', 5, ['ReleaseHold', ['Hold', ['Random']]]]);
    expect(eff(e)).toBe(undefined); // discharged by the frame
    expect(e.evaluate().isSame(e.evaluate())).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 5: "`invokes: false` container positions".
//
// > A position declared `invokes: false` — pure containers and constructors
// > that only *store* the value (`List`, `Tuple`, the structural operators) —
// > contributes the production effects `effectsOf(aᵢ)` only, no latent:
// > `List(randomF)` is pure to build; the effect surfaces at whatever
// > application later invokes an element.
// ───────────────────────────────────────────────────────────────────────────
describe('5 — `invokes: false` containers are pure to build', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('storedDraw', ce.box(DRAWING_LAMBDA));
    return ce;
  }

  it('the containers declare the metadata', () => {
    const ce = engine();
    expect(ce.box(['List', 1]).operatorDefinition!.invokes).toBe(false);
    expect(ce.box(['Tuple', 1, 2]).operatorDefinition!.invokes).toBe(false);
    // Contrast: an operator that DOES invoke its callback.
    expect(
      ce.box(['Map', ['List', 1], 'storedDraw']).operatorDefinition!.invokes
    ).toBe(true);
  });

  it('`List(randomF)` and `Tuple(randomF)` are pure — box and parse routes', () => {
    const ce = engine();
    for (const [route, e] of Object.entries({
      'List/box': ce.box(['List', 'storedDraw']),
      'List/parse': ce.parse('\\lbrack \\mathrm{storedDraw} \\rbrack'),
      'List/function': ce.function('List', [ce.symbol('storedDraw')]),
      'Tuple/box': ce.box(['Tuple', 'storedDraw', 1]),
      'Tuple/parse': ce.parse('(\\mathrm{storedDraw}, 1)'),
    })) {
      expect([route, eff(e)]).toEqual([route, undefined]);
      expect([route, e.isPure]).toEqual([route, true]);
    }
  });

  it('the effect surfaces at the application that INVOKES an element', () => {
    const ce = engine();
    // Storing it: nothing. Invoking it: `{random}`. Same value, two positions.
    expect(eff(ce.box(['List', 'storedDraw']))).toBe(undefined);
    expect(eff(ce.box(['Apply', 'storedDraw', 0]))).toEqual(['random']);
    expect(eff(ce.box(['Map', ['List', 1, 2], 'storedDraw']))).toEqual([
      'random',
    ]);
  });

  it('…including when the element is EXTRACTED from the container first', () => {
    // An extraction types as a UNION — `At(list<(…) random -> …>, i)` is
    // `((…) random -> …) | missing` — and the latent read has to see through
    // it (`signatureEffects`, `effects-inference.ts`). Reading `undefined`
    // there under-approximates in the UNSOUND direction: the expression below
    // would report pure while evaluating it draws.
    const ce = engine();
    for (const extract of ['At', 'First'] as const) {
      const e =
        extract === 'At'
          ? ce.box(['Apply', ['At', ['List', 'storedDraw'], 1], 0])
          : ce.box(['Apply', ['First', ['List', 'storedDraw']], 0]);
      expect([extract, eff(e)]).toEqual([extract, ['random']]);
      expect([extract, e.isPure]).toEqual([extract, false]);
    }
    // The claim behind the label: two evaluations really do differ.
    const drawing = ce.box(['Apply', ['At', ['List', 'storedDraw'], 1], 0]);
    expect(drawing.evaluate().re).not.toBe(drawing.evaluate().re);

    // Control: extracting a PURE callback stays pure — the union branch unions
    // the members' effects, it does not blanket-pessimize.
    ce.assign('storedPure', ce.box(PURE_LAMBDA));
    const pure = ce.box(['Apply', ['At', ['List', 'storedPure'], 1], 0]);
    expect(eff(pure)).toBe(undefined);
    expect(pure.isPure).toBe(true);
  });

  it('a container still carries its operands PRODUCTION effects', () => {
    // `invokes: false` suppresses only the LATENT half of the contribution:
    // evaluating `Random()` to put it in the list is a real draw.
    const ce = engine();
    expect(eff(ce.box(['List', ['Random']]))).toEqual(['random']);
    expect(eff(ce.box(['Tuple', ['Random'], 1]))).toEqual(['random']);
    expect(ce.box(['List', ['Random']]).isPure).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 6: "discharge incl. `WithRandomSeed` `{scope}`-passthrough and the
// ¬{random} co-finite case".
//
// > `WithRandomSeed(42, Random())` computes `∅` — referentially transparent, as
// > it truly is — while `WithRandomSeed(42, Block(Assign(x,1), Random()))`
// > computes `{scope}`: the frame absorbs the draws, not the scope write.
//
// > **Discharge from `any`**: `any − D` is the **co-finite set** ¬D — admitted
// > as an **internal computed value only**, never surface syntax. Payoff:
// > `WithRandomSeed(42, opaqueAnyBody)` computes ¬{random} — provably
// > not-random, so the frame gate can release.
//
// Co-finiteness is internal, so it is asserted through its two observable
// consequences: still impure (not provably free of the other labels), yet
// provably not-`random` (the frame gate releases instead of pinning forever).
// ───────────────────────────────────────────────────────────────────────────
describe('6 — discharge', () => {
  it('`WithRandomSeed` discharges `random` on its held body, on every route', () => {
    const ce = new ComputeEngine();
    for (const [route, e] of Object.entries({
      box: ce.box(['WithRandomSeed', 42, ['Random']]),
      parse: ce.parse('\\mathrm{WithRandomSeed}(42, \\mathrm{Random}())'),
      function: ce.function('WithRandomSeed', [
        ce.number(42),
        ce.box(['Random']),
      ]),
    })) {
      expect([route, eff(e)]).toEqual([route, undefined]);
      expect([route, e.isPure]).toEqual([route, true]);
    }
  });

  it('a framed draw really is referentially transparent', () => {
    // The claim the discharge makes, checked rather than asserted: the same
    // expression evaluates to the same value.
    const ce = new ComputeEngine();
    const e = ce.box(['WithRandomSeed', 42, ['Random']]);
    expect(e.evaluate().isSame(e.evaluate())).toBe(true);
    // …and an UNFRAMED draw is not.
    const live = ce.box(['Random']);
    expect(live.evaluate().isSame(live.evaluate())).toBe(false);
  });

  it('the discharge reaches a draw behind a named callback', () => {
    const ce = new ComputeEngine();
    ce.assign('drawEach', ce.box(DRAWING_LAMBDA));
    expect(
      eff(ce.box(['WithRandomSeed', 42, ['Map', ['List', 1, 2], 'drawEach']]))
    ).toBe(undefined);
  });

  it('a `{scope}` write PASSES THROUGH — the frame absorbs draws, not writes', () => {
    const ce = new ComputeEngine();
    for (const [route, e] of Object.entries({
      box: ce.box([
        'WithRandomSeed',
        42,
        ['Block', ['Assign', 'ctr6', 1], ['Random']],
      ]),
      parse: ce.parse(
        '\\mathrm{WithRandomSeed}(42, \\mathrm{Block}(\\mathrm{Assign}(\\mathrm{ctr6}, 1), \\mathrm{Random}()))'
      ),
      function: ce.function('WithRandomSeed', [
        ce.number(42),
        ce.box(['Block', ['Assign', 'ctr6', 1], ['Random']]),
      ]),
    })) {
      expect([route, eff(e)]).toEqual([route, ['scope']]);
      expect([route, e.isPure]).toEqual([route, false]);
    }
  });

  it('the definition declares the discharge, and DELIMITS rather than draws', () => {
    const ce = new ComputeEngine();
    const def = ce.box(['WithRandomSeed', 1, 1]).operatorDefinition!;
    expect(def.discharges).toEqual({ 1: ['random'] });
    expect(def.effects).toBe(undefined);
    // Frame participation is a runtime field, not the arrow — and the derived
    // getter unions the two, so every existing consumer keeps working.
    expect(def.frameProtocol).toBe('seed');
    expect(def.drawsRandom).toBe(true);
  });

  it('discharging from an `{any}` body computes ¬{random}', () => {
    const ce = new ComputeEngine();
    // A legacy `pure: false` declaration translates to `{any}` — unclassified
    // impurity — never to `{scope}`.
    ce.declare('opaqueAny6', {
      signature: '() -> number',
      pure: false,
      evaluate: () => ce.number(7),
    });
    expect(eff(ce.box(['opaqueAny6']))).toBe('any');

    for (const [route, e] of Object.entries({
      box: ce.box(['WithRandomSeed', 42, ['opaqueAny6']]),
      parse: ce.parse('\\mathrm{WithRandomSeed}(42, \\mathrm{opaqueAny6}())'),
      function: ce.function('WithRandomSeed', [
        ce.number(42),
        ce.box(['opaqueAny6']),
      ]),
    })) {
      // (1) still impure: not provably free of the OTHER labels;
      expect([route, e.isPure]).toEqual([route, false]);
      // (2) provably NOT random, so the frame gate releases rather than
      //     keeping the whole expression wrapped forever.
      expect([route, e.evaluate().toString()]).toEqual([route, '7']);
    }
  });

  it('`any` alone never pins a frame either — the frame-axis exception', () => {
    // "frame participation requires explicit declaration — `any` (and an
    // unknown operator) never pins a seed frame." Conservatism inverts on this
    // axis: pinning forever is the harm.
    const ce = new ComputeEngine();
    ce.declare('opaqueSurvivor6', {
      signature: '(number) -> number',
      pure: false,
      evaluate: ([x]) => (x.isNumberLiteral ? x : undefined),
    });
    const e = ce.box(['WithRandomSeed', 42, ['opaqueSurvivor6', 'unboundN6']]);
    expect(e.isPure).toBe(false);
    expect(e.evaluate().operator).not.toBe('WithRandomSeed');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 7: "overload arms incl. incomparable-effects tie-break".
//
// > Per-application effects use the **resolved arm** […] the selection is
// > *recomputed, not stored*. Definition-wide derived getters use the **union
// > of all arms' effects**. […] **Specificity**: effect sets are consulted only
// > to break ties among arms already equally specific by argument type; a
// > subset is more specific; **incomparable effect sets are not compared** and
// > fall through to the existing tie-break.
//
// Representative end-to-end cases only. The specificity ladder — argument type
// outranking effects, the arms-differ-only-by-effects definition error — is
// owned by `overload-resolution.test.ts` ("effects break ties, and only ties").
// ───────────────────────────────────────────────────────────────────────────
describe('7 — overload arms', () => {
  it('the per-application effects are the RESOLVED arm’s', () => {
    const ce = new ComputeEngine();
    ce.declare('Roll7', {
      signature: '((integer) random -> integer) & ((string) -> string)',
      evaluate: (ops) => ops[0],
    });
    expect(eff(ce.box(['Roll7', 6]))).toEqual(['random']);
    expect(ce.box(['Roll7', 6]).isPure).toBe(false);
    expect(eff(ce.box(['Roll7', { str: 'a' }]))).toBe(undefined);
    expect(ce.box(['Roll7', { str: 'a' }]).isPure).toBe(true);
    // The definition-wide getters stay the UNION, for a consumer holding no
    // application.
    expect(ce.lookupDefinition('Roll7')!['operator'].effects).toEqual([
      'random',
    ]);
  });

  it('INCOMPARABLE effect sets are not compared — declaration order decides', () => {
    // `{random}` and `{scope}` are pairwise incomparable singletons: no subset
    // relation, so the tie falls through to the existing rule (first arm).
    const ce = new ComputeEngine();
    ce.declare('Tie7', {
      signature: '((number) random -> rational) & ((number) scope -> integer)',
      evaluate: (ops) => ops[0],
    });
    expect(ce.box(['Tie7', 5]).type.toString()).toBe('rational');
    expect(eff(ce.box(['Tie7', 5]))).toEqual(['random']);
  });

  it('a SUBSET effect set is more specific among arms equal by argument type', () => {
    const ce = new ComputeEngine();
    ce.declare('Sub7', {
      signature: '((number) scope -> rational) & ((number) -> integer)',
      evaluate: (ops) => ops[0],
    });
    // The effectful arm is declared FIRST — declaration order alone would pick
    // it — and the pure arm wins on the effect tie-break instead.
    expect(ce.box(['Sub7', 5]).type.toString()).toBe('integer');
    expect(eff(ce.box(['Sub7', 5]))).toBe(undefined);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 8: "partial-application effect timing".
//
// > Stage 2 gates that pre-evaluation on purity — a body whose `effectsOf` is
// > pure keeps today's evaluate-then-curry optimization; an effectful body is
// > **captured without evaluation** and fires exactly once, at saturation.
// > Tests must pin: zero effects at partial application, exactly one at
// > saturation, for `random` and `scope`.
//
// Representative end-to-end pair. The full matrix — box / parse / `ce.function`
// routes, repeated saturations of one residual, capture-avoidance, and the
// pure-body optimization — is owned by `effects-currying.test.ts`.
// ───────────────────────────────────────────────────────────────────────────
describe('8 — partial-application effect timing', () => {
  it('`scope`: zero writes at partial application, exactly one at saturation', () => {
    const ce = new ComputeEngine();
    ce.assign('n8', 0);
    const writing = [
      'Function',
      ['Block', ['Assign', 'n8', ['Add', 'n8', 1]], ['Add', 'a', 'b']],
      'a',
      'b',
    ];
    const partial = ce.box(['Apply', writing, 1]).evaluate();
    // The body was CAPTURED, not evaluated: a residual function value.
    expect(partial.operator).toBe('Function');
    expect(ce.box('n8').evaluate().re).toBe(0);

    expect(ce.box(['Apply', partial, 2]).evaluate().re).toBe(3);
    expect(ce.box('n8').evaluate().re).toBe(1);
  });

  it('`random`: the partial application consumes no draw index', () => {
    // Inside one frame the stream is deterministic, so a probe `Random()`
    // placed after the partial application reports how many draws it consumed:
    // `stream[0]` if none.
    const ce = new ComputeEngine();
    const [first] = [
      ...ce
        .box(['WithRandomSeed', 42, ['List', ['Random'], ['Random']]])
        .evaluate()
        .each(),
    ].map((x) => x.re);

    const framed = ce
      .box([
        'WithRandomSeed',
        42,
        [
          'List',
          ['Apply', ['Function', ['Add', ['Random'], 'a', 'b'], 'a', 'b'], 1],
          ['Random'],
        ],
      ])
      .evaluate();
    const [residual, probe] = [...framed.each()];
    expect(residual.operator).toBe('Function');
    expect(probe.re).toBe(first);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 9: "confined vs escaping vs conditional-declare `Assign`
// inference" — worked example 3's trio.
//
// > f() := Block(Declare(n, 0), Assign(n, n + 1), n)   → confined, pure
// > Declare(counter, 0); g() := Block(Assign(counter, counter + 1), counter)
// >                                                    → escaping, {scope}
// > h() := Block(If(flag, Declare(n, 0)), Assign(n, 5), n)
// >                                                    → not provably confined
//
// Representative end-to-end trio, asserted on the OBSERVABLE consequence as
// well as the installed signature. The full dominance matrix — nested blocks,
// closure capture, `Assume`, compound and destructuring targets — is owned by
// `user-function-purity.test.ts` ("Confinement: `scope` is inferred only for
// ESCAPING writes").
// ───────────────────────────────────────────────────────────────────────────
describe('9 — confined vs escaping vs conditional-declare', () => {
  const effectsOfDef = (ce: ComputeEngine, name: string): unknown =>
    ce.lookupDefinition(name)!['operator'].effects;

  it('a `Declare` that DOMINATES the `Assign` is confined → pure, and observably so', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'confined9',
      [
        'Function',
        [
          'Block',
          ['Declare', 'k', { str: 'number' }, 0],
          ['Assign', 'k', ['Add', 'k', 1]],
          'k',
        ],
      ],
    ]).evaluate();
    expect(effectsOfDef(ce, 'confined9')).toBe(undefined);
    expect(ce.lookupDefinition('confined9')!['operator'].pure).toBe(true);
    // No observer outside can see the mutation: every call returns 1.
    expect(ce.box(['confined9']).evaluate().re).toBe(1);
    expect(ce.box(['confined9']).evaluate().re).toBe(1);
    // …and each APPLICATION projects through the pure arrow.
    expect(eff(ce.box(['confined9']))).toBe(undefined);
    expect(ce.box(['confined9']).isPure).toBe(true);
  });

  it('a write through to an OUTER binding is escaping → `{scope}`, and observably so', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'counter9', 0]).evaluate();
    ce.box([
      'Assign',
      'escaping9',
      [
        'Function',
        ['Block', ['Assign', 'counter9', ['Add', 'counter9', 1]], 'counter9'],
      ],
    ]).evaluate();
    expect(effectsOfDef(ce, 'escaping9')).toEqual(['scope']);
    // Impure — but owing the random stream nothing: `scope` and `random` are
    // incomparable singletons.
    expect(ce.lookupDefinition('escaping9')!['operator'].pure).toBe(false);
    expect(ce.lookupDefinition('escaping9')!['operator'].drawsRandom).toBe(
      false
    );
    // The mutation IS observable: successive calls differ.
    expect(ce.box(['escaping9']).evaluate().re).toBe(1);
    expect(ce.box(['escaping9']).evaluate().re).toBe(2);
    expect(ce.box('counter9').evaluate().re).toBe(2);
    expect(eff(ce.box(['escaping9']))).toEqual(['scope']);
  });

  it('a CONDITIONAL `Declare` does not dominate → not provably confined', () => {
    // On the `flag`-false path the `Assign` writes through, so the explicit
    // fallback applies: not provably confined ⇒ `scope`.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'conditional9',
      [
        'Function',
        [
          'Block',
          ['If', 'flag9', ['Declare', 'k2', { str: 'number' }, 0]],
          ['Assign', 'k2', 5],
          'k2',
        ],
      ],
    ]).evaluate();
    expect(effectsOfDef(ce, 'conditional9')).toEqual(['scope']);
  });

  it('confinement is INFERENCE-only: the runtime channel stays conservative', () => {
    // "The runtime `effectsOf` walk contributes `{scope}` for EVERY writer
    // application, with no binding analysis." Sound by direction: the runtime
    // channel may over-approximate what inference proved, never under-.
    const ce = new ComputeEngine();
    const bare = ce.box([
      'Block',
      ['Declare', 'k3', { str: 'number' }, 0],
      ['Assign', 'k3', ['Add', 'k3', 1]],
      'k3',
    ]);
    expect(eff(bare)).toEqual(['scope']);
    expect(bare.isPure).toBe(false);
    // The divergence is visible only on un-abstracted expressions: the same
    // body as a literal infers pure (first case above).
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spec item 10: "forward-reference `{any}` + trusted-annotation install".
//
// > So `f() := g()` before `g` exists: unannotated → `{any}` (honest);
// > annotated → author-stated, trusted.
//
// > an **explicit** annotation on a definition whose inference saw an
// > unresolved head is installed as a **trusted contract** — the head is
// > effectively opaque at that moment, so this is the same residual trust class
// > as an opaque host declaration — and is *not* revalidated when the head
// > later resolves (no dependency tracking).
//
// This is hole 3. The unannotated half is now sound (`{any}` ⊇ anything `g`
// turns out to be); the annotated half is a deliberate, documented trust.
// ───────────────────────────────────────────────────────────────────────────
describe('10 — forward reference: `{any}` honestly, or a trusted annotation', () => {
  it('`f() := g()` with `g` undefined infers `{any}`', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'fwd10', ['Function', ['undefined10']]]).evaluate();
    const def = ce.lookupDefinition('fwd10')!['operator'];
    expect(def.effects).toBe('any');
    expect(def.pure).toBe(false);
    // `any` is conservative on impurity — but never pins a seed frame.
    expect(def.drawsRandom).toBe(false);
    expect(eff(ce.box(['fwd10']))).toBe('any');
  });

  it('the `{any}` stays honest once the head resolves as drawing', () => {
    // The installed signature is a construction-time snapshot; `{any}` is the
    // top, so it is a sound over-approximation of whatever `g` becomes — the
    // reason the unresolved case infers it rather than staying optimistic.
    const ce = new ComputeEngine();
    ce.box(['Assign', 'honest10', ['Function', ['later10']]]).evaluate();
    expect(ce.lookupDefinition('honest10')!['operator'].effects).toBe('any');

    ce.box(['Assign', 'later10', ['Function', ['Random']]]).evaluate();
    expect(ce.lookupDefinition('later10')!['operator'].effects).toEqual([
      'random',
    ]);
    // Still `{any}` — which CONTAINS `{random}`; the caller is not told the
    // expression is pure.
    expect(ce.lookupDefinition('honest10')!['operator'].effects).toBe('any');
    expect(eff(ce.box(['honest10']))).toBe('any');
    expect(ce.box(['honest10']).isPure).toBe(false);
  });

  it('a RESOLVED head is read from its definition, not treated as unknown', () => {
    // The control that keeps the previous case about dependency ORDER rather
    // than about named heads in general.
    const ce = new ComputeEngine();
    ce.box(['Assign', 'src10', ['Function', ['Random']]]).evaluate();
    ce.box(['Assign', 'dst10', ['Function', ['src10']]]).evaluate();
    expect(ce.lookupDefinition('dst10')!['operator'].effects).toEqual([
      'random',
    ]);
    expect(ce.lookupDefinition('dst10')!['operator'].drawsRandom).toBe(true);
  });

  it('an explicit annotation over an unresolved head installs as TRUSTED', () => {
    const ce = new ComputeEngine();
    ce.declare('trusted10', {
      signature: '() -> number',
      effects: [],
      evaluate: ce.box(['Function', ['undefined10b']]),
    } as any);
    const def = ce.lookupDefinition('trusted10')!['operator'];
    // The check could not run — the head was opaque — so the author's word is
    // installed, with the provenance bit set. `effects: []` is the STATED
    // empty set (ruled 2026-08-01), so it is stored as `[]`, not collapsed to
    // `undefined`: same set, and the spelling the signature round-trips.
    expect(def.effects).toEqual([]);
    expect(def.pure).toBe(true);
    expect(def.effectsDeclared).toBe(true);
    expect(def.signature.toString()).toBe('() pure -> number');
  });

  it('the trusted contract is NOT revalidated when the head later resolves', () => {
    // No dependency tracking: the residual trust is the same class as an
    // opaque host declaration stating a wrong type. Documented, deliberate.
    const ce = new ComputeEngine();
    ce.declare('trusted10b', {
      signature: '() -> number',
      effects: [],
      evaluate: ce.box(['Function', ['later10b']]),
    } as any);
    ce.box(['Assign', 'later10b', ['Function', ['Random']]]).evaluate();

    const def = ce.lookupDefinition('trusted10b')!['operator'];
    expect(def.effects).toEqual([]);
    expect(def.pure).toBe(true);
    expect(ce.box(['trusted10b']).isPure).toBe(true);
  });

  it('mutual recursion with stated effects is what the escape enables', () => {
    // `isEven`/`isOdd` written in either order: the first sees an unresolved
    // head, and its annotation carries the contract instead of collapsing to
    // `{any}`.
    const ce = new ComputeEngine();
    ce.declare('isEven10', {
      signature: '(number) -> boolean',
      effects: [],
      evaluate: ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], 'True', ['isOdd10', ['Subtract', 'n', 1]]],
        'n',
      ]),
    } as any);
    ce.declare('isOdd10', {
      signature: '(number) -> boolean',
      effects: [],
      evaluate: ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], 'False', ['isEven10', ['Subtract', 'n', 1]]],
        'n',
      ]),
    } as any);
    expect(ce.lookupDefinition('isEven10')!['operator'].effects).toEqual([]);
    expect(ce.lookupDefinition('isOdd10')!['operator'].effects).toEqual([]);
    expect(ce.box(['isEven10', 4]).isPure).toBe(true);
  });
});
