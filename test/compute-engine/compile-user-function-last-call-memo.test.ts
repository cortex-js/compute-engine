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

/** The preamble line that defines the emitted function `name`. */
function definitionOf(preamble: string, name: string): string {
  const line = (preamble ?? '')
    .split('\n')
    .find((l) => l.startsWith(`const _fn_${name} =`));
  expect(line).toBeDefined();
  return line!;
}

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

  it('wraps `m`, called from inside `m2` and from the row, in a memo', () => {
    expect(row.success).not.toBe(false);
    const m = definitionOf(row.preamble, 'm');
    // The closure that holds the record, the scalar test, the record on
    // exit, and exactly one declaration of the name.
    expect(m).toContain('const _fn_m = (() => { let _fn_m$memo_k0, _fn_m$memo_k1, _fn_m$memo_v;');
    expect(m).toContain(
      "let _fn_m$memo_s = (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') && " +
        "(typeof y === 'number' || typeof y === 'string' || typeof y === 'boolean');"
    );
    expect(m).toContain("typeof _fn_m$memo_r !== 'object' && typeof _fn_m$memo_r !== 'function'");
    expect(m).toContain('_fn_m$memo_k0 = x; _fn_m$memo_k1 = y; _fn_m$memo_v = _fn_m$memo_r;');
    expect(m.split('const _fn_m =').length - 1).toBe(1);
    // `m2` (one site, the row) and `row` (the root) are emitted as before.
    expect(definitionOf(row.preamble, 'm2')).not.toContain('$memo');
    expect(definitionOf(row.preamble, 'row')).not.toContain('$memo');
  });

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
const F_BODY = ['Add', ['Multiply', 2, 'x'], 1, pad('x')];
function chainEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.box(['DefineFunction', 'f', ['Function', F_BODY, 'x']]).evaluate();
  ce.box(['DefineFunction', 'g', ['Function', ['Add', ['f', 'x'], 1], 'x']]).evaluate();
  return ce;
}

describe('LAST-CALL MEMO — the gate', () => {
  it('leaves a definition called from one site exactly as before', () => {
    const r = js(chainEngine(), ['f', 'x']);
    expect(r.preamble).toMatch(/^const _fn_f = \(x\) => [^\n]*;\n$/);
    expect(r.preamble).not.toContain('$memo');
    expect(r.run({ x: 3 })).toBe(7);
  });

  it('leaves a definition called only from the root alone (CSE merges equal root calls)', () => {
    const r = js(chainEngine(), ['Add', ['f', 'x'], ['f', ['Add', 'x', 1]]]);
    expect(r.preamble).toMatch(/^const _fn_f = \(x\) => [^\n]*;\n$/);
    expect(r.preamble).not.toContain('$memo');
    expect(r.run({ x: 3 })).toBe(7 + 9);
  });

  it('leaves a definition with a short body alone: a hit could not save more than a miss costs', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['DefineFunction', 'f', ['Function', ['Add', ['Multiply', 2, 'x'], 1], 'x']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['f', 'x'], 1], 'x']]).evaluate();
    const r = js(ce, ['Add', ['g', 'x'], ['f', 'x']]);
    expect(r.preamble).toContain('const _fn_f = (x) => 2 * x + 1;\n');
    expect(r.preamble).not.toContain('$memo');
    expect(r.run({ x: 3 })).toBe(8 + 7);
  });

  it('memoizes a definition called from inside another definition and from the root', () => {
    const r = js(chainEngine(), ['Add', ['g', 'x'], ['f', 'x']]);
    const f = definitionOf(r.preamble, 'f');
    expect(f).toContain('_fn_f$memo_k0');
    expect(definitionOf(r.preamble, 'g')).not.toContain('$memo');
    expect(r.run({ x: 3 })).toBe(8 + 7);
    expect(r.run({ x: 4 })).toBe(10 + 9);
  });

  it('memoizes a definition called from inside two other definitions', () => {
    const ce = chainEngine();
    ce.box(['DefineFunction', 'h', ['Function', ['Multiply', ['f', 'x'], 3], 'x']]).evaluate();
    const r = js(ce, ['Add', ['g', 'x'], ['h', 'x']]);
    expect(definitionOf(r.preamble, 'f')).toContain('$memo');
    expect(r.run({ x: 3 })).toBe(8 + 21);
  });

  it('memoizes on the function-literal route too', () => {
    const r = js(chainEngine(), ['Function', ['Add', ['g', 't'], ['f', 't']], 't']);
    expect(r.code).toContain('_fn_f$memo_k0');
    expect(r.run(3)).toBe(8 + 7);
  });

  it('memoizes under a lambda whose parameter has the same name as the definition parameter', () => {
    // A definition never reads a lambda parameter (it compiles against the
    // root), so its own `x` must not read as the lambda's per-call `x`.
    const r = js(chainEngine(), ['Function', ['Add', ['g', 'x'], ['f', 'x']], 'x']);
    expect(r.code).toContain('_fn_f$memo_k0');
    expect(r.run(3)).toBe(8 + 7);
  });
});

// ---------------------------------------------------------------------------
// Argument handling
// ---------------------------------------------------------------------------

describe('LAST-CALL MEMO — arguments', () => {
  it('compares NaN equal to NaN, and a NaN input still answers NaN', () => {
    const r = js(chainEngine(), ['Add', ['g', 'x'], ['f', 'x']]);
    const f = definitionOf(r.preamble, 'f');
    // The record test: `===`, else both NaN.
    expect(f).toContain('(x !== x && _fn_f$memo_k0 !== _fn_f$memo_k0)');
    expect(r.run({ x: NaN })).toBeNaN();
    expect(r.run({ x: 3 })).toBe(15);
  });

  it('does not answer f(-0) from a record of f(0)', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.box(['DefineFunction', 'inv', ['Function', ['Add', ['Divide', 1, 'x'], pad('x')], 'x']]).evaluate();
    ce.box(['DefineFunction', 'k', ['Function', ['Add', ['inv', 'x'], 1], 'x']]).evaluate();
    // `k(x) − inv(−x)`: at `x = 0` this is `inv(0) − inv(−0)` = `+∞ − (−∞)`.
    const r = js(ce, ['Subtract', ['k', 'x'], ['inv', ['Negate', 'x']]]);
    expect(definitionOf(r.preamble, 'inv')).toContain('1 / x === 1 / _fn_inv$memo_k0');
    expect(r.run({ x: 0 })).toBe(Infinity);
    expect(r.run({ x: 2 })).toBe(1.5 - -0.5);
  });

  it('still broadcasts a collection argument element-wise', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<number>');
    ce.box(['DefineFunction', 'f', ['Function', F_BODY, 'x']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['f', 'x'], 1], 'x']]).evaluate();
    const r = js(ce, ['List', ['f', 'xs'], ['g', 'xs']]);
    expect(definitionOf(r.preamble, 'f')).toContain('$memo');
    expect(r.run({ xs: [1, 2, 3] })).toEqual([
      [3, 5, 7],
      [4, 6, 8],
    ]);
  });

  it('bypasses the memo for an argument that is not a plain number', () => {
    // Every call site of a memoized definition is broadcast-aware (its
    // parameters are all scalar), so the wrapper meets an array or a
    // `{re, im}` record only through the bare direct call an explicitly
    // declared scalar symbol earns (`_fn_f(_.x)` with `run({ x: [1, 2] })`,
    // which the caller's declaration says cannot happen). The guard is
    // defensive; it is pinned by calling the emitted wrapper directly.
    const r = js(chainEngine(), ['Add', ['g', 'x'], ['f', 'x']]);
    expect(definitionOf(r.preamble, 'f')).toContain(
      "let _fn_f$memo_s = (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean');"
    );
    const fn = new Function('_SYS', `${r.preamble}\nreturn _fn_f;`)({}) as (
      x: unknown
    ) => unknown;
    expect(fn(3)).toBe(7);
    // ONE array object, mutated between two calls: the body runs on each
    // call (JavaScript concatenates `2 * [1, 2]`, NaN, with `1`), so a
    // recorded answer would have repeated the first value.
    const point = [1, 2];
    const first = fn(point);
    point[0] = 10;
    expect(fn(point)).toEqual(first);
    // The body ran on the array, not on a record made for `3`.
    expect(first).not.toBe(7);
    expect(fn({ re: 1, im: 2 })).not.toBe(7);
    expect(fn(3)).toBe(7);
  });
});

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

  it('a body that reaches `Random()` through an assigned symbol value', () => {
    // The skippability oracle stops at a symbol; the emission folds the
    // symbol's value into the body, so the draw is inline there.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.assign('r', ce.box(['Random']));
    ce.box(['DefineFunction', 'f', ['Function', ['Add', 'x', 'r', pad('x')], 'x']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['f', 'x'], 1], 'x']]).evaluate();
    const c = js(
      ce,
      ['WithRandomSeed', 42, ['Add', ['g', 'x'], ['f', 'x']]],
      { constantFold: false }
    );
    expect(definitionOf(c.preamble, 'f')).toContain('_SYS.drawNextRandomNumber()');
    expect(c.preamble).not.toContain('$memo');
    expect(c.run({ x: 1 })).toBeCloseTo(1 + draw(42, 0) + 1 + 1 + draw(42, 1), 12);
    expect(c.run({ x: 1 })).toBeCloseTo(
      ce.box(['WithRandomSeed', 42, ['Add', ['g', 1], ['f', 1]]]).N().re,
      12
    );
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

  it('a body that reads the vars object is memoized, keyed on that read', () => {
    const r = js(sliderEngine(), ['Add', ['g', 'x'], ['f', 'x']]);
    const f = definitionOf(r.preamble, 'f');
    expect(f).toContain('let _fn_f$memo_b0 = _.k;');
    expect(f).toContain("typeof _fn_f$memo_b0 === 'number'");
    expect(f).toContain('_fn_f$memo_k0 = x; _fn_f$memo_k1 = _fn_f$memo_b0;');
    expect(r.run({ x: 1, k: 10 })).toBe(12 + 11);
    expect(r.run({ x: 1, k: 20 })).toBe(22 + 21);
  });

  it('a slider moved between two calls of a spliced artifact misses the record', () => {
    const run = spliced(js(sliderEngine(), ['Add', ['g', 'x'], ['f', 'x']]));
    expect(run({ x: 1, k: 10 })).toBe(12 + 11);
    expect(run({ x: 1, k: 20 })).toBe(22 + 21);
    expect(run({ x: 1, k: 10 })).toBe(12 + 11);
  });

  it('a read made through a called definition joins the caller key too', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('k', 'number');
    ce.box(['DefineFunction', 'f', ['Function', ['Add', 'x', 'k'], 'x']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['f', 'x'], 1, pad('x')], 'x']]).evaluate();
    ce.box(['DefineFunction', 'h', ['Function', ['Multiply', ['g', 'x'], 2], 'x']]).evaluate();
    const r = js(ce, ['Add', ['h', 'x'], ['g', 'x']]);
    const g = definitionOf(r.preamble, 'g');
    // The only read of `k` in `g` is the key's: the body itself reads none.
    expect(g.split('_.k').length - 1).toBe(1);
    expect(g).toContain('let _fn_g$memo_b0 = _.k;');
    const run = spliced(r);
    expect(run({ x: 1, k: 10 })).toBe(24 + 12);
    expect(run({ x: 1, k: 20 })).toBe(44 + 22);
  });

  it('keys on the whole name of a read whose symbol carries a combining mark', () => {
    // `ce.box` reads a string with a combining mark as a string literal, so
    // the symbol is built directly.
    const ce = new ComputeEngine();
    ce.declare('x', 'number');
    ce.declare('q\u0307', 'number');
    const q = ce.symbol('q\u0307');
    expect(q.symbol).toBe('q\u0307');
    ce.box(['DefineFunction', 'f', ['Function', ['Add', 'x', q, pad('x')], 'x']]).evaluate();
    ce.box(['DefineFunction', 'g', ['Function', ['Add', ['f', 'x'], 1], 'x']]).evaluate();
    const r = js(ce, ['Add', ['g', 'x'], ['f', 'x']]);
    expect(definitionOf(r.preamble, 'f')).toContain('let _fn_f$memo_b0 = _.q\u0307;');
    const run = spliced(r);
    // `q` is present too and never changes: a key cut at the mark would hit.
    expect(run({ x: 1, 'q\u0307': 10, q: 99 })).toBe(12 + 11);
    expect(run({ x: 1, 'q\u0307': 20, q: 99 })).toBe(22 + 21);
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

// ---------------------------------------------------------------------------
// State and recursion
// ---------------------------------------------------------------------------

describe('LAST-CALL MEMO — state and recursion', () => {
  it('two compiled artifacts do not share a record', () => {
    const ce = chainEngine();
    const a = js(ce, ['Add', ['g', 'x'], ['f', 'x']]);
    const b = js(ce, ['Add', ['g', 'x'], ['f', 'x']]);
    // The record lives in the definition's own closure: no module-level name.
    expect(definitionOf(a.preamble, 'f')).toMatch(/^const _fn_f = \(\(\) => \{ let _fn_f\$memo_k0, _fn_f\$memo_v; return \(x\) => \{/);
    expect(a.run({ x: 1 })).toBe(4 + 3);
    expect(b.run({ x: 2 })).toBe(6 + 5);
    expect(a.run({ x: 1 })).toBe(4 + 3);
    expect(b.run({ x: 1 })).toBe(4 + 3);
  });

  it('a recursive definition stays correct', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.box([
      'DefineFunction',
      'fib',
      [
        'Function',
        ['Which', ['Less', 'n', 2], 'n', 'True', ['Add', ['fib', ['Subtract', 'n', 1]], ['fib', ['Subtract', 'n', 2]], pad('n')]],
        'n',
      ],
    ]).evaluate();
    ce.box(['DefineFunction', 'h', ['Function', ['Add', ['fib', 'n'], 1], 'n']]).evaluate();
    const r = js(ce, ['Add', ['h', 'n'], ['fib', 'n']]);
    expect(definitionOf(r.preamble, 'fib')).toContain('$memo');
    expect(r.run({ n: 10 })).toBe(55 + 1 + 55);
    expect(r.run({ n: 15 })).toBe(610 + 1 + 610);
    expect(r.run({ n: 1 })).toBe(1 + 1 + 1);
    expect(r.run({ n: 0 })).toBe(0 + 1 + 0);
  });
});
