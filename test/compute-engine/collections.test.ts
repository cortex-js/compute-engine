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
