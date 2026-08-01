import { ComputeEngine } from '../../src/compute-engine';
import { effectsOf } from '../../src/compute-engine/boxed-expression/effects-of';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * # The runtime effect channel — `effectsOf`
 *
 * Stage 2 WP-B of `docs/EFFECTS-MODEL.md` ("Projection and discharge", the
 * "Runtime counterpart" clause): ONE expression-level computation
 *
 * ```
 * effects(op(a₁ … aₙ)) = ownEffects(op) ∪ ⋃ᵢ contribution(aᵢ)
 * ```
 *
 * with `contribution` separating **producing** an operand from **invoking or
 * evaluating** it, and with per-position **discharge**.
 *
 * Two consumers are views of it: `isPure` (no impurity label) and the
 * pending-draw walk of `library/core.ts` (keyed on all three seed-frame
 * participation modes). The full contracts suite is WP-D's
 * `effects-contracts.test.ts`; this file pins the channel itself.
 *
 * Co-finite values (`{ not: [...] }`) are INTERNAL — never surface syntax,
 * never serialized — so where one is expected the test asserts through its
 * observable consequences: impure (`isPure === false`) yet provably
 * not-`random` (the frame gate releases).
 */

/** `effectsOf` as a plain value, for `toEqual`. */
function eff(expr: Expression): unknown {
  return effectsOf(expr);
}

describe('Projection basics', () => {
  const ce = new ComputeEngine();

  it('a pure operator over pure operands has no effects', () => {
    expect(eff(ce.parse('1 + x^2'))).toBe(undefined);
    expect(ce.parse('1 + x^2').isPure).toBe(true);
  });

  it("ownEffects surface: a draw is `{random}`, a writer is `{scope}`", () => {
    expect(eff(ce.box(['Random']))).toEqual(['random']);
    expect(eff(ce.box(['Assign', 'q', 1]))).toEqual(['scope']);
    // Unseeded entropy is a different label — impure, but owing the frame
    // nothing.
    expect(eff(ce.box(['RandomExpression']))).toEqual(['entropy']);
  });

  it('an operand contributes its own effects (the eager, non-function case)', () => {
    expect(eff(ce.box(['Add', 1, ['Random']]))).toEqual(['random']);
    expect(ce.box(['Add', 1, ['Random']]).isPure).toBe(false);
  });

  it('an unknown head is `{any}` — conservative, and never pure', () => {
    const e = ce.box(['UnknownHeadXyz', 1], { canonical: false });
    expect(eff(e)).toBe('any');
  });
});

describe('Resolve through the CURRENT binding (hole 1)', () => {
  it('Map(xs, randomF) is {random} when `randomF` is bound to a drawing function', () => {
    const ce = new ComputeEngine();
    ce.assign('randomF', ce.parse('x \\mapsto \\mathrm{Random}()'));
    const e = ce.box(['Map', ['List', 1, 2], 'randomF']);
    expect(e.operator).toBe('Map');
    expect(eff(e)).toEqual(['random']);
    expect(e.isPure).toBe(false);
  });

  it('Map(xs, pureF) stays pure — precision per call site, one fixed signature', () => {
    const ce = new ComputeEngine();
    ce.assign('pureF', ce.parse('x \\mapsto x + 1'));
    const e = ce.box(['Map', ['List', 1, 2], 'pureF']);
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
  });

  it('reassigning the symbol invalidates the memo (the generation guard)', () => {
    const ce = new ComputeEngine();
    ce.assign('cb', ce.parse('x \\mapsto \\mathrm{Random}()'));
    const e = ce.box(['Map', ['List', 1, 2], 'cb']);
    expect(eff(e)).toEqual(['random']);

    // The SAME boxed expression, after the binding changes: the answer must
    // follow the binding, which is what makes "current" honest.
    ce.assign('cb', ce.parse('x \\mapsto x + 1'));
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);

    ce.assign('cb', ce.parse('x \\mapsto \\mathrm{Random}()'));
    expect(eff(e)).toEqual(['random']);
  });

  it('an inline literal operand contributes its arrow effects', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Map', ['List', 1, 2], ['Function', ['Random'], 'x']]);
    expect(eff(e)).toEqual(['random']);
  });
});

describe('Producing vs. invoking (worked example 4)', () => {
  const ce = new ComputeEngine();
  // `MakeCallback` DRAWS in order to build a pure callback.
  ce.declare('MakeCallback', { signature: '() random -> ((real) -> real)' });
  // The mirror image: produces a drawing callback, purely.
  ce.declare('MakeRandomCallback', {
    signature: '() -> ((real) random -> real)',
  });
  ce.declare('Use', { signature: '(function) -> number' });
  // An EAGER discharging position: it contains whatever its callback does.
  ce.declare('UseFramed', {
    signature: '(function) -> number',
    discharges: { 0: ['random'] },
  });

  it('production effects contribute — and are NEVER dischargeable', () => {
    expect(eff(ce.box(['Use', ['MakeCallback']]))).toEqual(['random']);
    // Producing the operand happens BEFORE the operator sees it — the draw
    // fires when the operand is evaluated, whatever `UseFramed` then does with
    // the result — so the discharge does not reach it.
    expect(eff(ce.box(['UseFramed', ['MakeCallback']]))).toEqual(['random']);
  });

  it('the LATENT half is what a discharge absorbs', () => {
    // The mirror image of the case above, same shapes, opposite channels: a
    // purely-produced drawing callback fires only if the operator invokes it,
    // which is exactly what a discharging operator contains.
    expect(eff(ce.box(['Use', ['MakeRandomCallback']]))).toEqual(['random']);
    expect(eff(ce.box(['UseFramed', ['MakeRandomCallback']]))).toBe(undefined);
  });

  it('a pure producer of a random callback is ∅ until the callback is applied', () => {
    expect(eff(ce.box(['MakeRandomCallback']))).toBe(undefined);
    expect(ce.box(['MakeRandomCallback']).isPure).toBe(true);
    // …and `{random}` at the application that may invoke it — through the
    // LATENT set, which a discharging operator could absorb.
    expect(eff(ce.box(['Use', ['MakeRandomCallback']]))).toEqual(['random']);
  });
});

describe('`invokes: false` — a container is pure to build', () => {
  const ce = new ComputeEngine();
  ce.assign('randomF', ce.parse('x \\mapsto \\mathrm{Random}()'));

  it('List(randomF) stores the callback: no latent contribution', () => {
    const e = ce.box(['List', 'randomF']);
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
  });

  it('the effect surfaces at the application that INVOKES an element', () => {
    expect(eff(ce.box(['Map', ['List', 1, 2], 'randomF']))).toEqual(['random']);
  });

  it('a container still carries its operands PRODUCTION effects', () => {
    expect(eff(ce.box(['List', ['Random']]))).toEqual(['random']);
  });
});

describe('Quote positions: `Hold` is inert, `ReleaseHold` resurfaces', () => {
  const ce = new ComputeEngine();

  it('effectsOf(Hold(Random())) is ∅ and the expression is pure', () => {
    for (const e of [
      ce.box(['Hold', ['Random']]),
      ce.parse('\\mathrm{Hold}(\\mathrm{Random}())'),
      ce.function('Hold', [ce.box(['Random'])]),
    ]) {
      expect(eff(e)).toBe(undefined);
      expect(e.isPure).toBe(true);
    }
  });

  it('the effects resurface at forcing', () => {
    expect(eff(ce.box(['ReleaseHold', ['Hold', ['Random']]]))).toEqual([
      'random',
    ]);
    // …including through a symbol bound to the held value.
    ce.assign('heldDraw', ce.box(['Hold', ['Random']]));
    expect(eff(ce.box(['ReleaseHold', 'heldDraw']))).toEqual(['random']);
    // A pure content stays pure through both.
    expect(eff(ce.box(['ReleaseHold', ['Hold', ['Add', 1, 2]]]))).toBe(
      undefined
    );
  });

  it('a held draw is still a draw when released — the inertness is about ACCOUNTING', () => {
    const v = ce.box(['ReleaseHold', ['Hold', ['Random']]]).evaluate();
    expect(v.isNumber).toBe(true);
  });
});

describe('`WithRandomSeed` — the canonical discharger', () => {
  const ce = new ComputeEngine();

  it('discharges `random` on its held body position', () => {
    for (const e of [
      ce.box(['WithRandomSeed', 42, ['Random']]),
      ce.parse('\\mathrm{WithRandomSeed}(42, \\mathrm{Random}())'),
      ce.function('WithRandomSeed', [ce.number(42), ce.box(['Random'])]),
    ]) {
      expect(eff(e)).toBe(undefined);
      expect(e.isPure).toBe(true);
    }
  });

  it('a nested draw behind a callback is discharged too', () => {
    ce.assign('drawF', ce.parse('x \\mapsto \\mathrm{Random}()'));
    expect(
      eff(ce.box(['WithRandomSeed', 42, ['Map', ['List', 1, 2], 'drawF']]))
    ).toBe(undefined);
  });

  it('a `{scope}` write passes through — the frame absorbs draws, not writes', () => {
    const e = ce.box([
      'WithRandomSeed',
      42,
      ['Block', ['Assign', 'counter', 1], ['Random']],
    ]);
    expect(eff(e)).toEqual(['scope']);
    expect(e.isPure).toBe(false);
  });

  it('discharging from an `{any}` body computes ¬{random}: impure, yet provably not-random', () => {
    // An opaque legacy `pure: false` head is `{any}` — unclassified impurity.
    ce.declare('opaqueImpure', {
      signature: '() -> number',
      pure: false,
      evaluate: () => ce.number(7),
    });
    expect(eff(ce.box(['opaqueImpure']))).toBe('any');

    const e = ce.box(['WithRandomSeed', 42, ['opaqueImpure']]);
    // The co-finite value is internal: assert its two observable consequences.
    // (1) still impure — it is not provably free of the other labels;
    expect(e.isPure).toBe(false);
    // (2) provably NOT random, so the frame gate releases rather than keeping
    // the whole expression wrapped.
    expect(e.evaluate().toString()).toBe('7');
  });

  it('the definition declares the discharge, and delimits rather than draws', () => {
    const def = ce.box(['WithRandomSeed', 1, 1]).operatorDefinition!;
    expect(def.discharges).toEqual({ 1: ['random'] });
    expect(def.effects).toBe(undefined);
    expect(def.frameProtocol).toBe('seed');
    // The runtime role is unchanged: a surviving nested frame owes the outer.
    expect(def.drawsRandom).toBe(true);
  });
});

describe('Frame participation is a different axis from impurity', () => {
  it('an incomplete estimator keeps the frame with NO effect label (worked example 6)', () => {
    const ce = new ComputeEngine();
    const e = ce.parse(
      '\\mathrm{WithRandomSeed}(42, \\mathrm{NIntegrate}(x \\mapsto x, 0, n))'
    );
    // A derived sub-stream is pure by the noise-floor convention…
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
    // …yet the partially-evaluated survivor keeps the seed frame pinned, so a
    // later completion replays. That retention rides `readsRandomFrame`, the
    // walk's third key, not any label.
    expect(e.evaluate().operator).toBe('WithRandomSeed');
    expect(ce.box(['NIntegrate', ['Function', 'x', 'x'], 0, 'n']).operatorDefinition!
      .readsRandomFrame).toBe(true);
  });

  it('`any` never pins a frame — unknown operators release', () => {
    const ce = new ComputeEngine();
    ce.declare('opaqueSurvivor', {
      signature: '(number) -> number',
      pure: false,
      // Declines to evaluate when the operand is not a literal: the
      // application SURVIVES inside the frame.
      evaluate: ([x]) => (x.isNumberLiteral ? x : undefined),
    });
    const e = ce.box(['WithRandomSeed', 42, ['opaqueSurvivor', 'unboundN']]);
    // Impure (unknown effects) — but the frame is released, not pinned
    // forever: frame participation requires an EXPLICIT `random` label.
    expect(e.isPure).toBe(false);
    expect(e.evaluate().operator).not.toBe('WithRandomSeed');
  });

  it('a surviving draw behind a symbol-bound callback DOES keep the frame', () => {
    const ce = new ComputeEngine();
    ce.assign('drawEach', ce.parse('x \\mapsto \\mathrm{Random}()'));
    // `ListFrom` of a view whose length has not resolved: the materialization
    // was asked for INSIDE the frame, so the draws are owed.
    const e = ce.box([
      'WithRandomSeed',
      7,
      ['ListFrom', ['Map', ['Range', 1, 'unboundLen'], 'drawEach']],
    ]);
    expect(e.evaluate().operator).toBe('WithRandomSeed');
  });

  it('a lazy view in VALUE position is a completed value, not a pending draw', () => {
    // §6 of `docs/RANDOMNESS-MODEL.md`: the view escapes and draws live at
    // materialization. The re-keyed walk must not change this.
    const ce = new ComputeEngine();
    ce.assign('drawEach2', ce.parse('x \\mapsto \\mathrm{Random}()'));
    const e = ce.box([
      'WithRandomSeed',
      7,
      ['Map', ['Range', 1, 3], 'drawEach2'],
    ]);
    expect(e.evaluate().operator).not.toBe('WithRandomSeed');
  });

  it('held content never pins the frame (the Hold exception, now derived)', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['WithRandomSeed', 3, ['Hold', ['Random']]]);
    expect(e.evaluate().operator).toBe('Hold');
  });
});

describe('Runtime accounting stays conservative for scope writes', () => {
  it('a bare Block reports {scope}; the same body as a literal infers pure', () => {
    const ce = new ComputeEngine();
    // The un-abstracted expression: no confinement analysis at runtime — the
    // projection's `ownEffects` is a constant and stays one (worked example 3,
    // the channel split).
    const bare = ce.box([
      'Block',
      ['Declare', 'n', 0],
      ['Assign', 'n', ['Add', 'n', 1]],
      'n',
    ]);
    expect(eff(bare)).toEqual(['scope']);
    expect(bare.isPure).toBe(false);

    // The SAME body as a function literal: the `Declare` dominates the
    // `Assign`, so inference proves the write confined and the signature is
    // pure — and every application projects through that pure arrow.
    ce.box([
      'Assign',
      'confinedCounter',
      [
        'Function',
        ['Block', ['Declare', 'm', 0], ['Assign', 'm', ['Add', 'm', 1]], 'm'],
      ],
    ]).evaluate();
    const def = ce.lookupDefinition('confinedCounter');
    expect(def && 'operator' in def ? def.operator.effects : 'no-def').toBe(
      undefined
    );
    expect(eff(ce.box(['confinedCounter']))).toBe(undefined);
  });
});

describe('`isPure` is a view of the channel', () => {
  const ce = new ComputeEngine();

  it('a `Function` literal is pure to BUILD; its effects live on its arrow', () => {
    const f = ce.parse('x \\mapsto \\mathrm{Random}()');
    expect(eff(f)).toBe(undefined);
    expect(f.isPure).toBe(true);
    // The literal is an inference boundary: the effects are on its own arrow.
    expect(f.type.toString()).toContain('random');
    // …and it is NOT constant: a caller applying it draws.
    expect(f.isConstant).toBe(false);
  });

  it('impurity, not set-emptiness, is what `isPure` reads', () => {
    expect(ce.box(['Random']).isPure).toBe(false);
    expect(ce.box(['Assign', 'z', 1]).isPure).toBe(false);
    expect(ce.box(['RandomExpression']).isPure).toBe(false);
    // `any` is unknown, hence conservatively impure.
    ce.declare('opaqueUnknown', { signature: '() -> number', pure: false });
    expect(ce.box(['opaqueUnknown']).isPure).toBe(false);
  });
});

describe('Overloads: per-application effects use the RESOLVED arm', () => {
  // `docs/EFFECTS-MODEL.md`, "Subtyping" — *Overloads*: the selection is
  // recomputed by the same write-free resolver used for typing, never stored;
  // definition-wide getters keep reporting the UNION of the arms' effects.
  const engine = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.declare('Roll', {
      signature: '((integer) random -> integer) & ((string) -> string)',
      evaluate: (ops, { engine }) => ops[0],
    });
    return ce;
  };

  it('the drawing arm contributes `{random}`', () => {
    const ce = engine();
    expect(eff(ce.box(['Roll', 6]))).toEqual(['random']);
    expect(ce.box(['Roll', 6]).isPure).toBe(false);
  });

  it('the pure arm contributes nothing — per call site, one definition', () => {
    const ce = engine();
    expect(eff(ce.box(['Roll', { str: 'a' }]))).toBe(undefined);
    expect(ce.box(['Roll', { str: 'a' }]).isPure).toBe(true);
  });

  it('the definition-wide getters stay the UNION, for consumers with no application', () => {
    const ce = engine();
    const def = ce.lookupDefinition('Roll')!['operator'];
    expect(def.effects).toEqual(['random']);
    expect(def.pure).toBe(false);
  });

  it('an unresolvable call falls back to the definition-wide union', () => {
    const ce = engine();
    // Two arguments: no arm accepts the arity, so nothing is selected.
    expect(eff(ce.box(['Roll', 6, 7], { canonical: false }))).toEqual([
      'random',
    ]);
  });

  it('a set stated OUTSIDE the arms is never erased by an arm', () => {
    // `pure: false` translates to `{any}` — a statement the arrows do not
    // carry. Selecting the `string` arm must not report the operator as pure.
    const ce = new ComputeEngine();
    ce.declare('Legacy', {
      signature: '((integer) -> integer) & ((string) -> string)',
      pure: false,
      evaluate: (ops) => ops[0],
    });
    expect(eff(ce.box(['Legacy', { str: 'a' }]))).toBe('any');
  });
});
