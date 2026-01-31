import { Expression } from '../../src/math-json/types.ts';
import { engine, exprToString } from '../utils';

function evaluate(expr: Expression): string {
  return exprToString(engine.box(expr)?.evaluate({ materialization: true }));
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
    expect(evaluate(['Count', matrix])).toMatchInlineSnapshot(`9`));

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
    expect(evaluate(['Take', matrix, 1])).toMatchInlineSnapshot(`["List", 6]`)); // @fixme: should be the first row `["List", 2, 3, 4]`

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
    expect(evaluate(['Drop', matrix, 2])).toMatchInlineSnapshot(`
      [
        "List",
        ["Error", "'missing'"],
        ["Error", "'missing'"],
        ["Error", "'missing'"],
        ["Error", "'missing'"],
        ["Error", "'missing'"],
        ["Error", "'missing'"],
        ["Error", "'missing'"]
      ]
    `)); // @fixme should be `["List", ["List", 11, 12, 13]]`

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
        4.202247191011236,
        5.3033707865168545,
        6.404494382022472,
        7.50561797752809,
        8.606741573033709,
        "ContinuationPlaceholder",
        94.49438202247191,
        95.59550561797752,
        96.69662921348315,
        97.79775280898876,
        98.89887640449439
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
      `["List", 11, ["Error", "'missing'"]]`
    )); // @fixme.

  test('range', () =>
    expect(evaluate(['Slice', range, 2, 3])).toMatchInlineSnapshot(
      `["List", 4, 6]`
    ));

  test('linspace', () =>
    expect(evaluate(['Slice', linspace, 2, 3])).toMatchInlineSnapshot(
      `["List", 3.101123595505618, 4.202247191011236]`
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
    )); // @fixme

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
      `["List", 13, 13, 13, 13, 13, 11]`
    )); // @fixme should be `["List", 13, 5, 19, 2, 3, 11]`

  test('Most', () =>
    expect(evaluate(['Most', list])).toMatchInlineSnapshot(
      `["List", 7, 13, 5, 19, 2, 3]`
    )); // @fixme should be `["List", 7, 13, 5, 19, 2, 3]`

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
      `["Set", 100, 4, 2, 62, 34, "ContinuationPlaceholder"]`
    )); // @fixme should be `["List", 100, 4, 2, 62, 34, 16, 8, 9, 7, 24]`
});

// describe('NON-ITERABLE OPERATIONS', () => {

// })

describe('CONTINUATION PLACEHOLDER', () => {
  // Use lazy collections (e.g., Map) to test continuation placeholder

  // Check various eager evaluation
  test('empty list', () => {
    const empty_list = engine.box(['Map', ['List'], ['Square', '_']]);
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
    const empty_set = engine.box(['Map', ['Set'], ['Square', '_']]);
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
    const finite_list = engine.box([
      'Map',
      ['List', 1, 1, 2, 2, 3, 4, 7, 8, 9, 10, 11, 12, 14],
      ['Square', '_'],
    ]);
    expect(finite_list.evaluate({ materialization: false }))
      .toMatchInlineSnapshot(`
      [
        "Map",
        ["List", 1, 1, 2, 2, 3, 4, 7, 8, 9, 10, 11, 12, 14],
        ["Function", ["Square", "_1"]]
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
    const finite_set = engine.box([
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
    const infinite_set = engine.box(['Map', 'Integers', ['Square', '_']]);
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
