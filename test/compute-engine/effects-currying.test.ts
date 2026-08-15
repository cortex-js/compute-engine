import { ComputeEngine } from '../../src/compute-engine';

/**
 * # Purity-gated currying
 *
 * Stage 2 WP-C of `docs/EFFECTS-MODEL.md` ("Subtyping" — *Currying / partial
 * application*):
 *
 * > Runtime alignment (today `makeLambda` *evaluates the body* with the
 * > supplied prefix before currying […] so effects could fire at partial
 * > application): Stage 2 gates that pre-evaluation on purity — a body whose
 * > `effectsOf` is pure keeps today's evaluate-then-curry optimization; an
 * > effectful body is **captured without evaluation** and fires exactly once,
 * > at saturation. Tests must pin: zero effects at partial application, exactly
 * > one at saturation, for `random` and `scope`.
 *
 * The gate lives in `makeLambda` (`function-utils.ts`), on the
 * `args.length < params.length` branch. It never throws: `makeLambda` declines
 * by returning `undefined`, and the currying branch always returns a residual
 * `Function` literal.
 *
 * ## How a draw is COUNTED
 *
 * Inside one `WithRandomSeed` frame the stream is deterministic, so the k-th
 * draw is a known value. A probe `Random()` placed *after* the partial
 * application therefore reports how many draws the partial application
 * consumed: `stream[0]` if it drew nothing, `stream[1]` if it drew once.
 */

/** The first two values of the seeded stream — the yardstick every draw-count
 * assertion below is read against. */
function stream(ce: ComputeEngine, seed = 42): [number, number] {
  const v = [
    ...ce
      .box(['WithRandomSeed', seed, ['List', ['Random'], ['Random']]])
      .evaluate()
      .each(),
  ].map((x) => x.re);
  return [v[0], v[1]];
}

/** `(a, b) ↦ Random() + a + b` — one draw per saturated call. */
const DRAWING_LAMBDA = ['Function', ['Add', ['Random'], 'a', 'b'], 'a', 'b'];

/** `(a, b) ↦ { n := n + 1; a + b }` — one write to the OUTER `n` per call. */
const WRITING_LAMBDA = [
  'Function',
  ['Block', ['Assign', 'n', ['Add', 'n', 1]], ['Add', 'a', 'b']],
  'a',
  'b',
];

describe('`random`: zero draws at partial application, exactly one at saturation', () => {
  it('the partial application draws NOTHING (box route)', () => {
    const ce = new ComputeEngine();
    const [first] = stream(ce);
    // The probe sits after the partial application inside the same frame.
    const framed = ce
      .box([
        'WithRandomSeed',
        42,
        ['List', ['Apply', DRAWING_LAMBDA, 1], ['Random']],
      ])
      .evaluate();
    const [residual, probe] = [...framed.each()];
    // The residual is a function value: the body was CAPTURED, not evaluated.
    expect(residual.operator).toBe('Function');
    expect(residual.toString()).toContain('Random');
    // The probe is the FIRST value of the stream: nothing was drawn before it.
    expect(probe.re).toBe(first);
  });

  it('saturation draws EXACTLY once', () => {
    const ce = new ComputeEngine();
    const [first, second] = stream(ce);
    const framed = ce
      .box([
        'WithRandomSeed',
        42,
        ['List', ['Apply', ['Apply', DRAWING_LAMBDA, 1], 2], ['Random']],
      ])
      .evaluate();
    const [value, probe] = [...framed.each()].map((x) => x.re);
    // The saturating call consumed stream[0] — exactly one draw…
    expect(value).toBeCloseTo(first + 3, 12);
    // …so the probe that follows it is stream[1], not stream[0] or stream[2].
    expect(probe).toBe(second);
  });

  it('each saturation of the SAME residual draws again', () => {
    const ce = new ComputeEngine();
    const [first, second] = stream(ce);
    const framed = ce
      .box([
        'WithRandomSeed',
        42,
        [
          'Block',
          ['Assign', 'half', ['Apply', DRAWING_LAMBDA, 1]],
          ['List', ['Apply', 'half', 2], ['Apply', 'half', 2]],
        ],
      ])
      .evaluate();
    const [a, b] = [...framed.each()].map((x) => x.re);
    // `toBeCloseTo`: the engine's sum and the test's differ in association, so
    // they can land one ULP apart. The stream POSITION is what is pinned.
    expect(a).toBeCloseTo(first + 3, 12);
    expect(b).toBeCloseTo(second + 3, 12);
  });
});

describe('`scope`: zero writes at partial application, exactly one at saturation', () => {
  const counting = (): ComputeEngine => {
    const ce = new ComputeEngine();
    ce.assign('n', 0);
    return ce;
  };
  const n = (ce: ComputeEngine): number => ce.box('n').evaluate().re;

  it('the box route', () => {
    const ce = counting();
    const partial = ce.box(['Apply', WRITING_LAMBDA, 1]).evaluate();
    expect(partial.operator).toBe('Function');
    expect(n(ce)).toBe(0);

    const saturated = ce.box(['Apply', partial, 2]).evaluate();
    expect(saturated.re).toBe(3);
    expect(n(ce)).toBe(1);
  });

  it('the `ce.function` route', () => {
    const ce = counting();
    const literal = ce.box(WRITING_LAMBDA);
    const partial = ce
      .function('Apply', [literal, ce.number(1)])
      .evaluate();
    expect(n(ce)).toBe(0);

    const saturated = ce.function('Apply', [partial, ce.number(2)]).evaluate();
    expect(saturated.re).toBe(3);
    expect(n(ce)).toBe(1);
  });

  it('the parse route — `f(1)` on a two-parameter `f`', () => {
    const ce = counting();
    // Installing a writer as a NAMED definition requires the `scope`
    // contract (the default-`!scope` ceiling); the anonymous box /
    // `ce.function` routes above need none. The contract is stated via the
    // `effects:` flag rather than a `signature:` — a DECLARED signature pins
    // the arity and `f(1)` would fail validation with `missing` instead of
    // currying, and the currying behavior is exactly what this test pins.
    ce.declare('f', { effects: ['scope'], evaluate: ce.box(WRITING_LAMBDA) });

    const partial = ce.parse('f(1)').evaluate();
    expect(partial.operator).toBe('Function');
    expect(n(ce)).toBe(0);

    ce.declare('g', { effects: ['scope'], evaluate: partial });
    expect(ce.parse('g(2)').evaluate().re).toBe(3);
    expect(n(ce)).toBe(1);
  });

  it('the write is still made ONCE when the residual is applied later', () => {
    const ce = counting();
    const partial = ce.box(['Apply', WRITING_LAMBDA, 10]).evaluate();
    expect(n(ce)).toBe(0);
    ce.box(['Apply', partial, 1]).evaluate();
    ce.box(['Apply', partial, 2]).evaluate();
    expect(n(ce)).toBe(2);
  });
});

describe('the captured residual is capture-avoiding', () => {
  it('a nested literal that REBINDS a parameter name is left alone', () => {
    // The residual re-applies the original literal rather than substituting the
    // prefix into its body: `subs()` is not capture-avoiding, and substituting
    // `a := 1` here would rewrite the inner literal's own parameter symbol
    // (`(a) ↦ 2a` → `(1) ↦ 2`, an `expected-a-symbol` error).
    const ce = new ComputeEngine();
    ce.assign('n', 0);
    const shadowing = [
      'Function',
      [
        'Block',
        ['Assign', 'n', ['Add', 'n', 1]],
        [
          'Add',
          ['Apply', ['Function', ['Multiply', 'a', 2], 'a'], 5],
          'a',
          'b',
        ],
      ],
      'a',
      'b',
    ];
    const direct = ce.box(['Apply', shadowing, 1, 2]).evaluate();
    expect(direct.re).toBe(13);

    ce.assign('n', 0);
    const partial = ce.box(['Apply', shadowing, 1]).evaluate();
    expect(partial.isValid).toBe(true);
    expect(ce.box('n').evaluate().re).toBe(0);
    const curried = ce.box(['Apply', partial, 2]).evaluate();
    expect(curried.re).toBe(13);
    expect(ce.box('n').evaluate().re).toBe(1);
  });
});

describe('a PURE body keeps the evaluate-then-curry optimization', () => {
  it('the residual body is already reduced with the applied prefix', () => {
    const ce = new ComputeEngine();
    const partial = ce
      .box(['Apply', ['Function', ['Add', ['Multiply', 'a', 10], 'b'], 'a', 'b'], 2])
      .evaluate();
    expect(partial.operator).toBe('Function');
    // `a * 10` was folded to 20 at partial application — the optimization.
    expect(partial.toString()).toContain('20');
    expect(ce.box(['Apply', partial, 5]).evaluate().re).toBe(25);
  });

  it('a partially applied pure lambda still saturates to the same value', () => {
    const ce = new ComputeEngine();
    const f = ['Function', ['Divide', 'a', 'b'], 'a', 'b'];
    const direct = ce.box(['Apply', f, 6, 3]).evaluate();
    const curried = ce
      .box(['Apply', ce.box(['Apply', f, 6]).evaluate(), 3])
      .evaluate();
    expect(curried.toString()).toEqual(direct.toString());
  });
});

describe('the residual keeps the currying contract of §6.5', () => {
  it('the unapplied parameter keeps its annotation and its return ascription', () => {
    const ce = new ComputeEngine();
    ce.assign('n', 0);
    const literal = ce.box([
      'Function',
      [
        'Block',
        ['Assign', 'n', ['Add', 'n', 1]],
        ['Typed', ['Add', 'a', 'b'], "'integer'"],
      ],
      ['Typed', 'a', "'integer'"],
      ['Typed', 'b', "'integer'"],
    ]);
    const partial = ce.box(['Apply', literal, 1]).evaluate();
    expect(ce.box('n').evaluate().re).toBe(0);
    expect(partial.type.toString()).toContain('integer');
    expect(ce.box(['Apply', partial, 2]).evaluate().re).toBe(3);
    expect(ce.box('n').evaluate().re).toBe(1);
  });
});
