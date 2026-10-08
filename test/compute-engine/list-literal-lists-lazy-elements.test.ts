import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A list literal is a value. When it is evaluated, each element that
// evaluates to a FINITE lazy collection (a range, a `Map`, a comprehension,
// a `Take`) is replaced by the list of its elements, or by the set of its
// elements when the element is typed as a set. Before, such an element
// stayed a live view inside the literal: with `xs = [1, 2]`,
// `[map(x => x + 1, xs)]` printed as `[Map((x) => x + 1, "xs")]` and read
// `xs` again at each later read. A spread of the same element
// (`[...[map(…)]]`) was already listed by `snapshotListJoin`; the two now
// agree. An element that is not known to be finite stays lazy, and so does
// an element whose elements would use more than `ce.maxCollectionSize`
// elements. A tuple literal follows the same rule. The implementation is
// `listedLiteralElements` in
// `src/compute-engine/boxed-expression/listed-element.ts`.
//

function run(source: string, ce = new ComputeEngine()): string {
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  const result = executeEpsil(ce, source, { parseLatex });
  expect(result.diagnostics).toEqual([]);
  return result.value.toString();
}

describe('a list literal lists each finite lazy element', () => {
  test('a `map` element is listed', () => {
    expect(run('let xs = [1, 2]\n[map(x => x + 1, xs)]')).toBe('[[2,3]]');
  });

  test('the listed element does not read the variable again', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2]));
    const value = ce
      .box(['List', ['Map', ['Function', ['Add', 'x', 1], 'x'], 'xs']])
      .evaluate();
    ce.assign('xs', ce.box(['List', 7]));
    expect(value.json).toEqual(['List', ['List', 2, 3]]);
  });

  test('a range element is listed', () => {
    expect(run('[1..3, 4]')).toBe('[[1,2,3],4]');
    const ce = new ComputeEngine();
    expect(ce.parse('[1..3, 4]').evaluate().json).toEqual([
      'List',
      ['List', 1, 2, 3],
      4,
    ]);
  });

  test('a comprehension element is listed', () => {
    expect(run('[[q + 1 for q in [1, 2]]]')).toBe('[[2,3]]');
  });

  test('a function body that returns a literal with a comprehension', () => {
    expect(run('f(s) = [[q + s for q in [1, 2]], s]\nf(10)')).toBe(
      '[[11,12],10]'
    );
  });

  test('a lazy element inside a lazy element is listed too', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2]));
    expect(
      ce
        .box(['List', ['Map', ['Function', ['Range', 1, 'x'], 'x'], 'xs']])
        .evaluate().json
    ).toEqual(['List', ['List', ['List', 1], ['List', 1, 2]]]);
  });

  test('a spread and an element of a one-element literal print the same', () => {
    const element = run('let xs = [1, 2]\n[map(x => x + 1, xs)]');
    const spread = run('let xs = [1, 2]\n[...[map(x => x + 1, xs)]]');
    expect(element).toBe('[[2,3]]');
    expect(spread).toBe(element);
  });

  test('an element that is not known to be finite stays lazy', () => {
    expect(run('[filter(1..oo, x => x > 2)]')).toBe(
      '[Filter(Range(1, +oo), (x) => 2 < x)]'
    );
    expect(run('[1..oo, 4]')).toBe('[Range(1, +oo),4]');
  });

  test('an element typed as a set becomes a `Set`', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'List',
        ['Map', ['Function', ['Multiply', 'x', 0], 'x'], ['Set', 1, 2]],
      ])
      .evaluate();
    expect(value.json).toEqual(['List', ['Set', 0]]);
  });

  test('a lazy dictionary view stays as it is', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'List',
        [
          'Filter',
          ['Dictionary', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]],
          ['Function', ['Greater', 'v', 1], 'v'],
        ],
      ])
      .evaluate();
    expect(value.op1.operator).toBe('Filter');
  });

  test('the listing is bounded by `ce.maxCollectionSize`', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 5;
    // Above the budget by itself: the range stays lazy.
    expect(
      ce
        .box(['List', ['Range', 1, 6], 4])
        .evaluate()
        .toString()
    ).toBe('[Range(1, 6),4]');
    // The budget is shared by the elements of the literal: the first range
    // uses 3 of 5, and the second one, 3 more, stays lazy.
    expect(
      ce
        .box(['List', ['Range', 1, 3], ['Range', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('[[1,2,3],Range(1, 3)]');
  });

  test('an element whose count is not cheap is bounded during the walk', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 3;
    // The count of a `Filter` is not read before the walk: the walk stops
    // at the budget, and the element stays lazy.
    const value = ce
      .box([
        'List',
        ['Filter', ['Range', 1, 10], ['Function', ['Greater', 'x', 0], 'x']],
      ])
      .evaluate();
    expect(value.op1.operator).toBe('Filter');
  });

  test('a numeric approximation approximates the listed elements', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2]));
    const value = ce
      .box(['List', ['Map', ['Function', ['Divide', 'x', 4], 'x'], 'xs']])
      .N();
    expect(value.json).toEqual(['List', ['List', 0.25, 0.5]]);
  });

  test('the materialization option gives the same list', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2]));
    const literal = ce.box([
      'List',
      ['Map', ['Function', ['Add', 'x', 1], 'x'], 'xs'],
      ['Range', 1, 3],
    ]);
    expect(literal.evaluate({ materialization: true }).json).toEqual(
      literal.evaluate().json
    );
  });
});

describe('the asynchronous route lists each finite lazy element', () => {
  test('`evaluateAsync` of a list literal', async () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2]));
    const value = await ce
      .box([
        'List',
        ['Map', ['Function', ['Add', 'x', 1], 'x'], 'xs'],
        ['Range', 1, 3],
      ])
      .evaluateAsync();
    expect(value.json).toEqual(['List', ['List', 2, 3], ['List', 1, 2, 3]]);
  });

  test('`evaluateAsync` of a tuple literal', async () => {
    const ce = new ComputeEngine();
    const value = await ce.box(['Tuple', ['Range', 1, 3], 4]).evaluateAsync();
    expect(value.json).toEqual(['Tuple', ['List', 1, 2, 3], 4]);
  });

  test('an element that holds an asynchronous-only operator stays lazy', async () => {
    const ce = new ComputeEngine();
    ce.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => ce.number((x.re ?? 0) + 5),
    } as never);
    ce.assign('xs', ce.box(['List', 1, 2]));
    const value = await ce
      .box(['List', ['Map', ['Function', ['AsyncOnly', 'x'], 'x'], 'xs']])
      .evaluateAsync();
    expect(value.op1.operator).toBe('Map');
  });

  // The callback of the view is the NAME of an asynchronous-only operator,
  // or the name of a function whose body applies one. The synchronous
  // iterator of the view gives `AsyncOnly(1)`, `AsyncOnly(2)` unevaluated,
  // so a listing would hold these applications unevaluated. Before, the
  // check found the applications in the view only, not the names, and the
  // literal was `[[AsyncOnly(1), AsyncOnly(2)]]` on both routes.
  test('a view whose callback names an asynchronous-only operator stays lazy', async () => {
    const ce = new ComputeEngine();
    ce.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => ce.number((x.re ?? 0) + 5),
    } as never);
    ce.assign('g', ce.box(['Function', ['AsyncOnly', 'x'], 'x']));
    for (const callback of ['AsyncOnly', 'g']) {
      const literal = ce.box(['List', ['Map', callback, ['List', 1, 2]]]);
      expect(literal.evaluate().op1.operator).toBe('Map');
      const value = await literal.evaluateAsync();
      expect(value.op1.operator).toBe('Map');
    }
  });
});

//
// On the asynchronous route, the listing runs after an `await`. The engine
// keeps the capability registry and the context stack of an evaluation in
// place only until its first `await`, so the listing must put them in place
// again: the callbacks of a listed element evaluate synchronously. Two
// evaluations that run at the same time with different `entropy` handlers
// show the registry that the listing reads. Before, the evaluation that
// started first listed its elements with the handler of the second one.
//
describe('the asynchronous listing uses the context of its evaluation', () => {
  /** An engine with `Delay(n)`, an asynchronous-only operator that waits
   * for a timer and returns `n`. */
  function withDelay(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('Delay', {
      signature: '(integer) -> integer',
      evaluateAsync: async ([x]) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return x;
      },
    } as never);
    return ce;
  }

  /** Evaluate `expr` twice at the same time, the first time with an
   * `entropy` handler that always gives 0.25, the second time with one that
   * always gives 0.75. */
  async function withTwoEntropies(
    ce: ComputeEngine,
    expr: MathJsonExpression
  ): Promise<[string, string]> {
    const run = (u: number) =>
      ce.withEffects({ entropy: { random: () => u } } as never, () =>
        ce.box(expr).evaluateAsync()
      );
    const [a, b] = await Promise.all([run(0.25), run(0.75)]);
    return [a.toString(), b.toString()];
  }

  test('a list literal', async () => {
    const ce = withDelay();
    expect(
      await withTwoEntropies(ce, [
        'List',
        ['Map', ['Function', ['Random'], 'x'], ['List', 1, 2]],
        ['Delay', 1],
      ])
    ).toEqual(['[[0.25,0.25],1]', '[[0.75,0.75],1]']);
  });

  test('a broadcast', async () => {
    const ce = withDelay();
    ce.assign(
      'rr',
      ce.box([
        'Function',
        ['Map', ['Function', ['Random'], 'y'], ['Range', 1, 'x']],
        'x',
      ])
    );
    expect(await withTwoEntropies(ce, ['rr', ['List', 1, 2]])).toEqual([
      '[[0.25],[0.25,0.25]]',
      '[[0.75],[0.75,0.75]]',
    ]);
  });

  // The term of the `Sum` holds an asynchronous-only application, so the
  // `Sum` evaluates each term with `evaluateAsync`, and the listing of each
  // term runs after an `await`. The synchronous route gives the same value.
  test('a list literal in the term of a sum', async () => {
    const ce = withDelay();
    const term = (last: MathJsonExpression): MathJsonExpression => [
      'List',
      ['Map', ['Function', ['Add', 'x', 'k'], 'x'], ['List', 1, 2]],
      last,
    ];
    const sum = (last: MathJsonExpression): MathJsonExpression => [
      'Sum',
      term(last),
      ['Limits', 'k', 1, 3],
    ];
    const sync = ce.box(sum('k')).evaluate();
    expect(sync.json).toEqual(['List', ['List', 9, 12], 6]);
    expect((await ce.box(sum(['Delay', 'k'])).evaluateAsync()).json).toEqual(
      sync.json
    );
  });

  // `r(x) = x..x+1` maps over the list `[k, 2k]`: each cell is a range,
  // listed after the `await` of the broadcast.
  test('a broadcast in the term of a sum', async () => {
    const ce = withDelay();
    ce.assign('r', ce.box(['Function', ['Range', 'x', ['Add', 'x', 1]], 'x']));
    const sum = (last: MathJsonExpression): MathJsonExpression => [
      'Sum',
      ['List', ['r', ['List', 'k', ['Multiply', 2, 'k']]], last],
      ['Limits', 'k', 1, 3],
    ];
    const sync = ce.box(sum('k')).evaluate();
    expect(sync.json).toEqual([
      'List',
      ['List', ['List', 6, 9], ['List', 12, 15]],
      6,
    ]);
    expect((await ce.box(sum(['Delay', 'k'])).evaluateAsync()).json).toEqual(
      sync.json
    );
  });
});

describe('a tuple literal lists each finite lazy element', () => {
  test('a range element of a tuple is listed', () => {
    expect(run('(1..3, 4)')).toBe('([1,2,3], 4)');
    const ce = new ComputeEngine();
    expect(ce.box(['Tuple', ['Range', 1, 3], 4]).evaluate().json).toEqual([
      'Tuple',
      ['List', 1, 2, 3],
      4,
    ]);
  });

  test('an infinite element of a tuple stays lazy', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Tuple', ['Range', 1, 'PositiveInfinity'], 4]).evaluate().json
    ).toEqual(['Tuple', ['Range', 1, 'PositiveInfinity'], 4]);
  });
});

//
// The result of an eager broadcast is a value too: each cell that a user
// function answers with a finite lazy collection is listed, within one
// budget of `ce.maxCollectionSize` elements for the whole result
// (`listedBroadcastCells` in
// `src/compute-engine/boxed-expression/listed-element.ts`).
//
describe('a broadcast lists each finite lazy cell', () => {
  /** `k(x) = Range(1, x)`, a function that answers a lazy collection. */
  function withRangeFunction(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('k', ce.box(['Function', ['Range', 1, 'x'], 'x']));
    return ce;
  }

  test('a user function that answers a comprehension', () => {
    expect(run('f(s) = [q + 1 for q in [1, 2]]\nf([0, 1])')).toBe(
      '[[2,3],[2,3]]'
    );
  });

  test('a user function that answers a range', () => {
    expect(run('g(s) = 1..s\ng([2, 3])')).toBe('[[1,2],[1,2,3]]');
    const ce = withRangeFunction();
    expect(ce.box(['k', ['List', 2, 3]]).evaluate().json).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 1, 2, 3],
    ]);
  });

  test('`Apply` of a function literal over a list', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Apply', ['Function', ['Range', 1, 'x'], 'x'], ['List', 2, 3]])
        .evaluate().json
    ).toEqual(['List', ['List', 1, 2], ['List', 1, 2, 3]]);
  });

  test('a numeric approximation approximates the listed cells', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['Map', ['Function', ['Divide', 'y', 4], 'y'], ['Range', 1, 'x']],
        'x',
      ])
    );
    expect(ce.box(['h', ['List', 1, 2]]).N().json).toEqual([
      'List',
      ['List', 0.25],
      ['List', 0.25, 0.5],
    ]);
  });

  test('`evaluateAsync` of a broadcast', async () => {
    const ce = withRangeFunction();
    const value = await ce.box(['k', ['List', 2, 3]]).evaluateAsync();
    expect(value.json).toEqual(['List', ['List', 1, 2], ['List', 1, 2, 3]]);
  });

  test('a cell above the budget stays lazy', () => {
    const ce = withRangeFunction();
    ce.maxCollectionSize = 3;
    // The first cell uses 2 of 3 elements; the second one, 3 more, stays a
    // range.
    expect(
      ce
        .box(['k', ['List', 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[[1,2],Range(1, 3)]');
  });
});

//
// A function with a parameter declared as a scalar maps over the components
// of a tuple argument, and the result is a tuple of cells. A tuple literal
// lists its finite lazy elements, so the tuple of cells does too.
//
describe('a map over the components of a tuple lists each finite lazy cell', () => {
  /** `g(u: integer) = 1..u`, defined through Epsil. */
  function withTupleMappedFunction(): ComputeEngine {
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const result = executeEpsil(ce, 'g(u: integer) = 1..u', { parseLatex });
    expect(result.diagnostics).toEqual([]);
    return ce;
  }

  test('a function that answers a range, over a tuple', () => {
    expect(run('g(u: integer) = 1..u\ng((2, 3))')).toBe('([1,2], [1,2,3])');
    const ce = withTupleMappedFunction();
    expect(ce.box(['g', ['Tuple', 2, 3]]).evaluate().json).toEqual([
      'Tuple',
      ['List', 1, 2],
      ['List', 1, 2, 3],
    ]);
  });

  test('`evaluateAsync` of a function that answers a range, over a tuple', async () => {
    const ce = withTupleMappedFunction();
    const value = await ce.box(['g', ['Tuple', 2, 3]]).evaluateAsync();
    expect(value.json).toEqual(['Tuple', ['List', 1, 2], ['List', 1, 2, 3]]);
  });
});

describe('a spread of a view with an asynchronous-only callback keeps the view', () => {
  // The spread snapshot walks its operand synchronously, as the listing of
  // an element does, so a view whose callback applies an operator that has
  // only an `evaluateAsync` handler would store the applications
  // unevaluated. The literal keeps the view instead.
  test('by name and by lambda', () => {
    const ce = new ComputeEngine();
    ce.declare('AsyncOnly', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => ce.number(x.re * 10),
    });
    const byName = ce
      .box(['List', ['Spread', ['Map', 'AsyncOnly', ['List', 1, 2]]]])
      .evaluate();
    expect(byName.operator).not.toBe('List');
    const byLambda = ce
      .box([
        'List',
        [
          'Spread',
          ['Map', ['Function', ['AsyncOnly', 'x'], 'x'], ['List', 1, 2]],
        ],
      ])
      .evaluate();
    expect(byLambda.operator).not.toBe('List');
  });
});
