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
