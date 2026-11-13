import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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
 * The currying branch of `makeLambda` (`function-utils.ts`) now captures
 * EVERY body without evaluation, a pure one too: a pure body evaluated with
 * only the prefix was simplified before the remaining arguments were known,
 * so the curried value could differ from the full call (`(x, y) ↦ x·y`
 * applied to `0`, then to `∞`, gave `0`; the full call is
 * `NaN`). The branch never throws: `makeLambda` declines by
 * returning `undefined`, and the currying branch always returns a residual
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
          ['Declare', 'half', "'unknown'", ['Apply', DRAWING_LAMBDA, 1]],
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

describe('a PURE body is captured without evaluation too', () => {
  it('the residual re-applies the literal to the applied prefix', () => {
    const ce = new ComputeEngine();
    const partial = ce
      .box(['Apply', ['Function', ['Add', ['Multiply', 'a', 10], 'b'], 'a', 'b'], 2])
      .evaluate();
    expect(partial.operator).toBe('Function');
    expect(partial.toString()).toBe('(_) => Apply((a, b) => 10a + b, 2, _)');
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

// `0·Random()` gives a body an effect and adds nothing to its value.
const NOISE = ['Multiply', 0, ['Random']];

/** The value of `expr` by `evaluate()` and by `evaluateAsync()`. */
async function bothValues(
  ce: ComputeEngine,
  expr: unknown
): Promise<[string, string]> {
  const boxed = ce.box(expr as any);
  return [
    boxed.evaluate().toString(),
    (await boxed.evaluateAsync()).toString(),
  ];
}

/**
 * The value of `expr` compiled to JavaScript, or `declined` when the
 * compilation refuses it. An exception from the compiled code itself is not
 * caught, so a compilation that succeeds and then throws fails the test.
 */
function compiledValue(ce: ComputeEngine, expr: unknown): string {
  let r: ReturnType<typeof compile>;
  try {
    r = compile(ce.box(expr as any), { to: 'javascript', fallback: false });
  } catch {
    return 'declined';
  }
  return r.success ? JSON.stringify(r.run!()) : 'declined';
}

describe('a call of the residual equals the full call', () => {
  // The residual `(_1) ↦ Apply(F, 1, _1)` uses its parameter only as an
  // argument of `Apply`. Its slot now takes the collection type of the slot
  // of `p`, so a list is bound whole, as in the full call. Before, the list
  // was applied element by element, and each element was an
  // `incompatible-type` error.
  test.each([
    ['a pure body', ['Add', 'x', ['At', 'p', 1], ['At', 'p', 2]]],
    [
      'a body with an effect',
      ['Add', 'x', ['At', 'p', 1], ['At', 'p', 2], NOISE],
    ],
  ])('a list at a collection parameter is bound whole (%s)', async (_, body) => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.box(['Function', body, 'x', 'p'] as any));
    expect(await bothValues(ce, ['F', 1, ['List', 2, 3]])).toEqual(['6', '6']);
    expect(
      await bothValues(ce, ['Apply', ['F', 1], ['List', 2, 3]])
    ).toEqual(['6', '6']);
    // The same shape with the literal written in place compiles to the
    // interpreter's value, or declines.
    const curried = [
      'Apply',
      ['Apply', ['Function', body, 'x', 'p'], 1],
      ['List', 2, 3],
    ];
    const javascript = compiledValue(ce, curried);
    expect(['declined', '6']).toContain(javascript);
  });

  // A supplied argument whose value is `Nothing` (a computed `Nothing`) is
  // bound to its parameter by the full call. The residual keeps it in its
  // slot. Before, it was written as an operand of the `Apply` of the
  // residual, where the canonical form erased it, and `5` went to `a`.
  test.each([
    ['a pure body', 'b'],
    ['a body with an effect', ['Add', 'b', NOISE]],
  ])('a Nothing argument keeps its parameter (%s)', async (_, body) => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', 'Nothing']));
    ce.assign('G', ce.box(['Function', body, 'a', 'b'] as any));
    expect(await bothValues(ce, ['G', ['g'], 5])).toEqual(['5', '5']);
    expect(await bothValues(ce, ['Apply', ['G', ['g']], 5])).toEqual([
      '5',
      '5',
    ]);
    const curried = [
      'Apply',
      ['Apply', ['Function', body, 'a', 'b'], ['Apply', ['Function', 'Nothing']]],
      5,
    ];
    expect(await bothValues(ce, curried)).toEqual(['5', '5']);
    expect(['declined', '5']).toContain(compiledValue(ce, curried));
  });

  // The body reads the `Nothing` parameter. The residual passes a computed
  // `Nothing` in its slot, so the value is the value of the full call. A
  // held form of `Nothing` (`Evaluate(Hold(Nothing))`) gave
  // `Hold("Nothing")` there.
  test.each([
    // `null`: the compiled form declines (the `Nothing` value has no
    // compiled form).
    ['A(g())', ['Function', 'a', 'a', 'b'], [['g']], 5, null],
    ['B(g())', ['Function', ['Tuple', 'a', 'b'], 'a', 'b'], [['g']], 5, null],
    [
      'G3(g(), 1)',
      ['Function', ['List', 'a', 'b', 'c'], 'a', 'b', 'c'],
      [['g'], 1],
      5,
      '[1,5]',
    ],
    [
      'G3(1, g())',
      ['Function', ['List', 'a', 'b', 'c'], 'a', 'b', 'c'],
      [1, ['g']],
      5,
      '[1,5]',
    ],
  ] as const)(
    'the residual of %s applied to 5 equals the full call',
    async (_, literal, prefix, last, javascript) => {
      const ce = new ComputeEngine();
      ce.assign('g', ce.box(['Function', 'Nothing']));
      ce.assign('F', ce.box(literal as any));
      const full = await bothValues(ce, ['F', ...prefix, last]);
      expect(full[0]).not.toMatch(/Hold/);
      expect(await bothValues(ce, ['Apply', ['F', ...prefix], last])).toEqual(
        full
      );
      // The same shape with the literals written in place: the compiled value
      // is the interpreter's, or the target declines.
      const written = [
        'Apply',
        [
          'Apply',
          literal,
          ...prefix.map((x) =>
            Array.isArray(x) ? ['Apply', ['Function', 'Nothing']] : x
          ),
        ],
        last,
      ];
      expect(await bothValues(ce, written)).toEqual(full);
      const compiled = compiledValue(ce, written);
      if (javascript === null) expect(compiled).toBe('declined');
      else expect(['declined', javascript]).toContain(compiled);
    }
  );

  // A supplied argument that is an error is the value of the partial
  // application, and its type is `error`, not a function.
  test('a partial application with an error argument is typed error', () => {
    const ce = new ComputeEngine();
    ce.parse('h(a, t) := a[1] + a[2] + t').evaluate();
    ce.parse('f(a, b) := a').evaluate();
    const call = ce.box(['f', ['h', 3, 1]]);
    expect(call.type.toString()).toBe('error');
    expect(call.evaluate().toString()).toMatch(
      /^Error\(ErrorCode\("incompatible-type"/
    );
  });

  // A function literal that holds its arguments is not curried: the
  // residual would evaluate the held prefix and its own argument. Its
  // partial application is the `missing` error, as for a declared
  // signature.
  test('a partial application of a held literal is the missing error', async () => {
    const ce = new ComputeEngine();
    ce.declare('hf', {
      lazy: true,
      evaluate: ce.box(['Function', ['Head', 'a'], 'a', 'b']),
    } as any);
    ce.assign('c', 3);
    expect(await bothValues(ce, ['hf', ['Add', 'c', 1], 0])).toEqual([
      '"Add"',
      '"Add"',
    ]);
    expect(ce.box(['hf', ['Add', 'c', 1]]).type.toString()).toBe('error');
    expect(ce.box(['hf']).type.toString()).toBe('error');
    // The error has the frame of the first absent argument, as the error of
    // an Epsil `hold` function has.
    expect(ce.box(['hf', ['Add', 'c', 1]]).evaluate().json).toEqual([
      'Error',
      "'missing'",
      ['ErrorTrace', ['ErrorFrame', "'hf'", 2]],
    ]);
    expect(await bothValues(ce, ['hf', ['Add', 'c', 1]])).toEqual([
      'Error("missing")',
      'Error("missing")',
    ]);
    expect(
      await bothValues(ce, ['Apply', ['hf', ['Add', 'c', 1]], 0])
    ).toEqual(['Error("missing")', 'Error("missing")']);
  });

  // The type of a partial application of a function with an inferred
  // signature has the result `error` when the body is an error for the
  // supplied arguments: each call of the residual gives the error of the
  // full call.
  test.each([
    ['a pure body', ['Add', ['At', 'a', 1], ['At', 'a', 2], 't']],
    [
      'a body with an effect',
      ['Add', ['At', 'a', 1], ['At', 'a', 2], 't', NOISE],
    ],
  ])('the call of the residual is typed error (%s)', async (_, body) => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', body, 'a', 't'] as any));
    expect(ce.box(['h', 3]).type.toString()).toMatch(
      /^\(t: unknown\)( random)? -> error$/
    );
    expect(ce.box(['Apply', ['h', 3], 1]).type.toString()).toBe('error');
    expect(ce.box(['h', 3, 1]).type.toString()).toBe('error');
    const [value, asyncValue] = await bothValues(ce, ['Apply', ['h', 3], 1]);
    expect(value).toMatch(/^Error\(ErrorCode\("incompatible-type"/);
    expect(asyncValue).toBe(value);
    expect(ce.box(['h', 3]).evaluate().operator).toBe('Function');
  });
});
