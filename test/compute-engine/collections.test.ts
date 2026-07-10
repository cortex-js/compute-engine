import { Expression } from '../../src/math-json/types.ts';
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
