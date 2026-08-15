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
