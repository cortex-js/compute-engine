/**
 * The LAST-CALL MEMO around an emitted user-function definition on the
 * JavaScript target (`memoizeSharedDefinitions` in `javascript-target.ts`,
 * eligibility in `BaseCompiler.lastCallMemoEligible`).
 *
 * Common-subexpression elimination never crosses a definition boundary: a
 * user function emitted by reference (`_fn_f`) is compiled once, but every
 * call of it is a fresh evaluation of its body. On the Voronoi row of Desmos
 * state 62urmx2dcm, `m(x, y)` is called twice per sample with the same
 * `(x, y)` — once inside `m2` and once from the row — so its nine-distance
 * block ran twice per sample. The memo wraps such a definition in a closure
 * that remembers the arguments and the result of its most recent call and
 * answers a repeated call with the same arguments from that record.
 *
 * The pins below: the emitted shape on the witness and its numeric parity
 * with the fully inlined row; the gate (a site inside another definition,
 * two sites in all, a body long enough to pay for a miss; never a root-only,
 * one-site or short-bodied definition); `NaN` and
 * signed-zero argument handling; the bypass for array arguments; no memo on
 * an impure body; a vars-object read (a slider) joining the key; state private
 * to each compiled artifact; a recursive definition; the function-literal
 * route.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';

/** The expected n-th draw of a frame seeded `seed`. */
function draw(seed: number | string, n: number): number {
  const [seedLo, seedHi] = foldSeed(seed);
  return frameDraw(seedLo, seedHi, n);
}

const js = (ce: ComputeEngine, json: unknown, options: object = {}): any =>
  compile(ce.box(json as any), {
    to: 'javascript',
    fallback: false,
    ...options,
  } as any);

// ---------------------------------------------------------------------------
// The witness: the Voronoi row of Desmos state 62urmx2dcm, by reference and
// fully inlined (the same builders as
// `tycho-62urmx2dcm-byref-definition-unroll.test.ts`).
// ---------------------------------------------------------------------------

const N_CELLS = 16;
const N = 4;
const H = 1 / N;
const OFFSETS: Array<[number, number]> = [
  [-H, -H],
  [0, -H],
  [H, -H],
  [-H, 0],
  [0, 0],
  [H, 0],
  [-H, H],
  [0, H],
  [H, H],
];
const hash = (a: unknown) => [
  'Mod',
  ['Multiply', 10000, ['Sin', ['Multiply', 10000, a]]],
  1,
];
const S = (x: unknown, y: unknown, s: number) =>
  hash([
    'Add',
    ['Floor', ['Multiply', N, x]],
    ['Multiply', N, ['Floor', ['Multiply', N, y]]],
    s,
  ]);
const P = (x: unknown, y: unknown) => [
  'Add',
  [
    'Multiply',
    ['Divide', 1, N],
    ['PointList', ['Floor', ['Multiply', N, x]], ['Floor', ['Multiply', N, y]]],
  ],
  ['Multiply', ['Divide', 1, N], ['PointList', S(x, y, 0), S(x, y, 0.5)]],
];
const V = (x: unknown, y: unknown) => [
  'List',
  ...OFFSETS.map(([dx, dy]) => P(['Add', x, dx], ['Add', y, dy])),
];
const D = (x: unknown, y: unknown) => [
  'Add',
  ['Square', ['Subtract', x, ['PointX', V(x, y)]]],
  ['Square', ['Subtract', y, ['PointY', V(x, y)]]],
];
const M = (x: unknown, y: unknown) => ['Min', D(x, y)];
const ROW_INLINE = (x: unknown, y: unknown) => [
  'Subtract',
  ['Power', ['Divide', 1, N_CELLS], 2],
  [
    'Abs',
    [
      'Subtract',
      [
        'Min',
        [
          'Map',
          ['Function', ['Which', ['Equal', '_', M(x, y)], 1e9, 'True', '_'], '_'],
          D(x, y),
        ],
      ],
      M(x, y),
    ],
  ],
];

function byReferenceEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.declare('y', 'number');
  const define = (name: string, body: unknown) =>
    ce.box(['DefineFunction', name, ['Function', body, 'x', 'y']]).evaluate();
  define('V', V('x', 'y'));
  define('d', [
    'Add',
    ['Square', ['Subtract', 'x', ['PointX', ['V', 'x', 'y']]]],
    ['Square', ['Subtract', 'y', ['PointY', ['V', 'x', 'y']]]],
  ]);
  define('m', ['Min', ['d', 'x', 'y']]);
  define('d2', [
    'Map',
    ['Function', ['Which', ['Equal', '_', ['m', 'x', 'y']], 1e9, 'True', '_'], '_'],
    ['d', 'x', 'y'],
  ]);
  define('m2', ['Min', ['d2', 'x', 'y']]);
  define('row', [
    'Subtract',
    ['Power', ['Divide', 1, N_CELLS], 2],
    ['Abs', ['Subtract', ['m2', 'x', 'y'], ['m', 'x', 'y']]],
  ]);
  return ce;
}

const SAMPLES: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [
  -1 + (i % 5) * 0.37,
  -0.8 + Math.floor(i / 5) * 0.41,
]);

describe('LAST-CALL MEMO — the witness', () => {
  const ce = byReferenceEngine();
  const row = js(ce, ['row', 'x', 'y']);

  it('answers exactly what the fully inlined row answers at 20 points', () => {
    const inlined = js(ce, ROW_INLINE('x', 'y'));
    expect(inlined.preamble ?? '').not.toContain('$memo');
    for (const [x, y] of SAMPLES) {
      const a = row.run({ x, y }) as number;
      const b = inlined.run({ x, y }) as number;
      expect(Number.isFinite(a)).toBe(true);
      expect(a).toBe(b);
    }
  });

  it('answers the interpreter at 5 points', () => {
    for (const [x, y] of SAMPLES.slice(0, 5)) {
      const expected = ce.box(['row', x, y]).N().re;
      expect(row.run({ x, y })).toBeCloseTo(expected, 12);
    }
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * `f(x) := 2x + 1 + 0·Σ sin((k + ½) x)` — the value of
 * `2x + 1`, with an emitted body long enough for the memo's size gate — and
 * `g(x) := f(x) + 1`, over a declared scalar `x`.
 */
/** `0·Σ_{k=1..32} sin((k + ½) v)`: zero, emitted long enough for the memo's
 * body-size gate (the engine inlines and shares a short body itself, and
 * the memo only pays above about 600 emitted characters). */
const pad = (v: unknown) => [
  'Multiply',
  0,
  ['Add', ...Array.from({ length: 32 }, (_, k) => ['Sin', ['Multiply', k + 1.5, v]])],
];

// ---------------------------------------------------------------------------
// What is never memoized
// ---------------------------------------------------------------------------

describe('LAST-CALL MEMO — what is never memoized', () => {
  it('an impure body: `Random()` draws once per call', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['DefineFunction', 'r', ['Function', ['Add', 'x', ['Random'], pad('x')], 'x']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['r', 'x'], 1], 'x']]).evaluate();
    const c = js(
      ce,
      ['WithRandomSeed', 42, ['Add', ['g', 'x'], ['r', 'x']]],
      { constantFold: false }
    );
    expect(c.preamble).not.toContain('$memo');
    // Two draws of the seeded frame, not one draw answered twice.
    expect(c.run({ x: 1 })).toBeCloseTo(1 + draw(42, 0) + 1 + 1 + draw(42, 1), 12);
  });

  it('a body with a collection-typed parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<number>');
    ce.declare('s', '(list<number>) -> number');
    ce.declare('g', '(list<number>) -> number');
    ce.box(['DefineFunction', 's', ['Function', ['Add', ['Sum', 'L'], pad(['Sum', 'L'])], 'L']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['s', 'L'], 1], 'L']]).evaluate();
    const r = js(ce, ['Add', ['g', 'xs'], ['s', 'xs']]);
    expect(r.preamble).not.toContain('$memo');
    expect(r.run({ xs: [1, 2, 3] })).toBe(7 + 6);
  });
});

// ---------------------------------------------------------------------------
// Vars-object reads (a Desmos slider reaches a compiled row this way)
// ---------------------------------------------------------------------------

/** The artifact spliced at module level: the preamble is evaluated ONCE and
 * the vars object `_` is rebound per call, so the record outlives the vars
 * object of one call. */
function spliced(r: any): (vars: Record<string, unknown>) => unknown {
  return new Function(
    '_SYS',
    `let _;\n${r.preamble}\nreturn (vars) => { _ = vars; return ${r.code}; };`
  )({});
}

describe('LAST-CALL MEMO — vars-object reads join the key', () => {
  /** `f(x) := x + k + pad(x)` over a free `k`, `g(x) := f(x) + 1`. */
  function sliderEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('k', 'number');
    ce.box(['DefineFunction', 'f', ['Function', ['Add', 'x', 'k', pad('x')], 'x']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['f', 'x'], 1], 'x']]).evaluate();
    return ce;
  }

  it('a slider moved between two calls of a spliced artifact misses the record', () => {
    const run = spliced(js(sliderEngine(), ['Add', ['g', 'x'], ['f', 'x']]));
    expect(run({ x: 1, k: 10 })).toBe(12 + 11);
    expect(run({ x: 1, k: 20 })).toBe(22 + 21);
    expect(run({ x: 1, k: 10 })).toBe(12 + 11);
  });

  it('a slider value that is not a number, string or boolean bypasses the memo', () => {
    const run = spliced(js(sliderEngine(), ['Add', ['g', 'x'], ['f', 'x']]));
    // ONE array, mutated between two calls; the body runs on each call.
    const k = [1, 2];
    const first = run({ x: 1, k });
    k[0] = 5;
    const second = run({ x: 1, k });
    expect(first).not.toBe(second);
    expect(run({ x: 1, k: 10 })).toBe(12 + 11);
  });
});
