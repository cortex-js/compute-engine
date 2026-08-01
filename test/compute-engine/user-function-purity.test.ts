import { ComputeEngine } from '../../src/compute-engine';

/**
 * A user-defined function derives its `pure` and `drawsRandom` flags from the
 * heads its body applies (`inferLambdaFlags` in
 * `boxed-expression/boxed-operator-definition.ts`).
 *
 * Without the inference a definition is born with the DEFAULTS — `pure: true`,
 * `drawsRandom: false` — so `f() := Random()` claims to be a pure, hence
 * CONSTANT, expression while drawing from the stream on every call. Two
 * observable failures follow, both pinned below: `Add` re-evaluates a pure
 * operand under `.N()` (drawing twice), and `WithRandomSeed`'s pending-draw
 * gate loses the frame, silently resuming a seeded computation with LIVE
 * draws.
 *
 * The inference is a one-way downgrade from heads with a KNOWN definition; an
 * unknown head (a higher-order parameter, an undeclared name) stays pure by
 * ruling. See the doc comment on `inferLambdaFlags` for the three limits.
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
    expect(def('WithRandomSeed').pure).toBe(false);
    expect(def('WithRandomSeed').drawsRandom).toBe(true);
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
