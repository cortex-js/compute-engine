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
 * The timing assertion runs under `CE_PERF=1` only (`npm run test:perf`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { RSK_ROW_INSERTION } from './fixtures/rsk-row-insertion';

const PERF = process.env.CE_PERF === '1';

describe('a comparison with an operand that may be an absent collection', () => {
  const rows: [string, string][] = [
    ['collection | missing', 'broadcastable<boolean> | missing'],
    ['collection | integer | missing', 'broadcastable<boolean> | missing'],
    [
      'collection | integer | missing | nan',
      'broadcastable<boolean> | missing',
    ],
    // A definite collection gave the arm before (unchanged).
    ['list<integer> | missing', 'list<boolean | missing> | missing'],
    // A scalar: the comparison's own type has the arm (unchanged).
    ['integer | missing', 'boolean | missing'],
  ];
  for (const [declared, expected] of rows) {
    test(`y: ${declared} gives ${expected}`, () => {
      const ce = new ComputeEngine();
      ce.declare('y', declared as any);
      const t = ce.box(['Less', 'y', 'x']).type;
      expect(t.toString()).toBe(expected);
      // The value for an absent `y` and a scalar `x` is `Missing`.
      const v = ce.box(['Less', 'Missing', 3]).evaluate();
      expect(v.symbol).toBe('Missing');
      expect(v.type.matches(t)).toBe(true);
    });
  }

  test('an If over such a comparison has a missing arm', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'collection | integer | missing | nan');
    expect(ce.box(['If', ['Greater', 'x', 'y'], 1, 2]).type.toString()).toBe(
      'integer | list<integer | list<any>> | missing'
    );
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

  test('the expression of the issue is typed and evaluates as before', () => {
    // The types are those the refinement gave without the record (commit
    // 5404acb3f).
    const ce = new ComputeEngine();
    const expr = ce.box(issue());
    expect(expr.type.toString()).toBe('collection<any> | missing | number');
    expect(accumulators(expr)).toEqual([
      'a: collection<any>',
      'st: tuple<indexed_collection<collection<any>>>',
      'tacc: list<unknown>',
      'tacc: list<collection<any> | missing>',
      'bumped: unknown',
      'nacc: list<unknown>',
      'nacc: list<unknown>',
      'larger: collection<any>',
      'bacc: list<unknown>',
      'larger: collection<any>',
      'bacc: list<unknown>',
    ]);
    expect(expr.evaluate().toString()).toBe('[[1],[2],[3],[4]]');
  });

  test('a fold rejected at the first step of the enclosing fold is rejected at the next', () => {
    // `st[2]` is `2` at the first step and `collection | integer | missing |
    // nan` at the next, where the comparison `st[1][g] > st[2]` can be
    // `Missing`: the inner accumulator `b` keeps its admitted type at both
    // steps. (Before, the comparison at the second step had no `missing`
    // arm, the inner fixpoint settled there, and `b` was `list<unknown>`.)
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
    expect(expr.type.toString()).toBe(
      'list<collection | integer | missing | nan>'
    );
    expect(accumulators(expr)).toEqual([
      'st: list<collection | integer | missing | nan>',
      'b: collection<any>',
    ]);
    expect(expr.evaluate().toString()).toBe('[[3,1,4,3,4,3,4,3,4],2]');
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
