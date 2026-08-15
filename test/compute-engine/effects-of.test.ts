import { ComputeEngine } from '../../src/compute-engine';
import {
  effectsOf,
  shallowApplicationEffects,
} from '../../src/compute-engine/boxed-expression/effects-of';
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
  it('Map(randomF, xs) is {random} when `randomF` is bound to a drawing function', () => {
    const ce = new ComputeEngine();
    ce.assign('randomF', ce.parse('x \\mapsto \\mathrm{Random}()'));
    const e = ce.box(['Map', 'randomF', ['List', 1, 2]]);
    expect(e.operator).toBe('Map');
    expect(eff(e)).toEqual(['random']);
    expect(e.isPure).toBe(false);
  });

  it('Map(pureF, xs) stays pure — precision per call site, one fixed signature', () => {
    const ce = new ComputeEngine();
    ce.assign('pureF', ce.parse('x \\mapsto x + 1'));
    const e = ce.box(['Map', 'pureF', ['List', 1, 2]]);
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
  });

  it('reassigning the symbol invalidates the memo (the generation guard)', () => {
    const ce = new ComputeEngine();
    ce.assign('cb', ce.parse('x \\mapsto \\mathrm{Random}()'));
    const e = ce.box(['Map', 'cb', ['List', 1, 2]]);
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
    const e = ce.box(['Map', ['Function', ['Random'], 'x'], ['List', 1, 2]]);
    expect(eff(e)).toEqual(['random']);
  });
});

describe('A head bound to a function VALUE (declare-then-assign)', () => {
  // `ce.assign(name, fn)` alone creates an OPERATOR definition, but the
  // documented declare-then-assign idiom leaves a VALUE definition holding a
  // function. The head position must resolve through it exactly as an operand
  // position does — otherwise `fib(3)` reports `{any}` forever, even after a
  // provably pure body is assigned.
  for (const [spelling, declaration] of [
    ['type', { type: '(number) -> number' }],
    ['signature', { signature: '(number) -> number' }],
  ] as const) {
    describe(`declared with \`${spelling}:\``, () => {
      it('a pure body makes the application pure — on the box AND parse routes', () => {
        const ce = new ComputeEngine();
        ce.declare('fib', declaration);
        ce.assign('fib', ce.parse('x \\mapsto x + 1'));
        // The binding really is a value definition, not an operator one — that
        // is the shape this whole block is about.
        const def = ce.lookupDefinition('fib');
        expect(def !== undefined && 'value' in def).toBe(true);

        for (const e of [ce.box(['fib', 3]), ce.parse('\\mathrm{fib}(3)')]) {
          expect(eff(e)).toBe(undefined);
          expect(e.isPure).toBe(true);
        }
        // …and in operand position, which never had the blind spot.
        expect(eff(ce.box(['Map', 'fib', ['List', 1, 2]]))).toBe(undefined);
      });

      it('a scope-writing body surfaces `{scope}`', () => {
        const ce = new ComputeEngine();
        // The `scope` must be DECLARED since the default-`!scope` ceiling
        // (2026-08-15) extended to declare-then-assign: a writer body on a
        // bare declaration is refused, not installed. The head-position
        // surfacing this test pins is unchanged — the declared arrow and the
        // stored value's arrow are unioned by `valueBindingEffects`.
        ce.declare(
          'bump',
          spelling === 'type'
            ? { type: '(number) scope -> number' }
            : { signature: '(number) scope -> number' }
        );
        ce.assign(
          'bump',
          ce.parse('x \\mapsto \\mathrm{Assign}(\\mathrm{tally}, x)')
        );
        for (const e of [ce.box(['bump', 3]), ce.parse('\\mathrm{bump}(3)')]) {
          expect(eff(e)).toEqual(['scope']);
          expect(e.isPure).toBe(false);
        }
      });

      it('a scope-writing body on a BARE declaration is refused (the ceiling)', () => {
        const ce = new ComputeEngine();
        ce.declare('bump2', declaration);
        expect(() =>
          ce.assign(
            'bump2',
            ce.parse('x \\mapsto \\mathrm{Assign}(\\mathrm{tally}, x)')
          )
        ).toThrow(/scope/);
      });

      it('a drawing body surfaces `{random}` — including against a pure-declared arrow', () => {
        const ce = new ComputeEngine();
        ce.declare('draws', declaration);
        ce.assign('draws', ce.parse('x \\mapsto \\mathrm{Random}() + x'));
        // The DECLARED arrow stays pure on this route (the
        // definition-annotation check does not run here), so reading it alone
        // would report the body pure and silently release a seed frame. The
        // stored value's own arrow is what carries the truth, and the two are
        // unioned.
        for (const e of [ce.box(['draws', 3]), ce.parse('\\mathrm{draws}(3)')]) {
          expect(eff(e)).toEqual(['random']);
          expect(e.isPure).toBe(false);
        }
      });
    });
  }

  it('reassignment revises the answer (the generation guard)', () => {
    const ce = new ComputeEngine();
    ce.declare('revised', { type: '(number) -> number' });
    ce.assign('revised', ce.parse('x \\mapsto x + 1'));
    const e = ce.box(['revised', 3]);
    expect(e.isPure).toBe(true);

    // The SAME boxed expression, after the binding changes.
    ce.assign('revised', ce.parse('x \\mapsto \\mathrm{Random}()'));
    expect(eff(e)).toEqual(['random']);
    expect(e.isPure).toBe(false);

    ce.assign('revised', ce.parse('x \\mapsto x + 2'));
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
  });

  it('a head bound to a non-callable value is still `{any}`', () => {
    const ce = new ComputeEngine();
    ce.assign('notAFunction', 5);
    expect(eff(ce.box(['notAFunction', 3], { canonical: false }))).toBe('any');
  });

  it('a drawing value-def head participates in the seed frame', () => {
    const ce = new ComputeEngine();
    ce.declare('shuf', { type: '(number) -> list' });
    ce.assign(
      'shuf',
      ce.parse('n \\mapsto \\mathrm{RandomShuffle}(\\mathrm{Range}(1, n))')
    );
    // The walk's key is the node's OWN effects, and `{random}` is now visible
    // through the value binding — where a bare `{any}` head never pins.
    expect(shallowApplicationEffects(ce.box(['shuf', 'unboundN']))).toEqual([
      'random',
    ]);
    // End to end: a body that could not finish its draws keeps the frame, on
    // both routes.
    for (const e of [
      ce.box(['WithRandomSeed', 5, ['shuf', 'unboundN']]),
      ce.parse(
        '\\mathrm{WithRandomSeed}(5, \\mathrm{shuf}(\\mathrm{unboundN}))'
      ),
    ])
      expect(e.evaluate().operator).toBe('WithRandomSeed');

    // A completed application owes nothing: the frame is released and the
    // result replays.
    const once = ce.box(['WithRandomSeed', 5, ['shuf', 3]]).evaluate();
    expect(once.operator).not.toBe('WithRandomSeed');
    expect(
      ce.box(['WithRandomSeed', 5, ['shuf', 3]]).evaluate().toString()
    ).toBe(once.toString());
  });

  it('a MIXED callable union keeps its latent set', () => {
    // `At` over a list of callbacks types as `((…) random -> …) | missing` —
    // a union with one signature member and one that is not. The callable gate
    // must stay in lockstep with the reader, which unions across members:
    // bailing on the union would silently report a drawing callback pure.
    const ce = new ComputeEngine();
    ce.assign('rf', ce.parse('x \\mapsto \\mathrm{Random}()'));
    ce.assign('picked', ce.box(['At', ['List', 'rf'], 1]));
    const def = ce.lookupDefinition('picked');
    const t = def !== undefined && 'value' in def ? def.value.type.toString() : '';
    expect(t).toContain('|');
    expect(t).toContain('random');

    expect(eff(ce.box(['Map', 'picked', ['List', 1, 2]]))).toEqual(['random']);
    expect(ce.box(['Map', 'picked', ['List', 1, 2]]).isPure).toBe(false);
    expect(eff(ce.box(['picked', 3]))).toEqual(['random']);

    // The control: same shape, pure member.
    ce.assign('pf', ce.parse('x \\mapsto x + 1'));
    ce.assign('pickedPure', ce.box(['At', ['List', 'pf'], 1]));
    expect(eff(ce.box(['Map', 'pickedPure', ['List', 1, 2]]))).toBe(undefined);
    expect(eff(ce.box(['pickedPure', 3]))).toBe(undefined);

    // …and a DECLARED mixed union is read the same way.
    ce.declare('unionDecl', { type: '((real) random -> real) | nothing' });
    expect(eff(ce.box(['unionDecl', 3]))).toEqual(['random']);
  });

  describe('declared but UNIMPLEMENTED', () => {
    // The model's polarity: optimistic in DECLARED contracts, conservative in
    // runtime accounting. A bare arrow is the INFERRED track — unstated, not a
    // contract — so with no body to inspect there is nothing to be optimistic
    // about. (Stated pure is spelled `pure` in the slot and reads as the empty
    // set; an unstated arrow reads `undefined`.)
    it('an unstated arrow with no value is `{any}`, not pure', () => {
      const ce = new ComputeEngine();
      ce.declare('unimpl', { type: '(number) -> number' });
      const e = ce.box(['unimpl', 3]);
      expect(eff(e)).toBe('any');
      expect(e.isPure).toBe(false);
      // OPERAND position deliberately differs: there the declared bare arrow
      // IS the bound the operator invokes against, and an opaque declaration
      // is trusted at it (`effects-contracts.test.ts` pins that as the case
      // the design exists for). Applying something with no implementation is
      // the case with no contract to trust.
      expect(eff(ce.box(['Map', 'unimpl', ['List', 1, 2]]))).toBe(undefined);
      // `any` never pins a frame, so this costs a cache, not a frame.
      expect(
        ce.box(['WithRandomSeed', 5, ['unimpl', 'unboundN']]).evaluate().operator
      ).not.toBe('WithRandomSeed');
    });

    it('a STATED contract is trusted, body or not', () => {
      const ce = new ComputeEngine();
      ce.declare('claimsPure', { type: '(number) pure -> number' });
      expect(eff(ce.box(['claimsPure', 3]))).toEqual([]);
      expect(ce.box(['claimsPure', 3]).isPure).toBe(true);

      ce.declare('claimsRandom', { type: '(number) random -> number' });
      expect(eff(ce.box(['claimsRandom', 3]))).toEqual(['random']);
      expect(ce.box(['claimsRandom', 3]).isPure).toBe(false);
    });

    it('assigning a value later switches to the value read (generation guard)', () => {
      const ce = new ComputeEngine();
      ce.declare('later', { type: '(number) -> number' });
      const e = ce.box(['later', 3]);
      expect(eff(e)).toBe('any');

      ce.assign('later', ce.parse('x \\mapsto x + 1'));
      expect(eff(e)).toBe(undefined);
      expect(e.isPure).toBe(true);

      ce.assign('later', ce.parse('x \\mapsto \\mathrm{Random}()'));
      expect(eff(e)).toEqual(['random']);
    });

    it('the `signature:` spelling is an OPERATOR definition — unchanged', () => {
      // It never reached the value-binding path: a declared operator with a
      // bare arrow is the documented "bare `->` means pure" default, and every
      // library signature relies on it.
      const ce = new ComputeEngine();
      ce.declare('sigDecl', { signature: '(number) -> number' });
      const def = ce.lookupDefinition('sigDecl');
      expect(def !== undefined && 'operator' in def).toBe(true);
      expect(eff(ce.box(['sigDecl', 3]))).toBe(undefined);
    });
  });

  it('a pure value-def head does NOT pin the frame', () => {
    const ce = new ComputeEngine();
    ce.declare('purefn', { type: '(number) -> number' });
    ce.assign('purefn', ce.parse('x \\mapsto x + 1'));
    expect(
      ce.box(['WithRandomSeed', 5, ['purefn', 'unboundN']]).evaluate().operator
    ).not.toBe('WithRandomSeed');
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
    expect(eff(ce.box(['Map', 'randomF', ['List', 1, 2]]))).toEqual(['random']);
  });

  it('a container still carries its operands PRODUCTION effects', () => {
    expect(eff(ce.box(['List', ['Random']]))).toEqual(['random']);
  });
});

describe('Per-position `invokes` — a map, missing indices default to `true`', () => {
  const ce = new ComputeEngine();
  ce.assign('randomF', ce.parse('x \\mapsto \\mathrm{Random}()'));
  // Position 0 INVOKES its callback, position 1 only STORES it.
  ce.declare('CallThenStore', {
    // `any` parameters: the point of the fixture is the POSITION metadata, and
    // a `function`-typed parameter would reject the non-callable operands the
    // control cases below need.
    signature: '(any, any) -> number',
    invokes: { 1: false },
  });

  it('the invoking position contributes the latent set', () => {
    expect(eff(ce.box(['CallThenStore', 'randomF', 'randomF']))).toEqual([
      'random',
    ]);
    // …and it is the position, not the operand, that decides: a pure callback
    // in the invoking position contributes nothing.
    expect(eff(ce.box(['CallThenStore', 'randomF', 1]))).toEqual(['random']);
  });

  it('the storing position does NOT', () => {
    const e = ce.box(['CallThenStore', 1, 'randomF']);
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
  });

  it('a stored operand still carries its PRODUCTION effects', () => {
    expect(eff(ce.box(['CallThenStore', 1, ['Random']]))).toEqual(['random']);
  });

  it('the normalized metadata reads through the accessor', () => {
    const def = ce.box(['CallThenStore', 1, 1]).operatorDefinition!;
    expect(def.invokesAt(0)).toBe(true);
    expect(def.invokesAt(1)).toBe(false);
    // An index the map says nothing about defaults to the conservative answer.
    expect(def.invokesAt(2)).toBe(true);
    // A map never claims "no position invokes" — only `invokes: false` does.
    expect(def.invokesNone).toBe(false);
    expect(ce.box(['List', 1]).operatorDefinition!.invokesNone).toBe(true);
  });

  it('an all-`true` map collapses to the uniform default', () => {
    ce.declare('AllTrueMap', {
      signature: '(function) -> number',
      invokes: { 0: true },
    });
    const def = ce.box(['AllTrueMap', 1]).operatorDefinition!;
    expect(def.invokes).toBe(true);
    expect(def.invokesAt(0)).toBe(true);
  });

  it('an invalid `invokes` declaration is a registration error', () => {
    expect(() =>
      new ComputeEngine().declare('BadIndex', {
        signature: '(function) -> number',
        invokes: { '-1': false } as any,
      })
    ).toThrow(/'invokes' field is keyed by operand index/);
    expect(() =>
      new ComputeEngine().declare('BadIndex2', {
        signature: '(function) -> number',
        invokes: { 1.5: false } as any,
      })
    ).toThrow(/'invokes' field is keyed by operand index/);
    expect(() =>
      new ComputeEngine().declare('BadValue', {
        signature: '(function) -> number',
        invokes: { 0: 'no' } as any,
      })
    ).toThrow(/'invokes' entry at operand 0 must be a boolean/);
  });
});

describe('Selecting and storing heads drop the LATENT half', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('randomF', ce.parse('x \\mapsto \\mathrm{Random}()'));
    ce.assign('pureF', ce.parse('x \\mapsto x + 1'));
    return ce;
  }

  it('`If` SELECTS a branch — it never applies one', () => {
    const ce = engine();
    const e = ce.box(['If', 'True', 'randomF', 'pureF']);
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
    // The effect surfaces at whatever invokes the SELECTED result.
    expect(eff(ce.box(['Apply', ['If', 'True', 'randomF', 'pureF'], 0]))).toEqual([
      'random',
    ]);
  });

  it('…but a held branch still contributes its own (production) effects', () => {
    const ce = engine();
    expect(eff(ce.box(['If', 'True', ['Random'], 0]))).toEqual(['random']);
    expect(eff(ce.box(['Which', 'True', ['Random']]))).toEqual(['random']);
  });

  it('`Which` selects too', () => {
    const ce = engine();
    const e = ce.box(['Which', 'True', 'randomF', 'False', 'pureF']);
    expect(eff(e)).toBe(undefined);
    expect(e.isPure).toBe(true);
  });

  it('`Assign` STORES its value — `{scope}`, not `{scope, random}`', () => {
    const ce = engine();
    expect(eff(ce.box(['Assign', 'g', 'randomF']))).toEqual(['scope']);
    // Production effects are untouched: evaluating the RHS really does draw.
    expect(eff(ce.box(['Assign', 'x', ['Random']]))).toEqual([
      'random',
      'scope',
    ]);
  });

  it('…and the stored function keeps its arrow — the INFERENCE is unaffected', () => {
    const ce = engine();
    ce.box(['Assign', 'stored', 'randomF']).evaluate();
    expect(ce.box('stored').type.effects).toEqual(['random']);
    expect(eff(ce.box(['Map', 'stored', ['List', 1, 2]]))).toEqual(['random']);
  });

  it('`Declare` stores too', () => {
    const ce = engine();
    expect(eff(ce.box(['Declare', 'd', 'function', 'randomF']))).toEqual([
      'scope',
    ]);
  });

  it('`Block` SEQUENCES and RETURNS — a bare function value is not applied', () => {
    const ce = engine();
    for (const [route, e] of Object.entries({
      'literal/box': ce.box(['Block', ['Function', ['Random']]]),
      'symbol/box': ce.box(['Block', 'randomF']),
      'symbol/parse': ce.parse('\\mathrm{Block}(\\mathrm{randomF})'),
      'symbol/function': ce.function('Block', [ce.symbol('randomF')]),
    })) {
      expect([route, eff(e)]).toEqual([route, undefined]);
      expect([route, e.isPure]).toEqual([route, true]);
    }
  });

  it('…while a statement APPLICATION is untouched — it flows through the recursion', () => {
    const ce = engine();
    // The suppressed term is the LATENT one; an operand's own effects still
    // reach the block through `effectsOf`.
    expect(eff(ce.box(['Block', ['Assign', 'x', 1], ['Random']]))).toEqual([
      'random',
      'scope',
    ]);
    expect(eff(ce.box(['Block', ['Map', 'randomF', ['List', 1, 2]]]))).toEqual([
      'random',
    ]);
    // …and the frame still discharges those draws, not the scope write.
    expect(
      eff(
        ce.box([
          'WithRandomSeed',
          42,
          ['Block', ['Assign', 'x', 1], ['Random']],
        ])
      )
    ).toEqual(['scope']);
  });

  it('the two channels AGREE on a seeded frame inside a literal', () => {
    // `frameProtocol: 'seed'` is "a separate field, NOT THE ARROW"
    // (EFFECTS-MODEL.md, "Randomness shapes"). The inference used to contribute
    // `{random}` to the enclosing literal's arrow for a frame-protocol head, so
    // the arrow said `random` while the runtime channel called the very same
    // expression pure. Everything that reads a lambda's LATENT set inherited
    // that disagreement — `Map` reported impure for a body `Comprehension`
    // reported pure, which cost the element memo its prefix cache on exactly
    // the per-site-seeded rows a consumer lowers to `Map`.
    const ce = engine();
    const framed = ce.box(['WithRandomSeed', 42, ['Random']]);
    expect(framed.isPure).toBe(true); // runtime channel
    const lambda = ce.box(['Function', ['WithRandomSeed', 42, ['Random']], 'i']);
    expect(lambda.type.effects).toBe(undefined); // inference channel: agrees

    // …and the two collection operators now agree with each other.
    const body = ['Function', ['WithRandomSeed', 42, ['Random']], 'i'];
    expect(ce.box(['Map', body, ['Range', 1, 5]]).isPure).toBe(true);
    expect(
      ce.box(['Comprehension', ['WithRandomSeed', 42, ['Random']], ['Limits', 'i', 1, 5]])
        .isPure
    ).toBe(true);

    // CONTROL: an UNFRAMED draw is still random on both channels.
    expect(ce.box(['Function', ['Random'], 'i']).type.effects).toEqual([
      'random',
    ]);
    expect(
      ce.box(['Map', ['Function', ['Random'], 'i'], ['Range', 1, 5]]).isPure
    ).toBe(false);

    // CONTROL: the frame discharges `random` only — a scope write survives it,
    // on the inference channel exactly as the runtime channel already pinned.
    expect(
      ce.box([
        'Function',
        ['WithRandomSeed', 42, ['Block', ['Assign', 'x', 1], ['Random']]],
        'i',
      ]).type.effects
    ).toEqual(['scope']);
  });

  it('the two channels now AGREE on a build-and-return block', () => {
    // Before the annotation they disagreed: the runtime channel reported
    // `{random}` for `Block(() ↦ Random())` while the inference already typed
    // the enclosing literal's arrow PURE (it treats `Block` as non-projecting).
    const ce = engine();
    const built = ce.box(['Block', ['Function', ['Random']]]);
    expect(built.isPure).toBe(true);
    const outer = ce.box(['Function', ['Block', ['Function', ['Random']]]]);
    expect(outer.type.effects).toBe(undefined);
    // The draw is still on the INNER arrow — it fires when that value is applied.
    expect(built.type.effects).toEqual(['random']);
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

  it('a lazy view that escapes the frame is NOT discharged (item 142)', () => {
    ce.assign('drawF', ce.parse('x \\mapsto \\mathrm{Random}()'));
    // The view's callback draws at materialization, outside the frame
    // (`docs/RANDOMNESS-MODEL.md` §6) — the discharge cannot claim it.
    expect(
      eff(ce.box(['WithRandomSeed', 42, ['Map', 'drawF', ['List', 1, 2]]]))
    ).toEqual(['random']);
    // Materialized INSIDE the frame, the draws are owed to it and discharged.
    expect(
      eff(
        ce.box([
          'WithRandomSeed',
          42,
          ['ListFrom', ['Map', 'drawF', ['List', 1, 2]]],
        ])
      )
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
      ['ListFrom', ['Map', 'drawEach', ['Range', 1, 'unboundLen']]],
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
      ['Map', 'drawEach2', ['Range', 1, 3]],
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
