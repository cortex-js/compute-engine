import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine';
import { engine, exprToString } from '../utils';

function evaluate(expr: Expression): string {
  return exprToString(engine.expr(expr)?.evaluate({ materialization: true }));
}

const emptyList: Expression = ['List'];
const list: Expression = ['List', 7, 13, 5, 19, 2, 3, 11];

const list1: Expression = ['List', 100, 4, 2, 62, 34, 16, 8];
const list2: Expression = ['List', 9, 7, 2, 24];

// List with repeated elements
const list3: Expression = [
  'List',
  3,
  5,
  7,
  7,
  1,
  3,
  5,
  9,
  7,
  3,
  5,
  7,
  1,
  2,
  5,
  9,
];

const matrix: Expression = [
  'List',
  ['List', 2, 3, 4],
  ['List', 6, 7, 9],
  ['List', 11, 12, 13],
];
const range: Expression = ['Range', 2, 19, 2];
const bigRange: Expression = ['Range', 2, 200, 3];
const linspace: Expression = ['Linspace', 2, 100, 89];
const expression: Expression = ['Add', 2, ['Multiply', 3, 'x']];
const symbol: Expression = 'x';
const dict: Expression = [
  'Dictionary',
  ['Tuple', { str: 'x' }, 1],
  ['Tuple', { str: 'y' }, 2],
  ['Tuple', { str: 'z' }, 3],
];

const dictShorthand: Expression = { dict: { x: 1, y: 2, z: 3 } };

const tuple: Expression = ['Tuple', 7, 10, 13];

describe('COUNT', () => {
  test('Count empty list', () =>
    expect(evaluate(['Count', emptyList])).toEqual('0'));

  test('Count list', () =>
    expect(evaluate(['Count', list])).toMatchInlineSnapshot(`7`));

  test('Count matrix', () =>
    expect(evaluate(['Count', matrix])).toMatchInlineSnapshot(`3`));

  test('Count range', () =>
    expect(evaluate(['Count', range])).toMatchInlineSnapshot(`9`));

  test('Count linspace', () =>
    expect(evaluate(['Count', linspace])).toMatchInlineSnapshot(`11`));

  test('Count expression', () =>
    expect(evaluate(['Count', expression])).toMatchInlineSnapshot(`
      [
        "Count",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'collection'",
            "'finite_number'"
          ]
        ]
      ]
    `));

  test('Count symbol', () =>
    expect(evaluate(['Count', symbol])).toMatchInlineSnapshot(`
      [
        "Count",
        [
          "Error",
          ["ErrorCode", "incompatible-type", "'collection'", "'number'"]
        ]
      ]
    `));

  test('Count dict', () => {
    expect(evaluate(['Count', dict])).toMatchInlineSnapshot(`3`);
    expect(evaluate(['Count', dictShorthand])).toMatchInlineSnapshot(`3`);
  });

  test('Count tuple', () =>
    expect(evaluate(['Count', tuple])).toMatchInlineSnapshot(`3`));

  // Stage-2 corpus-audit finding: a symbolic bound reads as NaN through
  // `.re` and `range()` coerced it to 1, so `Count(Range(1, n))` collapsed
  // to the wrong scalar 1. The count is indeterminate: stay inert.
  test('Count range with symbolic bound stays inert', () =>
    expect(
      exprToString(engine.expr(['Count', ['Range', 1, 'n']]).evaluate())
    ).toMatchInlineSnapshot(`["Count", ["Range", 1, "n"]]`));

  test('Count infinite range', () =>
    expect(
      exprToString(
        engine.expr(['Count', ['Range', 1, { num: '+Infinity' }]]).evaluate()
      )
    ).toMatchInlineSnapshot(`PositiveInfinity`));

  test('Count linspace with symbolic count stays inert', () =>
    expect(
      exprToString(
        engine.expr(['Count', ['Linspace', 0, 1, 'n']]).evaluate()
      )
    ).toMatchInlineSnapshot(`["Count", ["Linspace", 0, 1, "n"]]`));
});

describe('TAKE', () => {
  test('empty list', () =>
    expect(evaluate(['Take', emptyList, 1])).toMatchInlineSnapshot(`["List"]`));

  test('list', () => {
    expect(evaluate(['Take', list, 1])).toMatchInlineSnapshot(`["List", 7]`);
    expect(evaluate(['Take', list, 2])).toMatchInlineSnapshot(
      `["List", 7, 13]`
    );
  });

  test('matrix', () =>
    expect(evaluate(['Take', matrix, 1])).toMatchInlineSnapshot(
      `["List", ["List", 2, 3, 4]]`
    )); // The first element of a matrix is its first row

  test('range', () => {
    expect(evaluate(['Take', range, 1])).toMatchInlineSnapshot(`["List", 2]`);
    expect(evaluate(['Take', bigRange, 1])).toMatchInlineSnapshot(
      `["List", 2]`
    );
  });

  test('linspace', () =>
    expect(evaluate(['Take', linspace, 1])).toMatchInlineSnapshot(
      `["List", 2]`
    ));

  test('tuple', () =>
    expect(evaluate(['Take', tuple, 1])).toMatchInlineSnapshot(`["List", 7]`));

  test('invalid argument', () => {
    expect(evaluate(['Take', expression, 1])).toMatchInlineSnapshot(`
      [
        "Take",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'finite_number'"
          ]
        ],
        1
      ]
    `);

    expect(evaluate(['Take', symbol, 1])).toMatchInlineSnapshot(`
      [
        "Take",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'number'"
          ]
        ],
        1
      ]
    `);

    expect(evaluate(['Take', dict, 1])).toMatchInlineSnapshot(`
      [
        "Take",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "dictionary<finite_integer>"
          ]
        ],
        1
      ]
    `);

    expect(evaluate(['Take', dictShorthand, 1])).toMatchInlineSnapshot(`
      [
        "Take",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "dictionary<finite_integer>"
          ]
        ],
        1
      ]
    `);
  });
});

describe('DROP 2', () => {
  test('empty list', () =>
    expect(evaluate(['Drop', emptyList, 2])).toMatchInlineSnapshot(`["List"]`));

  test('list', () =>
    expect(evaluate(['Drop', list, 2])).toMatchInlineSnapshot(
      `["List", 5, 19, 2, 3, 11]`
    ));

  test('matrix', () =>
    expect(evaluate(['Drop', matrix, 2])).toMatchInlineSnapshot(
      `["List", ["List", 11, 12, 13]]`
    ));

  test('range', () => {
    expect(evaluate(['Drop', range, 2])).toMatchInlineSnapshot(
      `["List", 6, 8, 10, 12, 14, 16, 18]`
    );
    expect(evaluate(['Drop', bigRange, 2])).toMatchInlineSnapshot(`
      [
        "List",
        8,
        11,
        14,
        17,
        20,
        "ContinuationPlaceholder",
        188,
        191,
        194,
        197,
        200
      ]
    `);
  });

  test('linspace', () =>
    expect(evaluate(['Drop', linspace, 2])).toMatchInlineSnapshot(`
      [
        "List",
        4.227272727272727,
        5.340909090909091,
        6.454545454545454,
        7.568181818181818,
        8.681818181818182,
        "ContinuationPlaceholder",
        95.54545454545455,
        96.6590909090909,
        97.77272727272727,
        98.88636363636364,
        100
      ]
    `));

  test('tuple', () =>
    expect(evaluate(['Drop', tuple, 2])).toMatchInlineSnapshot(`["List", 13]`));

  test('invalid argument', () => {
    expect(evaluate(['Drop', expression, 2])).toMatchInlineSnapshot(`
      [
        "Drop",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'finite_number'"
          ]
        ],
        2
      ]
    `);

    expect(evaluate(['Drop', symbol, 2])).toMatchInlineSnapshot(`
      [
        "Drop",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'number'"
          ]
        ],
        2
      ]
    `);

    expect(evaluate(['Drop', dict, 2])).toMatchInlineSnapshot(`
      [
        "Drop",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "dictionary<finite_integer>"
          ]
        ],
        2
      ]
    `);
  });
});

describe('SLICE (2,3)', () => {
  test('empty list', () =>
    expect(evaluate(['Slice', emptyList, 2, 3])).toMatchInlineSnapshot(
      `["List"]`
    ));

  test('list', () =>
    expect(evaluate(['Slice', list, 2, 3])).toMatchInlineSnapshot(
      `["List", 13, 5]`
    ));

  test('matrix', () =>
    expect(evaluate(['Slice', matrix, 2, 3])).toMatchInlineSnapshot(
      `["List", ["List", 6, 7, 9], ["List", 11, 12, 13]]`
    ));

  test('range', () =>
    expect(evaluate(['Slice', range, 2, 3])).toMatchInlineSnapshot(
      `["List", 4, 6]`
    ));

  test('linspace', () =>
    expect(evaluate(['Slice', linspace, 2, 3])).toMatchInlineSnapshot(
      `["List", 3.1136363636363633, 4.227272727272727]`
    ));

  test('tuple', () =>
    expect(evaluate(['Slice', tuple, 2, 3])).toMatchInlineSnapshot(
      `["List", 10, 13]`
    ));

  test('invalid argument', () => {
    expect(evaluate(['Slice', expression, 2, 3])).toMatchInlineSnapshot(`
      [
        "Slice",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'finite_number'"
          ]
        ],
        2,
        3
      ]
    `);

    expect(evaluate(['Slice', symbol, 2, 3])).toMatchInlineSnapshot(`
      [
        "Slice",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'number'"
          ]
        ],
        2,
        3
      ]
    `);

    expect(evaluate(['Slice', dict, 2, 3])).toMatchInlineSnapshot(`
      [
        "Slice",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "dictionary<finite_integer>"
          ]
        ],
        2,
        3
      ]
    `);
  });
});

describe('SLICE -1,1', () => {
  test('empty list', () =>
    expect(evaluate(['Slice', emptyList, -1, 1])).toMatchInlineSnapshot(
      `["List"]`
    ));

  test('list', () =>
    expect(evaluate(['Slice', list, -1, 1])).toMatchInlineSnapshot(`["List"]`));

  test('matrix', () =>
    expect(evaluate(['Slice', matrix, -1, 1])).toMatchInlineSnapshot(
      `["List"]`
    ));

  test('range', () =>
    expect(evaluate(['Slice', range, -1, 1])).toMatchInlineSnapshot(
      `["List"]`
    ));

  test('linspace', () =>
    expect(evaluate(['Slice', linspace, -1, 1])).toMatchInlineSnapshot(
      `["List"]`
    )); // Reversed bounds (last to first) yield an empty slice, like other collections

  test('expression', () =>
    expect(evaluate(['Slice', expression, -1, 1])).toMatchInlineSnapshot(`
      [
        "Slice",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'finite_number'"
          ]
        ],
        -1,
        1
      ]
    `));

  test('symbol', () =>
    expect(evaluate(['Slice', symbol, -1, 1])).toMatchInlineSnapshot(`
      [
        "Slice",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "'number'"
          ]
        ],
        -1,
        1
      ]
    `));

  test('dict', () =>
    expect(evaluate(['Slice', dict, -1, 1])).toMatchInlineSnapshot(`
      [
        "Slice",
        [
          "Error",
          [
            "ErrorCode",
            "incompatible-type",
            "'indexed_collection'",
            "dictionary<finite_integer>"
          ]
        ],
        -1,
        1
      ]
    `));

  test('tuple', () =>
    expect(evaluate(['Slice', tuple, -1, 1])).toMatchInlineSnapshot(
      `["List"]`
    ));
});

describe('OPERATIONS ON INDEXED COLLECTIONS', () => {
  test('At with positive index', () =>
    expect(evaluate(['At', list, 1])).toMatchInlineSnapshot(`7`));

  test('At with negative index', () =>
    expect(evaluate(['At', list, -2])).toMatchInlineSnapshot(`3`));

  test('At with multi-index on 1D list (stays symbolic)', () =>
    expect(evaluate(['At', list, 1, 2])).toMatchInlineSnapshot(
      `["At", ["List", 7, 13, 5, 19, 2, 3, 11], 1, 2]`
    )); // 1D list can't be double-indexed, stays symbolic

  test('At with multi-index on 2D matrix', () =>
    expect(evaluate(['At', matrix, 1, 2])).toMatchInlineSnapshot(`3`)); // Row 1, Column 2 → 3

  test('Chained At on a matrix-typed symbol (m[2][1])', () => {
    // Regression: `At(matrix, i)` must type as a row (a sub-tensor), so that a
    // chained/nested `At` — the lowering of `m[2][1]` — validates instead of
    // failing with `incompatible-type`. This exercises the type fall-through
    // path (symbol operand has no collection `elttype` handler).
    engine.assign('mtx', engine.box(matrix));
    const m = engine.box('mtx');
    expect(m.type.toString()).toMatchInlineSnapshot(`matrix<3x3>`);
    // A single index into the matrix yields a row (vector), not a scalar.
    expect(engine.box(['At', 'mtx', 2]).type.toString()).toMatchInlineSnapshot(
      `vector<3>`
    );
    // Nested `At` validates and evaluates (1-based indexing): row 2, column 1.
    expect(evaluate(['At', ['At', 'mtx', 2], 1])).toMatchInlineSnapshot(`6`);
  });

  test('Chained At on a flat-list-typed symbol stays sound', () => {
    // Sanity: a single index into a 1D list yields the scalar element type, so
    // a second `At` on that scalar does not validate (stays symbolic here).
    engine.assign('vec', engine.box(list));
    expect(engine.box(['At', 'vec', 1]).type.toString()).toMatchInlineSnapshot(
      `number`
    );
    expect(evaluate(['At', 'vec', 1])).toMatchInlineSnapshot(`7`);
  });

  test('At on a dictionary returns the value type (not the iteration pair)', () => {
    // Regression: `At(dict, key)` returns the VALUE, so its static type must be
    // the dictionary's value type — not the `tuple<string, T>` iteration pair
    // that `collectionElementType` reports for iteration. Otherwise `d["a"] + 10`
    // fails with `incompatible-type`.
    const at = engine.box(['At', dict, { str: 'x' }]);
    expect(at.type.toString()).toMatchInlineSnapshot(`finite_integer`);
    expect(
      engine.box(['Add', ['At', dict, { str: 'x' }], 10]).evaluate().toString()
    ).toMatchInlineSnapshot(`11`);
  });

  test('First', () =>
    expect(evaluate(['First', list])).toMatchInlineSnapshot(`7`));

  test('Second', () =>
    expect(evaluate(['Second', list])).toMatchInlineSnapshot(`13`));

  test('Last', () =>
    expect(evaluate(['Last', list])).toMatchInlineSnapshot(`11`));

  test('Rest', () =>
    expect(evaluate(['Rest', list])).toMatchInlineSnapshot(
      `["List", 13, 5, 19, 2, 3, 11]`
    ));

  test('Most', () =>
    expect(evaluate(['Most', list])).toMatchInlineSnapshot(
      `["List", 7, 13, 5, 19, 2, 3]`
    ));

  test('RotateLeft', () =>
    expect(evaluate(['RotateLeft', list1, 2])).toMatchInlineSnapshot(
      `["List", 2, 62, 34, 16, 8, 100, 4]`
    ));

  test('RotateRight', () =>
    expect(evaluate(['RotateRight', list1, 2])).toMatchInlineSnapshot(
      `["List", 16, 8, 100, 4, 2, 62, 34]`
    ));

  test('Sort', () =>
    expect(evaluate(['Sort', list])).toMatchInlineSnapshot(
      `["List", 2, 3, 5, 7, 11, 13, 19]`
    ));

  test('Ordering', () =>
    expect(evaluate(['Ordering', list])).toMatchInlineSnapshot(
      `["List", 5, 6, 3, 1, 7, 2, 4]`
    ));

  // test('Shuffle', () =>
  //   expect(evaluate(['Shuffle', list])).toMatchInlineSnapshot());

  test('Unique', () =>
    expect(evaluate(['Unique', list3])).toMatchInlineSnapshot(
      `["List", 3, 5, 7, 1, 9, 2]`
    ));

  test('Reverse', () =>
    expect(evaluate(['Reverse', list])).toMatchInlineSnapshot(
      `["List", 11, 3, 2, 19, 5, 13, 7]`
    ));

  // Regression: the `Reverse` iterator terminated on `index === 0`, but
  // `index` starts at -1 and only ever decreases (-1, -2, -3, …), so it
  // never equals 0. For a collection with no more elements than the default
  // materialization head size (5), the head loop in `materialize()` never
  // hits its own break condition either, so it kept consuming the iterator
  // past the end: `.at()` returned `undefined` for the out-of-range index,
  // and calling `.evaluate()` on that `undefined` "element" crashed with a
  // raw "Cannot read properties of undefined" instead of a MathJSON error.
  test('Reverse (short list, regression for out-of-range iterator crash)', () => {
    expect(() =>
      engine.box(['Reverse', ['List', 1, 2, 3]]).evaluate().toString()
    ).not.toThrow();
    expect(evaluate(['Reverse', ['List', 1, 2, 3]])).toMatchInlineSnapshot(
      `["List", 3, 2, 1]`
    );
    expect(evaluate(['Reverse', ['List', 1]])).toMatchInlineSnapshot(
      `["List", 1]`
    );
    expect(evaluate(['Reverse', emptyList])).toMatchInlineSnapshot(
      `["List"]`
    );
  });
});

describe('OPERATIONS ON NON-INDEXED COLLECTIONS', () => {
  test('Tally', () =>
    expect(evaluate(['Tally', list3])).toMatchInlineSnapshot(
      `["Pair", ["List", 3, 5, 7, 1, 9, 2], ["List", 3, 4, 4, 2, 2, 1]]`
    ));

  test('Flatten', () =>
    expect(evaluate(['Flatten', matrix])).toMatchInlineSnapshot(
      `["List", 2, 3, 4, 6, 7, 9, 11, 12, 13]`
    ));

  test('Map', () =>
    expect(
      evaluate(['Map', list, ['Function', ['Add', 'x', 1], 'x']])
    ).toMatchInlineSnapshot(`["List", 8, 14, 6, 20, 3, 4, 12]`));

  test('Map', () =>
    expect(evaluate(['Map', list, ['Add', '_', 1]])).toMatchInlineSnapshot(
      `["List", 8, 14, 6, 20, 3, 4, 12]`
    ));

  test('Filter a list', () =>
    expect(
      evaluate(['Filter', list, ['Greater', '_', 10]])
    ).toMatchInlineSnapshot(`["List", 13, 19, 11]`));

  test('Filter a set', () =>
    expect(
      evaluate(['Filter', 'Integers', ['Greater', '_', 10]])
    ).toMatchInlineSnapshot(
      `["Set", 11, 12, 13, 14, 15, "ContinuationPlaceholder"]`
    ));

  test('Reduce', () =>
    expect(
      evaluate(['Reduce', list, ['Add', '_1', '_2']])
    ).toMatchInlineSnapshot(`60`));

  test('Reduce', () =>
    expect(evaluate(['Reduce', list, 'Add'])).toMatchInlineSnapshot(`60`));

  test('Fold with a function symbol', () =>
    expect(
      evaluate(['Fold', 'Add', 10, ['List', 1, 2, 3]])
    ).toMatchInlineSnapshot(`16`));

  test('Fold with a lambda (foldl order)', () =>
    // ((0 - 1) - 2) - 3 = -6, confirming left-fold argument order
    expect(
      evaluate([
        'Fold',
        ['Function', ['Subtract', 'a', 'b'], 'a', 'b'],
        0,
        ['List', 1, 2, 3],
      ])
    ).toMatchInlineSnapshot(`-6`));

  test('Fold rational sum stays exact under evaluate(), float under N()', () => {
    // Regression: the compiled fast path folds with JS numbers and returns a
    // float, violating the Evaluate-vs-N exactness contract. `a + 1/k` over
    // Range(1,5) must stay exact (137/60) under evaluate(), and only numericize
    // under .N().
    const fold: Expression = [
      'Reduce',
      ['Range', 1, 5],
      ['Function', ['Add', 'a', ['Divide', 1, 'k']], 'a', 'k'],
      0,
    ];
    expect(engine.box(fold).evaluate().toString()).toMatchInlineSnapshot(
      `137/60`
    );
    expect(engine.box(fold).N().toString()).toMatchInlineSnapshot(
      `2.283333333333333`
    );
  });

  test('Product of a complex-valued Map keeps imaginary parts', () => {
    // Regression: (1+i)(2+i)(3+i) = 10i. A mis-typed real fast path would drop
    // the imaginary parts (via `item.re`) and return 6. Map must type as
    // complex so the fast path is correctly skipped.
    const p: Expression = [
      'Product',
      ['Map', ['Range', 1, 3], ['Function', ['Add', 'k', 'ImaginaryUnit'], 'k']],
    ];
    expect(engine.box(p).evaluate().toString()).toMatchInlineSnapshot(`10i`);
  });

  test('Map element type reflects the lambda result, not the source', () => {
    // Regression: `Map(Range(1,3), k |-> k + i)` must NOT be typed with the
    // source element type (integer). Its element type is the lambda's result
    // type (a complex-capable `number`), which keeps it out of the real-only
    // compiled fast path.
    const m: Expression = [
      'Map',
      ['Range', 1, 3],
      ['Function', ['Add', 'k', 'ImaginaryUnit'], 'k'],
    ];
    expect(engine.box(m).type.toString()).toMatchInlineSnapshot(
      `indexed_collection<number>`
    );
  });

  test('lazy op iterates an eager collection source', () => {
    // Regression: a `lazy: true` op (`Map`, `Filter`) keeps its source
    // un-evaluated. When that source is an *eager* collection operator
    // (`UnicodeScalars`, which only materializes a List on evaluation), the
    // op must still iterate it — `each()` materializes a non-iterable source
    // instead of yielding nothing.
    const m: Expression = [
      'Map',
      ['UnicodeScalars', { str: 'abc' }],
      ['Function', 'c', 'c'],
    ];
    expect(
      [...engine.box(m).evaluate().each()].map((x) => x.toString())
    ).toEqual(['97', '98', '99']);
    const f: Expression = [
      'Filter',
      ['UnicodeScalars', { str: 'abc' }],
      ['Function', ['Greater', 'c', 97], 'c'],
    ];
    expect(
      [...engine.box(f).evaluate().each()].map((x) => x.toString())
    ).toEqual(['98', '99']);
  });

  test('Append', () =>
    expect(
      evaluate(['Append', ['List', 1, 2, 3], 4])
    ).toMatchInlineSnapshot(`["List", 1, 2, 3, 4]`));

  test('Append to an empty list', () =>
    expect(evaluate(['Append', ['List'], 9])).toMatchInlineSnapshot(
      `["List", 9]`
    ));

  test('Zip', () =>
    expect(evaluate(['Zip', list1, list2])).toMatchInlineSnapshot(`
      [
        "List",
        ["Pair", 100, 9],
        ["Pair", 4, 7],
        ["Pair", 2, 2],
        ["Pair", 62, 24]
      ]
    `));

  test('Join', () =>
    expect(evaluate(['Join', list1, list2])).toMatchInlineSnapshot(
      `["List", 100, 4, 2, 62, 34, "ContinuationPlaceholder", 8, 9, 7, 2, 24]`
    )); // 11 elements: default materialization shows a 5-element head and tail
});

describe('ANY / ALL QUANTIFIERS', () => {
  const gt = (n: number): Expression => ['Greater', '_', n];

  test('Any with predicate: True when some element matches', () =>
    expect(evaluate(['Any', list, gt(10)])).toMatchInlineSnapshot(`True`));

  test('Any with predicate: False when no element matches', () =>
    expect(evaluate(['Any', list, gt(100)])).toMatchInlineSnapshot(`False`));

  test('All with predicate: True when every element matches', () =>
    expect(evaluate(['All', list, gt(0)])).toMatchInlineSnapshot(`True`));

  test('All with predicate: False when some element fails', () =>
    expect(evaluate(['All', list, gt(10)])).toMatchInlineSnapshot(`False`));

  test('Any without predicate: elements are the booleans', () =>
    expect(
      evaluate(['Any', ['List', 'False', 'True', 'False']])
    ).toMatchInlineSnapshot(`True`));

  test('All without predicate: elements are the booleans', () =>
    expect(
      evaluate(['All', ['List', 'True', 'False', 'True']])
    ).toMatchInlineSnapshot(`False`));

  test('All without predicate: all True', () =>
    expect(
      evaluate(['All', ['List', 'True', 'True']])
    ).toMatchInlineSnapshot(`True`));

  test('Empty collection: Any is False (vacuous)', () =>
    expect(evaluate(['Any', emptyList, gt(0)])).toMatchInlineSnapshot(`False`));

  test('Empty collection: All is True (vacuous)', () =>
    expect(evaluate(['All', emptyList, gt(0)])).toMatchInlineSnapshot(`True`));

  test('Any short-circuits over a huge lazy collection', () => {
    const t0 = Date.now();
    const result = engine
      .box(['Any', ['Range', 1, 1_000_000_000], gt(5)])
      .evaluate();
    const elapsed = Date.now() - t0;
    expect(result.symbol).toBe('True');
    expect(elapsed).toBeLessThan(1000);
  });

  test('All short-circuits to False over a huge lazy collection', () => {
    const t0 = Date.now();
    const result = engine
      .box(['All', ['Range', 1, 1_000_000_000], gt(5)])
      .evaluate();
    const elapsed = Date.now() - t0;
    expect(result.symbol).toBe('False');
    expect(elapsed).toBeLessThan(1000);
  });

  test('Any stays inert when the outcome is undetermined', () => {
    // 'X' is an unbound (uppercase) symbol, so X > 5 is neither True nor
    // False, and no earlier element short-circuits to True.
    const result = engine.box(['Any', ['List', 1, 2, 'X'], gt(5)]).evaluate();
    expect(result.operator).toBe('Any');
  });

  test('All stays inert when the outcome is undetermined', () => {
    const result = engine.box(['All', ['List', 3, 4, 'X'], gt(2)]).evaluate();
    expect(result.operator).toBe('All');
  });

  test('Any short-circuits to True even with an undetermined element present', () =>
    // A definite True (10 > 5) wins over the undetermined X > 5.
    expect(
      engine.box(['Any', ['List', 10, 'X'], gt(5)]).evaluate().symbol
    ).toBe('True'));
});

describe('SCAN / DIFFERENCES / TAKEWHILE / DROPWHILE / FLATMAP', () => {
  const str = (expr: Expression): string =>
    engine.box(expr).evaluate({ materialization: true }).toString();

  const add: Expression = ['Function', ['Add', 'a', 'b'], 'a', 'b'];
  const lessThan = (n: number): Expression => [
    'Function',
    ['Less', 'x', n],
    'x',
  ];
  // Iterate uses a 2-argument function `(index, acc)` and does NOT emit the
  // initial value as the first element: element k is f(k, element(k-1)).
  const doubleAcc: Expression = [
    'Function',
    ['Multiply', 2, 'acc'],
    'n',
    'acc',
  ];

  // --- Scan --------------------------------------------------------------
  test('Scan cumulative sum (same length as input)', () =>
    expect(str(['Scan', ['List', 1, 2, 3, 4], add])).toEqual('[1,3,6,10]'));

  test('Scan with an initial value seeds the first element', () =>
    expect(str(['Scan', ['List', 1, 2, 3], add, 10])).toEqual('[11,13,16]'));

  test('Scan is lazy: Take over a huge Range is fast', () => {
    const t0 = Date.now();
    const result = engine
      .box(['Take', ['Scan', ['Range', 1, 1_000_000_000], add], 5])
      .evaluate({ materialization: true });
    const elapsed = Date.now() - t0;
    expect(result.toString()).toEqual('[1,3,6,10,15]');
    expect(elapsed).toBeLessThan(1000);
  });

  test('Scan reports its count without enumerating', () => {
    const t0 = Date.now();
    const count = engine.box(['Scan', ['Range', 1, 1_000_000_000], add]).count;
    const elapsed = Date.now() - t0;
    expect(count).toBe(1_000_000_000);
    expect(elapsed).toBeLessThan(1000);
  });

  test('Scan materializes to a List, not a Set (no generic-collection trap)', () => {
    const result = engine
      .box(['Scan', ['List', 1, 2, 3, 4], add])
      .evaluate({ materialization: true });
    expect(result.operator).toBe('List');
    expect((result.json as unknown[])[0]).toBe('List');
    expect(result.toString()).toEqual('[1,3,6,10]');
  });

  // --- Differences -------------------------------------------------------
  test('Differences of successive elements (length n-1)', () =>
    expect(str(['Differences', ['List', 1, 4, 9, 16]])).toEqual('[3,5,7]'));

  test('Differences of exact rationals stays exact', () =>
    expect(
      str(['Differences', ['List', ['Rational', 1, 2], ['Rational', 3, 4]]])
    ).toEqual('[1/4]'));

  test('Differences of a single-element list is empty', () =>
    expect(str(['Differences', ['List', 'x']])).toEqual('[]'));

  test('Differences reports its count without enumerating', () => {
    const t0 = Date.now();
    const count = engine.box(['Differences', ['Range', 1, 1_000_000_000]])
      .count;
    const elapsed = Date.now() - t0;
    expect(count).toBe(999_999_999);
    expect(elapsed).toBeLessThan(1000);
  });

  test('Differences materializes to a List, not a Set', () => {
    const result = engine
      .box(['Differences', ['List', 1, 4, 9, 16]])
      .evaluate({ materialization: true });
    expect(result.operator).toBe('List');
    expect((result.json as unknown[])[0]).toBe('List');
  });

  // --- TakeWhile / DropWhile --------------------------------------------
  test('TakeWhile yields the leading run satisfying the predicate', () =>
    expect(str(['TakeWhile', ['Range', 1, 100], lessThan(5)])).toEqual(
      '[1,2,3,4]'
    ));

  test('DropWhile skips the leading run then yields the rest', () =>
    expect(str(['DropWhile', ['Range', 1, 10], lessThan(8)])).toEqual(
      '[8,9,10]'
    ));

  test('TakeWhile composes lazily with an infinite source', () => {
    // Iterate((n, acc) -> 2*acc, 1) = 2, 4, 8, 16, ...; TakeWhile x < 100 keeps
    // the leading run. Enumerate via `each()` to avoid materializing the
    // infinite source.
    const tw = engine.box([
      'TakeWhile',
      ['Iterate', doubleAcc, 1],
      lessThan(100),
    ]);
    expect(Array.from(tw.each()).map((x) => x.toString())).toEqual([
      '2',
      '4',
      '8',
      '16',
      '32',
      '64',
    ]);
  });

  // --- FlatMap -----------------------------------------------------------
  test('FlatMap splices collection-valued results', () =>
    expect(
      str([
        'FlatMap',
        ['List', 1, 2, 3],
        ['Function', ['List', 'x', ['Power', 'x', 2]], 'x'],
      ])
    ).toEqual('[1,1,2,4,3,9]'));

  test('FlatMap coerces scalar results to singletons', () =>
    expect(
      str(['FlatMap', ['List', 1, 2], ['Function', ['Power', 'x', 2], 'x']])
    ).toEqual('[1,4]'));

  test('FlatMap materializes to a List, not a Set', () => {
    const result = engine
      .box([
        'FlatMap',
        ['List', 1, 2, 3],
        ['Function', ['List', 'x', ['Power', 'x', 2]], 'x'],
      ])
      .evaluate({ materialization: true });
    expect(result.operator).toBe('List');
    expect((result.json as unknown[])[0]).toBe('List');
  });
});

describe('MAP (variadic / zipWith)', () => {
  const str = (expr: Expression): string =>
    engine.box(expr).evaluate({ materialization: true }).toString();

  const add: Expression = ['Function', ['Add', 'a', 'b'], 'a', 'b'];
  const mul: Expression = ['Function', ['Multiply', 'a', 'b'], 'a', 'b'];
  const add3: Expression = [
    'Function',
    ['Add', 'a', 'b', 'c'],
    'a',
    'b',
    'c',
  ];

  test('two collections combine element-wise', () =>
    expect(
      str(['Map', ['List', 1, 2, 3], ['List', 10, 20, 30], add])
    ).toEqual('[11,22,33]'));

  test('result has the length of the shortest input', () =>
    expect(str(['Map', ['List', 1, 2, 3], ['List', 10, 20], add])).toEqual(
      '[11,22]'
    ));

  test('three collections', () =>
    expect(
      str(['Map', ['List', 1, 2], ['List', 3, 4], ['List', 5, 6], add3])
    ).toEqual('[9,12]'));

  test('laziness: .count and head of two infinite ranges are fast', () => {
    const expr = engine.box([
      'Map',
      ['Range', 1, 1e9],
      ['Range', 1, 1e9],
      add,
    ]);
    expect(expr.count).toBe(1e9);
    expect(expr.isFiniteCollection).toBe(true);
    expect(expr.at(2)?.toString()).toEqual('4');
    expect(str(['Take', ['Map', ['Range', 1, 1e9], ['Range', 1, 1e9], add], 3])).toEqual(
      '[2,4,6]'
    );
  });

  test('mixed finite/infinite: bounded by the finite input', () => {
    const expr = engine.box([
      'Map',
      ['Range', 1, 1e9],
      ['List', 1, 2, 3],
      mul,
    ]);
    expect(expr.count).toBe(3);
    expect(str(['Map', ['Range', 1, 1e9], ['List', 1, 2, 3], mul])).toEqual(
      '[1,4,9]'
    );
  });

  test('single-collection form is unchanged', () =>
    expect(
      str(['Map', ['List', 1, 2, 3], ['Function', ['Power', 'x', 2], 'x']])
    ).toEqual('[1,4,9]'));

  test('arity mismatch: too few lambda params yields an evaluation error', () => {
    // The mapping function declares one parameter but two collections are
    // supplied. The call canonicalizes fine (isValid), but the existing
    // arity-validation machinery reports the mismatch when the function is
    // applied (documented behavior, not a new check): plain evaluate() yields
    // an error value; forcing materialization (via .at() or materialization)
    // throws the same "Too many arguments" error.
    const expr = engine.box([
      'Map',
      ['List', 1, 2],
      ['List', 3, 4],
      ['Function', ['Power', 'x', 2], 'x'],
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toContain('Too many arguments');
    expect(() => expr.at(1)).toThrow(/Too many arguments/);
  });
});

// describe('NON-ITERABLE OPERATIONS', () => {

// })

describe('CONTINUATION PLACEHOLDER', () => {
  // Use lazy collections (e.g., Map) to test continuation placeholder

  // Check various eager evaluation
  test('empty list', () => {
    const empty_list = engine.expr(['Map', ['List'], ['Square', '_']]);
    expect(
      empty_list.evaluate({ materialization: false })
    ).toMatchInlineSnapshot(
      `["Map", ["List"], ["Function", ["Square", "_1"]]]`
    );
    expect(
      empty_list.evaluate({ materialization: true })
    ).toMatchInlineSnapshot(`["List"]`);
    expect(empty_list.evaluate({ materialization: 2 })).toMatchInlineSnapshot(
      `["List"]`
    );
    expect(
      empty_list.evaluate({ materialization: [2, 3] })
    ).toMatchInlineSnapshot(`["List"]`);
  });

  test('empty set', () => {
    const empty_set = engine.expr(['Map', ['Set'], ['Square', '_']]);
    expect(
      empty_set.evaluate({ materialization: false })
    ).toMatchInlineSnapshot(`["Map", ["Set"], ["Function", ["Square", "_1"]]]`);
    expect(empty_set.evaluate({ materialization: true })).toMatchInlineSnapshot(
      `["Set"]`
    );
    expect(empty_set.evaluate({ materialization: 2 })).toMatchInlineSnapshot(
      `["Set"]`
    );
    expect(
      empty_set.evaluate({ materialization: [2, 3] })
    ).toMatchInlineSnapshot(`["Set"]`);
  });

  test('finite list', () => {
    const finite_list = engine.expr([
      'Map',
      ['List', 1, 1, 2, 2, 3, 4, 7, 8, 9, 10, 11, 12, 14],
      ['Square', '_'],
    ]);
    expect(finite_list.evaluate({ materialization: false }))
      .toMatchInlineSnapshot(`
      [
        "Map",
        ["List", 1, 1, 2, 2, 3, 4, 7, 8, 9, 10, 11, 12, 14],
        ["Function", ["Block", ["Power", "_1", 2]], "_1"]
      ]
    `);
    expect(finite_list.evaluate({ materialization: true }))
      .toMatchInlineSnapshot(`
      [
        "List",
        1,
        1,
        4,
        4,
        9,
        "ContinuationPlaceholder",
        81,
        100,
        121,
        144,
        196
      ]
    `);
    expect(finite_list.evaluate({ materialization: 2 })).toMatchInlineSnapshot(
      `["List", 1, "ContinuationPlaceholder", 196]`
    );
    expect(
      finite_list.evaluate({ materialization: [2, 3] })
    ).toMatchInlineSnapshot(
      `["List", 1, 1, "ContinuationPlaceholder", 121, 144, 196]`
    );
    expect(finite_list.evaluate({ materialization: 20 })).toMatchInlineSnapshot(
      `["List", 1, 1, 4, 4, 9, 16, 49, 64, 81, 100, 121, 144, 196]`
    );
    expect(
      finite_list.evaluate({ materialization: [20, 30] })
    ).toMatchInlineSnapshot(
      `["List", 1, 1, 4, 4, 9, 16, 49, 64, 81, 100, 121, 144, 196]`
    );
  });

  test('finite set', () => {
    const finite_set = engine.expr([
      'Map',
      ['Set', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      ['Square', '_'],
    ]);
    expect(finite_set.evaluate({ materialization: false }))
      .toMatchInlineSnapshot(`
      [
        "Map",
        ["Set", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        ["Function", ["Square", "_1"]]
      ]
    `);
    expect(
      finite_set.evaluate({ materialization: true })
    ).toMatchInlineSnapshot(
      `["Set", 1, 4, 9, 16, 25, "ContinuationPlaceholder"]`
    );
    expect(finite_set.evaluate({ materialization: 2 })).toMatchInlineSnapshot(
      `["Set", 1, 4, "ContinuationPlaceholder"]`
    );
    expect(
      finite_set.evaluate({ materialization: [2, 3] })
    ).toMatchInlineSnapshot(`["Set", 1, 4, "ContinuationPlaceholder"]`);
    expect(finite_set.evaluate({ materialization: 20 })).toMatchInlineSnapshot(
      `["Set", 1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 169]`
    );
    expect(
      finite_set.evaluate({ materialization: [20, 30] })
    ).toMatchInlineSnapshot(
      `["Set", 1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 169]`
    );
  });

  test('infinite set', () => {
    const infinite_set = engine.expr(['Map', 'Integers', ['Square', '_']]);
    expect(
      infinite_set.evaluate({ materialization: false })
    ).toMatchInlineSnapshot(
      `["Map", "Integers", ["Function", ["Square", "_1"]]]`
    );
    expect(
      infinite_set.evaluate({ materialization: true })
    ).toMatchInlineSnapshot(`["Set", 0, 1, 4, "ContinuationPlaceholder"]`);
    expect(infinite_set.evaluate({ materialization: 2 })).toMatchInlineSnapshot(
      `["Set", 0, 1, "ContinuationPlaceholder"]`
    );
    expect(
      infinite_set.evaluate({ materialization: [2, 3] })
    ).toMatchInlineSnapshot(`["Set", 0, 1, "ContinuationPlaceholder"]`);
    expect(infinite_set.evaluate({ materialization: 20 }))
      .toMatchInlineSnapshot(`
      [
        "Set",
        0,
        1,
        4,
        9,
        16,
        25,
        36,
        49,
        64,
        81,
        100,
        "ContinuationPlaceholder"
      ]
    `);
    expect(infinite_set.evaluate({ materialization: [20, 30] }))
      .toMatchInlineSnapshot(`
      [
        "Set",
        0,
        1,
        4,
        9,
        16,
        25,
        36,
        49,
        64,
        81,
        100,
        "ContinuationPlaceholder"
      ]
    `);
  });
});

// Regressions for the collection-handler bugs reported in REVIEW.md (B3–B8).
describe('Collection handler regressions (REVIEW.md B3–B8)', () => {
  // B3: the Rest iterator re-declared `index` inside next(), so it never
  // advanced (yielded the 2nd element forever).
  test('B3: Rest materializes all remaining elements', () => {
    expect(evaluate(['Rest', ['List', 1, 2, 3, 4]])).toMatchInlineSnapshot(
      `["List", 2, 3, 4]`
    );
    expect(evaluate(['Rest', ['List', 5]])).toMatchInlineSnapshot(`["List"]`);
  });

  // B4: Slice.at computed bounds then fell off the end with no return (always
  // undefined); the count handler's negative-start formula was wrong.
  test('B4: Slice.at returns elements; count handles negative bounds', () => {
    const sl = engine.expr(['Slice', ['List', 10, 20, 30, 40], 2, 3]);
    expect(sl.at(1)?.toString()).toEqual('20');
    expect(sl.at(2)?.toString()).toEqual('30');
    expect(
      evaluate(['Slice', ['List', 10, 20, 30, 40], 2, 3])
    ).toMatchInlineSnapshot(`["List", 20, 30]`);
    expect(
      evaluate(['Slice', ['List', 1, 2, 3, 4, 5], -2, -1])
    ).toMatchInlineSnapshot(`["List", 4, 5]`);
    expect(
      engine.expr(['Slice', ['List', 1, 2, 3, 4, 5], -2, -1]).count
    ).toEqual(2);
  });

  // B5: SetFrom/TupleFrom had the collection test inverted (the exact inverse
  // of the correct ListFrom), so a collection arg was wrapped as one element.
  test('B5: SetFrom/TupleFrom flatten their collection argument', () => {
    expect(evaluate(['SetFrom', ['List', 1, 2, 2, 3]])).toMatchInlineSnapshot(
      `["Set", 1, 2, 3]`
    );
    expect(evaluate(['TupleFrom', ['List', 1, 2, 3]])).toMatchInlineSnapshot(
      `["Triple", 1, 2, 3]`
    );
  });

  // B6: Position threw on every match (missing `else` before the predicate
  // type-check throw).
  test('B6: Position returns indices of matching elements', () => {
    expect(
      evaluate([
        'Position',
        ['List', 1, 2, 3],
        ['Function', ['Greater', 'x', 1], 'x'],
      ])
    ).toMatchInlineSnapshot(`["List", 2, 3]`);
  });

  // B7: Cycle isEmpty/isFinite self-recursed (stack overflow) and isFinite was
  // inverted; the iterator was also off-by-one (started at index 0).
  test('B7: Cycle reports infinite/empty correctly and cycles elements', () => {
    expect(engine.expr(['Cycle', ['List', 1, 2, 3]]).isFiniteCollection).toBe(
      false
    );
    expect(engine.expr(['Cycle', ['List']]).isEmptyCollection).toBe(true);
    expect(
      evaluate(['Take', ['Cycle', ['List', 1, 2]], 5])
    ).toMatchInlineSnapshot(`["List", 1, 2, 1, 2, 1]`);
  });

  // B8: Drop.at returned undefined for n=0 and wrong elements for negative
  // indices; the iterator also emitted trailing Error elements past the end.
  test('B8: Drop handles n=0, negative indices, and materializes cleanly', () => {
    expect(
      engine
        .expr(['Drop', ['List', 1, 2, 3, 4, 5], 2])
        .at(-1)
        ?.toString()
    ).toEqual('5');
    expect(
      engine
        .expr(['Drop', ['List', 1, 2, 3], 0])
        .at(1)
        ?.toString()
    ).toEqual('1');
    expect(
      evaluate(['Drop', ['List', 1, 2, 3, 4, 5], 2])
    ).toMatchInlineSnapshot(`["List", 3, 4, 5]`);
  });
});

// REVIEW.md B15/B17/B18: statistics binning, Reduce initial value, Filter count.
describe('Binning, Reduce, Filter, Zip (REVIEW.md B15/B17/B18)', () => {
  it('B15: BinCounts counts the dataset maximum in the (closed) last bin', () => {
    expect(
      evaluate(['BinCounts', ['List', 1, 2, 2, 3], 3])
    ).toMatchInlineSnapshot(`["List", 1, 2, 1]`);
  });
  it('B17: Reduce honors an explicit initial value', () => {
    expect(
      evaluate([
        'Reduce',
        ['List', 1, 2, 3],
        ['Function', ['Add', 'acc', 'x'], 'acc', 'x'],
        100,
      ])
    ).toBe('106');
  });
  it('B18: Filter has a finite count over a finite source, so Sum evaluates', () => {
    expect(
      evaluate([
        'Sum',
        ['Filter', ['List', 1, 2, 3], ['Function', ['Greater', '_', 1], '_']],
      ])
    ).toBe('5');
  });
  it('B18: Zip is empty as soon as any input is empty', () => {
    expect(
      engine.expr(['Zip', ['List', 1, 2], ['List']]).isEmptyCollection
    ).toBe(true);
    expect(
      engine.expr(['Zip', ['List', 1, 2], ['List', 3, 4]]).isEmptyCollection
    ).toBe(false);
  });
});

describe('SYMBOLIC-BOUND COLLECTIONS STAY INERT', () => {
  // Stage-2 corpus-audit follow-up: a symbolic Range/Linspace reports an
  // indeterminate count (or declines enumeration), and every consumer must
  // stay inert rather than collapse to a fabricated scalar or literal —
  // previously Sum(Range(1,n)) → 1 and materialization produced [1].
  test('Sum over symbolic Range stays inert', () =>
    expect(
      exprToString(engine.expr(['Sum', ['Range', 1, 'n']]).evaluate())
    ).toMatchInlineSnapshot(`["Sum", ["Range", 1, "n"]]`));

  test('Sum over Linspace with symbolic endpoint stays inert', () =>
    // Concrete count (3) but unenumerable elements: folding would
    // silently produce the initial value 0
    expect(
      exprToString(engine.expr(['Sum', ['Linspace', 'x_1', 1, 3]]).evaluate())
    ).toMatchInlineSnapshot(`["Sum", ["Linspace", "x_1", 1, 3]]`));

  test('materialization keeps the lazy form', () => {
    expect(
      exprToString(
        engine.expr(['Range', 1, 'n']).evaluate({ materialization: true })
      )
    ).toMatchInlineSnapshot(`["Range", 1, "n"]`);
    expect(
      exprToString(
        engine
          .expr(['Linspace', 'x_1', 1, 3])
          .evaluate({ materialization: true })
      )
    ).toMatchInlineSnapshot(`["Linspace", "x_1", 1, 3]`);
  });

  test('each() yields nothing for a symbolic Range', () =>
    expect([...engine.expr(['Range', 1, 'n']).each()]).toHaveLength(0));

  test('extrema of a symbolic Range stay inert', () => {
    expect(
      exprToString(engine.expr(['Supremum', ['Range', 1, 'n']]).evaluate())
    ).toMatchInlineSnapshot(`["Supremum", ["Range", 1, "n"]]`);
    expect(
      exprToString(engine.expr(['Infimum', ['Range', 1, 'n']]).evaluate())
    ).toMatchInlineSnapshot(`["Infimum", ["Range", 1, "n"]]`);
  });

  test('extrema over an unenumerable collection stay inert (no grind, no drop)', () => {
    // Map over a continuous Interval: the dyadic sampler used to grind
    // until the evaluation deadline (>seconds); now inert immediately.
    const start = Date.now();
    const r = engine
      .expr([
        'Min',
        [
          'Map',
          ['Interval', ['Open', 0], ['Open', 'PositiveInfinity']],
          ['Function', ['GammaLn', 'x_1'], 'x_1'],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Min');
    expect(Date.now() - start).toBeLessThan(2000);

    // Map over a Linspace with a symbolic endpoint reports count 3 but
    // declines enumeration: it used to VANISH from the result
    // (Min(Map(...), 5) → 5). It must stay in the symbolic Min.
    const m = engine
      .expr([
        'Min',
        ['Map', ['Linspace', 'x_1', 1, 3], ['Function', ['Square', '_'], '_']],
        5,
      ])
      .evaluate();
    expect(m.operator).toBe('Min');
    expect(m.nops).toBe(2);

    // Controls: a genuinely empty lazy Filter still folds away, and finite
    // collections still fold.
    expect(
      exprToString(
        engine
          .expr([
            'Min',
            ['Filter', ['List', 1, 2], ['Function', ['Greater', '_', 5], '_']],
            9,
          ])
          .evaluate()
      )
    ).toBe('9');
    expect(
      exprToString(
        engine
          .expr([
            'Min',
            ['Filter', ['List', 1, 2, 8], ['Function', ['Greater', '_', 1], '_']],
          ])
          .evaluate()
      )
    ).toBe('2');
  });

  test('concrete controls are unaffected', () => {
    expect(exprToString(engine.expr(['Sum', ['Range', 1, 10]]).evaluate())).toBe(
      '55'
    );
    expect(
      exprToString(engine.expr(['Sum', ['Linspace', 0, 1, 3]]).evaluate())
    ).toBe('1.5');
    expect(
      exprToString(
        engine.expr(['Range', 1, 5]).evaluate({ materialization: true })
      )
    ).toMatchInlineSnapshot(`["List", 1, 2, 3, 4, 5]`);
    expect(
      exprToString(engine.expr(['Supremum', ['Range', 2, 9, 3]]).evaluate())
    ).toBe('8');
  });
});

describe('LIST LITERAL EVALUATION', () => {
  test('evaluates elements against bound symbols', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 7);
    expect(
      exprToString(ce.box(['List', 'y', ['Add', 'y', 1]]).evaluate())
    ).toBe('["List", 7, 8]');
  });

  test('.N() numericizes elements', () => {
    const ce = new ComputeEngine();
    expect(exprToString(ce.box(['List', ['Divide', 1, 3], 'Pi']).N())).toBe(
      '["List", 0.3333333333333333, 3.141592653589793]'
    );
  });

  test('exact elements stay symbolic under evaluate()', () => {
    const ce = new ComputeEngine();
    expect(exprToString(ce.box(['List', ['Ln', 2]]).evaluate())).toBe(
      '["List", ["Ln", 2]]'
    );
  });

  test('nested literals evaluate through', () => {
    const ce = new ComputeEngine();
    ce.assign('d', 5);
    expect(
      exprToString(
        ce.box(['List', ['Tuple', 'd', 1], ['List', 'd']]).evaluate()
      )
    ).toBe('["List", ["Pair", 5, 1], ["List", 5]]');
  });

  test('all-literal list is returned unchanged (fast path, identity)', () => {
    const ce = new ComputeEngine();
    const big = ce.box(['List', ...Array.from({ length: 5000 }, (_, i) => i)]);
    expect(big.evaluate() === big).toBe(true);
  });
});

describe('DICTIONARY LITERAL VALUE EVALUATION', () => {
  test('evaluates values against bound symbols', () => {
    const ce = new ComputeEngine();
    ce.assign('d', 5);
    const m = ce.box({ dict: { a: ce.box(['Add', 'd', 1]) as any } });
    expect(exprToString((m.evaluate() as any).get('a'))).toBe('6');
  });

  test('all-literal dictionary is returned unchanged (identity)', () => {
    const ce = new ComputeEngine();
    const m = ce.box({ dict: { a: 3, b: 'x' } });
    expect(m.evaluate() === m).toBe(true);
  });
});

describe('KEYS / VALUES', () => {
  const dict: Expression = [
    'Dictionary',
    ['Tuple', { str: 'a' }, 1],
    ['Tuple', { str: 'b' }, 2],
    ['Tuple', { str: 'c' }, 3],
  ];

  test('Keys returns the keys in iteration order', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Keys', dict]).evaluate().json).toEqual([
      'List',
      "'a'",
      "'b'",
      "'c'",
    ]);
  });

  test('Keys type is list<string>', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Keys', dict]).type.toString()).toBe('list<string>');
  });

  test('Values returns the values in iteration order', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Values', dict]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
  });

  test('Values type reflects the value types', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Values', dict]).type.toString()).toBe(
      'list<finite_integer>'
    );
  });

  test('Keys, Values and iteration order agree', () => {
    const ce = new ComputeEngine();
    const d = ce.box(dict);
    const keys = (ce.box(['Keys', dict]).evaluate().json as any[]).slice(1);
    const values = (ce.box(['Values', dict]).evaluate().json as any[]).slice(1);
    const iterated = Array.from(d.each()).map((kv) => [
      (kv as any).op1.json,
      (kv as any).op2.json,
    ]);
    expect(iterated).toEqual([
      ["'a'", 1],
      ["'b'", 2],
      ["'c'", 3],
    ]);
    expect(keys).toEqual(iterated.map((p) => p[0]));
    expect(values).toEqual(iterated.map((p) => p[1]));
  });
});

describe('UNION / INTERSECTION ON COLLECTIONS', () => {
  const listA: Expression = ['List', 1, 2, 3];
  const listB: Expression = ['List', 2, 3, 4];
  const setB: Expression = ['Set', 2, 3, 4];

  test('Union of two list literals is a deduped set', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Union', listA, listB]).evaluate().json).toEqual([
      'Set',
      1,
      2,
      3,
      4,
    ]);
  });

  test('Intersection of two list literals is a set', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Intersection', listA, listB]).evaluate().json).toEqual([
      'Set',
      2,
      3,
    ]);
  });

  test('Intersection of a list and a set operand', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Intersection', listA, setB]).evaluate().json).toEqual([
      'Set',
      2,
      3,
    ]);
  });

  test('Union of a list and a set operand', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Union', listA, setB]).evaluate().json).toEqual([
      'Set',
      1,
      2,
      3,
      4,
    ]);
  });

  test('Intersection dedups the result (set semantics)', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Intersection', ['List', 1, 2, 2, 3], listB]).evaluate().json
    ).toEqual(['Set', 2, 3]);
  });

  test('existing set-literal intersection is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Intersection', ['Set', 1, 2, 3], setB]).evaluate().json
    ).toEqual(['Set', 2, 3]);
  });

  test('Intersection of two lazy Filter results (regression: stack overflow)', () => {
    // `Filter`'s `contains` handler used to call `expr.contains()` on the
    // Filter expression itself, recursing without bound when `Intersection`
    // probed membership.
    const ce = new ComputeEngine();
    const even: Expression = ['Function', ['Equal', ['Mod', '_1', 2], 0], '_1'];
    const big: Expression = ['Function', ['Greater', '_1', 4], '_1'];
    expect(
      ce
        .box([
          'Intersection',
          ['Filter', ['Range', 1, 10], even],
          ['Filter', ['Range', 1, 10], big],
        ])
        .evaluate().json
    ).toEqual(['Set', 6, 8, 10]);
  });

  test('Filter membership checks the source collection and the predicate', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Filter',
      ['Range', 1, 10],
      ['Function', ['Greater', '_1', 4], '_1'],
    ]);
    expect(f.contains(ce.number(7))).toBe(true); // in source, passes predicate
    expect(f.contains(ce.number(2))).toBe(false); // in source, fails predicate
    expect(f.contains(ce.number(42))).toBe(false); // not in source
  });
});

describe('INDEXOF ON A TENSOR-BACKED LIST', () => {
  // A rectangular numeric list is boxed as a `BoxedTensor`, which inherited the
  // abstract no-op `indexWhere` and so made `IndexOf`/`IndexWhere` always return
  // 0. The base now provides a working 1-based scan for any finite indexed
  // collection.
  test('IndexOf returns the 1-based index of the first match', () => {
    expect(evaluate(['IndexOf', ['List', 3, 1, 2], 3])).toBe('1');
    expect(evaluate(['IndexOf', ['List', 3, 1, 2], 2])).toBe('3');
    expect(evaluate(['IndexOf', ['List', 5, 5, 5], 5])).toBe('1');
  });
  test('IndexOf returns 0 when the value is absent', () => {
    expect(evaluate(['IndexOf', ['List', 3, 1, 2], 9])).toBe('0');
  });
});

describe('COLLECTION EQUALITY IS REPRESENTATION-INSENSITIVE', () => {
  // `Equal` is lazy, so its operands reach the comparison unevaluated. The
  // collection `eq` handlers used to return a definitive `false` on operator
  // mismatch, so any computed collection (`Intersection(…)`, `Map(…)`, a
  // symbol assigned a set…) compared `False` against a literal with the same
  // elements.
  const T = (expr: Expression) => {
    const ce = new ComputeEngine();
    return ce.box(expr).evaluate().json;
  };

  test('Set literal vs Intersection', () =>
    expect(
      T([
        'Equal',
        ['Intersection', ['Set', 1, 2, 3, 4], ['Set', 2, 3, 5]],
        ['Set', 2, 3],
      ])
    ).toEqual('True'));

  test('Set literal vs Union (equal and unequal)', () => {
    expect(
      T(['Equal', ['Union', ['Set', 1, 2], ['Set', 3]], ['Set', 1, 2, 3]])
    ).toEqual('True');
    expect(
      T(['Equal', ['Union', ['Set', 1, 2], ['Set', 3]], ['Set', 1, 2, 9]])
    ).toEqual('False');
  });

  test('List literal vs lazy Map / Join pipelines', () => {
    const inc: Expression = ['Function', ['Add', '_1', 1], '_1'];
    expect(T(['Equal', ['Map', ['List', 1, 2], inc], ['List', 2, 3]])).toEqual(
      'True'
    );
    expect(T(['Equal', ['Map', ['List', 1, 2], inc], ['List', 2, 4]])).toEqual(
      'False'
    );
    expect(
      T(['Equal', ['Join', ['List', 1], ['List', 2]], ['List', 1, 2]])
    ).toEqual('True');
  });

  test('lazy Filter vs literal (list-flavored and set-flavored)', () => {
    const big: Expression = ['Function', ['Greater', '_1', 8], '_1'];
    expect(
      T(['Equal', ['Filter', ['Range', 1, 10], big], ['List', 9, 10]])
    ).toEqual('True');
    expect(
      T([
        'Equal',
        ['Filter', ['Set', 1, 2, 3], ['Function', ['Greater', '_1', 1], '_1']],
        ['Set', 2, 3],
      ])
    ).toEqual('True');
  });

  test('symbol assigned a collection vs the same literal', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.box(['Set', 1, 2]));
    expect(ce.box(['Equal', 's', ['Set', 1, 2]]).evaluate().json).toEqual(
      'True'
    );
    ce.assign('r', ce.box(['Range', 1, 3]));
    expect(ce.box(['Equal', 'r', ['Range', 1, 3]]).evaluate().json).toEqual(
      'True'
    );
    ce.assign('iv', ce.box(['Interval', 1, 3]));
    expect(ce.box(['Equal', 'iv', ['Interval', 1, 3]]).evaluate().json).toEqual(
      'True'
    );
  });

  test('cross-kind comparisons stay definitively unequal', () => {
    expect(T(['Equal', ['List', 1, 2], ['Tuple', 1, 2]])).toEqual('False');
    expect(T(['Equal', ['Set', 1], 5])).toEqual('False');
    // A set never equals a sequence, whatever the elements
    expect(
      T([
        'Equal',
        ['Filter', ['Set', 1, 2, 3], ['Function', ['Greater', '_1', 1], '_1']],
        ['List', 2, 3],
      ])
    ).toEqual('False');
  });

  test('literal-vs-literal comparisons are unchanged', () => {
    expect(T(['Equal', ['Set', 1, 2, 3], ['Set', 3, 2, 1]])).toEqual('True');
    expect(T(['Equal', ['Set', 1, 2], ['Set', 1, 3]])).toEqual('False');
    expect(T(['Equal', ['List', 1, 2], ['List', 2, 1]])).toEqual('False');
    expect(T(['Equal', ['Range', 1, 3], ['Range', 1, 4]])).toEqual('False');
  });
});

describe('Scan invalid initial value (finding 6)', () => {
  const add = ['Function', ['Add', 'a', 'b'], 'a', 'b'] as Expression;

  test('a valid seed is applied', () => {
    expect(evaluate(['Scan', ['List', 1, 2], add, 10])).toEqual(
      '["List", 11, 13]'
    );
  });

  test('the unseeded form folds from the first element', () => {
    expect(evaluate(['Scan', ['List', 1, 2], add])).toEqual('["List", 1, 3]');
  });

  test('an invalid initial value is NOT silently dropped', () => {
    // `Divide(1)` is invalid (missing denominator). Previously the canonical
    // handler dropped the invalid seed and returned the unseeded form
    // `["List", 1, 3]`, silently diverging. It must instead surface the error
    // rather than fold unseeded.
    const expr = engine.box(['Scan', ['List', 1, 2], add, ['Divide', 1]]);
    expect(expr.isValid).toBe(false);
    expect(
      evaluate(['Scan', ['List', 1, 2], add, ['Divide', 1]])
    ).not.toEqual('["List", 1, 3]');
  });
});

describe('SORT KEY MODE / MAXBY / MINBY / ARGMAX / ARGMIN', () => {
  // A unary key function.
  const square: Expression = ['Function', ['Power', 'x', 2], 'x'];
  const lengthKey: Expression = ['Function', ['Length', 'xs'], 'xs'];
  const identity: Expression = ['Function', 'x', 'x'];
  // A binary comparator (descending: negative when b > a).
  const descending: Expression = ['Function', ['Subtract', 'b', 'a'], 'a', 'b'];

  test('Sort with a unary function sorts by key ascending', () =>
    expect(evaluate(['Sort', ['List', -3, 1, -2], square])).toEqual(
      '["List", 1, -2, -3]'
    ));

  test('Sort by a list-length key', () =>
    // Note: evaluate without materialization to keep the nested sub-lists
    // intact (materialization flattens list-of-lists for display).
    expect(
      engine
        .box([
          'Sort',
          ['List', ['List', 1, 2, 3], ['List', 7], ['List', 4, 5]],
          lengthKey,
        ])
        .evaluate().json
    ).toEqual(['List', ['List', 7], ['List', 4, 5], ['List', 1, 2, 3]]));

  test('Sort with a binary function is a comparator (descending)', () =>
    expect(evaluate(['Sort', ['List', 3, 1, 2], descending])).toEqual(
      '["List", 3, 2, 1]'
    ));

  test('Sort with no function uses the default ascending order', () =>
    expect(evaluate(['Sort', ['List', 3, 1, 2]])).toEqual(
      '["List", 1, 2, 3]'
    ));

  test('Sort key mode is stable: equal keys keep their original order', () =>
    // Keys: 3->9, -3->9, 2->4. The two elements with key 9 keep their
    // listed order (3 before -3).
    expect(evaluate(['Sort', ['List', 3, -3, 2], square])).toEqual(
      '["List", 2, 3, -3]'
    ));

  test('MaxBy returns the element maximizing the key', () =>
    expect(evaluate(['MaxBy', ['List', -3, 1, 2], square])).toEqual('-3'));

  test('MinBy returns the element minimizing the key', () =>
    expect(evaluate(['MinBy', ['List', -3, 1, 2], square])).toEqual('1'));

  test('ArgMax without a key returns the 1-based index of the largest element', () =>
    expect(evaluate(['ArgMax', ['List', 10, 30, 20]])).toEqual('2'));

  test('ArgMax with a key returns the 1-based index maximizing the key', () =>
    expect(evaluate(['ArgMax', ['List', -3, 1, 2], square])).toEqual('1'));

  test('ArgMin without a key returns the 1-based index of the smallest element', () =>
    expect(evaluate(['ArgMin', ['List', 10, 30, 20]])).toEqual('1'));

  test('ArgMax ties: first occurrence wins', () =>
    expect(evaluate(['ArgMax', ['List', 1, 3, 3]])).toEqual('2'));

  test('MaxBy on an empty collection stays inert', () =>
    expect(
      engine.box(['MaxBy', emptyList, identity]).evaluate().operator
    ).toBe('MaxBy'));

  test('ArgMax on an empty collection stays inert', () =>
    expect(engine.box(['ArgMax', emptyList]).evaluate().operator).toBe(
      'ArgMax'
    ));

  test('MaxBy with symbolic keys stays inert', () =>
    // 'X' and 'Y' are unbound (uppercase) symbols, so their keys cannot be
    // ordered.
    expect(
      engine.box(['MaxBy', ['List', 'X', 'Y'], identity]).evaluate().operator
    ).toBe('MaxBy'));
});

describe('CHUNKBY / DEDUP / INSERT / DELETEAT / REPLACEAT', () => {
  const str = (expr: Expression): string =>
    engine.box(expr).evaluate({ materialization: true }).toString();

  const identity: Expression = ['Function', 'x', 'x'];
  const square: Expression = ['Function', ['Power', 'x', 2], 'x'];
  const doubleAcc: Expression = ['Function', ['Multiply', 2, 'acc'], 'n', 'acc'];

  // --- ChunkBy -----------------------------------------------------------
  test('ChunkBy splits into consecutive runs sharing the key', () =>
    expect(str(['ChunkBy', ['List', 1, 1, 2, 2, 2, 1], identity])).toEqual(
      '[[1,1],[2,2,2],[1]]'
    ));

  test('ChunkBy groups by a derived key (x^2), keeping adjacency', () =>
    // Keys 1,1,4,4,9 → runs [1,-1], [2,-2], [3].
    expect(str(['ChunkBy', ['List', 1, -1, 2, -2, 3], square])).toEqual(
      '[[1,-1],[2,-2],[3]]'
    ));

  test('ChunkBy of an empty collection is an empty list', () =>
    expect(str(['ChunkBy', ['List'], identity])).toEqual('[]'));

  test('ChunkBy of a single-element collection is one singleton run', () =>
    expect(str(['ChunkBy', ['List', 5], identity])).toEqual('[[5]]'));

  test('ChunkBy is inert on a non-finite collection', () =>
    expect(
      engine
        .box(['ChunkBy', ['Iterate', doubleAcc, 1], identity])
        .evaluate().operator
    ).toBe('ChunkBy'));

  // --- Partition / Chunk -------------------------------------------------
  // Fixed-size chunking: exact division, then a trailing partial chunk.
  test('Partition(xs, n) chunks of size n, exact division', () =>
    expect(str(['Partition', ['List', 1, 2, 3, 4], 2])).toEqual(
      '[[1,2],[3,4]]'
    ));

  test('Partition(xs, n) keeps a shorter trailing chunk', () =>
    expect(str(['Partition', ['List', 1, 2, 3, 4, 5], 2])).toEqual(
      '[[1,2],[3,4],[5]]'
    ));

  // Sliding windows: only complete windows, step 1 and step > 1.
  test('Partition(xs, n, 1) sliding windows step 1', () =>
    expect(str(['Partition', ['List', 1, 2, 3, 4, 5], 2, 1])).toEqual(
      '[[1,2],[2,3],[3,4],[4,5]]'
    ));

  test('Partition(xs, n, step) windows step > 1', () =>
    expect(str(['Partition', ['List', 1, 2, 3, 4, 5, 6], 2, 3])).toEqual(
      '[[1,2],[4,5]]'
    ));

  test('Partition(xs, n, step) drops the trailing partial window', () =>
    // Windows start at 0, 2, 4; the window at 4 ([5]) is incomplete → dropped.
    expect(str(['Partition', ['List', 1, 2, 3, 4, 5], 2, 2])).toEqual(
      '[[1,2],[3,4]]'
    ));

  test('Partition(xs, 1) singletons', () =>
    expect(str(['Partition', ['List', 1, 2, 3], 1])).toEqual('[[1],[2],[3]]'));

  test('Partition(xs, n) with n ≥ length is a single chunk', () =>
    expect(str(['Partition', ['List', 1, 2, 3], 10])).toEqual('[[1,2,3]]'));

  test('Partition(xs, n) with n ≤ 0 is inert', () =>
    expect(
      engine.box(['Partition', ['List', 1, 2, 3], 0]).evaluate().operator
    ).toBe('Partition'));

  test('Partition(xs, n, step) with step ≤ 0 is inert', () =>
    expect(
      engine.box(['Partition', ['List', 1, 2, 3], 2, 0]).evaluate().operator
    ).toBe('Partition'));

  test('Partition(xs, predicate) splits into [matching, non-matching]', () =>
    expect(
      str(['Partition', ['List', 1, 2, 3, 4, 5], ['Function', ['Greater', 'x', 2], 'x']])
    ).toEqual('[[3,4,5],[1,2]]'));

  test('Partition is inert on a non-finite collection', () =>
    expect(
      engine.box(['Partition', ['Iterate', doubleAcc, 1], 2]).evaluate().operator
    ).toBe('Partition'));

  // Chunk stays the "count" form: k nearly-equal groups.
  test('Chunk(xs, k) splits into k nearly-equal groups', () =>
    expect(str(['Chunk', ['List', 1, 2, 3, 4, 5], 2])).toEqual(
      '[[1,2,3],[4,5]]'
    ));

  // --- Dedup -------------------------------------------------------------
  test('Dedup collapses consecutive duplicates', () =>
    expect(str(['Dedup', ['List', 1, 1, 2, 2, 1]])).toEqual('[1,2,1]'));

  test('Dedup of an already-unique list is unchanged', () =>
    expect(str(['Dedup', ['List', 1, 2, 3]])).toEqual('[1,2,3]'));

  test('Dedup of an empty collection is empty', () =>
    expect(str(['Dedup', ['List']])).toEqual('[]'));

  test('Dedup differs from Unique (local vs global dedup)', () => {
    // Unique removes ALL duplicates; Dedup only collapses adjacent ones.
    expect(str(['Unique', ['List', 1, 1, 2, 2, 1]])).toEqual('[1,2]');
    expect(str(['Dedup', ['List', 1, 1, 2, 2, 1]])).toEqual('[1,2,1]');
  });

  test('Dedup composes lazily with an infinite source', () => {
    // Iterate doubles: 2,4,8,16,… (all distinct); Take 4 without materializing
    // the infinite source.
    const d = engine.box([
      'Take',
      ['Dedup', ['Iterate', doubleAcc, 1]],
      4,
    ]);
    expect(str(d)).toEqual('[2,4,8,16]');
  });

  test('Dedup streams a lazy Map source with adjacent repeats', () => {
    // floor(k/2) for k=1..10 → 0,1,1,2,2,3,3,4,4,5; deduped → 0,1,2,3,4,5.
    const src: Expression = [
      'Map',
      ['Range', 1, 10],
      ['Function', ['Floor', ['Divide', 'x', 2]], 'x'],
    ];
    const d = engine.box(['Dedup', src]);
    expect(Array.from(d.each()).map((x) => x.toString())).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    // `at` and `count` handlers agree with the streamed result.
    expect(str(['At', ['Dedup', src], 3])).toEqual('2');
    expect(str(['Count', ['Dedup', src]])).toEqual('6');
  });

  // --- Insert ------------------------------------------------------------
  test('Insert at 1 prepends', () =>
    expect(str(['Insert', ['List', 10, 20, 30], 1, 99])).toEqual(
      '[99,10,20,30]'
    ));

  test('Insert in the middle', () =>
    expect(str(['Insert', ['List', 10, 20, 30], 2, 99])).toEqual(
      '[10,99,20,30]'
    ));

  test('Insert at n+1 appends', () =>
    expect(str(['Insert', ['List', 10, 20, 30], 4, 99])).toEqual(
      '[10,20,30,99]'
    ));

  test('Insert with negative index -1 appends (Elixir semantics)', () =>
    expect(str(['Insert', ['List', 10, 20, 30], -1, 99])).toEqual(
      '[10,20,30,99]'
    ));

  test('Insert with negative index -2 inserts before the last element', () =>
    expect(str(['Insert', ['List', 10, 20, 30], -2, 99])).toEqual(
      '[10,20,99,30]'
    ));

  test('Insert with index 0 is inert', () =>
    expect(
      engine.box(['Insert', ['List', 10, 20, 30], 0, 99]).evaluate().operator
    ).toBe('Insert'));

  test('Insert with out-of-range index (n+2) is inert', () =>
    expect(
      engine.box(['Insert', ['List', 10, 20, 30], 5, 99]).evaluate().operator
    ).toBe('Insert'));

  test('Insert with a symbolic index is inert', () =>
    expect(
      engine.box(['Insert', ['List', 10, 20, 30], 'k', 99]).evaluate().operator
    ).toBe('Insert'));

  // --- DeleteAt ----------------------------------------------------------
  test('DeleteAt first element', () =>
    expect(str(['DeleteAt', ['List', 10, 20, 30], 1])).toEqual('[20,30]'));

  test('DeleteAt middle element', () =>
    expect(str(['DeleteAt', ['List', 10, 20, 30], 2])).toEqual('[10,30]'));

  test('DeleteAt last element', () =>
    expect(str(['DeleteAt', ['List', 10, 20, 30], 3])).toEqual('[10,20]'));

  test('DeleteAt with negative index counts from the end', () =>
    expect(str(['DeleteAt', ['List', 10, 20, 30], -1])).toEqual('[10,20]'));

  test('DeleteAt out-of-range index is inert', () =>
    expect(
      engine.box(['DeleteAt', ['List', 10, 20, 30], 4]).evaluate().operator
    ).toBe('DeleteAt'));

  test('DeleteAt with index 0 is inert', () =>
    expect(
      engine.box(['DeleteAt', ['List', 10, 20, 30], 0]).evaluate().operator
    ).toBe('DeleteAt'));

  // --- ReplaceAt ---------------------------------------------------------
  test('ReplaceAt replaces the element at a 1-based index', () =>
    expect(str(['ReplaceAt', ['List', 10, 20, 30], 2, 99])).toEqual(
      '[10,99,30]'
    ));

  test('ReplaceAt with negative index counts from the end', () =>
    expect(str(['ReplaceAt', ['List', 10, 20, 30], -1, 99])).toEqual(
      '[10,20,99]'
    ));

  test('ReplaceAt out-of-range index is inert', () =>
    expect(
      engine.box(['ReplaceAt', ['List', 10, 20, 30], 4, 99]).evaluate().operator
    ).toBe('ReplaceAt'));

  test('ReplaceAt with a symbolic index is inert', () =>
    expect(
      engine
        .box(['ReplaceAt', ['List', 10, 20, 30], 'k', 99])
        .evaluate().operator
    ).toBe('ReplaceAt'));
});

describe('ZIP-SHAPED LAZINESS (review findings)', () => {
  const add2: Expression = ['Function', ['Add', 'x', 'y'], 'x', 'y'];

  test('variadic Map bounded by the finite source when zipped with an infinite one', () => {
    const m = engine.box(['Map', ['Repeat', 7], ['List', 1, 2], add2]);
    expect(m.count).toBe(2);
    expect(m.evaluate().toString()).toBe('[8,9]');
  });

  test('Zip of an infinite and a finite source has the finite count', () => {
    const z = engine.box(['Zip', ['Repeat', 7], ['List', 1, 2]]);
    expect(z.count).toBe(2);
    expect(z.evaluate().toString()).toBe('[(7, 1),(7, 2)]');
  });

  test('Sort with a key over symbolic elements stays inert', () =>
    expect(
      engine
        .box(['Sort', ['List', 'q', 'r'], ['Function', ['Power', 'x', 2], 'x']])
        .evaluate().operator
    ).toBe('Sort'));

  test('ArgMax over a non-indexed collection stays inert', () =>
    expect(
      engine.box(['ArgMax', ['Set', 1, 2]]).evaluate().operator
    ).toBe('ArgMax'));
});

describe('COLLECTION NITS (Take preview, Sort boolean comparator, GroupBy typo)', () => {
  test('lazy Take of an unknown-length source previews its own tail, not the source tail', () => {
    // Take(TakeWhile(...) [99 elements], 50): the [5,5] preview must sample
    // the *taken* prefix (…,49,50), not the source (…,98,99). A previous
    // evaluate handler consumed the operand's own display preview.
    const t = engine
      .box([
        'Take',
        ['TakeWhile', ['Range', 1, 1000], ['Function', ['Less', 'x', 100], 'x']],
        50,
      ])
      .evaluate({ materialization: [5, 5] });
    const ops = t.ops!.map((x) => x.toString());
    expect(ops[0]).toBe('1');
    expect(ops[ops.length - 1]).toBe('50');
  });

  test('negative index on a lazy Take counts from the end of the taken prefix', () => {
    const t = engine.box(['Take', ['List', 10, 20, 30], 2]).evaluate();
    expect(t.at?.(-1)?.toString()).toBe('20');
  });

  test('a boolean Sort comparator orders Elixir-style (True = first argument first)', () => {
    expect(
      engine
        .box([
          'Sort',
          ['List', 3, 1, 2],
          ['Function', ['Greater', 'a', 'b'], 'a', 'b'],
        ])
        .evaluate()
        .toString()
    ).toBe('[3,2,1]');
    expect(
      engine
        .box([
          'Sort',
          ['List', 3, 1, 2],
          ['Function', ['Less', 'a', 'b'], 'a', 'b'],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
  });

  test('GroupBy with a mistyped (auto-inferred) key function throws with a suggestion', () => {
    expect(() =>
      engine.box(['GroupBy', ['List', 1, 2, 3, 4], 'Even']).evaluate()
    ).toThrow(/Unknown function "Even"/);
  });

  test('GroupBy with a real predicate groups by stringified keys', () => {
    expect(
      JSON.stringify(
        engine
          .box(['GroupBy', ['List', 1, 2, 3, 4], ['Function', ['IsEven', 'x'], 'x']])
          .evaluate().json
      )
    ).toBe('{"dict":{"False":[1,3],"True":[2,4]}}');
  });
});

// Tycho item 26: iterating a lazy lambda-applying collection whose body cannot
// fully evaluate must still substitute each element's VALUE into the held
// result. A body like `Which`/`If` with an undetermined condition returns
// itself inert, referencing the raw parameter symbol; the fix (in `makeLambda`)
// substitutes the parameter's value into that partially-symbolic result so the
// element is not lost. A fresh engine keeps the declared-but-unassigned `m`
// (and the `k` parameter) isolated from the shared-engine tests above.
describe('Lambda application substitutes the element into an undetermined body', () => {
  // Fresh engine: `m` is declared-but-unassigned so the body can't fully
  // evaluate, and the single-char symbol names keep the serialized output
  // unquoted. Isolated from the shared-engine tests above.
  const ce = new ComputeEngine();
  ce.assign('d', ce.box(['List', 1, 2, 3]));
  ce.declare('m', 'number');
  const undeterminedFn: Expression = [
    'Function',
    ['Which', ['Equal', 'k', 'm'], 1e9, 'True', 'k'],
    'k',
  ];

  test('Map each() holds the body but substitutes the element value', () => {
    const e = ce.box(['Map', 'd', undeterminedFn]);
    expect([...e.each()].map((x) => x.toString())).toEqual([
      'Which(1 === m, 1000000000, "True", 1)',
      'Which(2 === m, 1000000000, "True", 2)',
      'Which(3 === m, 1000000000, "True", 3)',
    ]);
  });

  test('Map evaluate() holds the body but substitutes the element value', () => {
    expect(ce.box(['Map', 'd', undeterminedFn]).evaluate().toString()).toBe(
      '[Which(1 === m, 1000000000, "True", 1),Which(2 === m, 1000000000, "True", 2),Which(3 === m, 1000000000, "True", 3)]'
    );
  });

  test('Tabulate shares the same lambda choke point', () => {
    expect(
      [...ce.box(['Tabulate', undeterminedFn, 3]).each()].map((x) =>
        x.toString()
      )
    ).toEqual([
      'Which(1 === m, 1000000000, "True", 1)',
      'Which(2 === m, 1000000000, "True", 2)',
      'Which(3 === m, 1000000000, "True", 3)',
    ]);
  });

  test('direct Apply substitutes the argument into an undetermined body', () => {
    expect(ce.box(['Apply', undeterminedFn, 2]).evaluate().toString()).toBe(
      'Which(2 === m, 1000000000, "True", 2)'
    );
  });

  test('Filter shares the choke point: predicate sees the element value', () => {
    // The predicate below cannot decide (m is undetermined), so once the
    // element value is substituted the applied predicate is `1 === m`, not the
    // old, corrupted `k === m`. Filter surfaces the undetermined predicate as
    // an error rather than silently dropping the element.
    const undeterminedPred: Expression = ['Function', ['Equal', 'k', 'm'], 'k'];
    expect(() => [
      ...ce.box(['Filter', 'd', undeterminedPred]).each(),
    ]).toThrow(/True.+False/);
    // A fully-decidable predicate still filters correctly (regression guard on
    // the value flowing through the choke point).
    ce.assign('q', ce.box(['List', 1, 2, 3, 4, 5]));
    expect(
      ce
        .box(['Filter', 'q', ['Function', ['Greater', 'k', 2], 'k']])
        .evaluate()
        .toString()
    ).toBe('[3,4,5]');
  });

  test('a fully-evaluable body is unchanged (substitution is a no-op)', () => {
    expect(
      ce
        .box(['Map', 'd', ['Function', ['Power', 'k', 2], 'k']])
        .evaluate()
        .toString()
    ).toBe('[1,4,9]');
  });

  test('Map over an infinite base stays lazy (Take 3 does not materialize)', () => {
    expect(
      ce
        .box([
          'Take',
          ['Map', ['Range', 1, 'PositiveInfinity'], ['Function', ['Power', 'k', 2], 'k']],
          3,
        ])
        .evaluate()
        .toString()
    ).toBe('[1,4,9]');
  });
});

// Short-term half of Tycho item 19.3: arithmetic over an `unknown`-returning
// function call narrows to scalar `number`, and `At` must NOT bake an
// `incompatible-type` error for such an *over-narrowed* base — it stays inert
// and defers to runtime (durable fix is a `broadcastable<T>` type). A genuinely
// provable scalar base (`\pi`, `(5)`, `sin(3)`) must still error loudly.
describe('At: lenient over-narrowed base (Tycho 19.3)', () => {
  const errorCode = (expr: any): string | undefined => {
    const j = expr.json;
    if (!Array.isArray(j) || j[0] !== 'At') return undefined;
    const base = j[1];
    if (!Array.isArray(base) || base[0] !== 'Error') return undefined;
    const ec = base[1];
    return Array.isArray(ec) ? ec[1]?.replace(/'/g, '') : undefined;
  };

  test('repro: arithmetic over an unknown-return call stays inert (subs)', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(unknown, unknown) -> unknown');
    const r = ce.parse('a[1]').subs({ a: ce.parse('2h(x,y)-1') });
    expect(r.isValid).toBe(true);
    expect(errorCode(r)).toBeUndefined();
    expect(r.json).toEqual([
      'At',
      ['Add', ['Multiply', 2, ['h', 'x', 'y']], -1],
      1,
    ]);
  });

  test('repro: canonical-compose variant stays inert (box)', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(unknown, unknown) -> unknown');
    const b = ce.box(['At', ce.parse('2h(x,y)-1'), 1]);
    expect(b.isValid).toBe(true);
    expect(errorCode(b)).toBeUndefined();
  });

  test('base that resolves to a list at evaluation indexes correctly', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(u, v) \\mapsto \\lbrack u, v, u+v \\rbrack'));
    expect(
      ce.parse('a[1]').subs({ a: ce.parse('h(3,4)') }).evaluate().toString()
    ).toBe('3');
    expect(
      ce.parse('a[3]').subs({ a: ce.parse('h(3,4)') }).evaluate().toString()
    ).toBe('7');
  });

  test('contract-3: nc-parse → subs → box → evaluate resolves to a list', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(u, v) \\mapsto \\lbrack u, v, u+v \\rbrack'));
    const nc = ce.parse('a[2]', { canonical: false });
    const canon = ce.box(nc.subs({ a: ce.parse('h(10,20)') }).json);
    expect(canon.evaluate().toString()).toBe('20');
  });

  test('genuinely-scalar runtime base produces the error at evaluation', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(unknown, unknown) -> unknown');
    const inert = ce.box(['At', ce.parse('2h(x,y)-1'), 1]);
    expect(inert.isValid).toBe(true);
    // `h` now returns a scalar: the base evaluates to a number and `At` errors.
    ce.assign('h', ce.parse('(u, v) \\mapsto u+v'));
    const r = ce.parse('a[1]').subs({ a: ce.parse('2h(3,4)-1') }).evaluate();
    expect(r.isValid).toBe(false);
    expect(errorCode(r)).toBe('incompatible-type');
  });

  test('bare unknown-return call base is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(unknown, unknown) -> unknown');
    const r = ce.parse('h(x,y)[1]');
    expect(r.isValid).toBe(true);
    expect(errorCode(r)).toBeUndefined();
  });

  test('provable scalar bases still error loudly', () => {
    const ce = new ComputeEngine();
    // number literal
    expect(errorCode(ce.box(['At', ce.box(5), 1]))).toBe('incompatible-type');
    // declared scalar symbol (Pi)
    expect(errorCode(ce.box(['At', ce.parse('\\pi'), 1]))).toBe(
      'incompatible-type'
    );
    // declared-scalar-return call, no unknown descendant
    expect(errorCode(ce.box(['At', ce.parse('\\sin(3)'), 1]))).toBe(
      'incompatible-type'
    );
  });

  test('declared list<number> base is unchanged (no error)', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const r = ce.parse('L[2]');
    expect(r.isValid).toBe(true);
    expect(errorCode(r)).toBeUndefined();
  });

  test('dictionary access is unchanged', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'At',
        ['Dictionary', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]],
        { str: 'b' },
      ])
      .evaluate();
    expect(r.toString()).toBe('2');
  });

  // A broadcast-aware union base (`finite_integer | vector<3>`, from arithmetic
  // over a list-returning lambda) must be lenient: it isn't a subtype of
  // `dictionary | indexed_collection`, but one member IS indexable, so it stays
  // inert and evaluates once the base resolves to a list.
  test('union base with an indexable member stays inert and evaluates', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(u, v) \\mapsto \\lbrack u, v, u+v \\rbrack'));
    const at = ce.parse('(2h(3,4)-1)[1]');
    expect(at.isValid).toBe(true);
    expect(errorCode(at)).toBeUndefined();
    expect(at.evaluate().toString()).toBe('5');
  });

  test('declared union return `number | list<number>` stays inert + valid', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number) -> number | list<number>');
    const at = ce.parse('g(1)[2]');
    expect(at.isValid).toBe(true);
    expect(errorCode(at)).toBeUndefined();
  });

  test('scalar-only union base still errors at parse', () => {
    const ce = new ComputeEngine();
    // A declared (provable) scalar symbol whose type is a union of only scalar
    // members — no indexable member, so `At` must still reject it.
    ce.declare('z', 'finite_integer | rational');
    const at = ce.parse('z[1]');
    expect(at.isValid).toBe(false);
    expect(errorCode(at)).toBe('incompatible-type');
  });

  // A broadcastable operator (`sin`) over an unknown-return call narrows to
  // scalar `number` at its node, but the unknown descendant still means the
  // base may resolve to a collection at runtime — so `At` must stay lenient.
  test('broadcast over an unknown-return call stays inert', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(unknown, unknown) -> unknown');
    const at = ce.parse('(2\\sin(h(x,y))-1)[1]');
    expect(at.isValid).toBe(true);
    expect(errorCode(at)).toBeUndefined();
  });

  test('broadcast over a provable scalar still errors loudly', () => {
    const ce = new ComputeEngine();
    // `sin(3)` has no unknown descendant: a provable scalar, still rejected.
    expect(errorCode(ce.parse('\\sin(3)[1]'))).toBe('incompatible-type');
  });

  // A base typed as the bare `value` primitive (e.g. inferred through a
  // `(value*)` signature) is no evidence of scalar-ness — `value` also includes
  // collection types — so `At` defers to runtime instead of erroring.
  test('bare `value`-typed base stays inert', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'value');
    const at = ce.parse('w[1]');
    expect(at.isValid).toBe(true);
    expect(errorCode(at)).toBeUndefined();
  });
});
