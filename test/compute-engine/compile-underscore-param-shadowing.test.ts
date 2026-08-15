/**
 * A lambda parameter spelled `_` must not shadow the compiled VARS OBJECT.
 *
 * The JavaScript family binds the caller's `vars` argument to `_` and compiles
 * a free symbol `k` to the member access `_.k`. `_` is also how an implicit
 * lambda parameter is spelled — the idiomatic Epsil form — so `_ ↦ _ + k`
 * emitted `((_) => _ + _.k)`: inside the arrow `_` is the parameter, a number,
 * so `_.k` read `undefined` off it. Every such call answered NaN (`null` once
 * JSON-serialized) or `false`, silently, behind `success: true`:
 *
 *     Map(_ ↦ _ + k, [1,2,3])   with k = 10   →  [null, null, null]
 *     Filter([1,2,3,4], _ ↦ _ < k)            →  []
 *     TakeWhile(1..∞, _ ↦ _ < k)              →  []
 *
 * The hazard was already known and defended where the COMPILER generates a
 * callback parameter (the `Range` lowering names its unused element `_e`
 * precisely for this reason); it was never handled for a USER parameter.
 *
 * A colliding parameter is now renamed at emission. The rename is confined to
 * bodies that actually read the vars object, so a literal with no free symbol
 * — `_ ↦ _²`, the common case — emits exactly as before.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** Compile `expr` with `k` a run-time input, and run it with `k = 10`. */
function withFreeK(expr: unknown): { result: unknown; code: string } {
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.declare('k', 'real');
  // `constantFold: false` is not needed — `k` is free, so nothing folds — but
  // the emitted stream is what these tests are about, so it is explicit.
  const r = compile(ce.box(expr as never), { constantFold: false })!;
  ce.popScope();
  return { result: r.run!({ k: 10 } as never), code: r.code as string };
}

/** The interpreter's answer for the same expression with `k := 10`, as plain
 * numbers — `toString()` abbreviates a long list (`[1,2,3,4,5,...]`), which
 * would make the comparison vacuous for the `TakeWhile` case. */
function interpreted(expr: unknown): number[] {
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.assign('k', 10);
  const v = ce.box(expr as never).evaluate();
  const out = [...v.each()].map((el) => el.re);
  ce.popScope();
  return out as number[];
}

const UNDERSCORE_LAMBDA: [string, unknown, unknown][] = [
  [
    'Map(_ ↦ _ + k, [1,2,3])',
    ['Map', ['Function', ['Add', '_', 'k'], '_'], ['List', 1, 2, 3]],
    [11, 12, 13],
  ],
  [
    'Map(_ ↦ _ · k, [1,2,3])',
    ['Map', ['Function', ['Multiply', '_', 'k'], '_'], ['List', 1, 2, 3]],
    [10, 20, 30],
  ],
  [
    'Filter([1,2,3,4], _ ↦ _ < k)',
    ['Filter', ['List', 1, 2, 3, 4], ['Function', ['Less', '_', 'k'], '_']],
    [1, 2, 3, 4],
  ],
  [
    'TakeWhile(1..∞, _ ↦ _ < k)',
    [
      'TakeWhile',
      ['Range', 1, { num: '+Infinity' }],
      ['Function', ['Less', '_', 'k'], '_'],
    ],
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  ],
];

describe('COMPILE: a `_` lambda parameter does not shadow the vars object', () => {
  for (const [label, expr, expected] of UNDERSCORE_LAMBDA) {
    it(`${label} agrees with the interpreter`, () => {
      const { result, code } = withFreeK(expr);
      expect(result).toEqual(expected);
      // The parameter was renamed, so the vars-object access still resolves.
      expect(code).toContain('_.k');
      expect(code).not.toContain('(_) =>');
      // …and the interpreter agrees, which is the point.
      expect(interpreted(expr)).toEqual(expected);
    });
  }

  it('a NAMED parameter is unaffected', () => {
    const { result, code } = withFreeK([
      'Map',
      ['Function', ['Add', 'x', 'k'], 'x'],
      ['List', 1, 2, 3],
    ]);
    expect(result).toEqual([11, 12, 13]);
    expect(code).toContain('(x) =>');
  });

  it('an ENGINE-DEFINED function with a `_` parameter is covered too', () => {
    // The emitted-definition route (`f(x) := …`, and each clause of a
    // multi-clause set) builds the same `(params) => body` shape from its own
    // site, so fixing only the inline-lambda lowering left this one silently
    // wrong: `f := _ ↦ _ + k` called with `k = 10` computed NaN. Its fallback
    // parameter name is `_` itself, so a parameter that yields no name
    // defaults INTO the colliding spelling.
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Add', '_', 'k'], '_']));
    const r = compile(ce.box(['f', 3]), {
      vars: { k: '_.k' },
      constantFold: false,
    })!;
    expect(r.run!({ k: 10 } as never)).toBe(13);
  });

  it('a parameter named after a runtime helper namespace is renamed', () => {
    // `_SYS` is baked as a literal token by every helper lowering, so a
    // parameter spelled that way shadowed it for the whole body:
    // `TypeError: _SYS.rangeIter is not a function` at run time, for a program
    // the interpreter evaluates fine. Unlike `_`, no source names a parameter
    // this way, so the rename here is unconditional.
    const ce = new ComputeEngine();
    const expr = [
      'Map',
      [
        'Function',
        ['Take', ['Range', 1, { num: '+Infinity' }], '_SYS'],
        '_SYS',
      ],
      ['List', 2, 3],
    ];
    const r = compile(ce.box(expr as never), { constantFold: false })!;
    expect(r.run!({} as never)).toEqual([
      [1, 2],
      [1, 2, 3],
    ]);
    expect(r.code).not.toContain('(_SYS) =>');
  });

  it('a `_` lambda with NO free symbol emits unchanged', () => {
    // The rename would otherwise rewrite every `_ ↦ …` literal in every
    // artifact for no behavioural gain; this pins that it does not.
    const ce = new ComputeEngine();
    const r = compile(
      ce.parse(
        String.raw`\mathrm{Sum}(\mathrm{Take}(\mathrm{Map}(\_ \mapsto \_^2, 1..\infty), 10))`
      ),
      { constantFold: false }
    );
    expect(r?.code).toBe(
      '(_SYS.takeIter(_SYS.mapIter(_SYS.rangeIter(1, 1), ((_) => (_ * _))), 10)).reduce((_a, _b) => _a + _b, 0)'
    );
    expect(r?.run?.({})).toBe(385);
  });
});

/**
 * A call whose HEAD is a bound name — a function literal's parameter, a
 * definition's parameter — applies that BINDING, never a same-named engine
 * definition. The compiler had two ways to reach the engine definition anyway,
 * and both produced a silently wrong compiled artifact:
 *
 *  1. `tryCompileUserFunction` resolves a head by NAME through the engine's
 *     definitions, so `(f, x) ↦ f(x)` with an engine-level `f` emitted
 *     `_fn_f(x)` and the compiled function ignored its own `f` argument;
 *  2. the constant-fold gate `mentionsCompileBoundName` tested only
 *     value-position symbols, not application heads, so the closed-looking
 *     body of `(g) ↦ g(2)` was evaluated through the engine — applying the
 *     engine's `g` — and baked as `(g) => 3`.
 *
 * Both now refuse: a call of a bound head has no lowering, compilation
 * declines, and the interpreter — which resolves the parameter correctly as of
 * 2026-08-14 — evaluates it. Ruled by the user 2026-08-14: fail closed now;
 * emitting a direct call of the bound parameter (true higher-order
 * compilation) remains a possible future feature.
 *
 * The last two cases check the other direction — that the refusal is not
 * over-broad. A head bound by a binder the compiler itself lowers (a `Sum`
 * index) or by a block-local declaration is one the compiler CAN emit, so both
 * still compile; the block-local one also used to fold to the engine-level
 * function's answer, so it is a fixed case as well as a canary.
 */
describe('COMPILE — a call whose head is a bound parameter', () => {
  it('never resolves a lambda-parameter head to the engine global', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('(t)\\mapsto t + 1'));
    const literal = ce.parse('(f,x)\\mapsto f(x)');

    // The reference answer: applying the ARGUMENT `x ↦ 10x` to 2 is 20. The
    // engine-level `f` would give 3, which is the wrong-answer signature.
    const interpreted = ce
      .box([
        'Apply',
        literal.json as never,
        ['Function', ['Multiply', 'x', 10], 'x'],
        2,
      ] as never)
      .evaluate();
    expect(interpreted.re).toBe(20);

    const result = compile(literal);
    // Whatever the compiler does with this shape, it must agree with the
    // interpreter. Today it declines, so the answer comes from the engine; if
    // direct higher-order compilation is added later, `success` becomes true
    // and the emitted `run` must return the same 20.
    const answer = result.success
      ? (result.run as (...args: unknown[]) => number)(
          (v: number) => v * 10,
          2
        )
      : interpreted.re;
    expect(answer).toBe(20);
    // In no case may the artifact carry a call to the engine-level `f`.
    expect(result.code).not.toContain('_fn_f');
  });

  it('never constant-folds a call whose head is a lambda parameter', () => {
    const ce = new ComputeEngine();
    ce.assign('gg', ce.parse('(t)\\mapsto t + 1'));
    // The body `gg(2)` looks closed — no free symbols — so the fold gate is
    // what has to refuse it: `gg` is the parameter, and its value is not known
    // until the literal is applied.
    const literal = ce.box(['Function', ['gg', 2], 'gg'] as never);

    const interpreted = ce
      .box([
        'Apply',
        literal.json as never,
        ['Function', ['Multiply', 'x', 10], 'x'],
      ] as never)
      .evaluate();
    expect(interpreted.re).toBe(20);

    const result = compile(literal);
    // `3` is the engine-level `gg` applied to 2 — the baked constant this
    // pins against. An empty emission (the decline) trivially satisfies it.
    expect(result.code).not.toMatch(/=>\s*3\b/);
    expect(result.code).not.toContain('_fn_gg');
  });

  it('still folds a closed `Sum` whose INDEX shares a global function name (canary)', () => {
    // The index `kk` is bound by the `Sum`, which the compiler lowers itself,
    // and the whole `Sum` is closed at the point the fold is attempted — so
    // folding it is legitimate and must not be refused. The value is the one
    // the interpreter computes.
    const ce = new ComputeEngine();
    ce.assign('kk', ce.parse('(t)\\mapsto t + 100'));
    const expr = ce.box(['Sum', ['kk', 2], ['Limits', 'kk', 1, 3]] as never);
    const interpreted = expr.evaluate();

    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toBe(String(interpreted.re));
  });

  it('compiles a call of a BLOCK-LOCAL function to the LOCAL, not the global', () => {
    // `bb` is declared inside the block, so the call means the local, which
    // the block itself emits — a bound head the compiler CAN lower, so this
    // shape must keep compiling rather than being swept into the refusal. It
    // must also agree with the interpreter: 10 × 2 = 20. Before the fold gate
    // tested application heads, the body folded through the engine and the
    // artifact returned the engine-level `bb`'s answer, 3.
    const ce = new ComputeEngine();
    ce.assign('bb', ce.parse('(t)\\mapsto t + 1'));
    const literal = ce.box([
      'Function',
      [
        'Block',
        [
          'Declare',
          'bb',
          [
            'Dictionary',
            [
              'KeyValuePair',
              'value',
              ['Function', ['Multiply', 't', 10], 't'],
            ],
          ],
        ],
        ['bb', 2],
      ],
      'z',
    ] as never);

    const interpreted = ce
      .box(['Apply', literal.json as never, 0] as never)
      .evaluate();
    expect(interpreted.re).toBe(20);

    const result = compile(literal);
    expect(result.success).toBe(true);
    expect(
      (result.run as (...args: unknown[]) => number)(0)
    ).toBe(20);
  });
});
