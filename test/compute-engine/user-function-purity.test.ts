import { ComputeEngine } from '../../src/compute-engine';

/**
 * A user-defined function derives its `pure` and `drawsRandom` flags from the
 * heads its body applies (`inferFunctionLiteralEffects` in
 * `boxed-expression/effects-inference.ts` — the Stage 2 construction seam).
 *
 * Without the inference a definition is born with the DEFAULTS — `pure: true`,
 * `drawsRandom: false` — so `f() := Random()` claims to be a pure, hence
 * CONSTANT, expression while drawing from the stream on every call. Two
 * observable failures follow, both pinned below: `Add` re-evaluates a pure
 * operand under `.N()` (drawing twice), and `WithRandomSeed`'s pending-draw
 * gate loses the frame, silently resuming a seeded computation with LIVE
 * draws.
 *
 * The inference is a one-way accumulation over the heads the body APPLIES. The
 * Stage 2 rulings that shape it (`docs/EFFECTS-MODEL.md`, "Inference"):
 * an unannotated higher-order PARAMETER stays optimistically pure (ruling (c));
 * an UNRESOLVED named head infers `{any}` (the v5 dependency-order ruling —
 * this AMENDS the Stage 0 "unknown head stays pure" limit); a nested `Function`
 * literal is a BOUNDARY, contributing only where the body applies it.
 */

/** The `pure` / `drawsRandom` a symbol's operator definition ended up with. */
function flags(
  ce: ComputeEngine,
  name: string
): { pure: boolean; drawsRandom: boolean } | undefined {
  const def = ce.lookupDefinition(name);
  if (!def || !('operator' in def)) return undefined;
  return { pure: def.operator.pure, drawsRandom: def.operator.drawsRandom };
}

describe('User-function purity is inferred from the body', () => {
  const ce = new ComputeEngine();

  // Defined in dependency order: `comp` reads `f`'s inferred flags, which is
  // the documented composition rule.
  ce.box(['Assign', 'f', ['Function', ['Random']]]).evaluate();
  ce.box([
    'Assign',
    'shuffled',
    ['Function', ['RandomShuffle', ['List', 1, 2, 3]]],
  ]).evaluate();
  ce.box(['Assign', 'square', ['Function', ['Power', 'x', 2], 'x']]).evaluate();
  ce.box([
    'Assign',
    'bump',
    ['Function', ['Assign', 'a', ['Add', 'a', 1]]],
  ]).evaluate();
  ce.box(['Assign', 'comp', ['Function', ['Add', ['f'], 1]]]).evaluate();
  ce.box(['Assign', 'apply1', ['Function', ['g'], 'g']]).evaluate();

  const CASES: [name: string, pure: boolean, drawsRandom: boolean][] = [
    // A draw from the stream: impure AND owing the seed frame.
    ['f', false, true],
    ['shuffled', false, true],
    // Arithmetic only: untouched.
    ['square', true, false],
    // Impure but owing the stream nothing — `drawsRandom` must NOT follow
    // `pure`, or a surviving `Assign` would pin a seed frame forever.
    ['bump', false, false],
    // Composition: read from the callee's definition.
    ['comp', false, true],
    // Higher-order: the head is a parameter with no definition, so the
    // documented optimistic default applies.
    ['apply1', true, false],
  ];

  for (const [name, pure, drawsRandom] of CASES) {
    it(`${name} → pure=${pure}, drawsRandom=${drawsRandom}`, () => {
      expect(flags(ce, name)).toEqual({ pure, drawsRandom });
    });
  }

  it('a drawing function is not a constant expression', () => {
    expect(ce.box(['f']).isPure).toBe(false);
    expect(ce.box(['f']).isConstant).toBe(false);
    expect(ce.box(['square', 2]).isConstant).toBe(true);
  });

  it('an explicit flag on the definition wins over the inference', () => {
    const local = new ComputeEngine();
    local.declare('quiet', {
      signature: '() -> number',
      evaluate: local.box(['Function', ['Random']]),
      pure: true,
    });
    expect(flags(local, 'quiet')?.pure).toBe(true);
  });

  it('the parse route infers the same flags as the box route', () => {
    const local = new ComputeEngine();
    local.parse('g() := \\operatorname{Random}()').evaluate();
    expect(flags(local, 'g')).toEqual({ pure: false, drawsRandom: true });
  });

  it('redefining re-runs the inference', () => {
    const local = new ComputeEngine();
    local.box(['Assign', 'h', ['Function', ['Random']]]).evaluate();
    expect(flags(local, 'h')?.pure).toBe(false);
    local.box(['Assign', 'h', ['Function', 1]]).evaluate();
    expect(flags(local, 'h')).toEqual({ pure: true, drawsRandom: false });
  });
});

/**
 * Stage 1 of the effects model (`docs/EFFECTS-MODEL.md`): the `pure` /
 * `drawsRandom` definition flags become AUTHORING SUGAR for an effect set,
 * translated once at registration, and READABLE STATE derived from it.
 */
describe('Effect flags: the registration truth table', () => {
  /** Declare an operator with the given flags and read back the getters. */
  function declared(flags: Record<string, unknown>): {
    pure: boolean;
    drawsRandom: boolean;
    effects: unknown;
  } {
    const ce = new ComputeEngine();
    ce.declare('op9x', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
      ...flags,
    } as any);
    const def = ce.lookupDefinition('op9x')!['operator'];
    return {
      pure: def.pure,
      drawsRandom: def.drawsRandom,
      effects: def.effects,
    };
  }

  // The normative table of "One source of truth — and the flag migration".
  const ROWS: [
    label: string,
    flags: Record<string, unknown>,
    effects: unknown,
    pure: boolean,
    drawsRandom: boolean,
  ][] = [
    ['both omitted', {}, undefined, true, false],
    ['pure:true, drawsRandom:false', { pure: true, drawsRandom: false }, undefined, true, false], // prettier-ignore
    ['pure:true alone', { pure: true }, undefined, true, false],
    ['pure:false, drawsRandom:true', { pure: false, drawsRandom: true }, ['random'], false, true], // prettier-ignore
    ['drawsRandom:true alone', { drawsRandom: true }, ['random'], false, true],
    // `{any}`, NOT `{scope}`: the flag promises only "not pure". `any` is
    // conservatively IMPURE but NOT frame-relevant — frame participation
    // requires explicit declaration, so `drawsRandom` stays false.
    ['pure:false alone', { pure: false }, 'any', false, false],
    ['pure:false, drawsRandom:false', { pure: false, drawsRandom: false }, 'any', false, false], // prettier-ignore
  ];

  for (const [label, flags, effects, pure, drawsRandom] of ROWS) {
    it(`${label} → ${JSON.stringify(effects) ?? 'pure'}`, () => {
      expect(declared(flags)).toEqual({ pure, drawsRandom, effects });
    });
  }

  it('the explicit `effects` field is the precise surface', () => {
    // `scope` is an impurity but owes the random stream nothing — the
    // distinction the `{any}` row above cannot express.
    expect(declared({ effects: ['scope'] })).toEqual({
      pure: false,
      drawsRandom: false,
      effects: ['scope'],
    });
  });

  it('effects may be written in the signature specifier slot', () => {
    const ce = new ComputeEngine();
    ce.declare('draw9x', {
      signature: '(number) random -> number',
      evaluate: ([x]) => x,
    });
    const def = ce.lookupDefinition('draw9x')!['operator'];
    expect(def.pure).toBe(false);
    expect(def.drawsRandom).toBe(true);
    expect(def.effects).toEqual(['random']);
  });

  it('the effect set is attached to the signature, not stored beside it', () => {
    const ce = new ComputeEngine();
    ce.declare('scoped9x', {
      signature: '(number) -> number',
      effects: ['scope'],
      evaluate: ([x]) => x,
    } as any);
    const def = ce.lookupDefinition('scoped9x')!['operator'];
    expect(def.signature.toString()).toEqual('(number) scope -> number');
  });
});

describe('Effect flags: contradictions are registration errors', () => {
  const declare = (flags: Record<string, unknown>) => () => {
    const ce = new ComputeEngine();
    ce.declare('bad9x', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
      ...flags,
    } as any);
  };

  it('`pure: true` with `drawsRandom: true` is a contradiction', () => {
    expect(declare({ pure: true, drawsRandom: true })).toThrow(
      /'pure' and 'drawsRandom' flags are contradictory/
    );
  });

  it('an `effects` field disagreeing with the legacy flags throws', () => {
    expect(declare({ effects: ['scope'], pure: true })).toThrow(/disagree/);
    expect(declare({ effects: ['scope'], drawsRandom: true })).toThrow(
      /disagree/
    );
  });

  it('an effect-annotated signature disagreeing with the flags throws', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('bad9y', {
        signature: '(number) random -> number',
        pure: true,
        evaluate: ([x]) => x,
      })
    ).toThrow(/disagree/);
  });

  it('agreeing declarations are accepted', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('ok9x', {
        signature: '(number) random -> number',
        drawsRandom: true,
        evaluate: ([x]) => x,
      })
    ).not.toThrow();
    expect(() =>
      ce.declare('ok9y', {
        signature: '(number) -> number',
        effects: ['random'],
        drawsRandom: true,
        evaluate: ([x]) => x,
      } as any)
    ).not.toThrow();
  });
});

describe('Effect flags: the library carriers', () => {
  const ce = new ComputeEngine();
  const def = (name: string) => ce.lookupDefinition(name)!['operator'];

  for (const name of [
    'Random',
    'RandomChoice',
    'RandomPrime',
    'RandomSample',
    'RandomShuffle',
  ]) {
    it(`${name} carries {random}`, () => {
      expect(def(name).effects).toEqual(['random']);
      expect(def(name).pure).toBe(false);
      expect(def(name).drawsRandom).toBe(true);
    });
  }

  it('RandomExpression carries {entropy}: impure but NOT drawing', () => {
    // Unseeded entropy is the third randomness shape: it samples
    // `Math.random()` directly, so it owes the seed frame nothing.
    expect(def('RandomExpression').effects).toEqual(['entropy']);
    expect(def('RandomExpression').pure).toBe(false);
    expect(def('RandomExpression').drawsRandom).toBe(false);
  });

  for (const name of ['Assign', 'Assume', 'Declare']) {
    it(`${name} carries {scope}: impure but NOT drawing`, () => {
      expect(def(name).effects).toEqual(['scope']);
      expect(def(name).pure).toBe(false);
      expect(def(name).drawsRandom).toBe(false);
    });
  }

  it('WithRandomSeed DELIMITS the frame rather than drawing', () => {
    // The runtime role is the kind-valued `frameProtocol` field; the derived
    // `drawsRandom` getter reads it, so the pending-draw walk is unchanged.
    expect(def('WithRandomSeed').frameProtocol).toBe('seed');
    expect(def('WithRandomSeed').drawsRandom).toBe(true);
    // Its OWN effects are empty since Stage 2: it draws nothing, it DELIMITS,
    // and it DISCHARGES `random` on its held body position. (Stage 1 stood in
    // with the `pure: false` sugar — `{any}` — because the effects of the held
    // body were not computable until the runtime channel existed.) The
    // application-level answer is now the precise one: see
    // `effects-of.test.ts`.
    expect(def('WithRandomSeed').effects).toBe(undefined);
    expect(def('WithRandomSeed').pure).toBe(true);
    expect(def('WithRandomSeed').discharges).toEqual({ 1: ['random'] });
  });

  for (const name of ['Integrate', 'NIntegrate']) {
    it(`${name}'s readsRandomFrame is untouched by the migration`, () => {
      // A peer runtime field: neither translated to a label nor derived from
      // one (the noise-floor convention).
      expect(def(name).readsRandomFrame).toBe(true);
      expect(def(name).effects).toBe(undefined);
      expect(def(name).pure).toBe(true);
      expect(def(name).drawsRandom).toBe(false);
    });
  }

  it('the pure containers declare `invokes: false`', () => {
    for (const name of [
      'List',
      'Set',
      'Tuple',
      'Single',
      'Pair',
      'Triple',
      'KeyValuePair',
    ])
      expect([name, def(name).invokes]).toEqual([name, false]);
    // Every other operator invokes by default.
    expect(def('Map').invokes).toBe(true);
  });
});

/**
 * `any` is conservative on the impurity axis but NOT on the frame axis, where
 * conservatism inverts — pinning a frame forever is the harm. So an operator
 * whose effects are unknown is impure yet never pins a seed frame, which is
 * exactly the shipped `?? false` semantics of the pending-draw walk.
 * See the `any` ruling under "Labels and lattice" in `docs/EFFECTS-MODEL.md`.
 */
describe('`any` is impure but never pins a seed frame', () => {
  /** A partially-evaluated survivor: it reduces only for a literal operand. */
  function withOp(flags: Record<string, unknown>): string {
    const ce = new ComputeEngine();
    ce.declare('op9z', {
      signature: '(number) -> number',
      evaluate: ([x]) => (x.isNumberLiteral ? x : undefined),
      ...flags,
    } as any);
    return ce
      .box(['WithRandomSeed', 1, ['op9z', 'n']])
      .evaluate()
      .toString();
  }

  it('a legacy `pure: false` declaration does NOT keep the frame', () => {
    // The Stage 0 behavior, preserved exactly: the `{any}` translation of the
    // legacy flag must not start pinning frames that used to be released.
    expect(withOp({ pure: false })).toEqual('op9z(n)');
  });

  it('control: a pure operator does not keep the frame', () => {
    expect(withOp({})).toEqual('op9z(n)');
  });

  it('control: an explicit `{scope}` operator does not keep the frame', () => {
    // Impure, but owing the random stream nothing.
    expect(withOp({ signature: '(number) scope -> number' })).toEqual(
      'op9z(n)'
    );
  });

  it('positive control: an explicit `{random}` operator DOES keep it', () => {
    expect(withOp({ signature: '(number) random -> number' })).toEqual(
      'WithRandomSeed(1, op9z(n))'
    );
  });

  /** A lambda whose body calls `head` and, optionally, draws. */
  function lambdaFrame(body: any): {
    effects: unknown;
    pure: boolean;
    drawsRandom: boolean;
    frame: string;
  } {
    const ce = new ComputeEngine();
    ce.declare('opaque9w', {
      signature: '() -> number',
      pure: false,
      evaluate: () => undefined,
    });
    ce.box(['Assign', 'mix9w', ['Function', body]]).evaluate();
    const def = ce.lookupDefinition('mix9w')!['operator'];
    // A survivor: `Map` cannot finish while `n` is unbound, so the walk sees
    // the lambda calling `mix9w` in eager-survivor position.
    const kept = ce
      .box([
        'WithRandomSeed',
        1,
        ['ListFrom', ['Map', ['Range', 1, 'n'], ['Function', ['mix9w'], 'u']]],
      ])
      .evaluate();
    return {
      effects: def.effects,
      pure: def.pure,
      drawsRandom: def.drawsRandom,
      frame: kept.operator,
    };
  }

  it('a body mixing an `{any}` head with a real draw DOES keep the frame', () => {
    // The union collapses to `{any}` — the top absorbs the `random` the walk
    // positively saw — but the inference RETAINS the observed draw in an
    // internal definition bit, so the derived `drawsRandom` still fires and the
    // pending-draw gate keeps the frame. Stage 0 parity; see the Stage 1
    // migration bullet in `docs/EFFECTS-MODEL.md`.
    expect(lambdaFrame(['Add', ['opaque9w'], ['Random']])).toEqual({
      effects: 'any',
      pure: false,
      drawsRandom: true,
      frame: 'WithRandomSeed',
    });
  });

  it('control: an `{any}`-only lambda body does NOT keep the frame', () => {
    // `any` ALONE still never satisfies `drawsRandom`: only a positively
    // observed draw does.
    expect(lambdaFrame(['opaque9w'])).toEqual({
      effects: 'any',
      pure: false,
      drawsRandom: false,
      frame: 'ListFrom',
    });
  });
});

/**
 * An INTERSECTION of signatures is the overload-set representation
 * (`overloadArms` in `boxed-expression/overload.ts`). The definition-wide
 * derived getters read the UNION of the arms' effects: an overload with one
 * effect-bearing arm is not a pure definition.
 */
describe('Effects on an overload set', () => {
  /** Declare an overloaded operator and read back the getters. */
  function overloaded(extra: Record<string, unknown> = {}): {
    pure: boolean;
    drawsRandom: boolean;
    effects: unknown;
  } {
    const ce = new ComputeEngine();
    ce.declare('ov9x', {
      signature: '((real) random -> real) & ((integer) -> integer)',
      evaluate: ([x]) => x,
      ...extra,
    } as any);
    const def = ce.lookupDefinition('ov9x')!['operator'];
    return {
      pure: def.pure,
      drawsRandom: def.drawsRandom,
      effects: def.effects,
    };
  }

  it('one `random` arm makes the definition drawing and impure', () => {
    expect(overloaded()).toEqual({
      pure: false,
      drawsRandom: true,
      effects: ['random'],
    });
  });

  it('all-pure arms stay pure', () => {
    const ce = new ComputeEngine();
    ce.declare('ov9y', {
      signature: '((real) -> real) & ((integer) -> integer)',
      evaluate: ([x]) => x,
    });
    const def = ce.lookupDefinition('ov9y')!['operator'];
    expect(def.effects).toBe(undefined);
    expect(def.pure).toBe(true);
    expect(def.drawsRandom).toBe(false);
  });

  it('an `effects:` field disagreeing with the arm union is an error', () => {
    expect(() => overloaded({ effects: ['scope'] })).toThrow(/disagree/);
  });
});

describe('A signature rebuilt by inference keeps its effects', () => {
  it('result-type inference preserves `random` on the arrow', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'g9v',
      ['Function', ['Add', ['Random'], 'x'], 'x'],
    ]).evaluate();
    const def = ce.lookupDefinition('g9v')!['operator'];
    expect(def.signature.toString()).toContain(' random -> ');

    // Using `g9v` where a narrower result is expected drives
    // `BoxedFunction.infer()`, which REBUILDS the signature object. The rebuild
    // is assembled from the type-inference fields alone, so without carrying
    // the effect specifier the arrow would serialize pure while the definition
    // still reported `{random}` — the two must never disagree.
    ce.declare('needsInt9v', {
      signature: '(integer) -> integer',
      evaluate: ([x]) => x,
    });
    ce.box(['needsInt9v', ['g9v', 2]]);

    expect(def.signature.toString()).toContain(' random -> ');
    expect(def.effects).toEqual(['random']);
    expect(def.drawsRandom).toBe(true);
    expect(def.pure).toBe(false);
  });
});

describe('The inference stamps an effect set on the signature', () => {
  it('f() := Random() gets `random` on its arrow', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'r9x', ['Function', ['Random']]]).evaluate();
    const def = ce.lookupDefinition('r9x')!['operator'];
    expect(def.effects).toEqual(['random']);
    expect(def.signature.toString()).toContain(' random -> ');
    expect(def.drawsRandom).toBe(true);
    expect(def.pure).toBe(false);
  });

  it('f() := Assign(a, 1) gets `scope`, and owes the stream nothing', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      's9x',
      ['Function', ['Assign', 'a9x', ['Add', 'a9x', 1]]],
    ]).evaluate();
    const def = ce.lookupDefinition('s9x')!['operator'];
    expect(def.effects).toEqual(['scope']);
    expect(def.pure).toBe(false);
    expect(def.drawsRandom).toBe(false);
  });

  it('a body calling an `{any}` head infers `any`, and does not pin', () => {
    const ce = new ComputeEngine();
    ce.declare('opaque9x', {
      signature: '() -> number',
      pure: false,
      evaluate: () => undefined,
    });
    ce.box(['Assign', 'a9y', ['Function', ['opaque9x']]]).evaluate();
    const def = ce.lookupDefinition('a9y')!['operator'];
    // The union ABSORBS: `any` is the top, so the inferred set is `any`, not
    // `{random}`. Impure — but frame participation was never declared.
    expect(def.effects).toBe('any');
    expect(def.pure).toBe(false);
    expect(def.drawsRandom).toBe(false);
  });

  it('a body containing WithRandomSeed still unions `random`', () => {
    // A frame DELIMITER head propagates the frame obligation even though its
    // own Stage 1 effect set is the `any` placeholder for its held body — a
    // plain union of that placeholder would absorb and lose the propagation.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'w9x',
      ['Function', ['WithRandomSeed', 1, ['Random']]],
    ]).evaluate();
    const def = ce.lookupDefinition('w9x')!['operator'];
    expect(def.effects).toEqual(['random']);
    expect(def.drawsRandom).toBe(true);
  });

  it('an arithmetic body stays pure — an empty specifier slot', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'q9x', ['Function', ['Power', 'x', 2], 'x']]).evaluate();
    const def = ce.lookupDefinition('q9x')!['operator'];
    expect(def.effects).toBe(undefined);
    expect(def.signature.toString()).not.toContain('random');
  });
});

describe('The failures the inference prevents', () => {
  const ce = new ComputeEngine();
  ce.box(['Assign', 'f', ['Function', ['Random']]]).evaluate();

  /** The frame-42 stream, computed by consuming n draws in a Block. */
  const stream = (() => {
    const xs: number[] = [];
    for (let n = 1; n <= 8; n++)
      xs.push(
        ce
          .box(['WithRandomSeed', 42, ['Block', ...Array(n).fill(['Random'])]])
          .evaluate().re!
      );
    return xs;
  })();

  /** How many draws `body` consumed: the index of the trailing draw. */
  const drawsConsumed = (body: any): number => {
    const trailing = ce
      .box(['WithRandomSeed', 42, ['Block', body, ['Random']]])
      .evaluate().re!;
    return stream.findIndex((x) => Math.abs(x - trailing) < 1e-12);
  };

  it('N(f() + Pi) consumes one draw, like N(Random() + Pi)', () => {
    // `Add`/`Multiply` hand `addN` the RAW operand when it is pure and the
    // EVALUATED one when it is not. A `pure: true` lie made this re-evaluate
    // `f()` and draw a second time.
    expect(drawsConsumed(['N', ['Add', ['Random'], 'Pi']])).toBe(1);
    expect(drawsConsumed(['N', ['Add', ['f'], 'Pi']])).toBe(1);
  });

  it('a partially-evaluated body calling f keeps its seed frame', () => {
    // The Tycho item 104 witness with the draw behind a user function. The
    // pending-draw gate is keyed on `drawsRandom`; without it on `f`, the
    // frame was stripped and every later draw went live.
    const e = ce.box([
      'WithRandomSeed',
      1,
      ['ListFrom', ['Map', ['Range', 1, 'n'], ['Function', ['f'], 'u']]],
    ]);
    const kept = e.evaluate();
    expect(kept.operator).toBe('WithRandomSeed');
    const a = kept.subs({ n: 3 }).N().toString();
    const b = kept.subs({ n: 3 }).N().toString();
    expect(a).toBe(b);
  });

  it('f() is still live outside any frame', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(ce.box(['f']).evaluate().toString());
    expect(seen.size).toBeGreaterThan(1);
  });
});

/**
 * Stage 2 (`docs/EFFECTS-MODEL.md`, "Inference" → *Literals are inference
 * boundaries*):
 *
 * > A nested `Function` literal's effects go on **its own arrow** (its latent
 * > set); the enclosing body adds them only where the body *applies* (or
 * > projects) the literal. So `makeCallback() := (() ↦ Random())` is itself
 * > pure with result type `() random -> …`. This **amends Stage 0's shipped
 * > behavior** — the current `inferLambdaFlags` recurses into nested literal
 * > bodies (conservative) — and `user-function-purity.test.ts` updates
 * > accordingly.
 */
describe('Literals are inference boundaries', () => {
  /** The effect specifier on an arrow, or `''` for a pure one. */
  const specifier = (e: { type: { type: unknown } }) => {
    // Read the OUTER arrow's specifier off the type AST: a regex over the
    // serialized string is ambiguous when a parameter (or result) is itself
    // an annotated arrow — it reads the inner specifier back.
    const t = e.type.type as { kind?: string; effects?: 'any' | string[] };
    if (typeof t === 'string' || t.kind !== 'signature') return '';
    return t.effects === 'any' ? 'any' : (t.effects ?? []).join(' ');
  };

  it('a literal that merely PRODUCES a drawing callback is pure', () => {
    // The spec's own example. The nested literal's `{random}` lives on the
    // RESULT arrow, not on the producer's.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'makeCallback',
      ['Function', ['Function', ['Random']]],
    ]).evaluate();
    const def = ce.lookupDefinition('makeCallback')!['operator'];
    expect(def.effects).toBe(undefined);
    expect(def.pure).toBe(true);
    expect(def.drawsRandom).toBe(false);
    expect(def.signature.toString()).toContain('() random ->');
  });

  it('STORING a nested literal in a local contributes nothing', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Block', ['Declare', 'cb', ['Function', ['Random']]], 1],
    ]);
    expect(specifier(literal)).toBe('');
  });

  it('an immediately APPLIED literal contributes its latent set', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['Apply', ['Function', ['Random']]]]);
    expect(specifier(literal)).toBe('random');
  });

  it('APPLYING a locally-bound literal contributes its latent set', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Block', ['Declare', 'cb', ['Function', ['Random']]], ['cb']],
    ]);
    expect(specifier(literal)).toBe('random');
  });

  it('an APPLIED drawing callee still sets the draws bit', () => {
    // The `_inferredDraws` bridge must survive the boundary change: producing
    // no longer draws, but applying still does — including through the `any`
    // collapse, which is what the bridge exists for.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'useCallback',
      [
        'Function',
        ['Block', ['Declare', 'cb', ['Function', ['Random']]], ['cb']],
      ],
    ]).evaluate();
    const def = ce.lookupDefinition('useCallback')!['operator'];
    expect(def.effects).toEqual(['random']);
    expect(def.drawsRandom).toBe(true);
  });
});

/**
 * Stage 2, ruling (c) (`docs/EFFECTS-MODEL.md`, "Inference" → *Applied
 * parameters*):
 *
 * > an **annotated** function parameter contributes its declared arrow effects
 * > to body inference […]. An **unannotated** parameter (declared `unknown`,
 * > `function-utils.ts`) keeps the optimistic ruling: treated pure, no boundary
 * > check — deliberate residual optimism; soundness is opt-in via annotation.
 */
describe('Applied parameters: annotated contributes, unannotated stays optimistic', () => {
  const specifier = (e: { type: { type: unknown } }) => {
    // Read the OUTER arrow's specifier off the type AST: a regex over the
    // serialized string is ambiguous when a parameter (or result) is itself
    // an annotated arrow — it reads the inner specifier back.
    const t = e.type.type as { kind?: string; effects?: 'any' | string[] };
    if (typeof t === 'string' || t.kind !== 'signature') return '';
    return t.effects === 'any' ? 'any' : (t.effects ?? []).join(' ');
  };

  it('an ANNOTATED function parameter contributes its declared effects', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['g'],
      ['Typed', 'g', { str: '() random -> real' }],
    ]);
    expect(specifier(literal)).toBe('random');
  });

  it('an UNANNOTATED function parameter is treated pure', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['g'], 'g']);
    expect(specifier(literal)).toBe('');
  });

  it('a parameter shadows a same-named operator', () => {
    // `f(Random) := Random()` must not be read as a draw.
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['Random'], 'Random']);
    expect(specifier(literal)).toBe('');
  });
});

/**
 * Stage 2, the dependency-order split (`docs/EFFECTS-MODEL.md`, "Inference"):
 *
 * > an **unresolved named head** infers `{any}` — sound; the cost is caching
 * > for forward references — while **applied unannotated parameters** keep the
 * > optimistic ruling (c). […] an **explicit** annotation on a definition whose
 * > inference saw an unresolved head is installed as a **trusted contract** […]
 * > and is *not* revalidated when the head later resolves.
 */
describe('Dependency order: an unresolved named head infers `any`', () => {
  it('`f() := g()` before `g` exists infers `any` (honest)', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'fwd9x', ['Function', ['undeclared9x']]]).evaluate();
    const def = ce.lookupDefinition('fwd9x')!['operator'];
    expect(def.effects).toBe('any');
    expect(def.pure).toBe(false);
    // `any` alone never pins a seed frame.
    expect(def.drawsRandom).toBe(false);
  });

  it('an explicit annotation over an unresolved head installs as TRUSTED', () => {
    const ce = new ComputeEngine();
    ce.declare('trusted9x', {
      signature: '() -> number',
      effects: [],
      evaluate: ce.box(['Function', ['undeclared9y']]),
    } as any);
    const def = ce.lookupDefinition('trusted9x')!['operator'];
    expect(def.effects).toBe(undefined);
    expect(def.pure).toBe(true);
    expect(def.effectsDeclared).toBe(true);
  });

  it('a RESOLVED head is read from its definition, not treated as unknown', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'src9x', ['Function', ['Random']]]).evaluate();
    ce.box(['Assign', 'dst9x', ['Function', ['src9x']]]).evaluate();
    expect(ce.lookupDefinition('dst9x')!['operator'].effects).toEqual([
      'random',
    ]);
  });

  it('a self-call is neutral, not an unresolved head', () => {
    // Otherwise every recursive definition would infer `{any}`.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'rec9x',
      [
        'Function',
        ['If', ['Less', 'n', 1], 1, ['rec9x', ['Subtract', 'n', 1]]],
        'n',
      ],
    ]).evaluate();
    const def = ce.lookupDefinition('rec9x')!['operator'];
    expect(def.effects).toBe(undefined);
    expect(def.pure).toBe(true);
  });
});

/**
 * Stage 2, dominance-based confinement (`docs/EFFECTS-MODEL.md`, "Scope
 * writes"):
 *
 * > an `Assign` is confined iff **every static path from the literal's entry to
 * > the `Assign` passes through a `Declare` of that symbol within the literal**,
 * > **and** the symbol is not referenced by any nested `Function` literal
 * > (closure capture ⇒ escaping). […] `Assume` is **never** confined.
 * > Destructuring and compound targets are judged per target symbol; any target
 * > the analysis cannot resolve ⇒ `scope`. […] **not provably confined ⇒
 * > `scope`.**
 *
 * The approximation: a `Declare(n, …)` STATEMENT dominates the statements that
 * follow it in the same straight-line sequence, and nothing else. The frontier
 * is copied per sequence, so a `Declare` inside a nested `Block` or an `If` arm
 * never leaks outward.
 *
 * The three cases are worked example 3.
 */
describe('Confinement: `scope` is inferred only for ESCAPING writes', () => {
  const specifier = (e: { type: { type: unknown } }) => {
    // Read the OUTER arrow's specifier off the type AST: a regex over the
    // serialized string is ambiguous when a parameter (or result) is itself
    // an annotated arrow — it reads the inner specifier back.
    const t = e.type.type as { kind?: string; effects?: 'any' | string[] };
    if (typeof t === 'string' || t.kind !== 'signature') return '';
    return t.effects === 'any' ? 'any' : (t.effects ?? []).join(' ');
  };

  it('a Declare that DOMINATES the Assign is confined → pure', () => {
    // f() := Block(Declare(n, 0), Assign(n, n + 1), n)
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'confined9x',
      [
        'Function',
        ['Block', ['Declare', 'n', 0], ['Assign', 'n', ['Add', 'n', 1]], 'n'],
      ],
    ]).evaluate();
    const def = ce.lookupDefinition('confined9x')!['operator'];
    expect(def.effects).toBe(undefined);
    expect(def.pure).toBe(true);
  });

  it('a write through to an OUTER binding is escaping → `scope`', () => {
    // Declare(counter, 0); g() := Block(Assign(counter, counter + 1), counter)
    const ce = new ComputeEngine();
    ce.box(['Assign', 'counter9x', 0]).evaluate();
    ce.box([
      'Assign',
      'escaping9x',
      [
        'Function',
        [
          'Block',
          ['Assign', 'counter9x', ['Add', 'counter9x', 1]],
          'counter9x',
        ],
      ],
    ]).evaluate();
    const def = ce.lookupDefinition('escaping9x')!['operator'];
    expect(def.effects).toEqual(['scope']);
    expect(def.pure).toBe(false);
    // Impure, but owing the random stream nothing.
    expect(def.drawsRandom).toBe(false);
  });

  it('a CONDITIONAL Declare does not dominate → `scope`', () => {
    // h() := Block(If(flag, Declare(n, 0)), Assign(n, 5), n)
    // On the flag-false path the Assign writes through.
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Block', ['If', 'flag9x', ['Declare', 'n', 0]], ['Assign', 'n', 5], 'n'],
    ]);
    expect(specifier(literal)).toBe('scope');
  });

  it('a Declare in a NESTED Block does not dominate the outer Assign', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Block', ['Block', ['Declare', 'n', 0]], ['Assign', 'n', 5]],
    ]);
    expect(specifier(literal)).toBe('scope');
  });

  it('CLOSURE CAPTURE by a nested literal makes the write escaping', () => {
    // The closure may outlive the declaring application.
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Block', ['Declare', 'n', 0], ['Assign', 'n', 1], ['Function', 'n']],
    ]);
    expect(specifier(literal)).toBe('scope');
  });

  it('`Assume` is NEVER confined', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      ['Block', ['Declare', 'x9x', 0], ['Assume', ['Greater', 'x9x', 0]]],
    ]);
    expect(specifier(literal)).toBe('scope');
  });

  it('a COMPOUND target the analysis cannot resolve ⇒ `scope`', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'L9x', ['List', 1, 2]],
        ['Assign', ['Subscript', 'L9x', 1], 5],
      ],
    ]);
    expect(specifier(literal)).toBe('scope');
  });

  it('a DESTRUCTURING Declare dominates each of its target symbols', () => {
    const ce = new ComputeEngine();
    const literal = ce.box([
      'Function',
      [
        'Block',
        ['Declare', ['Tuple', 'p9x', 'q9x'], ['Tuple', 1, 2]],
        ['Assign', 'p9x', 5],
      ],
    ]);
    expect(specifier(literal)).toBe('');
  });

  it('confinement is INFERENCE-only: a bare Block still reports `scope`', () => {
    // The channel split (v5): the runtime accounting stays conservative, and
    // `Assign`'s own definition keeps its `{scope}` label unconditionally.
    const ce = new ComputeEngine();
    expect(ce.lookupDefinition('Assign')!['operator'].effects).toEqual([
      'scope',
    ]);
  });
});

/**
 * Stage 2, the definition-annotation check (`docs/EFFECTS-MODEL.md`,
 * "Inference"):
 *
 * > An explicit effect annotation on a defined function is a contract:
 * > accepted iff `inferred ⊆ declared` (over-declaring weakens, allowed). On
 * > violation the definition is **not installed** and the `Assign`/`Declare`
 * > yields an `incompatible-type` error value — same shape and channel as the
 * > call-boundary check.
 */
describe('The definition-annotation check', () => {
  it('over-declaring is allowed', () => {
    const ce = new ComputeEngine();
    ce.declare('over9x', {
      signature: '() any -> number',
      evaluate: ce.box(['Function', ['Random']]),
    });
    expect(ce.lookupDefinition('over9x')!['operator'].effects).toBe('any');
  });

  it('an exactly-matching annotation is accepted', () => {
    const ce = new ComputeEngine();
    ce.declare('exact9x', {
      signature: '() random -> number',
      evaluate: ce.box(['Function', ['Random']]),
    });
    expect(ce.lookupDefinition('exact9x')!['operator'].effects).toEqual([
      'random',
    ]);
  });

  it('a violated contract throws on the `ce.declare` API route', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('viol9x', {
        signature: '() scope -> number',
        evaluate: ce.box(['Function', ['Random']]),
      })
    ).toThrow(/do not cover/);
  });

  it('the `Assign` operator route yields an `incompatible-type` error value', () => {
    const ce = new ComputeEngine();
    ce.declare('viol9y', {
      signature: '() scope -> number',
      evaluate: ce.box(['Function', 1]),
    });
    const result = ce
      .box(['Assign', 'viol9y', ['Function', ['Random']]])
      .evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('incompatible-type');
    // NOT installed: the previous contract survives.
    expect(ce.lookupDefinition('viol9y')!['operator'].effects).toEqual([
      'scope',
    ]);
  });

  it('the `Declare` operator route yields an `incompatible-type` error value', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box([
        'Declare',
        'viol9z',
        { str: '() scope -> number' },
        ['Function', ['Random']],
      ])
      .evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('incompatible-type');
    expect(ce.lookupDefinition('viol9z')).toBeUndefined();
  });

  it('a BARE specifier is the INFERRED track, not a purity contract', () => {
    // Ruled 2026-08-01: effects take the same inferred-vs-explicit polarity the
    // type system already has for types. An ascribed full signature with an
    // EMPTY slot declares the type axes (params, result) but leaves effects
    // inferred and revisable — so any body is accepted, whatever it does.
    // Only an explicit statement (a non-empty specifier, `pure`, or
    // `effects:`) is a contract.
    const ce = new ComputeEngine();
    ce.declare('bare9x', { type: '() -> number' });
    expect(() =>
      ce.assign('bare9x', ce.box(['Function', ['Random']]))
    ).not.toThrow();
  });
});

/**
 * The **inferred track** (ruled 2026-08-01, `docs/EFFECTS-MODEL.md`,
 * "Annotation provenance"): a bare specifier slot is the effects-axis analog of
 * an inferred type — flexible, and re-stamped whenever better information
 * arrives. The canonical arc is `fib`: declare bare, assign a counter-writing
 * body (revised to `{scope}`), reassign a pure body (revised back). No errors
 * anywhere.
 */
describe('The inferred effects track (a bare specifier slot)', () => {
  /** The effect specifier on the arrow of the body stored for `name`, as a
   * string ('' when pure). Reads the DEFINITION, whichever slot it landed in. */
  const bodyEffects = (ce: ComputeEngine, name: string): string => {
    const def = ce.lookupDefinition(name)!;
    const t = (
      'operator' in def ? def.operator.signature : def.value.value!.type
    ).toString();
    const m = /\)\s*([a-z_ ]*?)\s*->/.exec(t);
    return m ? m[1] : `NO ARROW in "${t}"`;
  };

  it('the fib arc: declared bare, revised by each body assigned to it', () => {
    const ce = new ComputeEngine();
    ce.declare('counter9x', { type: 'number', value: 0 });
    ce.declare('fib9x', { type: '(number) -> number' });

    // Declared, unassigned: optimistically pure, and NOT a contract.
    const def = ce.lookupDefinition('fib9x')!;
    expect('value' in def && def.value.effectsDeclared).toBe(false);

    // A counter-writing body: accepted, and the effects are revised to
    // `{scope}` — the very idiom `scope.test.ts` / `lambda-capture.test.ts`
    // pin (a mutable closure under a bare-arrow declaration).
    ce.assign(
      'fib9x',
      ce.box([
        'Function',
        ['Block', ['Assign', 'counter9x', ['Add', 'counter9x', 1]], 'n'],
        'n',
      ])
    );
    expect(bodyEffects(ce, 'fib9x')).toBe('scope');
    // ... and the call still works, writing the counter.
    expect(ce.box(['fib9x', 3]).evaluate().toString()).toBe('3');
    expect(ce.box('counter9x').evaluate().toString()).toBe('1');

    // Reassigning a pure body revises the effects BACK: the inferred track is
    // re-stamped, never merely widened.
    ce.assign('fib9x', ce.box(['Function', ['Add', 'n', 1], 'n']));
    expect(bodyEffects(ce, 'fib9x')).toBe('');
    expect(ce.box(['fib9x', 3]).evaluate().toString()).toBe('4');
  });

  it('the same arc through the operator slot (`{ signature: … }`)', () => {
    // The two documented declare spellings must stay equivalent.
    const ce = new ComputeEngine();
    ce.declare('counter9y', { type: 'number', value: 0 });
    ce.declare('fib9y', { signature: '(number) -> number' });
    expect(ce.lookupDefinition('fib9y')!['operator'].effectsDeclared).toBe(
      false
    );

    ce.assign(
      'fib9y',
      ce.box([
        'Function',
        ['Block', ['Assign', 'counter9y', ['Add', 'counter9y', 1]], 'n'],
        'n',
      ])
    );
    expect(bodyEffects(ce, 'fib9y')).toBe('scope');
    expect(ce.box(['fib9y', 3]).evaluate().toString()).toBe('3');

    ce.assign('fib9y', ce.box(['Function', ['Add', 'n', 1], 'n']));
    expect(bodyEffects(ce, 'fib9y')).toBe('');
  });

  it('an inference-produced definition re-stamps freely too', () => {
    // No declaration at all: `effectsDeclared` stays false and each assignment
    // replaces the inferred set.
    const ce = new ComputeEngine();
    ce.assign('rev9x', ce.box(['Function', ['Random']]));
    expect(ce.lookupDefinition('rev9x')!['operator'].effects).toEqual([
      'random',
    ]);
    ce.assign('rev9x', ce.box(['Function', 1]));
    expect(ce.lookupDefinition('rev9x')!['operator'].effects).toBeUndefined();
    expect(ce.lookupDefinition('rev9x')!['operator'].effectsDeclared).toBe(
      false
    );
  });
});

/**
 * The **declared track**: an explicit statement — a non-empty specifier, the
 * `pure` keyword, or the `effects:` field — is a CONTRACT. Every assigned body
 * must satisfy `inferred ⊆ declared` (over-declaring allowed); a violation is
 * an `incompatible-type` error and the definition is not installed.
 */
describe('The declared effects track (an explicit statement)', () => {
  const declaredEffects = (ce: ComputeEngine, name: string): string => {
    const def = ce.lookupDefinition(name)!;
    const t = (
      'operator' in def ? def.operator.signature : def.value.type
    ).toString();
    const m = /\)\s*([a-z_ ]*?)\s*->/.exec(t);
    return m ? m[1] : `NO ARROW in "${t}"`;
  };

  for (const [label, declare] of [
    [
      'value slot',
      (ce: ComputeEngine, id: string) =>
        ce.declare(id, { type: '(number) scope -> number' }),
    ],
    [
      'operator slot',
      (ce: ComputeEngine, id: string) =>
        ce.declare(id, { signature: '(number) scope -> number' }),
    ],
  ] as [string, (ce: ComputeEngine, id: string) => void][]) {
    it(`a \`scope\` contract accepts a ⊆ body and rejects a wider one (${label})`, () => {
      const ce = new ComputeEngine();
      ce.declare('counter9z', { type: 'number', value: 0 });
      declare(ce, 'con9x');

      // A PURE body is a subset of `{scope}` — over-declaring is allowed.
      expect(() =>
        ce.assign('con9x', ce.box(['Function', ['Add', 'n', 1], 'n']))
      ).not.toThrow();
      // The declaration keeps the DECLARED set; it is not re-stamped to the
      // tighter inferred one.
      expect(declaredEffects(ce, 'con9x')).toBe('scope');
      expect(ce.box(['con9x', 3]).evaluate().toString()).toBe('4');

      // A `random` body is NOT a subset: rejected, definition not installed.
      expect(() =>
        ce.assign('con9x', ce.box(['Function', ['Add', 'n', ['Random']], 'n']))
      ).toThrow(/do not cover/);
      expect(declaredEffects(ce, 'con9x')).toBe('scope');
      expect(ce.box(['con9x', 3]).evaluate().toString()).toBe('4');
    });
  }

  it('the `Assign` operator route reports it as an `incompatible-type` value', () => {
    const ce = new ComputeEngine();
    ce.declare('con9y', { type: '(number) scope -> number' });
    const result = ce
      .box(['Assign', 'con9y', ['Function', ['Add', 'n', ['Random']], 'n']])
      .evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toContain('incompatible-type');
  });

  //
  // `pure` in the specifier slot — an explicitly-stated EMPTY effect set. It
  // is accepted authoring input only: the type it builds is identical to the
  // bare form (`test/common/type/effects.test.ts`), and the statement travels
  // to the definition as provenance.
  //
  for (const [label, declare] of [
    [
      'value slot, `pure` keyword',
      (ce: ComputeEngine, id: string) =>
        ce.declare(id, { type: '(number) pure -> number' }),
    ],
    [
      'value slot, `pure` keyword, string form',
      (ce: ComputeEngine, id: string) =>
        ce.declare(id, '(number) pure -> number'),
    ],
    [
      'operator slot, `pure` keyword',
      (ce: ComputeEngine, id: string) =>
        ce.declare(id, { signature: '(number) pure -> number' }),
    ],
    [
      'operator slot, `effects: []`',
      (ce: ComputeEngine, id: string) =>
        ce.declare(id, {
          signature: '(number) -> number',
          effects: [],
        } as any),
    ],
  ] as [string, (ce: ComputeEngine, id: string) => void][]) {
    it(`an explicit purity contract rejects a scope-writing body (${label})`, () => {
      const ce = new ComputeEngine();
      ce.declare('counter9w', { type: 'number', value: 0 });
      declare(ce, 'pur9x');

      // A pure body is fine.
      expect(() =>
        ce.assign('pur9x', ce.box(['Function', ['Add', 'n', 1], 'n']))
      ).not.toThrow();
      expect(ce.box(['pur9x', 3]).evaluate().toString()).toBe('4');

      // A scope-writing body violates the stated EMPTY set.
      expect(() =>
        ce.assign(
          'pur9x',
          ce.box([
            'Function',
            ['Block', ['Assign', 'counter9w', ['Add', 'counter9w', 1]], 'n'],
            'n',
          ])
        )
      ).toThrow(/do not cover/);
      // Not installed: the pure body survives, and the counter never moved.
      expect(ce.box(['pur9x', 3]).evaluate().toString()).toBe('4');
      expect(ce.box('counter9w').evaluate().toString()).toBe('0');
    });

    it(`the same contract still serializes with an EMPTY slot (${label})`, () => {
      // `pure` is never emitted: the canonical spelling of a pure arrow is the
      // empty slot, whichever way the author stated it.
      const ce = new ComputeEngine();
      declare(ce, 'pur9y');
      expect(declaredEffects(ce, 'pur9y')).toBe('');
    });
  }

  it('`pure` in the slot sets the `effectsDeclared` provenance bit', () => {
    const ce = new ComputeEngine();
    ce.declare('pur9z', {
      signature: '(number) pure -> number',
      evaluate: ([x]) => x,
    });
    expect(ce.lookupDefinition('pur9z')!['operator'].effectsDeclared).toBe(
      true
    );
    // ... and the bare form does not.
    ce.declare('pur9w', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
    });
    expect(ce.lookupDefinition('pur9w')!['operator'].effectsDeclared).toBe(
      false
    );
  });

  it('`pure` conflicts with a disagreeing `effects:` field or legacy flag', () => {
    // Never silent precedence: a contradiction is a registration error, the
    // same rule the `effects:`/signature pair already follows.
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('pur9v', {
        signature: '(number) pure -> number',
        effects: ['scope'],
        evaluate: ([x]) => x,
      })
    ).toThrow(/disagree/);
    expect(() =>
      ce.declare('pur9u', {
        signature: '(number) pure -> number',
        pure: false,
        evaluate: ([x]) => x,
      })
    ).toThrow(/disagree/);
  });
});

/**
 * Stage 2, annotation provenance (`docs/EFFECTS-MODEL.md`, "Inference" →
 * *Annotation provenance*): "a **definition-level provenance bit,
 * `effectsDeclared`** — set when the author supplied an effects-bearing
 * signature string, the `effects:` authoring field, or a full-signature
 * ascription; left unset on inference-produced signatures."
 */
describe('The `effectsDeclared` provenance bit', () => {
  const declaredBit = (flags: Record<string, unknown>): boolean => {
    const ce = new ComputeEngine();
    ce.declare('prov9x', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
      ...flags,
    } as any);
    return ce.lookupDefinition('prov9x')!['operator'].effectsDeclared;
  };

  it('an effect-bearing signature specifier sets it', () => {
    expect(declaredBit({ signature: '(number) random -> number' })).toBe(true);
  });

  it('the `effects:` field sets it', () => {
    expect(declaredBit({ effects: ['scope'] })).toBe(true);
  });

  it('a bare signature does NOT set it', () => {
    expect(declaredBit({})).toBe(false);
  });

  it('the legacy `pure`/`drawsRandom` sugar does NOT set it', () => {
    // The flags are an OVERRIDE ("not pure"), not a contract — which is what
    // keeps `pure: true` a working escape hatch over a drawing body.
    expect(declaredBit({ pure: false })).toBe(false);
    expect(declaredBit({ drawsRandom: true })).toBe(false);
  });

  it('an inference-produced signature does NOT set it', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'inf9x', ['Function', ['Random']]]).evaluate();
    const def = ce.lookupDefinition('inf9x')!['operator'];
    expect(def.effects).toEqual(['random']);
    expect(def.effectsDeclared).toBe(false);
  });

  it('a return-type-only ascription carries NO effect contract', () => {
    // `Typed(body, T)` is return-type-only and leaves inference in charge.
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'ret9x',
      ['Function', ['Typed', ['Random'], { str: 'number' }]],
    ]).evaluate();
    const def = ce.lookupDefinition('ret9x')!['operator'];
    expect(def.effects).toEqual(['random']);
    expect(def.effectsDeclared).toBe(false);
  });
});
