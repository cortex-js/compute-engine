/**
 * Tests for Sum and Product compilation
 */

import { execFileSync } from 'node:child_process';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

const ce = new ComputeEngine();
ce.declare('m', 'real');
ce.declare('n', 'real');

/**
 * Extract the numeric interval {lo, hi} from an IntervalResult.
 * Handles both plain {lo, hi} and {kind: 'interval', value: {lo, hi}}.
 */
function unwrapInterval(val: unknown): { lo: number; hi: number } {
  if (val && typeof val === 'object') {
    if ('kind' in val && (val as any).kind === 'interval') {
      return (val as any).value;
    }
    if ('lo' in val && 'hi' in val) {
      return val as { lo: number; hi: number };
    }
  }
  throw new Error(`Expected interval result, got: ${JSON.stringify(val)}`);
}

describe('COMPILE Sum', () => {
  test('simple sum: sum_{k=0}^{3} k^2 = 0+1+4+9 = 14', () => {
    const expr = ce.parse('\\sum_{k=0}^{3} k^2');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(14);
  });

  test('sum with variable: sum_{k=0}^{2} k*x, x=3 => 0+3+6 = 9', () => {
    const expr = ce.parse('\\sum_{k=0}^{2} k \\cdot x');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 3 })).toBe(9);
  });

  test('single term: sum_{k=0}^{0} k^2 = 0', () => {
    const expr = ce.parse('\\sum_{k=0}^{0} k^2');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(0);
  });

  test('empty range: sum_{k=5}^{3} k = 0', () => {
    const expr = ce.parse('\\sum_{k=5}^{3} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(0);
  });

  test('Fourier-like: sum_{k=0}^{2} sin((2k+1)x)/(2k+1) at x=1', () => {
    const expr = ce.parse('\\sum_{k=0}^{2} \\frac{\\sin((2k+1)x)}{2k+1}');
    const result = compile(expr);
    expect(result.success).toBe(true);
    // sin(1)/1 + sin(3)/3 + sin(5)/5
    const expected = Math.sin(1) / 1 + Math.sin(3) / 3 + Math.sin(5) / 5;
    expect(result.run!({ x: 1 })).toBeCloseTo(expected, 10);
  });
});

describe('COMPILE Product', () => {
  test('factorial: prod_{k=1}^{4} k = 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{4} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(24);
  });

  test('product with variable: prod_{k=1}^{3} (x-k), x=5 => 4*3*2 = 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{3} (x - k)');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 5 })).toBe(24);
  });

  test('empty range product: prod_{k=5}^{3} k = 1', () => {
    const expr = ce.parse('\\prod_{k=5}^{3} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(1);
  });

  test('single term product: prod_{k=3}^{3} k = 3', () => {
    const expr = ce.parse('\\prod_{k=3}^{3} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(3);
  });
});

describe('COMPILE Sum - interval-js', () => {
  test('simple sum: sum_{k=0}^{3} k^2 = 14', () => {
    const expr = ce.parse('\\sum_{k=0}^{3} k^2');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBeCloseTo(14, 10);
    expect(val.hi).toBeCloseTo(14, 10);
  });

  test('sum with variable: sum_{k=0}^{2} k*x, x=3 => 9', () => {
    const expr = ce.parse('\\sum_{k=0}^{2} k \\cdot x');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ x: 3 }));
    expect(val.lo).toBeCloseTo(9, 10);
    expect(val.hi).toBeCloseTo(9, 10);
  });

  test('empty range: sum_{k=5}^{3} k = 0', () => {
    const expr = ce.parse('\\sum_{k=5}^{3} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBe(0);
    expect(val.hi).toBe(0);
  });
});

describe('COMPILE Sum - symbolic bounds', () => {
  test('JS: sum_{k=0}^{n} k with n=4 => 0+1+2+3+4 = 10', () => {
    const expr = ce.parse('\\sum_{k=0}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ n: 4 })).toBe(10);
  });

  test('JS: Taylor sin(x) = sum_{k=0}^{n} (-1)^k x^(2k+1)/(2k+1)!', () => {
    const expr = ce.parse('\\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}');
    const result = compile(expr);
    expect(result.success).toBe(true);
    const val = result.run!({ x: 0.5, n: 10 });
    expect(val).toBeCloseTo(Math.sin(0.5), 10);
  });

  test('JS: product with symbolic bound: prod_{k=1}^{n} k = n!', () => {
    const expr = ce.parse('\\prod_{k=1}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ n: 5 })).toBe(120);
    expect(result.run!({ n: 0 })).toBe(1); // empty range
  });

  test('interval-js: sum_{k=0}^{n} k with n=4 => 10', () => {
    const expr = ce.parse('\\sum_{k=0}^{n} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ n: 4 }));
    expect(val.lo).toBeCloseTo(10, 10);
    expect(val.hi).toBeCloseTo(10, 10);
  });

  test('interval-js: Taylor sin(x) with symbolic n', () => {
    const expr = ce.parse('\\sum_{k=0}^{n} \\frac{(-1)^k x^{2k+1}}{(2k+1)!}');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ x: 0.5, n: 10 }));
    expect(val.lo).toBeCloseTo(Math.sin(0.5), 10);
    expect(val.hi).toBeCloseTo(Math.sin(0.5), 10);
  });

  test('interval-js: product with symbolic bound: prod_{k=1}^{n} k', () => {
    const expr = ce.parse('\\prod_{k=1}^{n} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ n: 5 }));
    expect(val.lo).toBeCloseTo(120, 10);
    expect(val.hi).toBeCloseTo(120, 10);
  });

  // Symbolic LOWER bound tests
  test('JS: sum_{k=m}^{10} k with m=3 => 3+4+...+10 = 52', () => {
    const expr = ce.parse('\\sum_{k=m}^{10} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ m: 3 })).toBe(52);
  });

  test('JS: sum_{k=m}^{n} k with m=1 n=4 => 10', () => {
    const expr = ce.parse('\\sum_{k=m}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ m: 1, n: 4 })).toBe(10);
  });

  test('interval-js: sum_{k=m}^{10} k with m=3 => 52', () => {
    const expr = ce.parse('\\sum_{k=m}^{10} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ m: 3 }));
    expect(val.lo).toBeCloseTo(52, 10);
    expect(val.hi).toBeCloseTo(52, 10);
  });

  test('JS: prod_{k=m}^{5} k with m=3 => 3*4*5 = 60', () => {
    const expr = ce.parse('\\prod_{k=m}^{5} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ m: 3 })).toBe(60);
  });
});

describe('COMPILE Sum - a bound naming a library constant (Tycho item 176)', () => {
  // A user function's parameter shadows the engine, but the compile-time
  // constant fold for a big-op bound read the shadowed ENGINE symbol: with
  // `F(i) = Σ_{m=1..i} m` the bound `i` resolved to the imaginary unit
  // (`re` 0), so `lower 1 > upper 0` looked like an empty range and the whole
  // body folded to the identity — `_fn_F = (i) => 0` behind `success: true`,
  // against an interpreted `6`. A parameter named `e` picked up Euler's number
  // and summed two terms instead of three. Silent wrong data on the compiled
  // path, so the pin asserts VALUES, not just that it compiled.
  const build = (param: string) => {
    const engine = new ComputeEngine();
    engine.declare('F', '(number) -> number');
    engine.assign(
      'F',
      engine.expr(['Function', ['Sum', 'm', ['Limits', 'm', 1, param]], param])
    );
    return engine;
  };

  // `i` and `e` are the library constants that made this silent; the rest are
  // controls that were always correct.
  test.each(['i', 'e', 'k', 'n', 'x'])(
    'a parameter named `%s` sums 1..3 = 6',
    (param) => {
      const engine = build(param);
      const result = compile(engine.expr(['F', 3]));
      expect(result.success).toBe(true);
      expect(result.run!({})).toBe(6);
      // The compiled answer must agree with the interpreter.
      expect(engine.expr(['F', 3]).N().re).toBe(6);
    }
  );

  test('GPU: the emitted loop does not depend on the parameter name', () => {
    const strip = (param: string) =>
      compile(build(param).expr(['F', 3]), { to: 'glsl', constantFold: false })
        .preamble!.replace(new RegExp(`\\b${param}\\b`, 'g'), 'P')
        .replace(/\s+/g, ' ')
        .trim();
    // `i` used to emit `float _fn_F(float i) { return 0.0; }`.
    expect(strip('i')).toEqual(strip('k'));
    expect(strip('i')).toContain('for');
  });

  test('a bound naming a constant still folds when it is NOT shadowed', () => {
    // The guard must not blind the fold to a genuine constant bound: `e` here
    // is the engine's Euler number, not a parameter, so `Σ_{m=1..e} m` is the
    // 2-term sum 1 + 2.
    const engine = new ComputeEngine();
    const result = compile(engine.expr(['Sum', 'm', ['Limits', 'm', 1, 'e']]));
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(3);
  });
});

describe('COMPILE Sum - iterationBudget', () => {
  // The budget keeps a single compiled call cheap enough for the engine
  // deadline to be honored between calls on the numeric limit ladder (the
  // Stage-2 corpus-audit deadline escape: N() of a Limit at +∞ whose body
  // contains a variable-bound Sum ran unbounded past the evaluation deadline).
  test('within budget: normal result', () => {
    const expr = ce.parse('\\sum_{k=1}^{n} k');
    const result = compile(expr, { iterationBudget: 1e6 });
    expect(result.success).toBe(true);
    expect(result.run!({ n: 4 })).toBe(10);
  });

  test('over budget: NaN instead of running the loop', () => {
    const expr = ce.parse('\\sum_{k=1}^{n} k');
    const result = compile(expr, { iterationBudget: 1e6 });
    expect(result.success).toBe(true);
    expect(result.run!({ n: 1e12 })).toBeNaN();
  });

  test('infinite bound: NaN instead of a non-terminating loop', () => {
    const expr = ce.parse('\\sum_{k=1}^{\\infty} \\frac{1}{k^2}');
    const result = compile(expr, {
      iterationBudget: 1e6,
      constantFold: false,
    });
    expect(result.success).toBe(true);
    expect(result.run!({})).toBeNaN();
  });

  test('no budget: loops of any length run (unchanged public behavior)', () => {
    const expr = ce.parse('\\sum_{k=1}^{n} k');
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ n: 2e6 })).toBe((2e6 * (2e6 + 1)) / 2);
  });
});

describe('COMPILE Product - interval-js', () => {
  test('factorial: prod_{k=1}^{4} k = 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{4} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBeCloseTo(24, 10);
    expect(val.hi).toBeCloseTo(24, 10);
  });

  test('product with variable: prod_{k=1}^{3} (x-k), x=5 => 24', () => {
    const expr = ce.parse('\\prod_{k=1}^{3} (x - k)');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!({ x: 5 }));
    expect(val.lo).toBeCloseTo(24, 10);
    expect(val.hi).toBeCloseTo(24, 10);
  });

  test('empty range product: prod_{k=5}^{3} k = 1', () => {
    const expr = ce.parse('\\prod_{k=5}^{3} k');
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const val = unwrapInterval(result.run!());
    expect(val.lo).toBe(1);
    expect(val.hi).toBe(1);
  });
});

// Regression: WP-2.8 / P0-43 — multi-index Sum/Product must honor *every*
// indexing-set clause. Previously only the first Limits clause was read,
// leaving the trailing indices dangling (`_.j` undefined → NaN) while the
// result still reported success and an empty freeSymbols set.
describe('COMPILE Sum/Product - multi-index (P0-43 regression)', () => {
  const engine = new ComputeEngine();

  test('JS: double-index sum ∑_{i=1}^{3} ∑_{j=1}^{3} i·j = 36', () => {
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 3],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(36);
    // No dangling free symbol — all indices are bound.
    expect(result.freeSymbols).toEqual([]);
  });

  test('JS: triple-index sum ∑∑∑ i·j·k over 1..2 = 27', () => {
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', ['Multiply', 'j', 'k']],
      ['Limits', 'i', 1, 2],
      ['Limits', 'j', 1, 2],
      ['Limits', 'k', 1, 2],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(27);
  });

  test('JS: double-index product ∏_{i=1}^{2} ∏_{j=1}^{2} (i+j) = 72', () => {
    const expr = engine.box([
      'Product',
      ['Add', 'i', 'j'],
      ['Limits', 'i', 1, 2],
      ['Limits', 'j', 1, 2],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(72);
  });

  test('JS: multi-index with a large outer (loop) range nests correctly', () => {
    // Outer range exceeds the unroll limit → outer while-loop, inner unroll.
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 150],
      ['Limits', 'j', 1, 3],
    ]);
    const result = compile(expr);
    expect(result.success).toBe(true);
    // (∑_{1..150} i)·(∑_{1..3} j) = 11325·6 = 67950
    expect(result.run!({})).toBe(67950);
  });

  test('GPU: multi-index Sum fails closed (not silently wrong)', () => {
    const expr = engine.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 3],
    ]);
    const result = compile(expr, { to: 'glsl', constantFold: false });
    expect(result.success).toBe(false);
  });
});

// Collection form: `Sum(collection)` / `Product(collection)` with no indexing
// set — what `[…].total` (→ Sum) and a bare list product canonicalize to. These
// used to throw `… : no indexing set`, dropping the whole compile to
// interpretation (Tycho item 11: `.total` inside a compiled comprehension body).
// `Max`/`Min` over a collection used to compile to `Math.max([…])` → NaN.
describe('COMPILE Sum/Product/Max/Min - collection form', () => {
  const engine = new ComputeEngine();
  engine.declare('V', engine.type('list<number>'));

  const jsRun = (mathjson: any, vars: any = {}) => {
    const r = compile(engine.box(mathjson));
    expect(r.success).toBe(true);
    return r.run!(vars);
  };

  test('Sum(collection) reduces (empty → 0)', () => {
    expect(jsRun(['Sum', 'V'], { V: [3, 4, 5] })).toBe(12);
    expect(jsRun(['Sum', 'V'], { V: [] })).toBe(0);
  });

  test('Product(collection) reduces (empty → 1)', () => {
    expect(jsRun(['Product', 'V'], { V: [3, 4, 5] })).toBe(60);
    expect(jsRun(['Product', 'V'], { V: [] })).toBe(1);
  });

  test('Max/Min(collection) reduce (empty → NaN, interpreter parity)', () => {
    expect(jsRun(['Max', 'V'], { V: [3, 9, 2] })).toBe(9);
    expect(jsRun(['Min', 'V'], { V: [3, 9, 2] })).toBe(2);
    // Missing-value typing (§3.C, amended 2026-07-24): an empty input is `NaN`,
    // matching the interpreter (was `∓∞` from the identity-seed reduce).
    expect(jsRun(['Max', 'V'], { V: [] })).toBeNaN();
    expect(jsRun(['Min', 'V'], { V: [] })).toBeNaN();
  });

  test('Max/Min scalar variadic form is unchanged', () => {
    expect(jsRun(['Max', 1, 7, 3])).toBe(7);
    expect(jsRun(['Min', 1, 7, 3])).toBe(1);
  });

  test('`.total` over a list literal compiles', () => {
    const r = compile(engine.parse('[1,2,3,4].\\operatorname{total}'));
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(10);
  });

  test('`.total` inside a compiled comprehension body (item 11)', () => {
    engine.declare('P', engine.type('list<number>'));
    const r = compile(
      engine.parse(
        '\\left[([P[n],P[n]]).\\operatorname{total} \\operatorname{for} n=\\left[1...3\\right]\\right]'
      )
    );
    expect(r.success).toBe(true);
    // `[body \operatorname{for} n=…]` is the comprehension itself — NOT a
    // one-element `List` wrapping it — so the result is the flat list of
    // per-element totals, not a singleton `[[…]]`.
    expect(r.run!({ P: [10, 20, 30] })).toEqual([20, 40, 60]);
  });

  test('indexing-set (range) form is unaffected', () => {
    const r = compile(engine.parse('\\sum_{n=1}^{5} n'));
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(15);
  });

  test('non-collection operand still fails closed', () => {
    engine.declare('s', engine.type('number'));
    // Sum of a bare scalar has neither an indexing set nor a collection
    // operand: it still fails closed (throws with fallback disabled).
    expect(() =>
      compile(engine.box(['Sum', 's']), { fallback: false })
    ).toThrow('no indexing set');
  });
});

describe('COMPILE Integrate - symbolic bounds', () => {
  test('JS: int_0^a x dx with a=2 => 2', () => {
    const expr = ce.parse('\\int_0^a x \\, dx');
    const result = compile(expr);
    expect(result.success).toBe(true);
    // int_0^2 x dx = x^2/2 |_0^2 = 2
    const val = result.run!({ a: 2 });
    expect(val).toBeCloseTo(2, 1);
  });

  test('JS: int_a^b x dx with a=0 b=1 => 0.5', () => {
    const expr = ce.parse('\\int_a^b x \\, dx');
    const result = compile(expr);
    expect(result.success).toBe(true);
    const val = result.run!({ a: 0, b: 1 });
    expect(val).toBeCloseTo(0.5, 1);
  });
});

describe('COMPILE SUM/PRODUCT: THE INDEX IS A REAL COUNTER', () => {
  // A `Block` declares a complex local `n`, and a `Sum`/`Product` inside it
  // binds its own index `n`. Each term must read the index as the integer
  // counter, not as the outer complex local: reading it as complex emitted
  // `n²` as `{re, im}` arithmetic on an integer, and the sum concatenated the
  // terms as strings.
  const inBlock = (body: unknown): unknown => [
    'Block',
    ['Declare', 'n'],
    ['Assign', 'n', ['Add', 'x', 'ImaginaryUnit']],
    ['Add', ['Abs', 'n'], body],
  ];
  const cases: [string, unknown][] = [
    [
      'loop form: Sum(n^2, n = 1..m)',
      inBlock(['Sum', ['Power', 'n', 2], ['Limits', 'n', 1, 'm']]),
    ],
    [
      'unrolled form: Sum(n^2, n = 1..3)',
      inBlock(['Sum', ['Power', 'n', 2], ['Limits', 'n', 1, 3]]),
    ],
    [
      'complex body: |Product(x + i·n, n = 1..m)|',
      inBlock([
        'Abs',
        [
          'Product',
          ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'n']],
          ['Limits', 'n', 1, 'm'],
        ],
      ]),
    ],
  ];
  for (const [name, json] of cases)
    test(`JS: ${name} runs to the interpreter's value`, () => {
      const engine = new ComputeEngine();
      engine.declare('x', 'real');
      engine.declare('m', 'integer');
      const result = compile(engine.box(json as any));
      expect(result.success).toBe(true);
      const value = result.run!({ x: 0.5, m: 3 });
      expect(typeof value).toBe('number');

      const interpreter = new ComputeEngine();
      interpreter.assign('x', 0.5);
      interpreter.assign('m', 3);
      const expected = interpreter.box(json as any).N();
      expect(expected.im).toBe(0);
      expect(value).toBeCloseTo(expected.re, 12);
    });
});

describe('COMPILE SUM/PRODUCT: A BODY THAT WRITES THE INDEX', () => {
  // The interpreter binds the index to its next value at each iteration,
  // whatever the body wrote: `Σ_{j=1}^{4} (j ≔ j + 1; j)` is 2 + 3 + 4 + 5 =
  // 14. A compiled loop that steps the written variable skips iterations (6
  // here) or does not end, so every target declines such a body, and the
  // fallback evaluates it with the interpreter.
  const I = "'integer'";
  const inc = (index: string, step: unknown = 1): unknown => [
    'Block',
    ['Assign', index, ['Add', index, step]],
    index,
  ];
  const fn = (body: unknown, ...limits: unknown[]): unknown => [
    'Function',
    ['Sum', body, ...limits],
    ['Typed', 'n', I],
  ];

  const CASES: [string, unknown, string][] = [
    ['a Sum', ['Sum', inc('j'), ['Limits', 'j', 1, 'n']], 'j'],
    ['a Product', ['Product', inc('j'), ['Limits', 'j', 1, 'n']], 'j'],
    ['constant bounds', ['Sum', inc('j'), ['Limits', 'j', 1, 4]], 'j'],
    [
      'an index with a reserved name',
      ['Sum', inc('Math'), ['Limits', 'Math', 1, 4]],
      'Math',
    ],
    [
      'a write to the outer index of two clauses',
      [
        'Sum',
        ['Block', ['Assign', 'j', ['Add', 'j', 10]], ['Add', 'j', 'k']],
        ['Limits', 'j', 1, 'n'],
        ['Limits', 'k', 1, 3],
      ],
      'j',
    ],
    [
      'a write to the inner index of two clauses',
      [
        'Sum',
        [
          'Block',
          ['Assign', 'k', ['Add', 'k', 10]],
          ['Add', ['Multiply', 100, 'j'], 'k'],
        ],
        ['Limits', 'j', 1, 'n'],
        ['Limits', 'k', 1, 3],
      ],
      'k',
    ],
  ];

  const engine = (): ComputeEngine => {
    const result = new ComputeEngine();
    result.declare('n', 'integer');
    return result;
  };

  test.each(
    ['javascript', 'interval-js', 'python', 'glsl', 'wgsl'].flatMap((to) =>
      CASES.map(([name, json, index]) => [to, name, json, index] as const)
    )
  )('%s declines %s', (to, _name, json, index) => {
    // A target declines either by throwing or with `success: false`.
    let error: string | undefined;
    try {
      const result = compile(engine().box(json as any), {
        to: to as never,
        fallback: false,
      });
      expect(result.success).toBe(false);
      error = result.error;
    } catch (err) {
      error = String(err);
    }
    expect(error).toContain(`the body writes the index \`${index}\``);
  });

  test('a target with no Sum lowering of its own (the generic loop) declines', () => {
    const target: any = {
      language: 'custom',
      operators: (op: string) =>
        op === 'Add' ? ['+', 11] : op === 'Multiply' ? ['*', 12] : undefined,
      functions: () => undefined,
      var: (id: string) => id,
      string: (s: string) => JSON.stringify(s),
      number: (x: number) => String(x),
      indent: 0,
      ws: () => ' ',
      preamble: '',
    };
    expect(() =>
      compile(ce.box(['Sum', inc('j'), ['Limits', 'j', 1, 4]] as any), {
        target,
        fallback: false,
      })
    ).toThrow('the body writes the index `j`');
  });

  test('JS: the fallback gives the interpreter value', () => {
    const f = fn(inc('j'), ['Limits', 'j', 1, 'n']);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(ce.box(f as any), { to: 'javascript' });
      expect(result.success).toBe(false);
      expect(result.run!(4 as never)).toBe(14);
    } finally {
      warn.mockRestore();
    }
  });

  test('a write to another variable compiles', () => {
    const result = compile(
      engine().box([
        'Sum',
        ['Block', ['Declare', 't', I], ['Assign', 't', ['Add', 'j', 1]], 't'],
        ['Limits', 'j', 1, 'n'],
      ] as any),
      { to: 'javascript', fallback: false }
    );
    expect(result.success).toBe(true);
    expect(result.run!({ n: 4 } as never)).toBe(14);
  });
});

describe('COMPILE SUM/PRODUCT: A BOUND THAT READS A VARIABLE WITH THE NAME OF THE INDEX', () => {
  // A bound is evaluated before the index is bound: in
  // `Function(Sum(j, Limits(j, 1, j + 2)), j)` the upper bound reads the
  // parameter `j`. The JavaScript loop declared its counter with the name of
  // the index in the scope where it evaluated the bounds, so the upper bound
  // read the counter (6, not 10) and the lower bound threw a
  // `ReferenceError`. The loop now steps a separate counter, and only the
  // loop body declares the index.
  const I = "'integer'";
  const fn = (op: string, body: unknown, ...limits: unknown[]): unknown => [
    'Function',
    [op, body, ...limits],
    ['Typed', 'j', I],
  ];
  const block = (op: string, body: unknown, ...limits: unknown[]): unknown => [
    'Block',
    ['Declare', 'j', I],
    ['Assign', 'j', 2],
    [op, body, ...limits],
  ];

  const FUNCTION_CASES: [string, unknown, number][] = [
    ['an upper bound', fn('Sum', 'j', ['Limits', 'j', 1, ['Add', 'j', 2]]), 10],
    ['a lower bound', fn('Sum', 'j', ['Limits', 'j', 'j', 5]), 14],
    ['both bounds', fn('Sum', 'j', ['Limits', 'j', 'j', ['Add', 'j', 2]]), 9],
    ['a Product', fn('Product', 'j', ['Limits', 'j', 'j', 5]), 120],
    [
      'an inner clause',
      fn('Sum', ['Add', 'k', 'j'], ['Limits', 'k', 1, 2], ['Limits', 'j', 1, 'j']),
      12,
    ],
    [
      'a complex body',
      fn('Sum', ['Sqrt', ['Negate', 'j']], ['Limits', 'j', 'j', 4]),
      NaN,
    ],
  ];

  test.each(FUNCTION_CASES)('JS: %s', (_name, f, expected) => {
    const result = compile(ce.box(f as any), { to: 'javascript' });
    expect(result.success).toBe(true);
    const value = result.run!(2 as never) as number | { re: number; im: number };
    const reference = new ComputeEngine().box(['Apply', f, 2] as any).N();
    if (typeof value === 'number') {
      expect(reference.im).toBe(0);
      expect(reference.re).toBe(expected);
      expect(value).toBe(reference.re);
    } else {
      expect(value.re).toBeCloseTo(reference.re, 10);
      expect(value.im).toBeCloseTo(reference.im, 10);
      expect(value.im).toBeCloseTo(Math.SQRT2 + Math.sqrt(3) + 2, 10);
    }
  });

  test.each([
    ['a lower bound', block('Sum', 'j', ['Limits', 'j', 'j', 5]), 14],
    ['an upper bound', block('Sum', 'j', ['Limits', 'j', 1, 'j']), 3],
    [
      'a list body',
      block('Sum', ['Multiply', 'j', ['List', 1, 2]], ['Limits', 'j', 'j', 4]),
      [9, 18],
    ],
  ] as const)('JS: a local of a Block, %s', (_name, expr, expected) => {
    const result = compile(ce.box(expr as any), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run!({} as never)).toEqual(expected);
    const reference = ce.box(expr as any).evaluate();
    expect(reference.json).toEqual(
      typeof expected === 'number' ? expected : ['List', ...expected]
    );
  });

  test('JS: the loop steps a counter, and the body declares the index', () => {
    const result = compile(
      ce.box(fn('Sum', 'j', ['Limits', 'j', 'j', 5]) as any),
      { to: 'javascript' }
    );
    expect(result.code).toMatch(
      /let (_tv\d+) = Math\.floor\(j\);.*while \(\1 <= _upper\) \{ let j = \1; /
    );
  });

  // The upper bound is bound to a local ahead of the loop, outside the scope
  // of the counter: in the loop condition, `j` reads the integer counter.
  const runShader = (code: string): number =>
    // eslint-disable-next-line no-new-func
    new Function(
      'const floor = Math.floor, int = Math.trunc, i32 = Math.trunc, ' +
        'float = Number, f32 = Number;\n' +
        code
          .replace(/^(\s*)(?:float|int) (\w+)(;| =)/gm, '$1let $2$3')
          .replace(/^(\s*)(?:var|let) (\w+): \w+(;| =)/gm, '$1let $2$3')
          .replace(/for \((?:int|var) (\w+)(?:: i32)? =/g, 'for (let $1 =')
    )();
  test.each([
    ['glsl', 'Sum', 'j', 3],
    ['glsl', 'Sum', ['Add', 'j', 2], 10],
    ['glsl', 'Product', 'j', 2],
    ['wgsl', 'Sum', 'j', 3],
    ['wgsl', 'Product', ['Add', 'j', 2], 24],
  ] as const)('%s: %s, upper bound %j', (to, op, hi, v) => {
    const expr = block(op, 'j', ['Limits', 'j', 1, hi]);
    expect(ce.box(expr as any).evaluate().re).toBe(v);
    const result = compile(ce.box(expr as any), { to, fallback: false });
    expect(result.success).toBe(true);
    const code = result.code as string;
    expect(code).toMatch(/j <= _tv\d+;/);
    expect(runShader(code)).toBe(v);
  });

  // In a generator expression, Python evaluates the `range` of a later
  // `for` clause in the scope of the generator, where the variable of every
  // clause is a local: a later clause takes a fresh index name.
  (TEST_PYTHON === undefined ? it.skip : it)(
    'Python: the generator and the loop form give the interpreter value',
    () => {
      const cases: unknown[] = [
        block('Sum', 'j', ['Limits', 'j', 'j', 5]),
        block('Sum', 'j', ['Limits', 'j', 1, ['Add', 'j', 2]]),
        block('Sum', ['Add', 'k', 'j'], ['Limits', 'k', 1, 3], ['Limits', 'j', 1, 'j']),
        block(
          'Product',
          ['Add', 'k', 'j'],
          ['Limits', 'k', 1, 2],
          ['Limits', 'j', 'k', 'j']
        ),
      ];
      const py = new PythonTarget();
      let program = 'import math\nout = []\n';
      cases.forEach((json, i) => {
        const code = py.compile(ce.box(json as any)).code as string;
        const body = code
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n');
        program += `def f${i}():\n${body}\nout.append(f${i}())\n`;
      });
      program += 'print(out)\n';
      const out = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      ) as number[];
      expect(out).toEqual(cases.map((json) => ce.box(json as any).evaluate().re));
    }
  );
});

describe('COMPILE SUM/PRODUCT: A BOUND THAT IS NOT PURE', () => {
  // The interpreter does not evaluate a big operator over a bound that is
  // not pure: `Sum(j, Limits(j, 1, Random(Range(2, 3))))` stays unevaluated
  // (`bigopBoundValue()` in `library/utils.ts`). Each target declines it.
  const exprs = [
    ['Sum', 'j', ['Limits', 'j', 1, ['Random', ['Range', 2, 3]]]],
    ['Product', 'j', ['Limits', 'j', ['Random', ['Range', 1, 2]], 3]],
  ];
  test.each(exprs.map((e) => [JSON.stringify(e), e]))(
    'the interpreter keeps %s unevaluated',
    (_name, e) => {
      const value = ce.box(e as any).evaluate();
      expect(value.operator).toBe((e as unknown[])[0]);
    }
  );
  test.each(
    ['javascript', 'interval-js', 'python', 'glsl', 'wgsl'].flatMap((to) =>
      exprs.map((e) => [to, JSON.stringify(e), e] as const)
    )
  )('%s declines %s', (to, _name, e) => {
    // A target declines either by throwing or with `success: false`.
    let success = true;
    try {
      success = compile(ce.box(e as any), {
        to: to as never,
        fallback: false,
      }).success;
    } catch (err) {
      expect(String(err)).toMatch(/has an effect/);
      success = false;
    }
    expect(success).toBe(false);
  });

  // A call of a function with no definition at compile time has unknown
  // effects, so `isPure` is false. The compilation does not refuse it: the
  // interpreter evaluates the bound once the function has a value. Only a
  // known effect is refused.
  test('JS: a call of a declared function with no definition compiles', () => {
    const engine = new ComputeEngine();
    engine.declare('h', '(integer) -> integer');
    const expr = engine.box(['Sum', 'j', ['Limits', 'j', 1, ['h', 2]]] as any);
    expect(expr.isPure).toBe(false);
    const result = compile(expr, {
      to: 'javascript',
      fallback: false,
      functions: { h: (x: number) => x + 1 },
    } as never);
    expect(result.success).toBe(true);
    const reference = new ComputeEngine();
    reference.declare('h', '(integer) -> integer');
    reference.assign('h', reference.box(['Function', ['Add', 'x', 1], 'x']));
    const expected = reference
      .box(['Sum', 'j', ['Limits', 'j', 1, ['h', 2]]] as any)
      .evaluate().re;
    expect(expected).toBe(6);
    expect(result.run!({} as never)).toBe(expected);
  });

  test('JS: a call of a function declared not pure declines', () => {
    const engine = new ComputeEngine();
    engine.declare('g', {
      signature: '(integer) -> integer',
      pure: false,
      evaluate: ([x]) => x,
    } as never);
    const expr = engine.box(['Sum', 'j', ['Limits', 'j', 1, ['g', 2]]] as any);
    expect(expr.evaluate().operator).toBe('Sum');
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false })
    ).toThrow(/upper bound `g\(2\)` has an effect/);
  });

  // A declared type that states the effect `any` is a contract: the call is
  // not pure, even with a pure function value assigned, so the interpreter
  // leaves the `Sum` unevaluated.
  test('JS: a call of a function whose type states the effect `any` declines', () => {
    const engine = new ComputeEngine();
    engine.declare('h', { type: '(integer) any -> integer' });
    engine.assign('h', engine.box(['Function', ['Add', 'x', 1], 'x']));
    const expr = engine.box(['Sum', 'j', ['Limits', 'j', 1, ['h', 2]]] as any);
    expect(expr.evaluate().operator).toBe('Sum');
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false })
    ).toThrow(/upper bound `h\(2\)` has an effect/);
  });
});
