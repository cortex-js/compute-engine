/**
 * A broadcast over a lone EMPTY collection operand answers the EMPTY LIST.
 *
 * Before the user ruling of 2026-09-21 the three sides disagreed: the
 * interpreter answered the erasure marker `Nothing` for the unary and
 * element-wise heads (`Sin([])`, `Negate([])`, `Not([])`, `Abs([])`,
 * `[] < 3`), while `Add` and `Multiply` already answered `[]` (`2·[]`), and
 * the compiled JavaScript helper `_SYS.bcast` spelled the erasure `NaN`. The
 * rule is now one rule on every route: `[]`.
 *
 * An empty operand BESIDE a non-empty one stays an ordinary length mismatch.
 * It used to be erased — `Sin([]) + [1, 2]` answered `[1, 2]`, because the
 * `Nothing` from `Sin([])` spliced out of the sum — and it now answers
 * `incompatible-dimensions`, exactly as `Sin([1,2,3]) + [1,2]` does.
 *
 * The rule and its consequences are `docs/BROADCAST-MODEL.md`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/** The shapes the ruling names, as MathJSON over a literal empty list. */
const EMPTY_BROADCASTS: [string, unknown][] = [
  ['Sin([])', ['Sin', ['List']]],
  ['Negate([])', ['Negate', ['List']]],
  ['Not([])', ['Not', ['List']]],
  ['Abs([])', ['Abs', ['List']]],
  ['[] < 3', ['Less', ['List'], 3]],
  ['2 · []', ['Multiply', 2, ['List']]],
  ['[] + 1', ['Add', ['List'], 1]],
  ['PointX([])', ['PointX', ['List']]],
];

describe('The interpreter answers the empty list for a lone empty operand', () => {
  for (const [label, json] of EMPTY_BROADCASTS) {
    test(`${label} evaluates to []`, () => {
      const r = ce.box(json).evaluate();
      expect(r.operator).toBe('List');
      expect(r.count).toBe(0);
      expect(r.toString()).toBe('[]');
    });

    test(`${label} numericizes to []`, () => {
      const r = ce.box(json).N();
      expect(r.operator).toBe('List');
      expect(r.count).toBe(0);
    });
  }

  test('an empty operand read from an assigned symbol answers [] too', () => {
    const engine = new ComputeEngine();
    engine.assign('EmptyList', engine.box(['List']));
    expect(engine.box(['Sin', 'EmptyList']).evaluate().toString()).toBe('[]');
    expect(engine.box(['Less', 'EmptyList', 3]).evaluate().toString()).toBe(
      '[]'
    );
  });

  test('the asynchronous evaluation agrees with the synchronous one', async () => {
    const r = await ce.box(['Sin', ['List']]).evaluateAsync();
    expect(r.toString()).toBe('[]');
  });

  test('a nested empty cell keeps its position and answers []', () => {
    // Only the empty POSITION is empty; the sibling still evaluates.
    const r = ce
      .box(['Not', ['List', ['List'], ['List', 'True']]])
      .evaluate();
    expect(r.toString()).toBe('[[],["False"]]');
  });
});

describe('An operand that becomes empty only at evaluation answers [] too', () => {
  // The pre-evaluation broadcast sees a literal `[]`. A call that ANSWERS the
  // empty list is empty only after its operand is evaluated, so it reaches the
  // post-evaluation broadcast instead. Both arms must give the same answer.
  function engineWith(body: unknown): ComputeEngine {
    const engine = new ComputeEngine();
    engine.assign('f', engine.box(['Function', body]));
    return engine;
  }

  test('Sin(f()) with f answering [] evaluates to []', () => {
    const engine = engineWith(['List']);
    const r = engine.box(['Sin', ['f']]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.count).toBe(0);
    expect(r.toString()).toBe('[]');
  });

  test('the asynchronous evaluation agrees', async () => {
    const engine = engineWith(['List']);
    const r = await engine.box(['Sin', ['f']]).evaluateAsync();
    expect(r.operator).toBe('List');
    expect(r.count).toBe(0);
    expect(r.toString()).toBe('[]');
  });

  test('a computed NON-empty list still broadcasts', () => {
    const engine = engineWith(['List', 1, 2]);
    expect(engine.box(['Sin', ['f']]).evaluate().toString()).toBe(
      '[sin(1),sin(2)]'
    );
  });

  test('a computed non-empty list still broadcasts asynchronously', async () => {
    const engine = engineWith(['List', 1, 2]);
    const r = await engine.box(['Sin', ['f']]).evaluateAsync();
    expect(r.toString()).toBe('[sin(1),sin(2)]');
  });

  // A control, not a new pin: a filter that keeps nothing already answered
  // `[]` before the post-evaluation arm was changed, because a lazy source
  // takes a different route. It keeps the two kinds of computed empty source
  // — a lazy collection and a call — in agreement.
  test('a filter that keeps nothing answers []', () => {
    const r = ce
      .box([
        'Sin',
        ['Filter', ['List', 1, 2, 3], ['Function', ['Greater', 'x', 10], 'x']],
      ])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.count).toBe(0);
  });
});

describe('An empty operand beside a non-empty one is a length mismatch', () => {
  test('Sin([]) + [1, 2] is incompatible-dimensions', () => {
    const r = ce.box(['Add', ['Sin', ['List']], ['List', 1, 2]]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
    expect(r.toString()).toMatch(/0 vs 2/);
  });

  test('it is the same answer a non-empty mismatch gets', () => {
    const r = ce
      .box(['Add', ['Sin', ['List', 1, 2, 3]], ['List', 1, 2]])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });
});

describe('The compiled JavaScript lane answers the empty list as well', () => {
  const jsEngine = new ComputeEngine();
  jsEngine.declare('N', 'list<number>');
  jsEngine.declare('M', 'list<number>');

  /** Compile `json` and run it with the given bindings. */
  function run(json: unknown, vars: Record<string, unknown>): unknown {
    const r = compile(jsEngine.box(json), { fallback: false });
    expect(r.success).toBe(true);
    return r.run!(vars as any);
  }

  const COMPILED: [string, unknown][] = [
    ['sin(N)', ['Sin', 'N']],
    ['-N', ['Negate', 'N']],
    ['not(N < 3)', ['Not', ['Less', 'N', 3]]],
    ['|N|', ['Abs', 'N']],
    ['N < 3', ['Less', 'N', 3]],
    ['2 · N', ['Multiply', 2, 'N']],
    ['N + 1', ['Add', 'N', 1]],
  ];

  for (const [label, json] of COMPILED) {
    test(`${label} with N = [] runs to []`, () => {
      expect(run(json, { N: [] })).toEqual([]);
    });
  }

  test('the fused chain of heads is one call and still answers []', () => {
    const json = [
      'Add',
      ['Multiply', 2, ['Add', ['Mod', ['Subtract', 'N', 1], 15], 7]],
      3,
    ];
    const r = compile(jsEngine.box(json), { fallback: false });
    expect(r.success).toBe(true);
    // The whole chain is absorbed into one `_SYS.bcast` call, so the empty
    // answer comes from the fused helper, not from a chain of empty steps.
    expect((r.code!.match(/_SYS\.bcast\(/g) ?? []).length).toBe(1);
    expect(r.run!({ N: [] } as any)).toEqual([]);
  });

  test('two empty sources agree on the empty answer', () => {
    expect(run(['Add', ['Sin', 'N'], 'M'], { N: [], M: [] })).toEqual([]);
  });

  test('a fused empty-against-non-empty operand is the mismatch answer, NaN', () => {
    // Fusion folds `Sin(N) + M` into ONE `_SYS.bcast` call over both
    // sources, so the empty `N` and the two-element `M` meet as a length
    // mismatch inside that call. The helper spells a mismatch `NaN`, which
    // is how every real-valued compiled target spells the interpreter's
    // `incompatible-dimensions` error.
    const r = run(['Add', ['Sin', 'N'], 'M'], { N: [], M: [1, 2] });
    expect(typeof r).toBe('number');
    expect(Number.isNaN(r as number)).toBe(true);
  });

  test('an elementwise selection over an empty condition answers []', () => {
    expect(run(['Which', ['Less', 'N', 3], 1, 'True', 2], { N: [] })).toEqual(
      []
    );
  });

  test('a non-empty source is unchanged', () => {
    expect(run(['Multiply', 2, 'N'], { N: [1, 2, 3] })).toEqual([2, 4, 6]);
  });
});
