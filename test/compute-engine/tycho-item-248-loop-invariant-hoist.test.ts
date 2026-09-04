/**
 * Tycho item 248: on the `javascript` target, a loop-invariant subexpression
 * of a `Sum`/`Product` loop body or a `Comprehension` body — a reduction over
 * a list that does not depend on the index (`Min(P)`, `Max(P)`, `Length(P)`),
 * or a list-valued operand expression (`(1 − v)·P_0 + v·P_1`) — was
 * re-emitted inside the loop body and re-run on every iteration, so the run
 * was quadratic in the list length (a 10 000-element histogram row took 25 s
 * of emitted-JavaScript time, and its interpolated twin did not finish).
 *
 * Three mechanisms, all pinned here on the emitted code's SHAPE (a timing
 * assertion is meaningless under worker contention; a `while` body that
 * contains no reduction and no broadcast IS the linearity):
 *
 * 1. The loop-form `Sum`/`Product` and the `Comprehension` hoist the
 *    invariant subexpressions of the body out of the loop
 *    (`BaseCompiler.hoistLoopInvariants`, which the UNROLLED binders already
 *    used for collection-valued subexpressions; it now also binds
 *    reductions, and invariant nested binders whole). A `Sum` binds them
 *    before its `while`, behind an empty-range return; a `Comprehension`
 *    initializes them on the first iteration — a body that never ran must
 *    not have its subexpressions evaluated.
 * 2. A node in a conditionally-evaluated position (a `Which` arm, the second
 *    operand of `And`) with the same structure as a hoisted node references
 *    the hoisted binding: the binding was computed unconditionally anyway.
 * 3. A CSE temporary an ENCLOSING region instance has already bound is
 *    reused inside a binder body or a conditional arm instead of being
 *    recomputed there (`BaseCompiler.availableCseBinding`), and the
 *    `Comprehension` body is now wired through its harvested CSE region
 *    (it compiled under a blind instance before).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('P', 'list<number>');
ce.declare('Q', 'list<number>');
ce.declare('v', 'number');
ce.declare('m', 'integer');

function js(expr: Expression, options: Record<string, unknown> = {}) {
  const r = compile(expr, { to: 'javascript', ...options }) as any;
  if (!r.success) throw new Error(`declined: ${String(r.error)}`);
  return r as { code: string; run: (vars: Record<string, unknown>) => any };
}

/** The bodies of every `while (…) { … }` loop in `code`, outermost first.
 * A loop body that contains no reduction (`reduce(`) and no broadcast
 * (`_SYS.bcast(`) runs O(1) work per iteration. */
function whileBodies(code: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const w = code.indexOf('while (', at);
    if (w < 0) return out;
    const open = code.indexOf('{', w);
    let depth = 0;
    let i = open;
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) break;
    }
    out.push(code.slice(open + 1, i));
    at = open + 1;
  }
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

/** The interpreter's answer for `expr` with the given values, as a plain JS
 * value, to compare against the compiled run. */
function interpret(expr: Expression, values: Record<string, unknown>) {
  const boxed: Record<string, Expression> = {};
  for (const [k, v] of Object.entries(values))
    boxed[k] = ce.box(Array.isArray(v) ? ['List', ...v] : (v as any));
  return expr.subs(boxed).evaluate().valueOf();
}

describe('Tycho item 248 — loop-form Sum', () => {
  const P = [3, 1, 2, 5];

  it('computes a reduction over an invariant list once, before the loop', () => {
    // Σ_{j=1}^{|P|} (Min(P) + P_j)
    const expr = ce.box([
      'Sum',
      ['Add', ['Min', 'P'], ['At', 'P', 'j']],
      ['Limits', 'j', 1, ['Length', 'P']],
    ]);
    const { code, run } = js(expr);
    expect(count(code, 'reduce(')).toBe(1);
    const [body] = whileBodies(code);
    expect(body).not.toContain('reduce(');
    // The binding sits behind the empty-range return, after the loop-entry
    // guard.
    expect(code).toMatch(/if \(!\(j <= _upper\)\) return 0; const _tv\d+ = /);
    expect(run({ P })).toBe(4 * 1 + 11);
    expect(run({ P })).toBe(interpret(expr, { P }));
  });

  it('builds a list-valued operand expression once, before the loop', () => {
    // Σ_{j=1}^{|P|} At((1 − v)·P + v·Q, j), with Min/Max of the same list
    const list = [
      'Add',
      ['Multiply', ['Subtract', 1, 'v'], 'P'],
      ['Multiply', 'v', 'Q'],
    ];
    const expr = ce.box([
      'Sum',
      [
        'Add',
        ['At', list, 'j'],
        ['Multiply', ['Min', list], ['Max', list]],
      ],
      ['Limits', 'j', 1, ['Length', list]],
    ]);
    const { code, run } = js(expr);
    const [body] = whileBodies(code);
    expect(body).not.toContain('_SYS.bcast(');
    expect(body).not.toContain('reduce(');
    // The body's list is built once (three broadcasts: two scalings and the
    // sum) and both reductions read the binding — the list's class is
    // recorded before its consumers (dependency order). The upper bound's
    // own `Length(list)` is compiled before the loop's hoist and builds the
    // list a second time, once per loop entry.
    expect(count(code, '_SYS.bcast(')).toBe(6);
    const Q = [10, 20, 30, 40];
    const v = 0.25;
    const mixed = P.map((p, i) => 0.75 * p + 0.25 * Q[i]);
    const expected =
      mixed.reduce((a, b) => a + b, 0) +
      mixed.length * Math.min(...mixed) * Math.max(...mixed);
    expect(run({ P, Q, v })).toBeCloseTo(expected, 10);
    expect(run({ P, Q, v })).toBeCloseTo(
      interpret(expr, { P, Q, v }) as number,
      10
    );
  });

  it('a subexpression that mentions the index stays in the loop', () => {
    const expr = ce.box([
      'Sum',
      ['Multiply', ['At', 'P', 'j'], ['Length', 'P']],
      ['Limits', 'j', 1, ['Length', 'P']],
    ]);
    const { code, run } = js(expr);
    const [body] = whileBodies(code);
    expect(body).toContain('_SYS.at(');
    expect(run({ P })).toBe(11 * 4);
  });

  it('an empty range answers the identity without evaluating the bindings', () => {
    // Σ_{j=1}^{m} (Min(P) + P_j) with m = 0 at run time. `P` is empty too, so
    // an evaluated `Min(P)` would be NaN — the identity proves it was not.
    const expr = ce.box([
      'Sum',
      ['Add', ['Min', 'P'], ['At', 'P', 'j']],
      ['Limits', 'j', 1, 'm'],
    ]);
    const { code, run } = js(expr);
    expect(code).toContain('if (!(j <= _upper)) return 0; const');
    expect(run({ P: [], m: 0 })).toBe(0);
    expect(run({ P: [4, 6], m: 2 })).toBe(4 + 4 + 4 + 6);
  });

  it('the Product form hoists too, with its own identity', () => {
    const expr = ce.box([
      'Product',
      ['Add', ['Max', 'P'], ['At', 'P', 'j']],
      ['Limits', 'j', 1, 'm'],
    ]);
    const { code, run } = js(expr);
    expect(code).toContain('if (!(j <= _upper)) return 1; const');
    expect(whileBodies(code)[0]).not.toContain('reduce(');
    expect(run({ P: [], m: 0 })).toBe(1);
    expect(run({ P: [1, 2], m: 2 })).toBe((2 + 1) * (2 + 2));
  });

  it('a node in a lazy position with the structure of a hoisted node reads the binding', () => {
    // Min(P) is unconditional in the first comparison and conditional in
    // the second (`And` short-circuits); both read one binding.
    const expr = ce.box([
      'Sum',
      [
        'Which',
        [
          'And',
          ['LessEqual', ['Min', 'P'], ['At', 'P', 'j']],
          ['Less', ['At', 'P', 'j'], ['Add', ['Min', 'P'], 2]],
        ],
        1,
        'True',
        0,
      ],
      ['Limits', 'j', 1, ['Length', 'P']],
    ]);
    const { code, run } = js(expr);
    expect(count(code, 'Math.min(')).toBe(1);
    expect(whileBodies(code)[0]).not.toContain('reduce(');
    // P = [3,1,2,5], Min = 1: elements in [1, 3) are 1 and 2.
    expect(run({ P })).toBe(2);
    expect(run({ P })).toBe(interpret(expr, { P }));
  });

  it('a multi-clause Sum hoists at the innermost clause only, once per outer iteration', () => {
    // Σ_{i=1}^{200} Σ_{j=1}^{m} (Min(P) + P_j): the inner range may be empty
    // while the outer is not, so the binding must sit inside the outer loop,
    // behind the INNER clause's empty-range return.
    const expr = ce.box([
      'Sum',
      ['Add', ['Min', 'P'], ['At', 'P', 'j']],
      ['Limits', 'i', 1, 200],
      ['Limits', 'j', 1, 'm'],
    ]);
    const { code, run } = js(expr);
    expect(code.indexOf('reduce(')).toBeGreaterThan(code.indexOf('while ('));
    expect(code).toContain('if (!(j <= _upper)) return 0; const');
    const [outer, inner] = whileBodies(code);
    expect(outer).toContain('reduce(');
    expect(inner).not.toContain('reduce(');
    expect(run({ P: [], m: 0 })).toBe(0);
    expect(run({ P: [4, 6], m: 2 })).toBe(200 * (4 + 4 + 4 + 6));
  });

  it('`cse: false` turns the hoist off', () => {
    const expr = ce.box([
      'Sum',
      ['Add', ['Min', 'P'], ['At', 'P', 'j']],
      ['Limits', 'j', 1, ['Length', 'P']],
    ]);
    const { code, run } = js(expr, { cse: false });
    expect(whileBodies(code)[0]).toContain('reduce(');
    expect(run({ P })).toBe(15);
  });
});

describe('Tycho item 248 — Comprehension', () => {
  const P = [3, 1, 2, 5];

  it('initializes the invariant bindings on the first iteration', () => {
    // [Min(P) + k for k in 1..3]
    const expr = ce.box([
      'Comprehension',
      ['Add', ['Min', 'P'], 'k'],
      ['Element', 'k', ['Range', 1, 3]],
    ]);
    const { code, run } = js(expr);
    expect(count(code, 'reduce(')).toBe(1);
    expect(code).toMatch(
      /let (_tv\d+) = false; let _tv\d+; for \(const k of .*?\) \{ if \(!\1\) \{ \1 = true; /
    );
    expect(run({ P })).toEqual([2, 3, 4]);
  });

  it('an empty source yields an empty list', () => {
    const expr = ce.box([
      'Comprehension',
      ['Add', ['Min', 'P'], 'k'],
      ['Element', 'k', 'Q'],
    ]);
    const { run } = js(expr);
    expect(run({ P: [], Q: [] })).toEqual([]);
    expect(run({ P, Q: [10, 20] })).toEqual([11, 21]);
  });

  it('a multi-clause comprehension initializes the bindings in the innermost loop', () => {
    // [Min(P) + a + b for a in A for b in B]: B may be empty while A is
    // not, so the first-iteration prelude belongs to the innermost loop.
    ce.declare('A', 'list<number>');
    ce.declare('B', 'list<number>');
    const expr = ce.box([
      'Comprehension',
      ['Add', ['Min', 'P'], 'a', 'b'],
      ['Element', 'a', 'A'],
      ['Element', 'b', 'B'],
    ]);
    const { code, run } = js(expr);
    expect(code).toMatch(/for \(const b of _\.B\) \{ if \(!_tv\d+\) \{/);
    expect(code).not.toMatch(/for \(const a of _\.A\) \{ if/);
    expect(run({ P: [], A: [1, 2, 3], B: [] })).toEqual([]);
    expect(run({ P, A: [1, 2], B: [10] })).toEqual([12, 13]);
  });

  it('an invariant nested Sum is hoisted whole', () => {
    // [k · Σ_{j=1}^{|P|} P_j for k in 1..3]: the inner Sum does not depend
    // on k, so it runs once, not once per k.
    const expr = ce.box([
      'Comprehension',
      [
        'Multiply',
        'k',
        ['Sum', ['At', 'P', 'j'], ['Limits', 'j', 1, ['Length', 'P']]],
      ],
      ['Element', 'k', ['Range', 1, 3]],
    ]);
    const { code, run } = js(expr);
    // The Sum's IIFE is emitted inside the first-iteration prelude, not in
    // the `result.push(...)`.
    const push = code.slice(code.indexOf('result.push('));
    expect(push).not.toContain('while (');
    expect(run({ P })).toEqual([11, 22, 33]);
  });

  it('a nested Sum that depends on the binder stays in the body', () => {
    const expr = ce.box([
      'Comprehension',
      ['Sum', ['At', 'P', 'j'], ['Limits', 'j', 1, 'k']],
      ['Element', 'k', ['Range', 1, 3]],
    ]);
    const { code, run } = js(expr);
    const push = code.slice(code.indexOf('result.push('));
    expect(push).toContain('while (');
    expect(run({ P })).toEqual([3, 4, 6]);
  });
});

describe('Tycho item 248 — reuse of an enclosing CSE temporary', () => {
  it('a temporary bound at the root is read inside a comprehension body', () => {
    // Min(P) + 1 occurs three times at the root (a CSE candidate there —
    // size 4 × two saved evaluations clears the score threshold — bound as
    // `_cse1`) and again inside the comprehension body, in a Which arm. The
    // root heads are real-only (`Floor`, `Ceil`, `Round`) so the expression
    // stays in the real lane — a maybe-complex head would route the operand
    // through the runtime real-operand guard instead of CSE.
    const x = ['Add', ['Min', 'P'], 1];
    const expr = ce.box([
      'Add',
      ['Floor', x],
      ['Ceil', x],
      ['Round', x],
      [
        'Sum',
        [
          'Comprehension',
          ['Which', ['Greater', 'k', 1], x, 'True', 0],
          ['Element', 'k', ['Range', 1, 3]],
        ],
      ],
    ]);
    const { code, run } = js(expr);
    expect(count(code, 'Math.min(')).toBe(1);
    expect(code).toMatch(/const _cse1 = .*Math\.min.*result\.push\(.*_cse1/);
    const P = [3, 1, 2, 5];
    expect(run({ P })).toBe(2 + 2 + 2 + (0 + 2 + 2));
    expect(run({ P })).toBe(interpret(expr, { P }));
  });

  it('a reduction under a node the enclosing temporary already covers is not hoisted', () => {
    // The loop body's `Floor(Min(P) + 1)` resolves its operand to the
    // root's `_cse1` (the body keeps it under `Floor` so canonicalization
    // does not flatten it into the sum), so hoisting `Min(P)` out of the
    // loop would bind a pass over `P` that nothing reads.
    const x = ['Add', ['Min', 'P'], 1];
    const expr = ce.box([
      'Add',
      ['Floor', x],
      ['Ceil', x],
      ['Round', x],
      [
        'Sum',
        ['Add', ['Floor', x], ['At', 'P', 'j']],
        ['Limits', 'j', 1, ['Length', 'P']],
      ],
    ]);
    const { code, run } = js(expr);
    expect(count(code, 'Math.min(')).toBe(1);
    expect(whileBodies(code)[0]).toContain('_cse1');
    const P = [3, 1, 2, 5];
    expect(run({ P })).toBe(2 + 2 + 2 + (4 * 2 + 11));
  });

  it('a nested Sum reusing the outer index name does not read the outer binding', () => {
    // sin(j)² + 2 is bound at the outer Sum's body (two occurrences); the
    // inner Sum binds `j` afresh, so its own sin(j)² + 2 must be recomputed
    // from the inner index.
    const inner = ['Add', ['Power', ['Sin', 'j'], 2], 2];
    const expr = ce.box([
      'Sum',
      [
        'Add',
        ['Sqrt', inner],
        ['Exp', inner],
        ['Sum', inner, ['Limits', 'j', 1, 2]],
      ],
      ['Limits', 'j', 1, 3],
    ]);
    const { run } = js(expr);
    const f = (j: number) => Math.sin(j) ** 2 + 2;
    let expected = 0;
    for (let j = 1; j <= 3; j++)
      expected += Math.sqrt(f(j)) + Math.exp(f(j)) + f(1) + f(2);
    expect(run({})).toBeCloseTo(expected, 10);
  });

  it('a lambda parameter shadowing an outer symbol does not read the outer binding', () => {
    const inner = ['Add', ['Power', 'v', 2], 2];
    const expr = ce.box([
      'Add',
      ['Sqrt', inner],
      ['Exp', inner],
      ['Sum', ['Map', ['Function', inner, 'v'], ['List', 1, 2, 3]]],
    ]);
    const { run } = js(expr);
    const v = 0.5;
    const f = (x: number) => x ** 2 + 2;
    expect(run({ v })).toBeCloseTo(
      Math.sqrt(f(v)) + Math.exp(f(v)) + f(1) + f(2) + f(3),
      10
    );
  });
});

describe('Tycho item 248 — the histogram row witnesses', () => {
  // `neyret/lg5hblqpel` row 1, `H(P_0, 1/100, PointList(…))` expanded (the
  // fixture of Tycho's `2026-09-03-ce-histogram-row-compiled-run-cost.mts`),
  // and row 2, the same with `P_0` replaced by `(1 − v)·P_0 + v·P_1`.
  const row1 = [
    'Add',
    [
      'PointList',
      [
        'Add',
        ['Min', 'P_0'],
        [
          'Multiply',
          ['Rational', 1, 100],
          ['Add', ['Negate', ['Min', 'P_0']], ['Max', 'P_0']],
          ['Floor', ['Multiply', ['Rational', 1, 3], ['Range', 0, 299]]],
        ],
      ],
      [
        'Comprehension',
        [
          'Which',
          ['Equal', ['Mod', 'n', 3], 0],
          ['Complex', 0, 1],
          ['Equal', ['Mod', 'n', 3], 1],
          0,
          'True',
          [
            'Divide',
            [
              'Multiply',
              100,
              [
                'Sum',
                [
                  'Which',
                  [
                    'And',
                    [
                      'LessEqual',
                      [
                        'Multiply',
                        ['Rational', 1, 100],
                        ['Floor', ['Multiply', ['Rational', 1, 3], 'n']],
                      ],
                      [
                        'Divide',
                        ['Add', ['Negate', ['Min', 'P_0']], ['At', 'P_0', 'j']],
                        ['Add', ['Negate', ['Min', 'P_0']], ['Max', 'P_0']],
                      ],
                    ],
                    [
                      'Less',
                      [
                        'Divide',
                        ['Add', ['Negate', ['Min', 'P_0']], ['At', 'P_0', 'j']],
                        ['Add', ['Negate', ['Min', 'P_0']], ['Max', 'P_0']],
                      ],
                      [
                        'Multiply',
                        ['Rational', 1, 100],
                        ['Ceil', ['Multiply', ['Rational', 1, 3], 'n']],
                      ],
                    ],
                  ],
                  1,
                  'True',
                  0,
                ],
                ['Limits', 'j', 1, ['Length', 'P_0']],
              ],
            ],
            ['Length', 'P_0'],
          ],
        ],
        ['Element', 'n', ['Range', 0, 299]],
      ],
    ],
    ['PointList', -1.2, -1.5],
  ];
  const substitute = (x: unknown): unknown =>
    x === 'P_0'
      ? ['Add', ['Multiply', ['Subtract', 1, 'v'], 'P_0'], ['Multiply', 'v', 'P_1']]
      : Array.isArray(x)
        ? x.map(substitute)
        : x;
  const row2 = substitute(row1);

  const engine = new ComputeEngine();
  engine.declare('P_0', 'list<number>');
  engine.declare('P_1', 'list<number>');
  engine.declare('v', 'number');
  const P_0 = Array.from(
    { length: 600 },
    (_, i) => (10000 * Math.sin(10000 * (i + 1))) % 1
  );

  it.each([
    ['row 1', row1],
    ['row 2', row2],
  ])('%s: every loop body is free of reductions and broadcasts', (_name, body) => {
    const { code, run } = js(engine.box(body as any));
    for (const loop of whileBodies(code)) {
      expect(loop).not.toContain('reduce(');
      expect(loop).not.toContain('_SYS.bcast(');
    }
    // The comprehension's `result.push(…)` runs once per bin: no list is
    // rebuilt there either.
    const push = code.slice(code.indexOf('result.push('));
    expect(push).not.toContain('_SYS.bcast(');
    const out = run({ P_0, P_1: P_0, v: 0.5 });
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(300);
    // Bin 0 of each triple is the complex separator, bin 1 the baseline,
    // bin 2 the height: 100 × (count of elements whose normalized value
    // falls in [b/100, (b+1)/100)) / N, shifted by the trailing −1.5. The
    // same arithmetic as the emitted code, written directly.
    const min = Math.min(...P_0);
    const max = Math.max(...P_0);
    for (let n = 0; n < 300; n++) {
      const y = out[n][1];
      if (n % 3 === 0) expect(y).toEqual({ re: -1.5, im: 1 });
      else if (n % 3 === 1) expect(y).toBe(-1.5);
      else {
        const lo = 0.01 * Math.floor(0.3333333333333333 * n);
        const hi = 0.01 * Math.ceil(0.3333333333333333 * n);
        let c = 0;
        for (const p of P_0) {
          const x = (-min + p) / (-min + max);
          if (lo <= x && x < hi) c++;
        }
        expect(y).toBeCloseTo((100 * c) / P_0.length - 1.5, 9);
      }
    }
  });
});
