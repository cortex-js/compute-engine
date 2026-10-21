/**
 * Issue #462: boxing nested folds whose accumulator is read by index took
 * about three times longer for every level of nesting.
 *
 * Such an accumulator's inferred type says too little, so the fold's bare
 * accumulator is typed to the fixpoint of its seed and its body's result
 * (`canonicalFoldCombiner`, `library/collections.ts`), which canonicalizes
 * the raw combiner once per fixpoint step. A fold nested in the body was
 * refined from scratch in each of those canonicalizations. Now a nested
 * fold is not refined while the enclosing handler admits its callback, and
 * the fixpoint found for it in one step of the enclosing fold is the
 * starting point of the next step, where it settles in one canonicalization.
 *
 * The timing assertion runs under `CE_PERF=1` only (`npm run test:perf`):
 * the ratio it measures is meaningless under worker contention. The rest
 * checks the types: every expected type and value below is the one the
 * refinement from scratch gave (measured on the tree before the record was
 * added, commit `23db30a67`), including the cases where a record shared
 * across folds would have widened a type: a nested fold that reads the
 * enclosing accumulator, two folds of the same text with different seeds,
 * two folds of the same text under differently typed `Map` parameters, a
 * fold in the seed operand next to a same-text fold in the body, and a seed
 * that is a symbol the body narrows. (A hit of the record can in principle
 * give a MORE precise type than the refinement from scratch, where that one
 * would not have settled in its three steps; no such shape is known. See
 * `FoldRefinementState` in `library/collections.ts`.)
 */
import { ComputeEngine } from '../../src/compute-engine';

const PERF = process.env.CE_PERF === '1';

// The shape of the issue: `st` is a pair `[rows, flag]` read only through
// `At(st, 1)` and `At(st, 2)`; each level nests another such fold in its
// body, next to a shallow fold (`copy`) that reads the enclosing
// accumulator.
//
// The same fold is spelled with `Fold`, with `Reduce` (seeded and, over a
// two-element list of seeds, unseeded) and with `Scan` (whose last element
// is the fold's result). `Fold` canonicalizes to `Reduce`, so re-boxing the
// canonical MathJSON of a `Fold` takes the `Reduce` route.
type Spelling = 'Fold' | 'Reduce' | 'ReduceNoSeed' | 'Scan';
const SPELLINGS: Spelling[] = ['Fold', 'Reduce', 'ReduceNoSeed', 'Scan'];

function level(i: number, depth: number, spelling: Spelling = 'Fold'): any {
  const s = 'st' + i;
  const k = 'k' + i;
  const m = 'm' + i;
  const a = 'a' + i;
  const rows = ['At', s, 1];
  const copy = [
    'Fold',
    ['Function', ['Join', a, ['List', ['At', rows, m]]], a, m],
    ['List'],
    ['Range', 1, ['Count', rows], 1],
  ];
  const inner = i + 1 < depth ? level(i + 1, depth, spelling) : copy;
  const fn = [
    'Function',
    [
      'If',
      ['Equal', ['At', s, 2], 0],
      s,
      ['List', ['Join', copy, ['List', inner]], 0],
    ],
    s,
    k,
  ];
  const seed = ['List', ['List'], 1];
  const range = ['Range', 1, 2, 1];
  if (spelling === 'Fold') return ['Fold', fn, seed, range];
  if (spelling === 'Reduce') return ['Reduce', range, fn, seed];
  if (spelling === 'ReduceNoSeed') return ['Reduce', ['List', seed, seed], fn];
  return ['Last', ['Scan', range, fn, seed]];
}

describe('issue #462: nested folds with an index-read accumulator', () => {
  const ce = new ComputeEngine();

  // The types and values the refinement from scratch gave (measured on a
  // clean checkout of commit 7cbbd3a50, 2026-10-21, without the record), so
  // a hit of the record is checked to settle on the same fixpoint. The type
  // is the same at every depth: the inner fold's accumulator is `list<unknown>`
  // (its seed is `[]`), and since that commit the element join of
  // `Join(copy, [inner])` keeps the `unknown` arm (`joinUnresolvedArm`,
  // `library/collections.ts`), which the reducer reads as `unknown`.
  const expected: [number, string, string][] = [
    [1, 'list<integer | list<unknown>>', '[[[]],0]'],
    [2, 'list<integer | list<unknown>>', '[[[[[]],0]],0]'],
    [3, 'list<integer | list<unknown>>', '[[[[[[[]],0]],0]],0]'],
    [4, 'list<integer | list<unknown>>', '[[[[[[[[[]],0]],0]],0]],0]'],
  ];
  for (const [depth, type, value] of expected) {
    test(`depth ${depth} is typed and evaluates as before`, () => {
      const expr = ce.box(level(0, depth));
      expect(expr.type.toString()).toBe(type);
      expect(expr.evaluate().toString()).toBe(value);
    });
  }

  // The other spellings, at depths 1 and 2, with the types the refinement
  // from scratch gave. `Scan` yields every running value, so its element
  // type carries the `missing` of an empty running state.
  const spelled: [Spelling, number, string][] = [
    ['Reduce', 1, 'list<integer | list<unknown>>'],
    ['Reduce', 2, 'list<integer | list<unknown>>'],
    ['ReduceNoSeed', 1, 'list<integer | list<unknown>>'],
    ['ReduceNoSeed', 2, 'list<integer | list<unknown>>'],
    ['Scan', 1, 'list<integer | list<unknown>> | missing'],
    ['Scan', 2, 'list<integer | list<missing | unknown>> | missing'],
  ];
  for (const [spelling, depth, type] of spelled) {
    test(`${spelling} at depth ${depth} is typed and evaluates as before`, () => {
      const expr = ce.box(level(0, depth, spelling));
      expect(expr.type.toString()).toBe(type);
      expect(expr.evaluate().toString()).toBe(expected[depth - 1][2]);
    });
  }

  test('the accumulator of every nested fold is typed from its seed', () => {
    // Each level's combiner reads `st` by index, which infers a one-element
    // tuple (issue #454); the refinement types it from the two-element seed.
    const expr: any = ce.box(level(0, 3));
    let fn: any = expr.ops[1];
    for (let d = 0; d < 3; d++) {
      expect(fn.operator).toBe('Function');
      const acc = fn.ops[1];
      expect(acc.type.toString()).toMatch(/^list<integer \| list</);
      // The nested fold is the second element of the list in the `else`
      // branch: `If(cond, st, [Join(copy, [inner]), 0])`.
      const body = fn.ops[0];
      const branch = body.ops[body.nops - 1].ops[2];
      const inner = branch.ops[0].ops[1].ops[0];
      if (d < 2) expect(inner.operator).toBe('Reduce');
      fn = inner.ops?.[1] ?? fn;
    }
  });

  // The accumulator bindings of every `Function` literal of `expr`, in
  // document order, as `name: type`.
  const accumulators = (expr: any): string[] => {
    const out: string[] = [];
    const walk = (e: any) => {
      if (!e?.ops) return;
      if (e.operator === 'Function' && e.ops[1]?.symbol !== undefined)
        out.push(`${e.ops[1].symbol}: ${e.ops[1].type}`);
      for (const o of e.ops) walk(o);
    };
    walk(expr);
    return out;
  };
  const R = (n: number) => ['Range', 1, n];
  const same = (name: string) => [
    'Function',
    ['Join', 'a', ['List', name]],
    'a',
    'j',
  ];

  test('a nested fold that reads the enclosing accumulator is typed as before', () => {
    // The enclosing fixpoint does not settle, so the literal kept is the
    // admitted one, whose nested fold was refined with `st` at its inferred
    // type. A record written by the enclosing steps must not reach it.
    const expr = ce.box([
      'Fold',
      [
        'Function',
        [
          'List',
          ['Fold', same(['At', 'st', 1] as any), ['List'], R(2)],
          ['At', 'st', 2],
        ],
        'st',
        'k',
      ],
      ['List', 5, 0],
      R(2),
    ] as any);
    expect(expr.type.toString()).toBe('list<unknown>');
    expect(accumulators(expr)).toEqual([
      'st: dictionary<any> | indexed_collection<any>',
      'a: list<unknown>',
    ]);
    expect(expr.evaluate().toString()).toBe('[[[5,5],[5,5]],0]');
  });

  test('two folds of the same text with different seeds keep their own types', () => {
    const expr = ce.box([
      'Fold',
      [
        'Function',
        [
          'List',
          ['Fold', ['Function', 'a', 'a', 'x'], 0, ['List', 1]],
          ['Fold', ['Function', 'a', 'a', 'x'], "'s'", ['List', 1]],
        ],
        'q',
        'k',
      ],
      ['List', 0, 0],
      R(1),
    ] as any);
    expect(expr.type.toString()).toBe('list<number | string>');
    expect(accumulators(expr)).toEqual([
      'q: list<number | string>',
      'a: number',
      'a: string',
    ]);
    expect(expr.evaluate().toString()).toBe('[0,"s"]');
  });

  test('two folds of the same text under differently typed Map parameters keep their own types', () => {
    const map = (xs: any) => [
      'Map',
      ['Function', ['Fold', same('p'), ['List'], R(2)], 'p'],
      xs,
    ];
    const expr = ce.box([
      'Fold',
      [
        'Function',
        ['List', map(['List', 1, 2]), map(['List', ['List', 1], ['List', 2]])],
        'q',
        'k',
      ],
      ['List', ['List'], ['List']],
      R(1),
    ] as any);
    // The outer type is the join the engine gives today (ROADMAP: a list of
    // one-element vectors is a subtype of a list of scalars); what this test
    // locks in is that the two `a` accumulators differ.
    expect(accumulators(expr)).toEqual([
      'q: list<list<list<integer>^2>>',
      'a: list<integer>',
      'a: list<vector<integer^1>>',
    ]);
    expect(expr.evaluate().toString()).toBe(
      '[[[1,1],[2,2]],[[[1],[1]],[[2],[2]]]]'
    );
  });

  test('a seed that is a symbol the body narrows types the accumulator from the narrowed seed', () => {
    // `w` is undeclared: its type is `unknown` until `At(w, 1)` in the body
    // types it as an indexed collection of numbers. The seed type is read
    // after the body is canonicalized, so the accumulator is typed from the
    // narrowed `w`, not left at the one-element tuple its index reads infer.
    const engine = new ComputeEngine();
    const expr = engine.box([
      'Reduce',
      R(3),
      [
        'Function',
        ['List', ['Add', ['At', 'acc', 1], ['At', 'w', 1]], 0],
        'acc',
        'k',
      ],
      'w',
    ] as any);
    expect(accumulators(expr)).toEqual(['acc: indexed_collection<number>']);
    expect(expr.type.toString()).toBe('vector<2>');
  });

  test('a fold in the seed operand does not share its record with the first fold of the body', () => {
    // Both folds spell the same combiner. The seed's fold takes the first
    // ordinal of the handler's children; the body's folds are numbered after
    // it in every pass, so the body fold starts from its own seed.
    const expr = ce.box([
      'Fold',
      [
        'Function',
        ['List', ['Fold', same('j'), ['List'], ['List', 1, 2]], ['At', 'q', 2]],
        'q',
        'k',
      ],
      ['List', ['Fold', same('j'), ['List'], ['List', "'s'", "'t'"]], 0],
      R(2),
    ] as any);
    expect(accumulators(expr)).toEqual([
      'q: list<integer | list<integer> | list<string> | missing | nan>',
      'a: list<integer>',
      'a: list<string>',
    ]);
    expect(expr.evaluate().toString()).toBe('[[1,2],0]');
    const identity = ['Function', 'a', 'a', 'x'];
    const expr2 = ce.box([
      'Fold',
      ['Function', ['Fold', identity, "'s'", ['List', 1]], 'q', 'k'],
      ['Fold', identity, ['List', 1], ['List', 1]],
      ['List', 1],
    ] as any);
    expect(expr2.type.toString()).toBe('string');
    expect(accumulators(expr2)).toEqual([
      'q: string | vector<integer^1>',
      'a: string',
      'a: vector<integer^1>',
    ]);
  });

  test('an accumulator joined with a nested fold is typed as before', () => {
    // The gate that decides whether the accumulator is refined reads its
    // binding from the admission pass in which the nested fold is only
    // admitted, not refined. Here the accumulator's use (`Join`) sees the
    // nested fold, and the binding is the one the fully refined pass gives.
    const expr = ce.box([
      'Fold',
      [
        'Function',
        ['Join', 'a', ['Fold', same('j'), ['List'], R(2)]],
        'a',
        'k',
      ],
      ['List', "'s'"],
      R(2),
    ] as any);
    expect(expr.type.toString()).toBe('list<integer | string>');
    expect(accumulators(expr)).toEqual([
      'a: list<integer | string>',
      'a: list<integer>',
    ]);
    expect(expr.evaluate().toString()).toBe('["s",1,2,1,2]');
  });

  // A chain of numeric folds: each accumulator is used only in arithmetic,
  // so its binding is precise and no fixpoint iteration runs.
  const numeric = (depth: number): any =>
    depth === 0
      ? ['Multiply', 2, 'j']
      : [
          'Fold',
          [
            'Function',
            ['Add', 'acc' + depth, numeric(depth - 1)],
            'acc' + depth,
            'j',
          ],
          0,
          R(3),
        ];

  test('a chain of numeric folds is typed as before', () => {
    const expr = ce.box(numeric(3));
    expect(expr.type.toString()).toBe('number');
    expect(accumulators(expr)).toEqual([
      'acc3: number',
      'acc2: number',
      'acc1: number',
    ]);
    expect(expr.evaluate().toString()).toBe('108');
  });

  // A chain of numeric folds around an index-read fold that holds a nested
  // fold: the numeric accumulators are predicted precise, so each numeric
  // level admits its body once, nested folds refined, and the chain costs
  // about what it did. (A numeric level that counted the nested fold's own
  // held-back admissions as its own re-admitted its body, and the cost
  // doubled per level: 2.5 s at depth 8.)
  const numericAround = (depth: number): any =>
    depth === 0
      ? ['Length', level(0, 2)]
      : [
          'Fold',
          [
            'Function',
            ['Add', 'acc' + depth, numericAround(depth - 1)],
            'acc' + depth,
            'j',
          ],
          0,
          R(3),
        ];

  test('a chain of numeric folds around an index-read fold is typed as before', () => {
    const expr = ce.box(numericAround(3));
    expect(expr.type.toString()).toBe('number');
    expect(accumulators(expr).slice(0, 3)).toEqual([
      'acc3: number',
      'acc2: number',
      'acc1: number',
    ]);
    expect(expr.evaluate().toString()).toBe('54');
  });

  (PERF ? test : test.skip)(
    'a chain of numeric folds costs about what it did',
    () => {
      const time = (make: (depth: number) => any, depth: number): number => {
        const t = performance.now();
        new ComputeEngine().box(make(depth));
        return performance.now() - t;
      };
      time(numeric, 6); // warm up
      // Before the record: 23 ms at depth 12 and 31 ms at depth 18 (M5,
      // idle); the same after. The bounds are about 4 times those values.
      expect(time(numeric, 12)).toBeLessThan(100);
      expect(time(numeric, 18)).toBeLessThan(130);
      // Around an index-read fold: 53 ms to 63 ms at every depth before,
      // 29 ms to 34 ms after (load average 28); 2.5 s at depth 8 with the
      // doubling.
      expect(time(numericAround, 8)).toBeLessThan(400);
    }
  );

  (PERF ? test : test.skip)(
    'boxing stays polynomial in the depth of nesting',
    () => {
      const time = (depth: number): number => {
        const t = performance.now();
        new ComputeEngine().box(level(0, depth));
        return performance.now() - t;
      };
      time(3); // warm up
      // Before the fix: 1.5 s at depth 6 and 13 s at depth 8 (M5, idle).
      // After: about 70 ms and 120 ms; under a load average of 26, 300 ms
      // and 530 ms. The depth-8 bound is what fails on the exponential
      // growth, by a factor of 6; the depth-6 bound only by half.
      expect(time(6)).toBeLessThan(1000);
      expect(time(8)).toBeLessThan(2000);
    }
  );

  (PERF ? test : test.skip)(
    'every spelling of the fold, and the re-boxed canonical form, stay polynomial',
    () => {
      // Before the record covered them: `Reduce` and `Scan` at depth 6 took
      // about 300 ms (the record never hit, their collection operand being
      // replaced by its canonical form in every pass) and the unseeded
      // `Reduce` 1.2 s (never held back either); after: 80 ms to 90 ms at
      // depth 6, 130 ms to 150 ms at depth 8 (M5, idle).
      for (const spelling of SPELLINGS) {
        const t = performance.now();
        new ComputeEngine().box(level(0, 8, spelling));
        expect(performance.now() - t).toBeLessThan(2000);
      }
      // A `Fold` canonicalizes to `Reduce`: re-boxing its canonical
      // MathJSON takes the `Reduce` route. 117 ms at depth 8 (M5, idle).
      const engine = new ComputeEngine();
      const json = engine.box(level(0, 8)).json;
      const t = performance.now();
      engine.box(json);
      expect(performance.now() - t).toBeLessThan(2000);
    }
  );
});
