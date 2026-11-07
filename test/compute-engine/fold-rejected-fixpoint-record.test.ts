/**
 * Issue #487: boxing nested folds whose accumulator fixpoint is rejected was
 * about 3.5 times slower than in 0.156.0.
 *
 * A fold whose accumulator is joined (`Join(acc, …)`) in a branch of an `If`
 * whose condition compares with a value that may be a list settles on a type
 * with a `missing` arm (the comparison can be `Missing`), which the binding
 * that `Join` narrows does not admit, so its fixpoint is rejected and it
 * keeps its admitted literal (`fixpointLiteral`, `library/collections.ts`).
 * Such a fold cost four passes over its body in every step of every
 * enclosing fold. Now the rejection is recorded, and the next step of the
 * enclosing fold admits the fold once.
 *
 * That record is sound only when a fold rejected at one accumulator type is
 * rejected at a wider one. A comparison whose operand MAY be a collection and
 * may be absent as a whole (`collection | integer | missing`) was typed
 * without the `missing` arm, while a narrower operand type
 * (`list<integer> | missing`) gave it, so a fold rejected at the narrower
 * type could settle at the wider one. That type did not hold the value:
 * `y < x` is `Missing` for `y = Missing`. Both are fixed here.
 *
 * Since the user decision of 2026-11-02 (two-valued comparisons) `y < x` is
 * `False` for `y = Missing`, not `Missing`, so the type of the comparison
 * has no `missing` arm: the arm for an absent `y` is `boolean`.
 *
 * Since `Missing` is a result only (user decision of 2026-11-02), a declared
 * type cannot name `missing`, and a read such as `st[2]` is typed by its
 * element type with no `missing` or `nan` arm.
 *
 * The timing assertion runs under `CE_PERF=1` only (`npm run test:perf`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { RSK_ROW_INSERTION } from './fixtures/rsk-row-insertion';

const PERF = process.env.CE_PERF === '1';

describe('a comparison with an operand that may be an absent collection', () => {
  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
  // is a result only"), so the operand types that these tests declared
  // (`collection | integer | missing`, `list<integer> | missing`) are
  // refused.
  test('an operand cannot be declared `collection | integer | missing`', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('y', 'collection | integer | missing' as any)
    ).toThrow(/cannot be declared/);
  });
});

describe('issue #487: nested folds whose fixpoint is rejected', () => {
  // The expression of the issue, applied to the permutation [4, 3, 2, 1].
  const fill = (n: any, v: any): any =>
    n === '_raw' ? v : Array.isArray(n) ? n.map((o) => fill(o, v)) : n;
  const issue = () => fill(RSK_ROW_INSERTION, ['List', 4, 3, 2, 1]);

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

  // The accumulator types of the expression of the issue, which the
  // refinement gave without the record (commit 5404acb3f) and still gives.
  const ISSUE_ACCUMULATORS = [
    'a: collection<any>',
    'st: tuple<indexed_collection<collection<any>>>',
    'tacc: list<unknown>',
    'tacc: list<collection<any>>',
    'bumped: unknown',
    'nacc: list<unknown>',
    'nacc: list<unknown>',
    'larger: collection<any>',
    'bacc: list<unknown>',
    'larger: collection<any>',
    'bacc: list<unknown>',
  ];

  test('the expression of the issue is typed and evaluates as before', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(issue());
    expect(expr.type.toString()).toBe('collection<any> | number');
    expect(accumulators(expr)).toEqual(ISSUE_ACCUMULATORS);
    expect(expr.evaluate().toString()).toBe('[[1],[2],[3],[4]]');
  });

  test('a fold rejected at the first step of the enclosing fold is rejected at the next', () => {
    // `st[2]` is `2` at the first step and `integer | list` at the next.
    // (Before 2026-11-02 it was `collection | integer | missing | nan` at
    // the next step, where the comparison `st[1][g] > st[2]` could be
    // `Missing`.)
    const at = (x: any, i: any) => ['At', x, i];
    const rows = at('st', 1);
    const inner = [
      'Fold',
      [
        'Function',
        [
          'If',
          ['Greater', at(rows, 'g'), at('st', 2)],
          ['Join', 'b', ['List', at(rows, 'g')]],
          'b',
        ],
        'b',
        'g',
      ],
      ['List'],
      ['Range', 1, ['Count', rows], 1],
    ];
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Fold',
      ['Function', ['List', ['Join', rows, inner], at('st', 2)], 'st', 'k'],
      ['List', ['List', 3, 1, 4], 2],
      ['Range', 1, 2, 1],
    ] as any);
    expect(expr.type.toString()).toBe('list<integer | list>');
    // Since the user decision of 2026-11-02 (two-valued comparisons) the
    // condition of the inner `If` has no `missing` arm, and the inner
    // accumulator settles at `list<unknown>` (it was `collection<any>`).
    expect(accumulators(expr)).toEqual([
      'st: list<integer | list>',
      'b: list<unknown>',
    ]);
    expect(expr.evaluate().toString()).toBe('[[3,1,4,3,4,3,4,3,4],2]');
  });

  // The outer fold of the issue and the fold nested in it (accumulator
  // `st`) are both rejected at their first step. The admission pass of the
  // outer fold reads the rejection that its step recorded for the nested
  // fold, and does not refine that fold again from its seed
  // (`FoldRefinementState`, `library/collections.ts`). The types are those
  // of the refinement from scratch (`ISSUE_ACCUMULATORS`, also at commit
  // 83a2ea70e).

  test('boxing the expression of the issue computes each type fewer times', () => {
    // 2,272 types were computed for the first time before the admission pass
    // read the rejection, 1,677 after. The count does not depend on the
    // load of the machine.
    const ce = new ComputeEngine();
    const wasEnabled = ce._cacheStats.enabled;
    ce._cacheStats.reset();
    ce._cacheStats.enabled = true;
    try {
      ce.box(['Function', RSK_ROW_INSERTION as any, '_raw']);
    } finally {
      ce._cacheStats.enabled = wasEnabled;
    }
    expect(ce._cacheStats.snapshot().caches.type.missCold).toBeLessThan(1800);
  });

  test('the rejection read by the admission pass gives the types of the refinement from scratch', () => {
    // The outer seed `[[1]]` instead of `[]`.
    const outerSeed: any = [...(RSK_ROW_INSERTION as any[])];
    outerSeed[2] = ['List', ['List', 1]];
    // The seed `[a, 0]` instead of `[a, b]` for the fold nested in the outer
    // fold: `st[2] = 0`, so the nested fold returns its seed.
    const innerSeed: any = JSON.parse(JSON.stringify(RSK_ROW_INSERTION));
    innerSeed[1][1][1][2] = ['List', 'a', 0];
    expect(innerSeed[1][1][1][0]).toBe('Fold');
    const cases: [any, string][] = [
      [outerSeed, '[[1,1,2],[3]]'],
      [innerSeed, '[]'],
    ];
    for (const [json, value] of cases) {
      const ce = new ComputeEngine();
      const expr = ce.box(fill(json, ['List', 3, 1, 2]));
      expect(expr.type.toString()).toBe('collection<any> | number');
      expect(accumulators(expr)).toEqual(ISSUE_ACCUMULATORS);
      expect(expr.evaluate().toString()).toBe(value);
    }
  });

  (PERF ? test : test.skip)('boxing the expression of the issue', () => {
    const ce = new ComputeEngine();
    const time = (): number => {
      const t = performance.now();
      ce.box(issue());
      return performance.now() - t;
    };
    time(); // warm up
    const runs = [time(), time(), time()].sort((a, b) => a - b);
    // From source: median 188 ms before the record, 139 ms after (load
    // average about 6, 2026-10-30). The bound is about 2 times the second.
    expect(runs[1]).toBeLessThan(300);
  });
});
