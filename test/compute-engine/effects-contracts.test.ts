import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { effectsOf } from '../../src/compute-engine/boxed-expression/effects-of';
import { isEffectContractError } from '../../src/compute-engine/boxed-expression/effects-inference';
import {
  functionLiteralDeclaredEffects,
  functionLiteralDeclaredSignature,
  functionLiteralReturnType,
} from '../../src/compute-engine/boxed-expression/function-literal';
import { typeToString } from '../../src/common/type/serialize';
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
// This is hole 1 of "Current state": `Map(f, xs)` with `f` bound to an impure
// function used to report pure, because a bare symbol is always pure and
// neither the `isPure` conjunction nor the pending-draw walk resolved through
// the binding. The three flavors are the three ways a function value reaches an
// application — inline literal, symbol binding, opaque declaration — and the
// design's claim is that all three report through ONE channel, the signature.
// ───────────────────────────────────────────────────────────────────────────
describe('1 — inline / assigned / opaque `{random}` callbacks', () => {
  /** An engine with all three callback flavors installed under one name each,
   * plus the pure control and the second HOF `applyAll: g ↦ Map(g, [1,2])`. */
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('assignedDraw', ce.box(DRAWING_LAMBDA));
    ce.assign('assignedPure', ce.box(PURE_LAMBDA));
    // An OPAQUE declaration: no body to infer from, the contract is the
    // signature — the case the whole design exists for.
    ce.declare('opaqueDraw', ce.type('(real) random -> real'));
    ce.declare('opaquePure', ce.type('(real) -> real'));
    ce.assign('applyAll', ce.box(['Function', ['Map', 'g', ['List', 1, 2]], 'g']));
    return ce;
  }

  describe('direct: `Map(f, xs)`', () => {
    it('an INLINE literal contributes its arrow effects', () => {
      const ce = engine();
      expect(eff(ce.box(['Map', DRAWING_LAMBDA, ['List', 1, 2]]))).toEqual([
        'random',
      ]);
      expect(eff(ce.box(['Map', PURE_LAMBDA, ['List', 1, 2]]))).toBe(undefined);
    });

    it('an ASSIGNED symbol resolves through its CURRENT binding', () => {
      const ce = engine();
      expect(eff(ce.box(['Map', 'assignedDraw', ['List', 1, 2]]))).toEqual([
        'random',
      ]);
      expect(eff(ce.box(['Map', 'assignedPure', ['List', 1, 2]]))).toBe(
        undefined
      );
    });

    it('an OPAQUE declaration contributes its declared arrow effects', () => {
      const ce = engine();
      expect(eff(ce.box(['Map', 'opaqueDraw', ['List', 1, 2]]))).toEqual([
        'random',
      ]);
      expect(eff(ce.box(['Map', 'opaquePure', ['List', 1, 2]]))).toBe(undefined);
    });

    it('`isPure` follows, on every flavor — the boolean view of the channel', () => {
      const ce = engine();
      for (const cb of [DRAWING_LAMBDA, 'assignedDraw', 'opaqueDraw'])
        expect(ce.box(['Map', cb, ['List', 1, 2]]).isPure).toBe(false);
      for (const cb of [PURE_LAMBDA, 'assignedPure', 'opaquePure'])
        expect(ce.box(['Map', cb, ['List', 1, 2]]).isPure).toBe(true);
    });

    it('route parity: box, parse and `ce.function` agree', () => {
      const ce = engine();
      const routes = [
        ce.box(['Map', 'assignedDraw', ['List', 1, 2]]),
        ce.parse('\\mathrm{Map}(\\mathrm{assignedDraw}, \\lbrack 1, 2 \\rbrack)'),
        ce.function('Map', [ce.symbol('assignedDraw'), ce.box(['List', 1, 2])]),
      ];
      for (const e of routes) {
        expect(eff(e)).toEqual(['random']);
        expect(e.isPure).toBe(false);
      }
    });
  });

  describe('through a second HOF — `(g) ↦ Map(g, xs)` applied to each', () => {
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

    it('an INLINE second HOF (`Apply((g) ↦ Map(g, xs), f)`) agrees', () => {
      const ce = engine();
      const hof = ['Function', ['Map', 'g', ['List', 1, 2]], 'g'];
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
    //   > the literal `(xs) ↦ Map(f, xs)` has type `(list) random -> list` —
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

    it('`(g: (real) random -> real) ↦ Map(g, xs)` carries `random` on its own arrow', () => {
      const ce = new ComputeEngine();
      const literal = ce.box([
        'Function',
        ['Map', 'g', ['List', 1, 2]],
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
        outerArrowEffects(ce.box(['Function', ['Map', 'g', ['List', 1, 2]], 'g']))
      ).toBe(undefined);
      expect(outerArrowEffects(ce.box(['Function', ['g'], 'g']))).toBe(
        undefined
      );
    });

    it('an INLINE literal operand: `(xs) ↦ Map(x ↦ Random(), xs)` carries `random`', () => {
      // This does NOT reopen "literals are inference boundaries": producing or
      // STORING a literal still contributes ∅ (pinned in
      // `user-function-purity.test.ts`, "Literals are inference boundaries").
      // Only an INVOKING position projects the latent set.
      const ce = new ComputeEngine();
      const literal = ce.box([
        'Function',
        ['Map', DRAWING_LAMBDA, ['List', 1, 2]],
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
        ['Function', ['Map', 'globalDraw1', ['List', 1, 2]], 'xs'],
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
          ce.box(['Function', ['Map', 'neverDeclared1', ['List', 1, 2]], 'xs'])
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
      // `Map(k, xs)` with `k := 5`: the binding resolves, and it is not
      // callable, so nothing is projected — the resolved-binding gate.
      //
      // `k` is declared `any` rather than left to infer `integer` from
      // the assignment: as of the 2026-08-09 callback-slot ruling, an operand
      // whose declared type is PROVABLY not a function is rejected outright at
      // every callback slot (`canonicalCallbackOperand`), which would make
      // this an ill-typed program rather than a projection question. `any` is
      // not provably disjoint from `function`, so the operand is still
      // admitted and the gate below is the one under test.
      const ce = new ComputeEngine();
      ce.declare('numericK1', 'any');
      ce.box(['Assign', 'numericK1', 5]).evaluate();
      expect(
        outerArrowEffects(
          ce.box(['Function', ['Map', 'numericK1', ['List', 1, 2]], 'xs'])
        )
      ).toBe(undefined);
    });

    it('…and a provably non-callable one is rejected before it gets there', () => {
      // The companion to the above: the inferred `integer` binding no
      // longer reaches the projection at all.
      const ce = new ComputeEngine();
      ce.box(['Assign', 'numericK2', 5]).evaluate();
      expect(
        ce.box(['Map', 'numericK2', ['List', 1, 2]]).errors[0]?.toString()
      ).toBe(
        'Error(ErrorCode("incompatible-type", "function", "integer"), "numericK2")'
      );
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
        ['Function', ['Map', 'globalDraw2', ['List', 1, 2]], 'xs'],
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
      expect(eff(ce.box(['Map', 'globalDraw2', ['List', 1, 2]]))).toBe(
        undefined
      );
      expect(ce.box(['Map', 'globalDraw2', ['List', 1, 2]]).isPure).toBe(true);
    });

    it('the projection is label-blind — a `scope` parameter projects the same way', () => {
      const ce = new ComputeEngine();
      expect(
        outerArrowEffects(
          ce.box([
            'Function',
            ['Map', 'g', ['List', 1, 2]],
            ['Typed', 'g', { str: '(real) scope -> real' }],
          ])
        )
      ).toEqual(['scope']);
      // …and a PURE annotation projects nothing.
      expect(
        outerArrowEffects(
          ce.box([
            'Function',
            ['Map', 'g', ['List', 1, 2]],
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
//
// The metadata is per POSITION (a boolean is the uniform spelling): the
// selecting conditionals (`If`, `Which`), the storing writers (`Assign`,
// `Declare`) and the sequencer (`Block`) are non-invoking too — see the last
// cases below.
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
      ce.box(['Map', 'storedDraw', ['List', 1]]).operatorDefinition!.invokes
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
    expect(eff(ce.box(['Map', 'storedDraw', ['List', 1, 2]]))).toEqual([
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

  // ── The metadata is PER POSITION ─────────────────────────────────────────
  // The shipped shape is `boolean | { [operandIndex]: boolean }`, missing
  // indices defaulting to `true`; the operator-level boolean is the uniform
  // spelling. The heads below are uniform, so they use the boolean — the map
  // is exercised on a synthetic operator in `effects-of.test.ts`.

  it('a SELECTING head — `If`/`Which` branches — drops the latent half', () => {
    const ce = engine();
    ce.assign('storedPure', ce.box(PURE_LAMBDA));
    for (const [route, e] of Object.entries({
      'If/box': ce.box(['If', 'True', 'storedDraw', 'storedPure']),
      'If/parse': ce.parse(
        '\\mathrm{If}(\\mathrm{True}, \\mathrm{storedDraw}, \\mathrm{storedPure})'
      ),
      'Which/box': ce.box(['Which', 'True', 'storedDraw']),
    })) {
      expect([route, eff(e)]).toEqual([route, undefined]);
      expect([route, e.isPure]).toEqual([route, true]);
    }
    // The branches are HELD may-evaluate positions: their own effects are
    // unaffected — only the latent set of a function VALUE drops.
    expect(eff(ce.box(['If', 'True', ['Random'], 0]))).toEqual(['random']);
    // And the effect surfaces at whatever invokes the SELECTED result.
    expect(
      eff(ce.box(['Apply', ['If', 'True', 'storedDraw', 'storedPure'], 0]))
    ).toEqual(['random']);
  });

  it('a STORING head — `Assign`/`Declare` values — drops the latent half', () => {
    const ce = engine();
    // `{scope}` exactly: the write, not the draw the stored callback will make.
    expect(eff(ce.box(['Assign', 'g', 'storedDraw']))).toEqual(['scope']);
    expect(eff(ce.box(['Declare', 'h', 'function', 'storedDraw']))).toEqual([
      'scope',
    ]);
    // Production effects still count — the RHS is evaluated eagerly.
    expect(eff(ce.box(['Assign', 'k', ['Random']]))).toEqual([
      'random',
      'scope',
    ]);
    // …and the INFERENCE is untouched: the assigned definition still carries
    // `random` on its arrow, so invoking it is `{random}`.
    ce.box(['Assign', 'g', 'storedDraw']).evaluate();
    expect(ce.box('g').type.effects).toEqual(['random']);
    expect(eff(ce.box(['Map', 'g', ['List', 1, 2]]))).toEqual(['random']);
  });

  it('a SEQUENCING head — `Block` — returns its last value, it does not apply it', () => {
    const ce = engine();
    for (const [route, e] of Object.entries({
      'literal/box': ce.box(['Block', DRAWING_LAMBDA]),
      'symbol/box': ce.box(['Block', 'storedDraw']),
      'symbol/parse': ce.parse('\\mathrm{Block}(\\mathrm{storedDraw})'),
      'symbol/function': ce.function('Block', [ce.symbol('storedDraw')]),
    })) {
      expect([route, eff(e)]).toEqual([route, undefined]);
      expect([route, e.isPure]).toEqual([route, true]);
    }
    // CONTROL — statement APPLICATIONS are untouched: their effects reach the
    // block through the `effectsOf` recursion, not the latent term.
    expect(eff(ce.box(['Block', ['Assign', 'x', 1], ['Random']]))).toEqual([
      'random',
      'scope',
    ]);
    // …and the frame still absorbs the draws but not the scope write.
    expect(
      eff(
        ce.box(['WithRandomSeed', 42, ['Block', ['Assign', 'x', 1], ['Random']]])
      )
    ).toEqual(['scope']);
  });

  it('the two CHANNELS agree on a build-and-return block', () => {
    // They disagreed before the annotation: the runtime channel called
    // `Block(() ↦ Random())` impure while the inference already typed the
    // enclosing literal's arrow PURE — it treats `Block` as non-projecting.
    const ce = engine();
    expect(ce.box(['Block', DRAWING_LAMBDA]).isPure).toBe(true);
    expect(ce.box(['Function', ['Block', DRAWING_LAMBDA]]).type.effects).toBe(
      undefined
    );
    // The draw lives on the INNER arrow, where it fires when applied.
    expect(ce.box(['Block', DRAWING_LAMBDA]).type.effects).toEqual(['random']);
  });

  it('the pending-draw walk: a surviving build-and-return block RELEASES the frame', () => {
    // `u` is unbound, so the `ListFrom` never finishes and every node beneath
    // it — the lambda included — is scanned by the walk. The surviving tree
    // carries a `Block` whose only "random" content is a stored callback: no
    // draw is owed to this frame, so the frame is released.
    const ce = engine();
    const released = ce.box([
      'WithRandomSeed',
      7,
      ['ListFrom', ['Map', ['Function', ['Block', 'storedDraw'], 'x'], 'u']],
    ]);
    expect(released.evaluate().operator).toBe('ListFrom');

    // The mirror: the same survivor shape with a REAL pending draw inside the
    // block keeps the frame, exactly as before.
    const kept = ce.box([
      'WithRandomSeed',
      7,
      ['ListFrom', ['Map', ['Function', ['Block', ['Random']], 'x'], 'u']],
    ]);
    expect(kept.evaluate().operator).toBe('WithRandomSeed');
  });

  // ── The walk agrees with the projection — for a LITERAL too ──────────────
  // The walk passes its eager-survivor flag to every operand, so it used to
  // descend into an INLINE `Function` sitting in a non-invoking position and
  // count its body's `Random()` as pending — pinning the frame although the
  // operator only stores or returns the lambda. The verdict then split on
  // SPELLING: `If(c, storedDraw, …)` released while the identical lambda
  // written inline pinned. A function VALUE in a non-invoking position is now
  // a value boundary for the walk, exactly as §6 makes a lazy view's own
  // `Function` subtree one.

  /** A survivor: `u` is unbound, so the `ListFrom` never finishes and every
   * node beneath it — lambdas included — is scanned by the walk. `body` is the
   * lambda body under test. Returns the operator of the evaluated result:
   * `'WithRandomSeed'` = frame kept, anything else = released. */
  function survivor(ce: ComputeEngine, body: unknown): string {
    return ce
      .box([
        'WithRandomSeed',
        7,
        ['ListFrom', ['Map', ['Function', body, 'y'], 'u']],
      ] as any)
      .evaluate().operator;
  }

  it('an INLINE lambda in a non-invoking position releases the frame', () => {
    const ce = engine();
    for (const [head, body] of Object.entries({
      If: ['If', 'True', DRAWING_LAMBDA, ['Function', 0, 'x']],
      Block: ['Block', DRAWING_LAMBDA],
      List: ['List', DRAWING_LAMBDA],
      Tuple: ['Tuple', DRAWING_LAMBDA, 1],
    }))
      expect([head, survivor(ce, body)]).toEqual([head, 'ListFrom']);
  });

  it('…on the PARSE route too', () => {
    const ce = engine();
    for (const [head, latex] of Object.entries({
      If: '\\mathrm{WithRandomSeed}(7, \\mathrm{ListFrom}(\\mathrm{Map}(y \\mapsto \\mathrm{If}(\\mathrm{True}, x \\mapsto \\mathrm{Random}(), x \\mapsto 0), u)))',
      Block:
        '\\mathrm{WithRandomSeed}(7, \\mathrm{ListFrom}(\\mathrm{Map}(y \\mapsto \\mathrm{Block}(x \\mapsto \\mathrm{Random}()), u)))',
      List: '\\mathrm{WithRandomSeed}(7, \\mathrm{ListFrom}(\\mathrm{Map}(y \\mapsto \\lbrack x \\mapsto \\mathrm{Random}() \\rbrack, u)))',
    }))
      expect([head, ce.parse(latex).evaluate().operator]).toEqual([
        head,
        'ListFrom',
      ]);
  });

  it('literal and bound symbol give the SAME verdict — no split on spelling', () => {
    const ce = engine();
    for (const head of ['If', 'Block', 'List'] as const) {
      const inline =
        head === 'If'
          ? ['If', 'True', DRAWING_LAMBDA, ['Function', 0, 'x']]
          : [head, DRAWING_LAMBDA];
      const named =
        head === 'If'
          ? ['If', 'True', 'storedDraw', 'storedDraw']
          : [head, 'storedDraw'];
      expect([head, survivor(ce, inline)]).toEqual([
        head,
        survivor(ce, named),
      ]);
    }
  });

  it('CONTROL — an INVOKING position still pins (the item-104 case)', () => {
    // `Map` invokes its callback per element, so the draws are still owed.
    const ce = engine();
    expect(
      ce
        .box([
          'WithRandomSeed',
          7,
          ['ListFrom', ['Map', DRAWING_LAMBDA, 'u']],
        ])
        .evaluate().operator
    ).toBe('WithRandomSeed');
  });

  it('CONTROL — an APPLICATION operand in a non-invoking position still pins', () => {
    // The carve-out is for function VALUES only: a non-invoking operator still
    // EVALUATES an application operand under itself, so that draw IS pending.
    const ce = engine();
    expect(survivor(ce, ['If', 'True', ['Random'], 0])).toBe('WithRandomSeed');
    expect(survivor(ce, ['Block', ['Assign', 'z', 1], ['Random']])).toBe(
      'WithRandomSeed'
    );
    expect(survivor(ce, ['List', ['Random']])).toBe('WithRandomSeed');
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

  it('the discharge does NOT reach a lazy view that escapes the frame', () => {
    // Tycho item 142, ruled 2026-08-02 (direction A). A discharge says "bring
    // it, I contain it" — and a seed frame contains only the draws made during
    // its dynamic extent. A `Map` view's callback draws at MATERIALIZATION,
    // from whatever frame is active then (`docs/RANDOMNESS-MODEL.md` §6), so
    // the view escapes and its draws are LIVE. Claiming the discharge here
    // reported a genuinely random expression pure.
    //
    // Spelling-insensitive: the callback is NAMED here and inline in the
    // five-shape table below.
    const ce = new ComputeEngine();
    ce.assign('drawEach', ce.box(DRAWING_LAMBDA));
    expect(
      eff(ce.box(['WithRandomSeed', 42, ['Map', 'drawEach', ['List', 1, 2]]]))
    ).toEqual(['random']);
    // …while materializing INSIDE the frame asks for the draws there, so the
    // discharge is genuine and still applies.
    expect(
      eff(
        ce.box([
          'WithRandomSeed',
          42,
          ['ListFrom', ['Map', 'drawEach', ['List', 1, 2]]],
        ])
      )
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

  // ─────────────────────────────────────────────────────────────────────────
  // Tycho item 142 (direction A, ruled 2026-08-02): the frame-escape carve-out
  // on the `random` discharge. RUNTIME semantics are unchanged — the §6 ruling
  // of `docs/RANDOMNESS-MODEL.md` (draws happen at materialization, from
  // whatever frame is active then) stands; only the MODEL stops claiming a
  // discharge it does not deliver.
  // ─────────────────────────────────────────────────────────────────────────
  describe('a frame-escaping lazy view is not discharged (item 142)', () => {
    /** `Map(k ↦ Random(), Range(1, 6))` — the lazy drawing view. */
    const DRAWING_VIEW = ['Map', DRAWING_LAMBDA, ['Range', 1, 6]];

    it('the five shapes', () => {
      const ce = new ComputeEngine();
      const table = [
        // an unframed draw
        [['Random'], ['random']],
        // a framed draw — a GENUINE discharge, the whole point of the frame
        [['WithRandomSeed', 42, ['Random']], undefined],
        // a bare lazy drawing view — impure wherever it is materialized
        [DRAWING_VIEW, ['random']],
        // THE CARVE-OUT: the view escapes the frame and draws live
        [['WithRandomSeed', 42, DRAWING_VIEW], ['random']],
        // materialized INSIDE the frame — genuine again
        [['WithRandomSeed', 42, ['ListFrom', DRAWING_VIEW]], undefined],
      ] as const;
      // Labelled by INDEX: `toString()` materializes a lazy view (and would
      // draw), so it cannot be used to identify a row.
      table.forEach(([expr, expected], row) => {
        const e = ce.box(expr as any);
        expect([row, eff(e)]).toEqual([row, expected]);
        expect([row, e.isPure]).toEqual([row, expected === undefined]);
      });
    });

    it('a `Comprehension` is the same shape, on the parse route too', () => {
      // `[… for k = …]` builds a `Comprehension` — a lazy view that binds its
      // own variable, so its BODY is the per-element work (no `Function` node)
      // and its CLAUSES are the source.
      const ce = new ComputeEngine();
      for (const [route, e] of Object.entries({
        parse: ce.parse(
          '\\mathrm{WithRandomSeed}(42, [\\mathrm{Random}() \\text{ for } k = [1..6]])'
        ),
        box: ce.box([
          'WithRandomSeed',
          42,
          ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 6]]],
        ]),
      })) {
        expect([route, e.ops[1].operator]).toEqual([route, 'Comprehension']);
        expect([route, eff(e)]).toEqual([route, ['random']]);
      }
      // …and materializing it inside the frame discharges as before.
      expect(
        eff(
          ce.box([
            'WithRandomSeed',
            42,
            [
              'ListFrom',
              ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 6]]],
            ],
          ])
        )
      ).toBe(undefined);
    });

    it('a view escapes from a CONTAINER cell and from a `Block` result too', () => {
      // `RANDOMNESS-MODEL.md` §2: the escape "stays a live-draw escape,
      // whether the view is the result itself or a cell of a returned
      // `List`/`Tuple`" — value position propagates through the literal
      // containers exactly as it does in the pending-draw walk, and through
      // the statement a `Block` returns.
      const ce = new ComputeEngine();
      for (const [label, body] of Object.entries({
        List: ['List', DRAWING_VIEW, 1],
        Tuple: ['Tuple', DRAWING_VIEW, 1],
        Pair: ['Pair', DRAWING_VIEW, 1],
        nested: ['List', ['List', DRAWING_VIEW]],
        Block: ['Block', DRAWING_VIEW],
        // The earlier statements run UNDER the frame; the last one escapes.
        'Block after a framed draw': ['Block', ['Random'], DRAWING_VIEW],
      })) {
        const e = ce.box(['WithRandomSeed', 42, body] as any);
        expect([label, eff(e)]).toEqual([label, ['random']]);
      }
    });

    it('a container of only in-frame or pure cells keeps its discharge', () => {
      const ce = new ComputeEngine();
      for (const [label, body] of Object.entries({
        // Draws made in the frame's own extent — the genuine discharge.
        'framed draws': ['List', ['Random'], ['Random']],
        // A view with nothing to escape.
        'pure view': ['List', ['Map', PURE_LAMBDA, ['Range', 1, 6]], 1],
        // Materialized in the frame before it is stored.
        materialized: ['List', ['ListFrom', DRAWING_VIEW], 1],
        // The view is a STATEMENT, not the block's result: `Block` evaluates
        // it under the frame and returns the draw that follows.
        'view not returned': ['Block', DRAWING_VIEW, ['Random']],
        'framed draw returned': ['Block', ['Random']],
      })) {
        const e = ce.box(['WithRandomSeed', 42, body] as any);
        expect([label, eff(e)]).toEqual([label, undefined]);
      }
    });

    it('positive proof only — a view with no draws to escape stays pure', () => {
      const ce = new ComputeEngine();
      // A lazy view whose ELEMENT work is pure: discharging nothing is fine,
      // and the shape alone must not flip it.
      expect(
        eff(ce.box(['WithRandomSeed', 42, ['Map', PURE_LAMBDA, ['Range', 1, 6]]]))
      ).toBe(undefined);
      // A view whose SOURCE draws: that draw happens when the view is BUILT,
      // inside the frame, so it is owed to the frame and stays discharged.
      expect(
        eff(
          ce.box([
            'WithRandomSeed',
            42,
            ['Map', PURE_LAMBDA, ['RandomShuffle', ['Range', 1, 5]]],
          ])
        )
      ).toBe(undefined);
    });

    it('the two channels agree — a frame INSIDE a callback still discharges', () => {
      // The item-132 distinction, kept: a per-site frame WITHIN the callback
      // materializes its value inside itself, so the arrow stays pure and a
      // `Map` over it stays pure. A frame OUTSIDE a lazy view is the escape.
      const ce = new ComputeEngine();
      const perSite = ce.box([
        'Function',
        ['WithRandomSeed', 42, ['Random']],
        'i',
      ]);
      expect(perSite.isPure).toBe(true);
      expect(eff(ce.box(['Map', perSite, ['Range', 1, 3]]))).toBe(undefined);

      // …and the escaping shape propagates through the STATIC channel too:
      // the enclosing literal's own arrow carries `random`, so an operator
      // reading only that arrow (`Map`) agrees with `effectsOf`.
      const escaping = ce.box([
        'Function',
        ['WithRandomSeed', 42, DRAWING_VIEW],
        'i',
      ]);
      expect(escaping.type.effects).toEqual(['random']);
      expect(eff(ce.box(['Map', escaping, ['Range', 1, 3]]))).toEqual([
        'random',
      ]);
    });
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
    // The default-`!scope` ceiling refuses a BARE install of an escaping
    // writer; the stated contract opts in (ruled 2026-08-15). `declare` with
    // an `evaluate` literal is the one-call route yielding an OPERATOR
    // definition with declared effects.
    ce.declare('escaping9', {
      signature: '() scope -> number',
      evaluate: ce.box([
        'Function',
        ['Block', ['Assign', 'counter9', ['Add', 'counter9', 1]], 'counter9'],
      ]),
    });
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
    // fallback applies: not provably confined ⇒ `scope`. Installing such a
    // body requires the stated `scope` contract (the default-`!scope`
    // ceiling).
    const ce = new ComputeEngine();
    ce.declare('conditional9', {
      signature: '() scope -> number',
      evaluate: ce.box([
        'Function',
        [
          'Block',
          ['If', 'flag9', ['Declare', 'k2', { str: 'number' }, 0]],
          ['Assign', 'k2', 5],
          'k2',
        ],
      ]),
    });
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

  it('an update that RESTATES the surface without an annotation retracts the contract', () => {
    // Annotation provenance is replaced by an update that restates the effect
    // surface, never merged into it — the same rule the signature itself
    // follows. Load-bearing beyond tidiness: a declared contract is what
    // `conformanceWideningViolations` checks against, so an author who cannot
    // retract one by rewriting the function without the annotation cannot
    // retire a contract that is holding a conformance back.
    const ce = new ComputeEngine();
    ce.declare('retract1', {
      signature: '(integer) pure -> integer',
      evaluate: () => ce.number(1),
    });
    const def = ce.lookupDefinition('retract1')!['operator'];
    expect(def.effectsDeclared).toBe(true);

    def._update({ signature: '(integer) -> integer' });
    expect(def.effectsDeclared).toBe(false);
  });

  it('an update that restates NOTHING leaves the contract alone', () => {
    // The other side: an update touching some unrelated attribute is not a
    // restatement and must not silently drop the author's annotation.
    const ce = new ComputeEngine();
    ce.declare('retract2', {
      signature: '(integer) pure -> integer',
      evaluate: () => ce.number(1),
    });
    const def = ce.lookupDefinition('retract2')!['operator'];
    def._update({ complexity: 1234 });
    expect(def.effectsDeclared).toBe(true);
  });

  it('an Epsil REDEFINITION restates its own effect annotation', () => {
    // Cross-unit redefinition has REPLACEMENT semantics, and the effect
    // annotation is part of what is replaced: the incoming statement is the
    // whole truth about its own effects. Load-bearing — a contract that cannot
    // be retracted by rewriting the function cannot be retired at all, and it
    // goes on refusing whatever it was refusing (see the mutable-objects entry
    // of `ROADMAP.md`).
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function h(x: integer) pure -> integer { x }');
    expect(String(executeEpsil(ce, 'Type(h)').value)).toBe(
      'TypeFrom("(x: integer) pure -> integer")'
    );

    executeEpsil(ce, 'function h(x: integer) -> integer { x }');
    expect(String(executeEpsil(ce, 'Type(h)').value)).toBe(
      'TypeFrom("(x: integer) -> integer")'
    );
  });

  it('a REJECTED redefinition leaves the installed contract untouched', () => {
    // The provenance is rebuilt from the incoming statement, but only once the
    // install SUCCEEDS. A redefinition that `ce.assign` refuses — every bare
    // one below, and the widening case that is the common rejection — must
    // leave the surviving definition exactly as it was, or the contract check
    // reads a `pure` definition that claims to declare nothing.
    for (const rejected of [
      'function h(x: integer) -> string { x }',
      'function h(x: integer) -> integer { Random() }',
      'function h(x: integer) random -> integer { x }',
    ]) {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'function h(x: integer) pure -> integer { x }');
      expect(String(executeEpsil(ce, rejected).value)).toMatch(/^Error\(/);

      const def = ce.lookupDefinition('h')!['operator'];
      expect(def.effectsDeclared).toBe(true);
      expect(def.signature.toString()).toBe('(x: integer) pure -> integer');
    }
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

// ───────────────────────────────────────────────────────────────────────────
// STAGE 3 — full-signature `Typed` markers.
//
// `docs/EFFECTS-MODEL.md`, "Epsil surface": the block-form definition return
// annotation is encoded as **the full signature**. A `Function` literal's §4.2
// return marker may hold a complete `FunctionSignature` — parameter types
// mirrored from the parameter list, arrow effects from the post-parameter-list
// specifier slot, result from the ascription — and that signature is the
// literal's declared type.
//
// Decomposition predicate: a marker's type decomposes as a full signature iff
// it parses to a signature AND carries an effect set (the stated-empty `[]` a
// `pure` keyword builds counts). A signature WITHOUT effects keeps its
// historical reading — a function whose RESULT is a function — so existing
// bare `Typed(body, returnType)` ascriptions are untouched.
//
// Wide-result convention (mirrors `desugarSignatureString`'s `isWide`): a
// result of `unknown`/`any` declares NO return type; only the effects are
// declared, and the return stays inferred. That is what
// `function tick() scope { … }` lowers to.
// ───────────────────────────────────────────────────────────────────────────
describe('STAGE 3 — full-signature `Typed` markers', () => {
  /** `(n) ↦ Random(Range(1, n))` — the drawing body every case below reuses. */
  const DRAWING_BODY = ['Random', ['Range', 1, 'n']];

  describe('the literal carries the declared arrow', () => {
    it('box route: effects AND result come off a full-signature marker', () => {
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', DRAWING_BODY, { str: '(n: unknown) random -> integer' }],
        'n',
      ]);
      expect(f.type.toString()).toBe('(unknown) random -> integer');
      // The declared RESULT is `integer`, not the whole signature: the marker
      // decomposed.
      expect(typeToString(functionLiteralReturnType(f)!)).toBe('integer');
      expect(functionLiteralDeclaredEffects(f)).toEqual(['random']);
    });

    it('the param operands stay the parameters of record', () => {
      // The marker signature's argument list is a MIRROR: never read for
      // parameter types. Here it says `n: unknown` while the parameter operand
      // is annotated `integer` — the parameter operand wins.
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', DRAWING_BODY, { str: '(n: unknown) random -> integer' }],
        ['Typed', 'n', { str: 'integer' }],
      ]);
      expect(f.type.toString()).toBe('(n: integer) random -> integer');
    });

    it('a STATED-pure marker round-trips as ` pure`', () => {
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', 'x', { str: '(x: unknown) pure -> real' }],
        'x',
      ]);
      // `[]` is the stated empty set, not `undefined` — the spelling survives.
      expect(functionLiteralDeclaredEffects(f)).toEqual([]);
      expect(f.type.toString()).toBe('(unknown) pure -> real');
      expect(f.isPure).toBe(true);
    });

    it('a wide result declares effects ONLY; the return stays inferred', () => {
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        [
          'Typed',
          ['Block', ['Assign', 'w3', 'x'], ['Add', 'x', 1]],
          { str: '(x: unknown) scope -> unknown' },
        ],
        'x',
      ]);
      expect(functionLiteralDeclaredEffects(f)).toEqual(['scope']);
      // No declared return type at all…
      expect(functionLiteralReturnType(f)).toBe(undefined);
      // …so inference supplies it (and the finite-numeric widening rule still
      // applies over the last statement's own type) — `unknown` is NOT forced.
      expect(f.type.toString()).toBe('(unknown) scope -> number');
    });

    it('the inferred effects UNION with the declared ones', () => {
      // Over-declaring is allowed and the union equals the declared set; the
      // literal's arrow is a sound over-approximation either way.
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', ['Add', 'n', 1], { str: '(n: unknown) random scope -> integer' }],
        'n',
      ]);
      expect(f.type.toString()).toBe('(unknown) random scope -> integer');
    });
  });

  describe('an EFFECT-FREE marker decomposes too (ruled 2026-08-04)', () => {
    it('a ground signature is the literal’s OWN contract, not a return type', () => {
      // Was: an effect-free arrow stayed a return-type ascription, so this
      // literal typed `(unknown) -> (integer) -> integer` — a function
      // returning a function, which is plainly not what the marker author
      // meant. The grouped spelling below is the opt-out for that reading, so
      // the ungrouped one no longer needs effects to be read as a contract.
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', ['Add', 'x', 1], { str: '(integer) -> integer' }],
        'x',
      ]);
      expect(typeToString(functionLiteralDeclaredSignature(f)!)).toBe(
        '(integer) -> integer'
      );
      // A plain arrow STATES no effects — the specifier slot is empty, which is
      // not the stated-empty set a `pure` keyword writes. Reading it as a
      // stated-pure contract would put the literal on the checked track.
      expect(functionLiteralDeclaredEffects(f)).toBe(undefined);
      // The declared RETURN type is now the signature's RESULT.
      expect(typeToString(functionLiteralReturnType(f)!)).toBe('integer');
      expect(f.type.toString()).toBe('(unknown) -> integer');
    });

    it('the GROUPED spelling is the migration path for a returned function', () => {
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', ['Add', 'x', 1], { str: '((integer) -> integer)' }],
        'x',
      ]);
      expect(functionLiteralDeclaredSignature(f)).toBe(undefined);
      expect(functionLiteralDeclaredEffects(f)).toBe(undefined);
      expect(typeToString(functionLiteralReturnType(f)!)).toBe(
        '(integer) -> integer'
      );
      expect(f.type.toString()).toBe('(unknown) -> (integer) -> integer');
    });

    it('an ARITY-MISMATCHED ground marker is rejected, like a quantified one', () => {
      // The E2 pre-pass well-formedness check now covers ground markers: the
      // marker is the contract of record, so a signature the literal cannot
      // implement is an error rather than a silent return-type reading.
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', ['Add', 'x', 1], { str: '(integer, integer) -> integer' }],
        'x',
      ]);
      expect(f.toString()).toContain(
        'A function-literal signature marker must be a plain signature'
      );
    });

    it('a bare return-type ascription is unchanged', () => {
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', ['Add', 'x', 1], { str: 'integer' }],
        'x',
      ]);
      expect(functionLiteralDeclaredEffects(f)).toBe(undefined);
      expect(f.type.toString()).toBe('(unknown) -> integer');
    });

    it('a PARENTHESIZED effect-bearing signature is a grouped RETURN type, not a contract (ruled 2026-08-01)', () => {
      // Grouping does not survive parsing, so the marker's TEXT is the
      // authority: `-> ((real) random -> real)` ascribes an effectful-arrow
      // RETURN type, while the ungrouped spelling declares the literal's own
      // contract. See `isGroupedTypeText` (`common/type/utils.ts`).
      const ce = new ComputeEngine();
      const f = ce.box([
        'Function',
        ['Typed', 'x', { str: '((real) random -> real)' }],
        'x',
      ]);
      expect(functionLiteralDeclaredEffects(f)).toBe(undefined);
      expect(f.type.toString()).toBe('(unknown) -> (real) random -> real');
    });
  });

  describe('the marker is a CONTRACT at install', () => {
    it('a violation is an `incompatible-type` error VALUE on the `Assign` route', () => {
      const ce = new ComputeEngine();
      const r = ce
        .box([
          'Assign',
          'v3',
          [
            'Function',
            ['Typed', DRAWING_BODY, { str: '(n: unknown) pure -> integer' }],
            'n',
          ],
        ])
        .evaluate();
      expect(r.operator).toBe('Error');
      expect(r.toString()).toContain('incompatible-type');
      // Not installed: the symbol was auto-declared while the `Assign` was
      // canonicalized, but no operator definition was created for it.
      expect(ce.lookupDefinition('v3')?.['operator']).toBeUndefined();
    });

    it('a failed install leaves a USABLE definition record (no crash on call)', () => {
      // `updateDef` swaps a definition record's value/operator halves; the
      // operator constructor throwing (this contract check) used to fire
      // AFTER the old half was deleted, leaving a record with neither — and
      // applying the symbol then crashed in `makeCanonicalFunction`
      // (`def.operator.scoped` on undefined). The swap is now transactional.
      const ce = new ComputeEngine();
      ce.box([
        'Assign',
        'v3c',
        [
          'Function',
          ['Typed', DRAWING_BODY, { str: '(n: unknown) pure -> integer' }],
          'n',
        ],
      ]).evaluate();
      // The pre-declared placeholder survives; the call is inert, not a throw.
      expect(ce.box(['v3c', 1]).toString()).toBe('v3c(1)');
    });

    it('the same violation THROWS through the JS `ce.assign` API', () => {
      const ce = new ComputeEngine();
      const literal = ce.box([
        'Function',
        ['Typed', DRAWING_BODY, { str: '(n: unknown) pure -> integer' }],
        'n',
      ]);
      let caught: unknown;
      try {
        ce.assign('v3b', literal);
      } catch (e) {
        caught = e;
      }
      expect(isEffectContractError(caught)).toBe(true);
      expect((caught as Error).message).toContain('random');
    });

    it('a contract that HOLDS installs, and the definition keeps the declared set', () => {
      const ce = new ComputeEngine();
      ce.box([
        'Assign',
        'h3',
        [
          'Function',
          ['Typed', DRAWING_BODY, { str: '(n: unknown) random -> integer' }],
          'n',
        ],
      ]).evaluate();
      const def = ce.lookupDefinition('h3')!['operator'];
      expect(def.signature.toString()).toBe('(unknown) random -> integer');
      expect(def.effects).toEqual(['random']);
      // The marker is AUTHOR-stated, so it sets the provenance bit (an
      // inference-produced arrow is stripped instead).
      expect(def.effectsDeclared).toBe(true);
      expect(def.pure).toBe(false);
      expect(ce.box('h3').type.toString()).toBe('(unknown) random -> integer');
      expect(eff(ce.box(['h3', 5]))).toEqual(['random']);
      expect(ce.box(['h3', 5]).isPure).toBe(false);
    });

    it('OVER-declaring installs and the declared set is what is stored', () => {
      const ce = new ComputeEngine();
      ce.box([
        'Assign',
        'o3',
        [
          'Function',
          [
            'Typed',
            ['Add', 'n', 1],
            { str: '(n: unknown) random scope -> integer' },
          ],
          'n',
        ],
      ]).evaluate();
      const def = ce.lookupDefinition('o3')!['operator'];
      expect(def.effects).toEqual(['random', 'scope']);
      expect(def.effectsDeclared).toBe(true);
      expect(def.signature.toString()).toBe(
        '(unknown) random scope -> integer'
      );
    });

    it('an effects-ONLY marker still installs an explicit signature', () => {
      // Wide result, no annotated parameter: nothing a return-type ascription
      // or an annotated param would catch, yet it IS an annotation.
      const ce = new ComputeEngine();
      ce.box([
        'Assign',
        'tick3',
        ['Function', ['Typed', ['Assign', 'ctr3', 1], { str: '() scope -> unknown' }]],
      ]).evaluate();
      const def = ce.lookupDefinition('tick3')!['operator'];
      expect(def.inferredSignature).toBe(false);
      expect(def.effects).toEqual(['scope']);
      expect(def.effectsDeclared).toBe(true);
      expect(def.signature.toString()).toBe('() scope -> integer');
    });

    it('a stated-pure marker over a pure body installs as a purity CONTRACT', () => {
      const ce = new ComputeEngine();
      ce.box([
        'Assign',
        'p3',
        [
          'Function',
          ['Typed', ['Add', 'n', 1], { str: '(n: unknown) pure -> integer' }],
          'n',
        ],
      ]).evaluate();
      const def = ce.lookupDefinition('p3')!['operator'];
      expect(def.effects).toEqual([]);
      expect(def.effectsDeclared).toBe(true);
      expect(def.pure).toBe(true);
      expect(def.signature.toString()).toBe('(unknown) pure -> integer');
    });
  });

  describe('re-assigning a lambda preserves effect PROVENANCE', () => {
    it('an INFERRED effect set does not become a declared contract', () => {
      // The re-assignment rebuild installs a FRESH operator definition, and the
      // constructor reads ANY effect-bearing supplied signature as author-
      // STATED. Carrying an INFERRED specifier over would flip
      // `effectsDeclared` on the second assign, turning the first assign's
      // inference into a contract that later re-assigns are checked against.
      const ce = new ComputeEngine();
      const drawing = () =>
        ce.box([
          'Function',
          ['Add', 'n', ['Random']],
          ['Typed', 'n', { str: 'integer' }],
        ]);
      ce.assign('r9', drawing());
      const first = ce.lookupDefinition('r9')!['operator']!;
      expect(first.effectsDeclared).toBe(false);
      expect(first.effects).toEqual(['random']);

      ce.assign('r9', drawing());
      const second = ce.lookupDefinition('r9')!['operator']!;
      expect(second.effectsDeclared).toBe(false);
      expect(second.effects).toEqual(['random']);

      // A PURE body then re-infers from scratch: the previously-INFERRED
      // `random` was never a contract, so nothing has to satisfy it.
      ce.assign(
        'r9',
        ce.box([
          'Function',
          ['Add', 'n', 1],
          ['Typed', 'n', { str: 'integer' }],
        ])
      );
      const third = ce.lookupDefinition('r9')!['operator']!;
      expect(third.effectsDeclared).toBe(false);
      expect(third.pure).toBe(true);
      expect(third.signature.toString()).not.toContain('random');
    });

    it('an AUTHOR-STATED contract still survives the re-assign', () => {
      const ce = new ComputeEngine();
      const stated = () =>
        ce.box([
          'Function',
          ['Typed', DRAWING_BODY, { str: '(n: unknown) random -> integer' }],
          'n',
        ]);
      ce.assign('r9b', stated());
      ce.assign('r9b', stated());
      const def = ce.lookupDefinition('r9b')!['operator']!;
      expect(def.effectsDeclared).toBe(true);
      expect(def.effects).toEqual(['random']);
      expect(def.signature.toString()).toBe('(unknown) random -> integer');
    });
  });

  describe('the `desugarSignatureString` sugar route preserves arrow effects', () => {
    it('a signature-string parameter keeps its effects on the literal', () => {
      const ce = new ComputeEngine();
      const f = ce.function('Function', [
        ce.box(['Add', 'n', ['Random']]),
        ce.string('(n: integer) random -> integer'),
      ]);
      expect(f.type.toString()).toBe('(n: integer) random -> integer');
      expect(functionLiteralDeclaredEffects(f)).toEqual(['random']);
    });

    it('a wide result under the sugar declares effects only', () => {
      const ce = new ComputeEngine();
      const f = ce.function('Function', [
        ce.box(['Assign', 's3', 'n']),
        ce.string('(n: integer) scope -> unknown'),
      ]);
      expect(functionLiteralDeclaredEffects(f)).toEqual(['scope']);
      expect(functionLiteralReturnType(f)).toBe(undefined);
      expect(f.type.toString()).toBe('(n: integer) scope -> integer');
    });

    it('an effect-free signature string is unchanged (result-only ascription)', () => {
      const ce = new ComputeEngine();
      const f = ce.function('Function', [
        ce.box(['Add', 'n', 1]),
        ce.string('(n: integer) -> integer'),
      ]);
      expect(functionLiteralDeclaredEffects(f)).toBe(undefined);
      expect(f.type.toString()).toBe('(n: integer) -> integer');
    });
  });
});

/**
 * The effects memo is re-entrancy-safe (review finding on item 120). The
 * projection follows bindings, so a self-recursive definition's body reaches
 * its own nodes re-entrantly. The shared `cachedValue` helper stamps the
 * generation BEFORE computing, so the re-entrant read returned the PREVIOUS
 * generation's value (the assign-time in-flight `'any'`) as fresh — freezing
 * it at the current generation and making `isPure` depend on which node was
 * read first.
 */
describe('effects memo re-entrancy (recursive definition bodies)', () => {
  const setup = () => {
    const ce = new ComputeEngine();
    ce.declare('S_9', '(number, number, number) -> number');
    ce.assign('S_9', ce.parse('(x,y,r)\\mapsto\\sin(xy)+0.1r'));
    ce.declare('R_9', '(number, number, number) -> number');
    ce.assign(
      'R_9',
      ce.parse(
        '(i,x,y)\\mapsto\\begin{cases}0&i=0\\\\R_9(i-1,x,y)+0.5S_9(x,y,R_9(i-1,x,y))&\\text{otherwise}\\end{cases}'
      )
    );
    return ce;
  };

  it('a pure recursive body reports pure when the body root is read FIRST', () => {
    const ce = setup();
    const body = (ce.box('R_9').value as Expression).op1;
    expect(body.isPure).toBe(true);
  });

  it('…and when a CHILD is read first (the order that froze the stale any)', () => {
    const ce = setup();
    const body = (ce.box('R_9').value as Expression).op1;
    void body.op1.isPure;
    expect(body.isPure).toBe(true);
  });

  it('an impure recursive body reports impure in both orders', () => {
    const ce = setup();
    ce.declare('Q_9', '(number) -> number');
    ce.assign(
      'Q_9',
      ce.parse('(n)\\mapsto\\begin{cases}0&n=0\\\\Q_9(n-1)+\\operatorname{Random}()&\\text{otherwise}\\end{cases}')
    );
    const body = (ce.box('Q_9').value as Expression).op1;
    void body.op1.isPure;
    expect(body.isPure).toBe(false);
    const ce2 = setup();
    ce2.declare('Q_9', '(number) -> number');
    ce2.assign(
      'Q_9',
      ce2.parse('(n)\\mapsto\\begin{cases}0&n=0\\\\Q_9(n-1)+\\operatorname{Random}()&\\text{otherwise}\\end{cases}')
    );
    const body2 = (ce2.box('Q_9').value as Expression).op1;
    expect(body2.isPure).toBe(false);
  });
});

/**
 * # The default-`!scope` ceiling (ruled 2026-08-15)
 *
 * A NAMED definition with no effect annotation guarantees it does not mutate
 * the world: a body with a PROVEN escaping write (unconfined `Assign`,
 * `Assume`, or an application of a resolved callee whose effect set concretely
 * contains `scope`) is refused at install unless the definition declares the
 * `scope` effect. The trigger is the walk's proven-mutation bit, never the
 * inferred set's `scope` label, so `{any}` conservatism (unresolved
 * forward-referenced heads) stays optimistic and mutual recursion keeps
 * working. Anonymous literals are not gated — they have no annotation surface
 * (the lambda specifier slot is deferred); their arrows carry the inferred
 * `scope` honestly, which is what the census measured.
 */
describe('The default-`!scope` ceiling: escaping writes are opt-in', () => {
  it('a bare install of an escaping writer is refused on the Assign route', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'cl_ctr', 0]).evaluate();
    const r = ce.box([
      'Assign',
      'cl_bump',
      ['Function', ['Assign', 'cl_ctr', ['Add', 'cl_ctr', 1]]],
    ]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('scope');
    // Not installed: the definition record stays usable and the counter
    // never moved.
    expect(ce.box('cl_ctr').evaluate().re).toBe(0);
  });

  it('the `ce.assign` API route throws the contract error', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'cl_ctr2', 0]).evaluate();
    let thrown: unknown;
    try {
      ce.assign(
        'cl_bump2',
        ce.box(['Function', ['Assign', 'cl_ctr2', ['Add', 'cl_ctr2', 1]]])
      );
    } catch (e) {
      thrown = e;
    }
    expect(isEffectContractError(thrown)).toBe(true);
  });

  it('the stated `scope` contract opts in, and the write works', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'cl_ctr3', 0]).evaluate();
    ce.declare('cl_bump3', { signature: '() scope -> number' });
    ce.assign(
      'cl_bump3',
      ce.box([
        'Function',
        ['Block', ['Assign', 'cl_ctr3', ['Add', 'cl_ctr3', 1]], 'cl_ctr3'],
      ])
    );
    expect(ce.box(['cl_bump3']).evaluate().re).toBe(1);
    expect(ce.box('cl_ctr3').evaluate().re).toBe(1);
  });

  it('a write to an OWN PARAMETER is confined: bare install, pure, call-local', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'cl_pinc',
      ['Function', ['Block', ['Assign', 'x', ['Add', 'x', 1]], 'x'], 'x'],
    ]).evaluate();
    const def = ce.lookupDefinition('cl_pinc')!['operator'];
    expect(def.effects).toBe(undefined);
    expect(def.pure).toBe(true);
    // The write is effective inside the body and invisible to the caller.
    ce.box(['Assign', 'cl_arg', 5]).evaluate();
    expect(ce.box(['cl_pinc', 'cl_arg']).evaluate().re).toBe(6);
    expect(ce.box('cl_arg').evaluate().re).toBe(5);
  });

  it('a factory RETURNING a writing closure installs bare (production is pure)', () => {
    const ce = new ComputeEngine();
    // makeCounter() { let c = 0; () ↦ { c := c + 1; c } } — the inner
    // literal's write goes on the inner ARROW (literals are inference
    // boundaries); the factory's own body only produces it.
    const r = ce.box([
      'Assign',
      'cl_mk',
      [
        'Function',
        [
          'Block',
          ['Declare', 'c', { str: 'number' }, 0],
          ['Function', ['Block', ['Assign', 'c', ['Add', 'c', 1]], 'c']],
        ],
      ],
    ]).evaluate();
    expect(r.operator).not.toBe('Error');
  });

  it('a forward-referenced head stays optimistic: bare install allowed', () => {
    const ce = new ComputeEngine();
    const r = ce.box([
      'Assign',
      'cl_fwd',
      ['Function', ['cl_laterDefined', 'n'], 'n'],
    ]).evaluate();
    expect(r.operator).not.toBe('Error');
  });

  it('calling a DECLARED-`scope` function is a proven mutation: the caller needs the contract too', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'cl_ctr4', 0]).evaluate();
    ce.declare('cl_bump4', { signature: '() scope -> number' });
    ce.assign(
      'cl_bump4',
      ce.box([
        'Function',
        ['Block', ['Assign', 'cl_ctr4', ['Add', 'cl_ctr4', 1]], 'cl_ctr4'],
      ])
    );
    // Bare wrapper over a scope callee: refused…
    const bare = ce.box([
      'Assign',
      'cl_wrap',
      ['Function', ['cl_bump4']],
    ]).evaluate();
    expect(bare.operator).toBe('Error');
    // …and the annotated wrapper installs.
    ce.declare('cl_wrap2', { signature: '() scope -> number' });
    ce.assign('cl_wrap2', ce.box(['Function', ['cl_bump4']]));
    expect(ce.box(['cl_wrap2']).evaluate().re).toBe(1);
  });

  // A clause SET does not reach the operator definition's own walk-and-gate:
  // `installClauseList` builds `evaluate` as a JS dispatch function and hands
  // the definition an already-unioned effect row as an author-STATED one. The
  // ceiling therefore has a second enforcement point, in `defineFunctionClause`
  // (`src/compute-engine/multi-clause.ts`), on the clause being admitted.
  it('a SECOND bare clause with an escaping write is refused', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'cl_ctr5', 0]).evaluate();
    // Clause 1: pure, installs through the single-clause `ce.assign` shortcut.
    expect(
      ce.box([
        'DefineFunction',
        'cl_mbump',
        ['Function', 0, ['Typed', 'z', { str: '0' }]],
      ]).evaluate().operator
    ).not.toBe('Error');
    // Clause 2: converts the symbol to clause storage, and writes outside.
    const r = ce.box([
      'DefineFunction',
      'cl_mbump',
      [
        'Function',
        ['Block', ['Assign', 'cl_ctr5', ['Add', 'cl_ctr5', 1]], 'n'],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('scope');
    // Not installed, and nothing ran: the counter never moved and the symbol
    // still holds only the first clause.
    expect(ce.box('cl_ctr5').evaluate().re).toBe(0);
    expect(ce.box(['cl_mbump', 0]).evaluate().re).toBe(0);
    expect(ce.box('cl_ctr5').evaluate().re).toBe(0);
  });

  it('the clause’s stated `scope` row opts in, and the write works', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'cl_ctr6', 0]).evaluate();
    expect(
      ce.box([
        'DefineFunction',
        'cl_mbump2',
        ['Function', 0, ['Typed', 'z', { str: '0' }]],
      ]).evaluate().operator
    ).not.toBe('Error');
    // The same escaping clause, with the effect row STATED on the literal's
    // full-signature return marker.
    const r = ce.box([
      'DefineFunction',
      'cl_mbump2',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Assign', 'cl_ctr6', ['Add', 'cl_ctr6', 1]], 'cl_ctr6'],
          { str: '(n: integer) scope -> integer' },
        ],
        'n',
      ],
    ]).evaluate();
    expect(r.operator).not.toBe('Error');
    // It dispatches, and the write reaches the outer variable.
    expect(ce.box(['cl_mbump2', 5]).evaluate().re).toBe(1);
    expect(ce.box('cl_ctr6').evaluate().re).toBe(1);
    // The pure clause is still there.
    expect(ce.box(['cl_mbump2', 0]).evaluate().re).toBe(0);
  });
});
