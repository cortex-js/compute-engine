/**
 * The reads that need the count of a finite collection with no count.
 *
 * `FlatMap([1, 2, 3], x ↦ [x, x])` is finite, but its count is known only
 * after the callback is applied to each element, and the `count` facet does
 * not apply a callback. `Count`, `Length`, `IsEmpty`, `Last`, a negative
 * index, `Reverse`, `Most`, `RotateLeft` and `RotateRight` stayed
 * unevaluated. They now walk the collection once, outside the facets
 * (`listFiniteUncountedCollection()`, `finiteUncountedIsEmpty()` and
 * `viewOverListedSource()`, `collection-utils.ts`).
 *
 * A walk answers only when it lists every element: the iterator of `FlatMap`
 * records an inner result that it cannot walk (`incomplete-walks.ts`), and
 * the read then stays unevaluated.
 */

import { ComputeEngine } from '../../src/compute-engine';

const doubled = [
  'FlatMap',
  ['List', 1, 2, 3],
  ['Function', ['List', 'x', 'x'], 'x'],
];

const doubledLatex = '\\operatorname{FlatMap}([1, 2, 3], x \\mapsto [x, x])';

const allEmpty = ['FlatMap', ['List', 1, 2], ['Function', ['List'], 'x']];

describe('reads that need the count of a FlatMap', () => {
  const ce = new ComputeEngine();
  const value = (expr: unknown) =>
    ce.box(expr as any).evaluate({ materialization: true }).json;

  test('box route', () => {
    expect(value(['Count', doubled])).toBe(6);
    expect(value(['Length', doubled])).toBe(6);
    expect(value(['IsEmpty', doubled])).toBe('False');
    expect(value(['Last', doubled])).toBe(3);
    expect(value(['At', doubled, -1])).toBe(3);
    expect(value(['At', doubled, -3])).toBe(2);
    expect(value(['At', doubled, -7])).toEqual('NaN');
    expect(value(['At', doubled, ['List', -1, 1]])).toEqual(['List', 3, 1]);
    expect(
      value([
        'At',
        doubled,
        ['List', 'True', 'False', 'True', 'False', 'True', 'False'],
      ])
    ).toEqual(['List', 1, 2, 3]);
    expect(value(['Reverse', doubled])).toEqual(['List', 3, 3, 2, 2, 1, 1]);
    expect(value(['Most', doubled])).toEqual(['List', 1, 1, 2, 2, 3]);
    expect(value(['RotateLeft', doubled])).toEqual(['List', 1, 2, 2, 3, 3, 1]);
    expect(value(['RotateLeft', doubled, 2])).toEqual([
      'List',
      2,
      2,
      3,
      3,
      1,
      1,
    ]);
    expect(value(['RotateRight', doubled])).toEqual(['List', 3, 1, 1, 2, 2, 3]);
  });

  test('parse route', () => {
    const parsed = (latex: string) =>
      ce.parse(latex).evaluate({ materialization: true }).json;
    expect(parsed(`\\operatorname{Last}(${doubledLatex})`)).toBe(3);
    expect(parsed(`\\operatorname{Count}(${doubledLatex})`)).toBe(6);
    expect(parsed(`\\operatorname{Reverse}(${doubledLatex})`)).toEqual([
      'List',
      3,
      3,
      2,
      2,
      1,
      1,
    ]);
  });

  test('the display of a view that reads from the end', () => {
    expect(ce.box(['Reverse', doubled]).evaluate().toString()).toBe(
      '[3,3,2,2,1,1]'
    );
  });

  test('a FlatMap whose callback results are all empty', () => {
    expect(value(['Take', allEmpty, 1])).toEqual(['List']);
    expect(value(['Count', allEmpty])).toBe(0);
    expect(value(['IsEmpty', allEmpty])).toBe('True');
    expect(value(['IsEmpty', ['Take', allEmpty, 1]])).toBe('True');
    expect(value(['Reverse', allEmpty])).toEqual(['List']);
    expect(value(['Last', allEmpty])).toBe('Missing');
  });

  test('a collection larger than maxCollectionSize stays unevaluated', () => {
    const small = new ComputeEngine();
    small.maxCollectionSize = 4;
    for (const op of ['Count', 'Last', 'Reverse']) {
      const result = small
        .box([op, doubled])
        .evaluate({ materialization: true });
      expect(result.operator).toBe(op);
    }
  });
});

describe('a walk that misses elements does not answer', () => {
  // `v` has no value, so the elements of `Join([x], v)` are not known, and
  // neither are the elements of the FlatMap. Before, the walk read
  // `Join([x], v)` as `[x]`: `Take(…, 3)` was `[1, 2]`.
  const ce = new ComputeEngine();
  ce.declare('v', 'list<integer>');
  const joined = [
    'FlatMap',
    ['List', 1, 2],
    ['Function', ['Join', ['List', 'x'], 'v'], 'x'],
  ];
  // The inner `Reverse` over a `FlatMap` cannot be walked: its source has no
  // count, and the list of its source misses the elements of `v`. Before,
  // the walk read it as empty: `Take(…, 3)` was `[]`. (Over a source that can
  // be listed, the inner `Reverse` is walked: see the next test.)
  const reversed = [
    'FlatMap',
    ['List', 1, 2],
    [
      'Function',
      [
        'Reverse',
        [
          'FlatMap',
          ['List', 'x'],
          ['Function', ['Join', ['List', 'y'], 'v'], 'y'],
        ],
      ],
      'x',
    ],
  ];

  test('an inner Reverse over a source that can be listed is walked', () => {
    const listable = [
      'FlatMap',
      ['List', 1, 2],
      [
        'Function',
        [
          'Reverse',
          ['FlatMap', ['List', 'x'], ['Function', ['List', 'y', 'y'], 'y']],
        ],
        'x',
      ],
    ];
    expect(
      ce
        .box(['Take', listable, 3])
        .evaluate({ materialization: true })
        .toString()
    ).toBe('[1,1,2]');
  });

  test('the materialization keeps the lazy form', () => {
    for (const fm of [joined, reversed]) {
      const take = ce.box(['Take', fm, 3]);
      expect(take.evaluate({ materialization: true }).operator).toBe('Take');
      // A second walk reads the element memo: the memo must not keep the
      // walk that missed elements.
      expect(take.evaluate({ materialization: true }).operator).toBe('Take');
      expect(ce.box(fm).evaluate({ materialization: true }).operator).toBe(
        'FlatMap'
      );
    }
  });

  test('the reads stay unevaluated', () => {
    for (const op of ['Count', 'Last', 'IsEmpty']) {
      const result = ce.box([op, ['Take', joined, 3]]).evaluate();
      expect(result.operator).toBe(op);
    }
  });

  test('a symbol of a list type with no value is not one element', () => {
    const fm = ['FlatMap', ['List', 1], ['Function', 'v', 'x']];
    expect(ce.box(fm).evaluate({ materialization: true }).operator).toBe(
      'FlatMap'
    );
    expect(ce.box(['IsEmpty', ['Take', fm, 3]]).evaluate().operator).toBe(
      'IsEmpty'
    );
  });
});

describe('an impure callback is applied once for each element of a read', () => {
  function counting(): { ce: ComputeEngine; calls: () => number } {
    const ce = new ComputeEngine();
    let n = 0;
    ce.declare('Tick', {
      signature: '() -> number',
      pure: false,
      evaluate: () => ce.number(++n),
    });
    return { ce, calls: () => n };
  }

  const ticks = [
    'FlatMap',
    ['List', 1, 2, 3],
    ['Function', ['List', ['Tick'], ['Tick']], 'x'],
  ];

  test.each([
    [['Count', ticks], 6],
    [['Length', ticks], 6],
    [['Last', ticks], 6],
    [['At', ticks, -2], 5],
  ])('%j', (expr, expected) => {
    const { ce, calls } = counting();
    expect(ce.box(expr as any).evaluate().json).toBe(expected);
    expect(calls()).toBe(6);
  });

  test('IsEmpty stops at the first element', () => {
    const { ce, calls } = counting();
    expect(ce.box(['IsEmpty', ticks]).evaluate().json).toBe('False');
    expect(calls()).toBe(2);
  });

  test.each([
    ['Reverse', [6, 5, 4, 3, 2, 1]],
    ['Most', [1, 2, 3, 4, 5]],
    ['RotateLeft', [2, 3, 4, 5, 6, 1]],
    ['RotateRight', [6, 1, 2, 3, 4, 5]],
  ])('%s lists the collection once', (op, expected) => {
    const { ce, calls } = counting();
    expect(
      ce.box([op, ticks]).evaluate({ materialization: true }).json
    ).toEqual(['List', ...expected]);
    expect(calls()).toBe(6);
  });

  test('the asynchronous route', async () => {
    const { ce, calls } = counting();
    const result = await ce
      .box(['Reverse', ticks])
      .evaluateAsync({ materialization: true });
    expect(result.json).toEqual(['List', 6, 5, 4, 3, 2, 1]);
    expect(calls()).toBe(6);
  });
});

describe('a view read by position over a source with no count', () => {
  // `Take`, `Drop` and `Rest` read their source with `at()`. The `at()` of
  // `Partition` and `SlidingWindow` needed the count of the source, and gave
  // nothing when the count was not known or was a `bigint`, while the view
  // claimed to be enumerable: the walk of `Take` was empty, and its consumers
  // read it as an empty collection.
  const ce = new ComputeEngine();
  const value = (expr: unknown) =>
    ce.box(expr as any).evaluate({ materialization: true }).json;
  const pairs = ['Partition', doubled, 2];
  const identity = Array.from({ length: 25 }, (_, i) => i + 1);
  const lastTwoSwapped = [...identity.slice(0, 23), 25, 24];

  test('the at() of a window', () => {
    const view = ce.box(pairs);
    expect(view.isEnumerableCollection).toBe(true);
    expect(view.at(1)?.json).toEqual(['List', 1, 1]);
    expect(view.at(3)?.json).toEqual(['List', 3, 3]);
    expect(view.at(4)).toBeUndefined();
    // The trailing chunk is shorter, and a sliding window is complete.
    expect(value(['At', ['Partition', doubled, 4], 2])).toEqual(['List', 3, 3]);
    expect(value(['At', ['Partition', doubled, 4], 3])).toBe('Missing');
    expect(value(['At', ['Partition', doubled, 4, 1], 4])).toBe('Missing');
  });

  test('box route', () => {
    expect(value(['Take', pairs, 1])).toEqual(['List', ['List', 1, 1]]);
    expect(value(['IsEmpty', ['Take', pairs, 1]])).toBe('False');
    expect(value(['Count', ['Take', pairs, 1]])).toBe(1);
    expect(value(['Drop', pairs, 1])).toEqual([
      'List',
      ['List', 2, 2],
      ['List', 3, 3],
    ]);
    expect(value(['Rest', pairs])).toEqual([
      'List',
      ['List', 2, 2],
      ['List', 3, 3],
    ]);
    expect(value(['Take', ['Partition', doubled, 2, 1], 2])).toEqual([
      'List',
      ['List', 1, 1],
      ['List', 1, 2],
    ]);
    expect(value(['Take', ['SlidingWindow', doubled, 2], 1])).toEqual([
      'List',
      ['List', 1, 1],
    ]);
  });

  test('a source whose count is a bigint', () => {
    expect(
      value(['Take', ['Partition', ['Permutations', ['Range', 1, 25]], 2], 1])
    ).toEqual([
      'List',
      ['List', ['List', ...identity], ['List', ...lastTwoSwapped]],
    ]);
  });

  test('parse route', () => {
    expect(
      ce
        .parse(
          `\\operatorname{Take}(\\operatorname{Partition}(${doubledLatex}, 2), 1)`
        )
        .evaluate({ materialization: true }).json
    ).toEqual(['List', ['List', 1, 1]]);
  });

  test('Cycle reads a source with no count in order', () => {
    expect(value(['Take', ['Cycle', doubled], 8])).toEqual([
      'List',
      1,
      1,
      2,
      2,
      3,
      3,
      1,
      1,
    ]);
    expect(value(['First', ['Cycle', doubled]])).toBe(1);
    expect(value(['At', ['Cycle', doubled], 8])).toBe(1);
  });

  test('Chunk of a very large source stays unevaluated', () => {
    // It listed the 25! elements of the source, and the process ran out of
    // memory.
    expect(
      ce.box(['Chunk', ['Permutations', ['Range', 1, 25]], 2]).evaluate()
        .operator
    ).toBe('Chunk');
    expect(value(['Chunk', doubled, 2])).toEqual([
      'List',
      ['List', 1, 1, 2],
      ['List', 2, 3, 3],
    ]);
  });
});

describe('the readers of a walk that misses elements stay unevaluated', () => {
  // `v` has no value, so the second element of `joined` is the first element
  // of `v`, which is not known. The walk of `joined` reads `Join([x], v)` as
  // `[x]`, and the readers answered from that walk: `Second(joined)` was 2.
  const ce = new ComputeEngine();
  ce.declare('v', 'list<integer>');
  const joined = [
    'FlatMap',
    ['List', 1, 2],
    ['Function', ['Join', ['List', 'x'], 'v'], 'x'],
  ];
  const joinedLatex =
    '\\operatorname{FlatMap}([1, 2], x \\mapsto \\operatorname{Join}([x], v))';
  // The iterator of `FlatMap` gives the symbol `v` as one element.
  const symbol = ['FlatMap', ['List', 1, 2], ['Function', 'v', 'x']];
  const taken = ['Take', joined, 3];
  const p = (body: unknown) => ['Function', body, 'x'];
  const add = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

  const readers: unknown[][] = [
    ['At', joined, 2],
    ['Second', joined],
    // The first element is 1, but the walk that gives it already met `v`, and
    // an element that such a walk gives is not used (`MeasuredWalk`).
    ['First', joined],
    ['IndexOf', joined, 2],
    ['IndexWhere', joined, p(['Greater', 'x', 1])],
    ['Find', joined, p(['Greater', 'x', 1])],
    ['Any', joined, p(['Greater', 'x', 5])],
    ['Any', joined, p(['Equal', 'x', 1])],
    ['All', joined, p(['Less', 'x', 5])],
    ['First', symbol],
    ['At', symbol, 1],
    ['First', taken],
    ['At', taken, 2],
    ['At', taken, ['List', 1, 2]],
    ['CountIf', taken, p(['Greater', 'x', 0])],
    ['Contains', taken, 2],
    ['Contains', ['Filter', joined, p('True')], 2],
    ['IsEmpty', ['Filter', symbol, p('True')]],
    ['Reduce', taken, add],
    ['Fold', add, 0, taken],
    ['Max', taken],
    ['Mean', taken],
    ['Tally', taken],
    ['Unique', taken],
    ['ListFrom', taken],
    ['StartsWith', taken, ['List', 1]],
    ['Position', taken, p(['Greater', 'x', 1])],
    ['Partition', taken, p(['Greater', 'x', 1])],
    ['Chunk', taken, 2],
    ['Differences', taken],
    ['Subset', ['Set', 1], ['SetFrom', taken]],
    // `Sum` is lazy, and it folds with its own walk.
    ['Sum', taken],
    ['Sum', ['Map', p(['Add', 'x', 1]), taken]],
    // `Product` of a collection is a `Reduce`.
    ['Product', taken],
  ];

  test.each(readers.map((expr) => [JSON.stringify(expr), expr]))(
    '%s',
    (_name, expr) => {
      const result = ce.box(expr as any).evaluate({ materialization: true });
      expect(result.toString()).toMatch(/FlatMap/);
    }
  );

  test('parse route of the lazy readers', () => {
    for (const latex of [
      `\\operatorname{Any}(${joinedLatex}, x \\mapsto x > 5)`,
      `\\operatorname{All}(${joinedLatex}, x \\mapsto x < 5)`,
      `\\operatorname{At}(${joinedLatex}, 2)`,
      `\\operatorname{IndexOf}(${joinedLatex}, 2)`,
    ]) {
      const result = ce.parse(latex).evaluate();
      expect(result.toString()).toMatch(/FlatMap/);
    }
  });

  test('the asynchronous route', async () => {
    for (const expr of [
      ['Any', joined, p(['Greater', 'x', 5])],
      ['CountIf', taken, p(['Greater', 'x', 0])],
      ['Max', taken],
      ['Sum', taken],
    ]) {
      const result = await ce.box(expr as any).evaluateAsync();
      expect(result.toString()).toMatch(/FlatMap/);
    }
  });

  test('a walk that lists every element still answers', () => {
    const doubledValue = (expr: unknown) => ce.box(expr as any).evaluate().json;
    expect(doubledValue(['Second', doubled])).toBe(1);
    expect(doubledValue(['IndexOf', doubled, 3])).toBe(5);
    expect(doubledValue(['Any', doubled, p(['Greater', 'x', 2])])).toBe('True');
    expect(doubledValue(['All', doubled, p(['Less', 'x', 5])])).toBe('True');
    expect(doubledValue(['Find', doubled, p(['Greater', 'x', 1])])).toBe(2);
    expect(
      doubledValue(['CountIf', ['Take', doubled, 3], p(['Greater', 'x', 1])])
    ).toBe(1);
    expect(doubledValue(['Max', ['Take', doubled, 3]])).toBe(2);
    expect(doubledValue(['Sum', ['Take', doubled, 3]])).toBe(4);
  });
});

describe('an eager operator over a very large source', () => {
  // These operators keep every element of their source, or a value for each
  // element, in their result. With no bound, a source of 25! elements did not
  // end (`Tally`, `Unique`, `GroupBy`, `ChunkBy`, `Partition` with a
  // predicate, `Position`) or ran out of memory (`Chunk`, `StartsWith`,
  // `ListFrom`, …). They now list at most `maxCollectionSize` elements and
  // stay unevaluated past that bound.
  const ce = new ComputeEngine();
  const huge = ['Permutations', ['Range', 1, 25]];
  const p = (body: unknown) => ['Function', body, 'x'];

  test.each([
    ['Tally', huge],
    ['Unique', huge],
    ['GroupBy', huge, p(1)],
    ['ChunkBy', huge, p(1)],
    ['Partition', huge, p('True')],
    ['Position', huge, p('True')],
    ['Chunk', huge, 2],
    ['StartsWith', huge, ['List', 1]],
    ['EndsWith', huge, ['List', 1]],
    ['RangeOf', huge, ['List', 1]],
    ['ContainsSequence', huge, ['List', 1]],
    ['ListFrom', huge],
    ['SetFrom', huge],
    ['TupleFrom', huge],
    ['TakeWhile', huge, p('True')],
  ])(
    '%s stays unevaluated',
    (...expr) => {
      const start = Date.now();
      const result = ce.box(expr as any).evaluate();
      expect(result.operator).toBe(expr[0]);
      // The time depends on the load of the machine, so the limit is
      // asserted only in a `CE_PERF=1` run. The test timeout below catches a
      // walk that does not end.
      if (process.env.CE_PERF === '1')
        expect(Date.now() - start).toBeLessThan(500);
    },
    5000
  );

  test('a count by walk over a source with a bigint count', () => {
    // The walk ends at once: the first element does not satisfy the
    // predicate.
    expect(
      ce.box(['Count', ['TakeWhile', huge, p('False')]]).evaluate().json
    ).toBe(0);
    // A run of more than `maxCollectionSize` elements: the count is not
    // known.
    expect(ce.box(['Count', ['ChunkBy', huge, p(1)]]).evaluate().operator).toBe(
      'Count'
    );
  }, 5000);

  test('a source with no count is bounded by its walk', () => {
    const small = new ComputeEngine();
    small.maxCollectionSize = 4;
    // Six elements, and the count is not known before the walk.
    for (const op of ['Tally', 'Unique', 'ListFrom']) {
      const result = small.box([op, doubled]).evaluate();
      if (op === 'ListFrom') {
        // `ListFrom` is the explicit way to list a collection: only a source
        // whose count is a `bigint` stays unevaluated.
        expect(result.json).toEqual(['List', 1, 1, 2, 2, 3, 3]);
      } else expect(result.operator).toBe(op);
    }
    expect(small.box(['GroupBy', doubled, p(1)]).evaluate().operator).toBe(
      'GroupBy'
    );
  });

  test('a source within the bound still answers', () => {
    expect(ce.box(['Unique', doubled]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
    expect(
      ce.box(['Position', doubled, p(['Greater', 'x', 2])]).evaluate().json
    ).toEqual(['List', 5, 6]);
    expect(
      ce.box(['StartsWith', doubled, ['List', 1, 1]]).evaluate().json
    ).toBe('True');
  });
});

describe('a nested FlatMap that meets an inner collection it cannot walk', () => {
  // The inner `FlatMap` reports that it can be walked, but its walk meets
  // `Join([y], v)` with a valueless `v`. The materialization of the outer
  // `FlatMap` (here, the listing that `toString()` asks for) listed `[1]`,
  // without the elements of `v`. `evaluate()` keeps a `FlatMap` lazy.
  const ce = new ComputeEngine();
  ce.declare('v', 'list<integer>');
  const nested = [
    'FlatMap',
    ['List', 1],
    [
      'Function',
      [
        'FlatMap',
        ['List', 'x'],
        ['Function', ['Join', ['List', 'y'], 'v'], 'y'],
      ],
      'x',
    ],
  ];

  test('the view stays lazy on the box route and the parse route', () => {
    expect(ce.box(nested).evaluate().toString()).toMatch(/^FlatMap\(/);
    expect(ce.box(['Sum', nested]).evaluate().operator).toBe('Sum');
    expect(
      ce
        .parse(
          '\\operatorname{FlatMap}([1], x \\mapsto \\operatorname{FlatMap}([x], y \\mapsto \\operatorname{Join}([y], v)))'
        )
        .evaluate()
        .toString()
    ).toMatch(/^FlatMap\(/);
  });

  test('a nested FlatMap with known elements is listed', () => {
    expect(
      ce
        .box([
          'FlatMap',
          ['List', 1, 2],
          [
            'Function',
            ['FlatMap', ['List', 'x'], ['Function', ['List', 'y', 'y'], 'y']],
            'x',
          ],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,1,2,2]');
  });
});

describe('the bounds of a walk apply only where a walk cannot end', () => {
  const ce = new ComputeEngine();
  ce.declare('v', 'list<integer>');
  const p = (body: unknown) => ['Function', body, 'x'];
  const huge = ['Permutations', ['Range', 1, 25]];
  const joined = [
    'FlatMap',
    ['List', 1, 2],
    ['Function', ['Join', ['List', 'x'], 'v'], 'x'],
  ];
  const taken = ['Take', joined, 3];
  const timed = (expr: unknown, limit = 500) => {
    const start = Date.now();
    const result = ce.box(expr as any).evaluate();
    // The time depends on the load of the machine, so the limit is asserted
    // only in a `CE_PERF=1` run. The test timeouts catch a walk that does
    // not end.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(limit);
    return result;
  };

  test('a run of ChunkBy over a source with a count is read whole', () => {
    // The run limit applies only to a source with a `bigint` count: the
    // first run of this view is the whole range.
    const runs = ['ChunkBy', ['Range', 1, 20000], p(1)];
    expect(ce.box(['Count', ['First', runs]]).evaluate().json).toBe(20000);
    expect(ce.box(['Count', ['ListFrom', runs]]).evaluate().json).toBe(1);
    expect(ce.box(['Count', runs]).evaluate().json).toBe(1);
  });

  test('a run of ChunkBy that is too long is not known, and nothing throws', () => {
    const runs = ['ChunkBy', huge, p(1)];
    for (const expr of [
      ['First', runs],
      ['ListFrom', runs],
      ['Count', runs],
      ['Any', runs, p('False')],
    ])
      expect(ce.box(expr as any).evaluate().operator).toBe(expr[0]);
  }, 5000);

  test('Cycle over a source whose finiteness is not known', () => {
    // The walk of the source stops at its iteration limit. The element is
    // not known: the read stays unevaluated, and nothing throws.
    const cycle = [
      'Cycle',
      ['Filter', ['Range', 1, 'PositiveInfinity'], p(['Less', 'x', 3])],
    ];
    expect(ce.box(['At', cycle, 3]).evaluate().operator).toBe('At');
    expect(ce.box(['Third', cycle]).evaluate().operator).toBe('Third');
    expect(ce.box(['Take', cycle, 5]).evaluate().operator).toBe('Take');
    expect(ce.box(['First', cycle]).evaluate().json).toBe(1);
  });

  test('an eager operator over a list that is held in memory', () => {
    // A literal of 10001 integers is larger than `maxCollectionSize`, but
    // its elements are already held, so it is not bounded.
    const list = ['List', ...Array.from({ length: 10001 }, (_, i) => i % 7)];
    expect(ce.box(['Count', ['Unique', list]]).evaluate().json).toBe(7);
    expect(ce.box(['StartsWith', list, ['List', 0, 1]]).evaluate().json).toBe(
      'True'
    );
    expect(ce.box(['Count', ['First', ['Tally', list]]]).evaluate().json).toBe(
      7
    );
    expect(ce.box(['Count', ['GroupBy', list, p('x')]]).evaluate().json).toBe(
      7
    );
  });

  test('a callback that holds an unevaluated incomplete read', () => {
    // The read stays unevaluated, which is a correct result: the handler
    // that applies the callback keeps its own result.
    const sum = ['Sum', taken];
    const applied = ce
      .box(['Apply', ['Function', ['Add', 'a', sum], 'a'], 2])
      .evaluate();
    expect(applied.operator).toBe('Add');
    const grouped = ce
      .box(['GroupBy', ['List', 1, 2, 3], p(['Add', 'x', sum])])
      .evaluate();
    expect(grouped.operator).toBe('Dictionary');
    // A handler that walks the incomplete collection itself still stays
    // unevaluated.
    expect(ce.box(['Max', taken]).evaluate().operator).toBe('Max');
    expect(
      ce
        .box(['Add', 1, ['Max', taken]])
        .evaluate()
        .toString()
    ).toMatch(/FlatMap/);
  });

  test('a concurrent evaluation does not change the result', async () => {
    // `Factorial` has no collection operand, so its handler is not
    // measured, and a measured call is synchronous: a concurrent evaluation
    // that meets an incomplete walk cannot change the result.
    let stop = false;
    let iterations = 0;
    const loop = (async () => {
      while (!stop) {
        await ce.box(['Count', taken]).evaluateAsync();
        iterations += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })();
    const factorial = await ce.box(['Factorial', 40000]).evaluateAsync();
    const list = await ce
      .box(['List', ['Factorial', 30000], 1])
      .evaluateAsync();
    stop = true;
    await loop;
    expect(factorial.isNumberLiteral).toBe(true);
    expect(list.ops![0].isNumberLiteral).toBe(true);
    expect(iterations).toBeGreaterThan(0);
  }, 10000);

  test('a window of a source with no small count is read with one walk', () => {
    const first = timed(['First', ['Partition', huge, 10000]]);
    expect(first.nops).toBe(10000);
  }, 5000);

  test('Take of a source with no count walks it once', () => {
    const flat = ['FlatMap', ['Range', 1, 2000], p(['List', 'x'])];
    expect(timed(['Count', ['Take', flat, 2000]]).json).toBe(2000);
    expect(timed(['Last', ['Take', flat, 2000]]).json).toBe(2000);
    expect(timed(['Sum', ['Take', flat, 2000]]).json).toBe(2001000);
  }, 5000);

  test('Join with a part whose count is very large', () => {
    const permutation = Array.from({ length: 25 }, (_, i) => i + 1);
    const swapped = [...permutation.slice(0, 23), 25, 24];
    const join = ['Join', huge, ['List', 1]];
    expect(ce.box(['First', join]).evaluate().json).toEqual([
      'List',
      ...permutation,
    ]);
    expect(ce.box(['At', join, 2]).evaluate().json).toEqual([
      'List',
      ...swapped,
    ]);
    const range = ['Join', ['Range', 1, ['Power', 10, 20]], ['List', 1]];
    expect(ce.box(['First', range]).evaluate().json).toBe(1);
    expect(ce.box(['At', range, 5]).evaluate().json).toBe(5);
    // The last element needs the exact count: the read stays unevaluated.
    expect(ce.box(['Last', join]).evaluate().operator).toBe('Last');
  });
});

describe('Flatten of a collection that cannot be walked', () => {
  // `Flatten([[1], v, [2]])` with a valueless `v` kept `v` as one element:
  // its count was 3 and its sum `v + 3`. It stays unevaluated, as `FlatMap`
  // and `Join` do.
  const ce = new ComputeEngine();
  ce.declare('v', 'list<integer>');
  const flat = ['Flatten', ['List', ['List', 1], 'v', ['List', 2]]];

  test('the box route and the parse route stay unevaluated', () => {
    expect(ce.box(['Count', flat]).evaluate().operator).toBe('Count');
    expect(ce.box(['Sum', flat]).evaluate().operator).toBe('Sum');
    expect(ce.box(flat).evaluate().operator).toBe('Flatten');
    expect(
      ce.parse('\\operatorname{Flatten}([[1], v, [2]])').evaluate().operator
    ).toBe('Flatten');
  });

  test('a list with a value, and a scalar symbol, are flattened', () => {
    ce.assign('w', ce.box(['List', 5, 6]));
    expect(
      ce
        .box(['Flatten', ['List', ['List', 1], 'w']])
        .evaluate()
        .toString()
    ).toBe('[1,5,6]');
    expect(
      ce
        .box(['Flatten', ['List', ['List', 1], ['List', ['List', 2, 3]], 'x']])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,x]');
  });
});
