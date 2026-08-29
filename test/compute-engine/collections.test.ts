import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine';
import { isTensor } from '../../src/compute-engine/boxed-expression/type-guards';
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

describe('LIST TENSOR ELIGIBILITY', () => {
  test('tuple-valued elements remain a list of tuples', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');

    const expressions = [
      ce.parse('[(1,2),(3,4)]'),
      ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]),
      ce.box(['List', ['Hold', ['Tuple', 1, 2]], ['Hold', ['Tuple', 3, 4]]]),
      ce.box([
        'List',
        ['If', 'c', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['If', 'c', ['Tuple', 5, 6], ['Tuple', 7, 8]],
      ]),
      ce.box([
        'List',
        ['Which', 'c', ['Tuple', 1, 2]],
        ['Which', 'c', ['Tuple', 3, 4]],
      ]),
      ce.box([
        'List',
        ['When', ['Tuple', 1, 2], 'c'],
        ['When', ['Tuple', 3, 4], 'c'],
      ]),
    ];

    for (const expr of expressions) {
      // Phase C representation unification: a shape-regular list of tuple cells
      // IS shape-regular (isTensor may be true), but tuple cells are NOT
      // kernel-admissible — the value stays a plain List and never enters a
      // numeric kernel (no `list<number>` / `vector` typing). The SHAPE claim
      // uses `list<any>`: the `Which` rows have no default clause, so their
      // elements type `tuple<…> | missing` (no-selection ruling 2026-08-27)
      // and the values-only bare `list` synonym excludes an absence-admitting
      // element type by design.
      expect(expr.operator).toBe('List');
      expect(expr.type.matches('list<any>')).toBe(true);
      expect(expr.type.matches('list<number>')).toBe(false);
      expect(expr.type.matches('vector')).toBe(false);
    }
    const whichRows = expressions.filter((x) => x.ops[0].operator === 'Which');
    for (const expr of expressions.filter(
      (x) => x.ops[0].operator !== 'Hold' && x.ops[0].operator !== 'Which'
    )) {
      expect(expr.type.matches('list')).toBe(true);
      expect(expr.type.matches('list<tuple<number, number>>')).toBe(true);
    }
    // A default-less `Which` element may answer `Missing`, and the list type
    // says so.
    for (const expr of whichRows)
      expect(expr.type.matches('list<tuple<number, number> | missing>')).toBe(
        true
      );
  });

  test('wrapped container elements (Set/Dictionary) remain a list', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');

    const expressions = [
      ce.box(['List', ['Hold', ['Set', 1, 2]], ['Hold', ['Set', 3, 4]]]),
      ce.box([
        'List',
        ['If', 'c', ['Set', 1, 2], ['Set', 3, 4]],
        ['If', 'c', ['Set', 5, 6], ['Set', 7, 8]],
      ]),
      ce.box([
        'List',
        ['Hold', ['Dictionary', ['KeyValuePair', { str: 'a' }, 1]]],
        ['Hold', ['Dictionary', ['KeyValuePair', { str: 'b' }, 2]]],
      ]),
      ce.box([
        'List',
        ['Hold', ['KeyValuePair', { str: 'a' }, 1]],
        ['Hold', ['KeyValuePair', { str: 'b' }, 2]],
      ]),
    ];

    for (const expr of expressions) {
      // Phase C representation unification: shape-regular container-cell lists
      // (Set/Dictionary cells) may report isTensor true, but such cells are NOT
      // kernel-admissible — the value stays a plain List and never enters a
      // numeric kernel.
      expect(expr.operator).toBe('List');
      expect(expr.type.matches('list')).toBe(true);
      expect(expr.type.matches('list<number>')).toBe(false);
      expect(expr.type.matches('vector')).toBe(false);
    }
  });

  test('elements typed with the primitive `tuple` type remain a list', () => {
    const ce = new ComputeEngine();
    ce.declare('p1', 'tuple');
    ce.declare('p2', 'tuple');

    const expr = ce.box(['List', 'p1', 'p2']);
    // Phase C representation unification: a shape-regular list of tuple cells
    // IS shape-regular (isTensor true), but tuple cells are NOT kernel-
    // admissible — the value stays a plain List and never enters a numeric
    // kernel (its type carries the honest tuple cell, not a numeric vector).
    expect(isTensor(expr)).toBe(true);
    expect(expr.operator).toBe('List');
    expect(expr.type.matches('list<number>')).toBe(false);
    expect(expr.type.toString()).toBe('list<tuple^2>');
  });

  test('genuine numeric vectors and matrices remain tensors', () => {
    const ce = new ComputeEngine();
    const vector = ce.box(['List', 1, 2, 3]);
    const matrix = ce.box(['List', ['List', 1, 2], ['List', 3, 4]]);

    // Phase C representation unification: literal lists type honestly
    // (list<finite_…^dims>).
    expect(isTensor(vector)).toBe(true);
    expect(vector.type.toString()).toBe('vector<integer^3>');
    expect(isTensor(matrix)).toBe(true);
    expect(matrix.type.toString()).toBe('matrix<integer^(2x2)>');
  });
});

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
        "Error",
        ["ErrorCode", "incompatible-type", "'collection'", "'number'"],
        ["Add", ["Multiply", 3, "x"], 2],
        ["ErrorTrace", ["ErrorFrame", "'Count'", 1]]
      ]
    `));

  test('Count symbol', () =>
    expect(evaluate(['Count', symbol])).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "incompatible-type", "'collection'", "'number'"],
        "x",
        ["ErrorTrace", ["ErrorFrame", "'Count'", 1]]
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
      exprToString(engine.expr(['Count', ['Linspace', 0, 1, 'n']]).evaluate())
    ).toMatchInlineSnapshot(`["Count", ["Linspace", 0, 1, "n"]]`));
});

describe('EXACT NUMERICALLY-KNOWN BOUNDS (item 117)', () => {
  // A Range bound that is exact but numerically known (`50π`, `2π/3`) used
  // to read as NaN through `.re` and trip the symbolic-bound guards: the
  // collection was BOTH uncountable (`count` undefined) and unenumerable
  // (`each()` empty) while `.N()` fully recovered it. Such bounds now read
  // through `.N()`; only bounds with unknowns stay indeterminate.

  test('exact constant bound counts and enumerates (parse route)', () => {
    const v = engine.parse('\\left[0,0.05...50\\pi\\right]').evaluate();
    expect(v.count).toEqual(3142);
    const els = [...v.each()];
    expect(els.length).toEqual(3142);
    expect(els[0].re).toEqual(0);
    expect(els[1].re).toEqual(0.05);
    expect(els[3141].re).toBeCloseTo(157.05, 10);
  });

  test('exact constant bound counts and enumerates (box route)', () => {
    const v = engine
      .expr(['Range', 0, ['Multiply', 50, 'Pi'], 0.05])
      .evaluate();
    expect(v.count).toEqual(3142);
    expect(v.contains(engine.number(0.1))).toEqual(true);
  });

  test('exact symbolic step enumerates', () => {
    const v = engine
      .expr([
        'Range',
        0,
        ['Multiply', 2, 'Pi'],
        ['Divide', ['Multiply', 2, 'Pi'], 3],
      ])
      .evaluate();
    expect(v.count).toEqual(3);
    expect([...v.each()].map((e) => e.re)).toEqual([
      0, 2.0943951023931957, 4.188790204786391,
    ]);
  });

  test('bound known by substitution counts and enumerates', () => {
    const ce = new ComputeEngine();
    ce.assign('N_0', 2);
    const v = ce.parse('\\left[0,0.5...N_0\\pi\\right]').evaluate();
    expect(v.count).toEqual(13);
    expect([...v.each()].pop()?.re).toEqual(6);
  });

  test('a bound with unknowns still stays indeterminate', () => {
    const v = engine.expr(['Range', 1, 'n']);
    expect(v.count).toBeUndefined();
    expect([...v.each()]).toEqual([]);
  });

  test('Linspace with exact endpoints counts and enumerates', () => {
    const v = engine.expr(['Linspace', 0, ['Multiply', 2, 'Pi'], 5]).evaluate();
    expect(v.count).toEqual(5);
    const els = [...v.each()].map((e) => e.re);
    expect(els.length).toEqual(5);
    expect(els[0]).toEqual(0);
    // Both endpoints included
    expect(els[4]).toBeCloseTo(2 * Math.PI, 12);
  });
});

describe('COUNT — 2-argument value and predicate forms', () => {
  // `Count(xs, v)` counts elements structurally the same as `v`;
  // `Count(xs, p)` counts elements satisfying the predicate `p`. The forms
  // are dispatched on the second operand's TYPE (`.isFunction`), so a value
  // that happens to be callable is a predicate and everything else is a value.
  const count = (...ops: Expression[]) => evaluate(['Count', ...ops] as any);

  test('value form counts structurally identical elements', () => {
    expect(count(['List', 1, 1, 2], 1)).toEqual('2');
    expect(count(['List', 1, 1, 2, 1], 1)).toEqual('3');
    expect(count(['List', 'a', 'b', 'a'], 'a')).toEqual('2');
  });

  test('value form uses `.isSame` semantics, like `===`', () => {
    // `0.5` IS `1/2` at the number leaf; `1/3` is not.
    expect(count(['List', 0.5, ['Divide', 1, 3]], ['Divide', 1, 2])).toEqual(
      '1'
    );
    // Structural, with no tolerance: an unevaluated radical does not match
    // its float approximation.
    expect(count(['List', ['Sqrt', 2]], 1.4142135623730951)).toEqual('0');
    expect(count(['List', ['Sqrt', 2]], ['Sqrt', 2])).toEqual('1');
  });

  test('no match is 0, and an empty collection is 0 in every form', () => {
    expect(count(['List', 1, 2, 3], 9)).toEqual('0');
    expect(count(emptyList, 1)).toEqual('0');
    expect(count(emptyList, ['Function', ['Greater', '_', 1], '_'])).toEqual(
      '0'
    );
  });

  test('predicate form counts satisfying elements', () => {
    expect(
      count(['List', 1, 2, 3], ['Function', ['Greater', '_', 1], '_'])
    ).toEqual('2');
    expect(
      count(['Range', 1, 10], ['Function', ['Greater', '_', 5], '_'])
    ).toEqual('5');
    // Same answer as the long way round.
    expect(
      count(['Range', 1, 10], ['Function', ['Greater', '_', 5], '_'])
    ).toEqual(
      evaluate([
        'Count',
        ['Filter', ['Range', 1, 10], ['Function', ['Greater', '_', 5], '_']],
      ])
    );
  });

  test('a non-boolean predicate result is a hard error, exactly as in Filter', () => {
    // Delegating to `Filter` means the predicate contract is Filter's by
    // construction: an inert `x > 1` over a symbolic element throws rather
    // than being silently counted or skipped.
    const pred: Expression = ['Function', ['Greater', '_', 1], '_'];
    expect(() =>
      engine.expr(['Count', ['List', 1, 'x', 3], pred]).evaluate()
    ).toThrow(/must return "True" or "False"/);
    expect(
      () => engine.expr(['Filter', ['List', 1, 'x', 3], pred]).evaluate().count
    ).toThrow(/must return "True" or "False"/);
  });

  test('an indeterminate-count collection stays symbolic, as in the 1-arg form', () => {
    expect(
      exprToString(engine.expr(['Count', ['Range', 1, 'n'], 1]).evaluate())
    ).toEqual('["Count", ["Range", 1, "n"], 1]');
    expect(
      exprToString(
        engine
          .expr([
            'Count',
            ['Range', 1, 'n'],
            ['Function', ['Greater', '_', 5], '_'],
          ])
          .evaluate()
      )
    ).toContain('"Count"');
  });

  test('a wrapped collection still counts correctly (the wrapper is KEPT)', () => {
    // The count-preserving-wrapper peek is deliberately restricted to the
    // 1-arg cardinality form: a 2-arg predicate may be impure (drawing from
    // `Random`), and its result then depends on the element ORDER the wrapper
    // establishes. So the wrapper is preserved here — it merely materializes —
    // and the answer is unchanged since these are permutations.
    expect(count(['Sort', ['List', 2, 1, 1]], 1)).toEqual('2');
    expect(count(['Reverse', ['List', 2, 1, 1]], 1)).toEqual('2');
    expect(
      engine.expr(['Count', ['Sort', ['List', 2, 1, 1]], 1]).op1.operator
    ).toEqual('Sort');
    // ...while the 1-arg form still strips it.
    expect(
      engine.expr(['Count', ['Sort', ['List', 2, 1, 1]]]).op1.operator
    ).toEqual('List');
  });

  test('sgn: a matching count over a non-empty collection may be zero', () => {
    // The 1-arg cardinality of a non-empty collection is positive...
    expect(engine.expr(['Count', ['List', 1, 2, 3]]).sgn).toEqual('positive');
    // ...but a matching count is only non-negative (nothing need match).
    expect(engine.expr(['Count', ['List', 1, 2, 3], 9]).sgn).toEqual(
      'non-negative'
    );
    expect(engine.expr(['Count', emptyList, 9]).sgn).toEqual('zero');
  });

  test('1-argument cardinality form is unchanged', () => {
    expect(count(list)).toEqual('7');
    expect(count(emptyList)).toEqual('0');
  });
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
            "'number'"
          ],
          ["Add", ["Multiply", 3, "x"], 2]
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
          ],
          "x"
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
            "record{x: integer, y: integer, z: integer}"
          ],
          {dict: {x: 1; y: 2; z: 3}}
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
            "record{x: integer, y: integer, z: integer}"
          ],
          {dict: {x: 1; y: 2; z: 3}}
        ],
        1
      ]
    `);
  });

  // Regression: `Take`'s `isFinite` handler ignored its own bound and only
  // reported the source's finiteness, so `Take(<infinite>, n)` claimed count
  // `n` yet `isFiniteCollection === false` — which left `ListFrom(...)` inert.
  test('Take of an infinite source with a finite bound is a finite collection', () => {
    const e = engine.box(['Take', ['Range', 1, 'PositiveInfinity'], 3]);
    expect(e.isFiniteCollection).toBe(true);
    expect(e.count).toBe(3);
  });

  test('ListFrom(Take(infinite, n)) materializes the n elements', () => {
    const e = engine
      .box(['ListFrom', ['Take', ['Range', 1, 'PositiveInfinity'], 3]])
      .evaluate();
    expect(e.json).toEqual(['List', 1, 2, 3]);
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
            "'number'"
          ],
          ["Add", ["Multiply", 3, "x"], 2]
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
          ],
          "x"
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
            "record{x: integer, y: integer, z: integer}"
          ],
          {dict: {x: 1; y: 2; z: 3}}
        ],
        2
      ]
    `);
  });
});

describe('SLICE facet coherence over infinite/unknown sources (2026-07-19)', () => {
  const inf = ['Range', 1, 'PositiveInfinity'];

  test('negative END over infinite = unbounded tail: count ∞, not finite, streams', () => {
    const s = engine.box(['Slice', inf, 5, -1]);
    expect(s.count).toBe(Infinity);
    expect(s.isFiniteCollection).toBe(false);
    expect(s.at(1)?.toString()).toBe('5');
    // Counting from the end of an infinite tail is unresolvable.
    expect(s.at(-1)).toBeUndefined();
    expect(
      engine
        .box(['Take', ['Slice', inf, 5, -1], 3])
        .evaluate()
        .toString()
    ).toBe('[5,6,7]');
  });

  test('negative START over infinite is unresolvable: all facets decline, stays inert', () => {
    // "The last 3 elements" of an infinite collection do not exist.
    // Previously: count was NaN and at(1) fabricated the element +oo.
    const s = engine.box(['Slice', inf, -3, -1]);
    expect(s.count).toBeUndefined();
    expect(s.isFiniteCollection).toBeUndefined();
    expect(s.at(1)).toBeUndefined();
    expect(s.evaluate().operator).toBe('Slice');
    expect(
      engine.box(['ListFrom', ['Slice', inf, -3, -1]]).evaluate().operator
    ).toBe('ListFrom');
  });

  test('unknown-count source: finiteness is unknown, not true', () => {
    const s = engine.box([
      'Slice',
      ['ChunkBy', ['Cycle', ['List', 1, 1, 2]], ['Function', 'x', 'x']],
      1,
      5,
    ]);
    expect(s.count).toBeUndefined();
    expect(s.isFiniteCollection).toBeUndefined();
  });

  test('bounded positive window over infinite stays finite and materializes', () => {
    const s = engine.box(['Slice', inf, 1, 5]);
    expect(s.count).toBe(5);
    expect(s.isFiniteCollection).toBe(true);
    expect(
      engine
        .box(['ListFrom', ['Slice', inf, 1, 5]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4,5]');
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
            "'number'"
          ],
          ["Add", ["Multiply", 3, "x"], 2]
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
          ],
          "x"
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
            "record{x: integer, y: integer, z: integer}"
          ],
          {dict: {x: 1; y: 2; z: 3}}
        ],
        2,
        3
      ]
    `);
  });

  // Finding (Fix B companion): unlike `Take`, `Slice` already answers
  // correctly for a bounded positive-index range over an infinite source —
  // its `count` resolves the explicit end and its `isFinite` is `true`. Pin
  // that (no code change was needed here).
  test('Slice of an infinite source with a bounded index range is finite', () => {
    const e = engine.box(['Slice', ['Range', 1, 'PositiveInfinity'], 1, 5]);
    expect(e.count).toBe(5);
    expect(e.isFiniteCollection).toBe(true);
    expect(engine.box(['ListFrom', e]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
      4,
      5,
    ]);
  });
});

// The `(indexed_collection<T>, range)` arm (docs/STRING_ROADMAP.md, Phase 0c):
// `Slice(xs, r)` is `Slice(xs, First(r), Last(r))`, inheriting the positional
// arm's end clamping. The parameter is typed `range` — an ascending, step-1,
// finite span of 1-based indices — so a descending or stepped `Range` is a
// STATIC type error rather than a runtime reinterpretation (`Slice(xs, 3, 2)`
// is empty, but the collection `3..2` is the pair `[3, 2]`); a gather by
// arbitrary indices is `At(xs, indices)`.
describe('SLICE (range)', () => {
  test('is Slice(xs, First(r), Last(r))', () => {
    expect(evaluate(['Slice', list, ['Range', 2, 3]])).toBe(
      evaluate(['Slice', list, 2, 3])
    );
    expect(evaluate(['Slice', list, ['Range', 2, 3]])).toMatchInlineSnapshot(
      `["List", 13, 5]`
    );
    expect(evaluate(['Slice', list, ['Range', 1, 1]])).toMatchInlineSnapshot(
      `["List", 7]`
    );
    expect(evaluate(['Slice', list, ['Range', 1, 7]])).toBe(evaluate(list));
  });

  test('clamps the end and yields [] past the end, like the positional arm', () => {
    expect(evaluate(['Slice', list, ['Range', 6, 20]])).toBe(
      evaluate(['Slice', list, 6, 20])
    );
    expect(evaluate(['Slice', list, ['Range', 6, 20]])).toMatchInlineSnapshot(
      `["List", 3, 11]`
    );
    expect(evaluate(['Slice', list, ['Range', 8, 9]])).toMatchInlineSnapshot(
      `["List"]`
    );
    expect(
      evaluate(['Slice', emptyList, ['Range', 1, 3]])
    ).toMatchInlineSnapshot(`["List"]`);
  });

  test('every source kind the positional arm accepts', () => {
    for (const xs of [range, linspace, tuple, matrix])
      expect(evaluate(['Slice', xs, ['Range', 2, 3]])).toBe(
        evaluate(['Slice', xs, 2, 3])
      );
    // A lazy infinite source: the span bounds the result.
    const e = engine.box([
      'Slice',
      ['Range', 1, 'PositiveInfinity'],
      ['Range', 3, 5],
    ]);
    expect(e.count).toBe(3);
    expect(e.isFiniteCollection).toBe(true);
    expect(engine.box(['ListFrom', e]).evaluate().json).toEqual([
      'List',
      3,
      4,
      5,
    ]);
  });

  test('the collection facets agree with the positional arm', () => {
    const viaSpan = engine.box(['Slice', list, ['Range', 2, 5]]);
    const viaBounds = engine.box(['Slice', list, 2, 5]);
    expect(viaSpan.count).toBe(viaBounds.count);
    expect(viaSpan.at(1)?.json).toEqual(viaBounds.at(1)?.json);
    expect(viaSpan.at(-1)?.json).toEqual(viaBounds.at(-1)?.json);
    expect(viaSpan.at(5)).toBeUndefined();
    expect(viaSpan.type.toString()).toBe(viaBounds.type.toString());
    expect(viaSpan.type.toString()).toMatchInlineSnapshot(
      `list<integer>`
    );
  });

  test('a symbol declared or inferred `range` is a span operand', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'range');
    ce.assign('r', ce.box(['Range', 2, 3]));
    expect(ce.box(['ListFrom', ['Slice', list, 'r']]).evaluate().json).toEqual([
      'List',
      13,
      5,
    ]);
    // Inferred from the assigned value: `Range(3, 4)` qualifies as a span.
    ce.assign('q', ce.box(['Range', 3, 4]));
    expect(ce.box('q').type.toString()).toBe('range');
    expect(ce.box(['ListFrom', ['Slice', list, 'q']]).evaluate().json).toEqual([
      'List',
      5,
      19,
    ]);
  });

  test('a span operand whose VALUE is not a span declines at run time', () => {
    // Validation rejects such an operand statically (and `assign` refuses a
    // non-span value for a `range` symbol), so the only route to the facets is
    // an unvalidated STRUCTURAL construction. Even there, the runtime re-check
    // must refuse to reinterpret a non-contiguous value as `(first, last)`
    // bounds — and it checks every position, not just the endpoints:
    // `[1, 100, 3]` has the count and endpoints of `1..3` and must not slice
    // as it. A list that IS a span by value (`[2, 3]`) is read as one.
    const ce = new ComputeEngine();
    const xs = ce.box(list);
    const slice = (span: Expression) =>
      ce.function('Slice', [xs, ce.box(span)], { form: 'structural' });
    for (const bad of [
      ['List', 1, 100, 3],
      ['Range', 4, 2],
      ['Range', 1, 5, 2],
      ['List', 0, 1],
      ['List'],
    ] as Expression[]) {
      const e = slice(bad);
      expect(e.count).toBeUndefined();
      expect(e.at(1)).toBeUndefined();
    }
    const ok = slice(['List', 2, 3]);
    expect(ok.count).toBe(2);
    expect(ok.at(1)?.json).toBe(13);
  });

  test('a descending, stepped, or symbolic Range span boxes and stays inert; a List span is a STATIC type error', () => {
    // Re-read under R1 overlap admission (§4.4 of
    // `docs/plans/2026-08-22-type-handlers-on-types.md`; this pin was a
    // static refusal before). Each Range below types as
    // `indexed_collection<integer|number>` — deliberately NOT `range`, the
    // Range type derivation refuses descending/stepped spans — and that
    // type OVERLAPS the span slot's `nothing | range` (an
    // indexed_collection value could be a range), so boxing admits it
    // provisionally. The refutation is not expressible in the lattice
    // ("an indexed_collection that is not a range"), so it cannot stay
    // static; at evaluation the span arm declines and the application stays
    // INERT. For `Range(a, b)` inert is the honest undecided answer —
    // `a = 1, b = 5` would make the span valid, a composition the old
    // static error refused outright.
    for (const r of [
      ['Range', 3, 2],
      ['Range', 1, 7, 2],
      ['Range', 'a', 'b'],
    ] as Expression[]) {
      const e = engine.box(['Slice', list, r]);
      expect(e.isValid).toBe(true);
      const v = e.evaluate();
      expect(v.operator).toBe('Slice');
    }
    // A `List` shares NO inhabitant with `nothing | range` — a provable
    // refutation stays a static error (§4.4).
    const e = engine.box(['Slice', list, ['List', 2, 3]]);
    expect(e.type.toString()).toBe('error');
    expect(e.op2.operator).toBe('Error');
    expect(e.op2.op1.json).toEqual([
      'ErrorCode',
      "'incompatible-type'",
      "'nothing | range'",
      expect.any(String),
    ]);
    // A span in the wrong slot is a type error too: `end` is a number.
    expect(
      engine.box(['Slice', list, ['Range', 2, 3], 5]).type.toString()
    ).toBe('error');
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
            "'number'"
          ],
          ["Add", ["Multiply", 3, "x"], 2]
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
          ],
          "x"
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
            "record{x: integer, y: integer, z: integer}"
          ],
          {dict: {x: 1; y: 2; z: 3}}
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

  test('At with multi-index on 1D list errors (incompatible-dimensions)', () =>
    expect(evaluate(['At', list, 1, 2])).toMatchInlineSnapshot(`
      [
        "Error",
        "incompatible-dimensions",
        "2 indices vs 1-dimensional collection"
      ]
    `)); // BREAKING (Tycho item 129): a 1D list can't be double-indexed. This
  // used to stay inert (silently wrong values downstream); it now fails fast.

  test('At with multi-index on 2D matrix', () =>
    expect(evaluate(['At', matrix, 1, 2])).toMatchInlineSnapshot(`3`)); // Row 1, Column 2 → 3

  // At description-audit pins (2026-07-19): mask/pick forms and the edge
  // conventions documented at the evaluate handler.
  // BREAKING (2026-07-22): a boolean mask is a filter whose length must EQUAL
  // the collection length; a mismatch is an error (was a silent prefix apply).
  test('At with a boolean mask keeps the True positions (mask length matches)', () =>
    expect(
      evaluate([
        'At',
        list,
        ['List', 'True', 'False', 'True', 'False', 'False', 'False', 'False'],
      ])
    ).toMatchInlineSnapshot(`["List", 7, 5]`));

  test('At with a mask of the wrong length is an error', () =>
    expect(evaluate(['At', list, ['List', 'True', 'False', 'True']]))
      .toMatchInlineSnapshot(`
      [
        "Error",
        "The mask (length 3) must have the same length as the collection (length 7)"
      ]
    `));

  test('At with an integer-list pick selects those indices, in order', () =>
    expect(evaluate(['At', list, ['List', 3, 1]])).toMatchInlineSnapshot(
      `["List", 5, 7]`
    ));

  test('At pick normalizes negative indices', () =>
    expect(evaluate(['At', list, ['List', 2, -1]])).toMatchInlineSnapshot(
      `["List", 13, 11]`
    ));

  // BREAKING (2026-07-22): out-of-band access is POSITION-PRESERVING and
  // yields the absence marker (`NaN` for a numeric collection), never
  // `Nothing`; a gather is length-preserving (out-of-range → marker in place).
  test('At out-of-range: scalar yields the marker, pick preserves length', () => {
    expect(evaluate(['At', list, 10])).toMatchInlineSnapshot(`NaN`);
    expect(evaluate(['At', list, ['List', 10]])).toMatchInlineSnapshot(
      `["List", "NaN"]`
    );
  });

  test('At with a scalar boolean index stays unevaluated', () =>
    expect(evaluate(['At', ['List', 7, 13], 'True'])).toMatchInlineSnapshot(
      `["At", ["List", 7, 13], "True"]`
    ));

  test('Chained At on a matrix-typed symbol (m[2][1])', () => {
    // Regression: `At(matrix, i)` must type as a row (a sub-tensor), so that a
    // chained/nested `At` — the lowering of `m[2][1]` — validates instead of
    // failing with `incompatible-type`. This exercises the type fall-through
    // path (symbol operand has no collection `elttype` handler).
    engine.assign('mtx', engine.box(matrix));
    const m = engine.box('mtx');
    // Phase C representation unification: literal lists type honestly
    // (list<finite_…^dims>).
    expect(m.type.toString()).toMatchInlineSnapshot(
      `matrix<integer^(3x3)>`
    );
    // A single index into the matrix yields a row (vector), not a scalar. The
    // access may be out of band, so the honest type carries the `| missing`
    // arm (§3.C `T | marker(T)`).
    expect(engine.box(['At', 'mtx', 2]).type.toString()).toMatchInlineSnapshot(
      `missing | vector<integer^3>`
    );
    // Nested `At` validates and evaluates (1-based indexing): row 2, column 1.
    expect(evaluate(['At', ['At', 'mtx', 2], 1])).toMatchInlineSnapshot(`6`);
  });

  test('Chained At on a flat-list-typed symbol stays sound', () => {
    // Sanity: a single index into a 1D list yields the scalar element type, so
    // a second `At` on that scalar does not validate (stays symbolic here).
    engine.assign('vec', engine.box(list));
    // Phase C representation unification: literal lists type honestly, so a
    // single index reports the honest element type.
    // §3.C: `At(list<T>, i) : T | marker(T)`. The marker of a numeric `T` is
    // the `nan` singleton, so the arm is ADDITIVE and the element tier
    // survives. It used to absorb to a bare `number` on the reasoning that
    // `NaN ∈ number`; the finite-by-default lattice flip repealed that
    // premise (`docs/ERROR-MODEL.md` §7, the 2026-08-28 `markerType` entry).
    expect(engine.box(['At', 'vec', 1]).type.toString()).toMatchInlineSnapshot(
      `integer | nan`
    );
    expect(evaluate(['At', 'vec', 1])).toMatchInlineSnapshot(`7`);
  });

  test('At on a dictionary returns the value type (not the iteration pair)', () => {
    // Regression: `At(dict, key)` returns the VALUE, so its static type must be
    // the dictionary's value type — not the `tuple<string, T>` iteration pair
    // that `collectionElementType` reports for iteration. Otherwise `d["a"] + 10`
    // fails with `incompatible-type`.
    const at = engine.box(['At', dict, { str: 'x' }]);
    // §3.C: the literal `dict` synthesizes `record{x: …, y: …, z: …}`, so a
    // LITERAL key that names an existing field is statically present — the
    // "present literal → exact" arm applies and the result carries no absence
    // marker. (A key-blind `dictionary<T>` base instead gives `T | marker(T)`,
    // which for a numeric `T` is `T | nan`.)
    expect(at.type.toString()).toMatchInlineSnapshot(`integer`);
    expect(
      engine
        .box(['Add', ['At', dict, { str: 'x' }], 10])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`11`);
  });

  test('At on a tuple with a literal index types the selected slot', () => {
    // Regression (Tycho item 44b): a literal integer index into a tuple-typed
    // operand types the SLOT (1-based; negatives count from the end), not the
    // widened union of every slot type. A non-literal index still widens.
    const ce = new ComputeEngine();
    ce.declare('tpl', ce.type('tuple<integer, string, boolean>'));
    expect(ce.box(['At', 'tpl', 1]).type.toString()).toEqual('integer');
    expect(ce.box(['At', 'tpl', 2]).type.toString()).toEqual('string');
    expect(ce.box(['At', 'tpl', 3]).type.toString()).toEqual('boolean');
    expect(ce.box(['At', 'tpl', -1]).type.toString()).toEqual('boolean');
    // BREAKING (§3.C): an out-of-range LITERAL tuple index is a definite miss,
    // so it types as `marker(⊔S)` — the absence marker over the widened slots,
    // NOT the widened slots themselves (the value is absent).
    // `marker(integer ⊔ string ⊔ boolean)` = `nan ⊔ missing ⊔ missing`: the
    // numeric arm names the `nan` singleton, not the whole `number` tier.
    expect(ce.box(['At', 'tpl', 5]).type.toString()).toEqual('missing | nan');
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

  // test('RandomShuffle', () =>
  //   expect(evaluate(['RandomShuffle', list])).toMatchInlineSnapshot());

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
      engine
        .box(['Reverse', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).not.toThrow();
    expect(evaluate(['Reverse', ['List', 1, 2, 3]])).toMatchInlineSnapshot(
      `["List", 3, 2, 1]`
    );
    expect(evaluate(['Reverse', ['List', 1]])).toMatchInlineSnapshot(
      `["List", 1]`
    );
    expect(evaluate(['Reverse', emptyList])).toMatchInlineSnapshot(`["List"]`);
  });
});

describe('SORT/SHUFFLE REBUILD AS LIST (regression)', () => {
  // Regression: Sort/RandomShuffle rebuilt the result with the source's operator
  // head. For a `Range` source, that reinterpreted the sorted elements as
  // lo/hi/step (`Sort(Range(1,10))` → `["Range",1,2,3]` == `[1]`).
  test('Sort(Range) rebuilds as List', () =>
    expect(evaluate(['Sort', ['Range', 1, 10]])).toMatchInlineSnapshot(
      `["List", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`
    ));

  test('Sort(Range) result has a List head', () => {
    const e = engine.box(['Sort', ['Range', 1, 10]]).evaluate();
    expect(e.operator).toEqual('List');
  });

  test('RandomShuffle(Range) rebuilds as List (seeded frame)', () => {
    const e = engine
      .box(['WithRandomSeed', 42, ['RandomShuffle', ['Range', 1, 5]]])
      .evaluate();
    expect(e.operator).toEqual('List');
    const elements = [...e.each()].map((x) => x.re).sort((a, b) => a! - b!);
    expect(elements).toEqual([1, 2, 3, 4, 5]);
  });

  test('Sort of an infinite collection stays inert', () => {
    // Plain evaluate (no materialization): the inert Sort is returned unchanged.
    const e = engine.box(['Sort', ['Cycle', ['List', 1, 2]]]).evaluate();
    expect(e.operator).toEqual('Sort');
  });

  // Regression: Sort/RandomShuffle always rebuild as `List`, but their `type`
  // handler returned the source's type — so `Sort(Range(1,5))` statically
  // claimed an indexed_collection/Range shape instead of a list.
  test('Sort static type is list<elt>, not the source type', () => {
    expect(engine.box(['Sort', ['Range', 1, 5]]).type.toString()).toEqual(
      'list<integer>'
    );
  });

  test('RandomShuffle static type is list<elt>, not the source type', () => {
    expect(
      engine.box(['RandomShuffle', ['Range', 1, 5]]).type.toString()
    ).toEqual('list<integer>');
  });
});

describe('FINITENESS GUARDS: COUNTIF/POSITION/ORDERING/DICTIONARYFROM/RECORDFROM (regression)', () => {
  // These evaluate handlers full-walk their input via `each()`. On a provably
  // infinite collection they used to burn the evaluation deadline then throw
  // CancellationError; now they cheaply stay inert (return undefined, so the
  // original operator is preserved), matching Sort's idiom.
  const pred: Expression = ['Function', ['Greater', 'x', 1], 'x'];

  test('CountIf of an infinite Cycle stays inert', () => {
    const e = engine
      .box(['CountIf', ['Cycle', ['List', 1, 2, 3]], pred])
      .evaluate();
    expect(e.operator).toEqual('CountIf');
  });

  test('CountIf of an infinite Range stays inert', () => {
    const e = engine
      .box(['CountIf', ['Range', 1, 'PositiveInfinity'], pred])
      .evaluate();
    expect(e.operator).toEqual('CountIf');
  });

  test('Position over an infinite collection stays inert', () => {
    const e = engine
      .box(['Position', ['Cycle', ['List', 1, 2, 3]], pred])
      .evaluate();
    expect(e.operator).toEqual('Position');
  });

  test('Ordering over an infinite collection stays inert (not an empty List)', () => {
    const e = engine.box(['Ordering', ['Cycle', ['List', 1, 2, 3]]]).evaluate();
    expect(e.operator).toEqual('Ordering');
  });

  test('Find over an infinite Range still streams and returns the first match', () => {
    // Streaming capability must not regress: Find short-circuits on the first
    // matching element without walking the whole (infinite) collection.
    const e = engine
      .box([
        'Find',
        ['Range', 1, 'PositiveInfinity'],
        ['Function', ['Greater', 'x', 5], 'x'],
      ])
      .evaluate();
    expect(e.re).toEqual(6);
  });

  test('Find types as the ELEMENT type (| nothing), not the collection type', () => {
    // `Find` returns a single element, or `Nothing` when nothing matches, so
    // its static type must be the element type unioned with `nothing`. It
    // used to echo `ops[0].type`, statically claiming `list<integer>` for an
    // expression that evaluates to an integer.
    const e = engine.box([
      'Find',
      ['List', 1, 2, 3],
      ['Function', ['Greater', 'x', 1], 'x'],
    ]);
    expect(e.type.matches('list<number>')).toBe(false);
    expect(e.type.matches('integer | nothing')).toBe(true);
    // The evaluated result agrees with the declared type.
    const v = e.evaluate();
    expect(v.re).toEqual(2);
    expect(v.type.matches(e.type)).toBe(true);

    // No match: the result is `Nothing`, also covered by the declared type.
    const none = engine.box([
      'Find',
      ['List', 1, 2, 3],
      ['Function', ['Greater', 'x', 10], 'x'],
    ]);
    const noneValue = none.evaluate();
    expect(noneValue.symbol).toEqual('Nothing');
    expect(noneValue.type.matches(none.type)).toBe(true);
  });

  test('DictionaryFrom of a finite collection of pairs', () => {
    const e = engine
      .box([
        'DictionaryFrom',
        ['List', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]],
      ])
      .evaluate();
    expect(e.operator).toEqual('Dictionary');
    expect(e.json).toEqual({ dict: { a: 1, b: 2 } });
  });

  test('DictionaryFrom of an infinite collection stays inert', () => {
    const e = engine
      .box(['DictionaryFrom', ['Cycle', ['List', ['Tuple', { str: 'a' }, 1]]]])
      .evaluate();
    expect(e.operator).toEqual('DictionaryFrom');
  });

  // `RecordFrom` was DELETED (user-ruled 2026-08-15). It declared
  // `(collection) -> record` but returned an inert `Record(…)` application
  // with type `unknown`, because `Record` has no operator definition anywhere
  // in the engine — so its declared result type lied. `DictionaryFrom` on the
  // same input already returns exactly what `RecordFrom` promised: a
  // dictionary value whose type derives as `record{…}` when every key is a
  // bare identifier. Record-ness is derived from the value, not carried by a
  // separate representation, which made the operator redundant rather than
  // merely broken. See the `RecordFrom` entry in `ROADMAP.md`.
  test('RecordFrom is gone; DictionaryFrom is the conversion', () => {
    const e = engine
      .box([
        'RecordFrom',
        ['List', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]],
      ])
      .evaluate();
    expect(e.operatorDefinition).toBeUndefined();
    const d = engine
      .box([
        'DictionaryFrom',
        ['List', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]],
      ])
      .evaluate();
    expect(d.type.toString()).toBe(
      'record{a: integer, b: integer}'
    );
  });
});

describe('MATERIALIZATION PRESERVES STRUCTURAL ELEMENTS (enlist regression)', () => {
  // `List.evaluate`'s materialization branch used `enlist`, which spliced ANY
  // sub-collection recursively — destroying eager structural elements (a
  // `Tuple`, a nested `List`) and spreading an infinite lazy child (a `Cycle`)
  // until the deadline burned. It must flatten ONLY finite lazy children.
  test('materialization keeps a list of Tuples intact (pairs preserved)', () => {
    const e = engine
      .box(['List', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]])
      .evaluate({ materialization: true });
    expect(e.json).toEqual(['List', ['Tuple', "'a'", 1], ['Tuple', "'b'", 2]]);
  });

  test('materialization keeps a nested literal List nested', () => {
    const e = engine
      .box(['List', ['List', 1, 2], 3])
      .evaluate({ materialization: true });
    expect(e.json).toEqual(['List', ['List', 1, 2], 3]);
  });

  test('materialization splices a finite lazy sub-collection (Range)', () => {
    const e = engine
      .box(['List', ['Range', 1, 3]])
      .evaluate({ materialization: true });
    expect(e.json).toEqual(['List', 1, 2, 3]);
  });

  test('materialization keeps an infinite lazy child as an element (no deadline burn)', () => {
    const e = engine
      .box(['List', ['Cycle', ['List', 1, 2]]])
      .evaluate({ materialization: true });
    // The Cycle is kept as a single element (materialized to a bounded
    // placeholder list), not spread into the outer list. That count of 1 is
    // itself the proof that the infinite child was not spread — spreading it
    // does not terminate — so no elapsed-time assertion is needed, and the
    // jest per-test timeout covers the non-terminating case.
    expect(e.operator).toEqual('List');
    expect(e.count).toEqual(1);
    expect([...e.each()][0].isCollection).toBe(true);
  });

  test('DictionaryFrom of a materialized pair-list yields a Dictionary', () => {
    // The motivating flow: materialize a pair-list, then build a Dictionary
    // from it. Before the fix the pairs were flattened and this stayed inert.
    const pairs = engine
      .box(['List', ['Tuple', { str: 'a' }, 1], ['Tuple', { str: 'b' }, 2]])
      .evaluate({ materialization: true });
    const e = engine.box(['DictionaryFrom', pairs]).evaluate();
    expect(e.operator).toEqual('Dictionary');
    expect(e.json).toEqual({ dict: { a: 1, b: 2 } });
  });
});

describe('NEGATIVE INDEX NORMALIZATION IN at() DISPATCHER (regression)', () => {
  // Regression: ~25 collection `at` handlers reject `index < 1`, so negative
  // indexing (`Last`, `At(xs, -1)`, `Reverse`'s back-to-front walk) yielded
  // Nothing/empty for `Range`, `Linspace`, `Zip`, `Scan`, etc. Negative-index
  // normalization is now centralized in the `at()` dispatcher.
  test('Last(Range)', () =>
    expect(evaluate(['Last', ['Range', 1, 10]])).toMatchInlineSnapshot(`10`));

  test('At(Range, -1)', () =>
    expect(evaluate(['At', ['Range', 1, 10], -1])).toMatchInlineSnapshot(`10`));

  // BREAKING (2026-07-22): out-of-band access yields the position-preserving
  // marker (`NaN` for a numeric collection), not `Nothing`.
  test('At(Range, out-of-range negative) is the marker (NaN)', () =>
    expect(evaluate(['At', ['Range', 1, 10], -11])).toMatchInlineSnapshot(
      `NaN`
    ));

  test('At(Linspace, -1)', () =>
    expect(evaluate(['At', ['Linspace', 0, 1, 5], -1])).toMatchInlineSnapshot(
      `1`
    ));

  test('Last(Zip)', () =>
    expect(
      evaluate(['Last', ['Zip', ['List', 1, 2, 3], ['List', 4, 5, 6]]])
    ).toMatchInlineSnapshot(`["Pair", 3, 6]`));

  test('Last(Scan)', () =>
    expect(
      evaluate([
        'Last',
        ['Scan', ['List', 1, 2, 3], ['Function', ['Add', 'a', 'b'], 'a', 'b']],
      ])
    ).toMatchInlineSnapshot(`6`));

  test('First(Reverse(Range))', () =>
    expect(
      evaluate(['First', ['Reverse', ['Range', 1, 10]]])
    ).toMatchInlineSnapshot(`10`));

  test('ListFrom(Reverse(Range))', () =>
    expect(
      evaluate(['ListFrom', ['Reverse', ['Range', 1, 5]]])
    ).toMatchInlineSnapshot(`["List", 5, 4, 3, 2, 1]`));

  test('Last of an infinite collection does not hang and yields the marker', () => {
    // Negative-index normalization requires a finite, known count; an infinite
    // source keeps returning undefined (no materialization, no hang). The
    // out-of-band access is POSITION-PRESERVING: a numeric collection yields
    // `NaN` (BREAKING — was `Nothing`).
    const e = engine.box(['Last', ['Cycle', ['List', 1, 2]]]).evaluate();
    expect(e.isNaN === true || e.symbol === 'Missing').toBe(true);
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
      evaluate(['Map', ['Function', ['Add', 'x', 1], 'x'], list])
    ).toMatchInlineSnapshot(`["List", 8, 14, 6, 20, 3, 4, 12]`));

  test('Map', () =>
    expect(evaluate(['Map', ['Add', '_', 1], list])).toMatchInlineSnapshot(
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

  // A SEEDLESS `Reduce` seeds with the FIRST element and folds from the
  // second (ruled 2026-08-09) — the convention of `Scan` and of the compiled
  // fast path. It used to fold from a `Nothing` sentinel instead, which only
  // looked right for a reducer that splices it away (`Add`): subtraction
  // answered -6 (`((nothing - 1) - 2) - 3`) where `Scan`'s last element is -4,
  // division 1/32 instead of 2, and a non-splicing reducer leaked the sentinel
  // into the result (`Power` → `Nothing^12`).
  describe('Reduce, seedless', () => {
    const SUB: Expression = ['Function', ['Subtract', 'a', 'b'], 'a', 'b'];
    const DIV: Expression = ['Function', ['Divide', 'a', 'b'], 'a', 'b'];
    const POW: Expression = ['Function', ['Power', 'a', 'b'], 'a', 'b'];

    // The interpreted path (`evaluate`) and the compiled fast path (`N`, which
    // is the only route that takes it) must agree on every case.
    test.each([
      // [name, collection, reducer, result]
      [
        'an empty collection has nothing to seed from',
        ['List'],
        SUB,
        '"Nothing"',
      ],
      ['a single element IS the result', ['List', 5], SUB, '5'],
      ['a NON-associative reducer folds left', ['List', 1, 2, 3], SUB, '-4'],
      ['division folds left too', ['List', 8, 2, 2], DIV, '2'],
      [
        'a NON-splicing reducer never sees a sentinel',
        ['List', 2, 3, 2],
        POW,
        '64',
      ],
    ] as [string, Expression, Expression, string][])(
      '%s (interpreted and compiled agree)',
      (_name, xs, f, result) => {
        expect(engine.expr(['Reduce', xs, f]).evaluate().toString()).toBe(
          result
        );
        expect(engine.expr(['Reduce', xs, f]).N().toString()).toBe(result);
      }
    );

    test('agrees with the last element of the seedless Scan', () => {
      // `Scan` is the cumulative spelling of the same fold, so its LAST
      // element is `Reduce`'s result — the convention this alignment adopts.
      expect(
        engine
          .expr(['Last', ['Scan', ['List', 1, 2, 3], SUB]])
          .evaluate()
          .toString()
      ).toBe('-4');
    });

    test('an explicit initial value is still folded in from the start', () => {
      expect(
        engine
          .expr(['Reduce', ['List', 1, 2, 3], SUB, 0])
          .evaluate()
          .toString()
      ).toBe('-6');
    });
  });

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
      [
        'Map',
        ['Function', ['Add', 'k', 'ImaginaryUnit'], 'k'],
        ['Range', 1, 3],
      ],
    ];
    expect(engine.box(p).evaluate().toString()).toMatchInlineSnapshot(`10i`);
  });

  test('Map element type reflects the lambda result, not the source', () => {
    // Regression: `Map(k => k + i, Range(1,3))` must NOT be typed with the
    // source element type (integer). Its element type is the lambda's result
    // type, which keeps it out of the real-only compiled fast path.
    //
    // Since the 2026-08-09 widening of the callback element-type inference to
    // scalar element types, `k` is annotated `integer` (Range's element type),
    // so the body types `complex` rather than the looser `number` — strictly
    // more precise, and still not real.
    const m: Expression = [
      'Map',
      ['Function', ['Add', 'k', 'ImaginaryUnit'], 'k'],
      ['Range', 1, 3],
    ];
    expect(engine.box(m).type.toString()).toMatchInlineSnapshot(
      `indexed_collection<complex>`
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
      ['Function', 'c', 'c'],
      ['UnicodeScalars', { str: 'abc' }],
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
    expect(evaluate(['Append', ['List', 1, 2, 3], 4])).toMatchInlineSnapshot(
      `["List", 1, 2, 3, 4]`
    ));

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

  // A tuple operand is ONE element, not a sequence to splice: the point-list
  // accumulation idiom `L → Join(L, P)`. Previously the point's components
  // were spliced (length +2, and the result stopped matching `list<point>`).
  describe('Join with a tuple operand appends it atomically', () => {
    const points: Expression = ['List', ['Tuple', 0, 3], ['Tuple', 1, 4]];
    const joined: Expression = ['Join', points, ['Tuple', 2, 5]];

    test('length is +1, not +2', () =>
      expect(evaluate(['Length', joined])).toMatchInlineSnapshot(`3`));

    test('the point survives as one element', () =>
      expect(evaluate(joined)).toMatchInlineSnapshot(
        `["List", ["Pair", 0, 3], ["Pair", 1, 4], ["Pair", 2, 5]]`
      ));

    test('indexing lands on whole points', () =>
      expect(
        [1, 3, -1].map((i) => engine.box(joined).evaluate().at(i)?.toString())
      ).toMatchInlineSnapshot(`
        [
          (0, 3),
          (2, 5),
          (2, 5),
        ]
      `));

    test('agrees with Append', () =>
      expect(evaluate(joined)).toEqual(
        evaluate(['Append', points, ['Tuple', 2, 5]])
      ));

    test('a LIST operand still splices', () =>
      expect(
        evaluate(['Join', points, ['List', ['Tuple', 2, 5]]])
      ).toMatchInlineSnapshot(
        `["List", ["Pair", 0, 3], ["Pair", 1, 4], ["Pair", 2, 5]]`
      ));

    test('tuple-only Join collects the tuples', () =>
      expect(
        evaluate(['Join', ['Tuple', 1, 2], ['Tuple', 3, 4]])
      ).toMatchInlineSnapshot(`["List", ["Pair", 1, 2], ["Pair", 3, 4]]`));
  });
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
    expect(evaluate(['All', ['List', 'True', 'True']])).toMatchInlineSnapshot(
      `True`
    ));

  test('Empty collection: Any is False (vacuous)', () =>
    expect(evaluate(['Any', emptyList, gt(0)])).toMatchInlineSnapshot(`False`));

  test('Empty collection: All is True (vacuous)', () =>
    expect(evaluate(['All', emptyList, gt(0)])).toMatchInlineSnapshot(`True`));

  // Short-circuiting is pinned by the ANSWER, not by elapsed time: a walk that
  // did not stop at the deciding element would run through 10⁹ elements and
  // never return a verdict, so producing `True`/`False` at all is the proof.
  // The jest per-test timeout is the backstop for that non-terminating case.
  test('Any short-circuits over a huge lazy collection', () => {
    const result = engine
      .box(['Any', ['Range', 1, 1_000_000_000], gt(5)])
      .evaluate();
    expect(result.symbol).toBe('True');
  });

  test('All short-circuits to False over a huge lazy collection', () => {
    const result = engine
      .box(['All', ['Range', 1, 1_000_000_000], gt(5)])
      .evaluate();
    expect(result.symbol).toBe('False');
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

  // Laziness is pinned by the fact that these return AT ALL: an eager Scan
  // over 10⁹ elements does not terminate within any budget, so obtaining the
  // first five cumulative sums, or a count, is itself the evidence. The jest
  // per-test timeout is the backstop for the non-terminating case; an
  // elapsed-millisecond assertion would only report how loaded the machine is.
  test('Scan is lazy: Take over a huge Range does not enumerate the source', () => {
    const result = engine
      .box(['Take', ['Scan', ['Range', 1, 1_000_000_000], add], 5])
      .evaluate({ materialization: true });
    expect(result.toString()).toEqual('[1,3,6,10,15]');
  });

  test('Scan reports its count without enumerating', () => {
    const count = engine.box(['Scan', ['Range', 1, 1_000_000_000], add]).count;
    expect(count).toBe(1_000_000_000);
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

  // As with Scan above: returning a count at all proves the 10⁹-element source
  // was not walked, since walking it does not terminate. The jest per-test
  // timeout is the backstop.
  test('Differences reports its count without enumerating', () => {
    const count = engine.box([
      'Differences',
      ['Range', 1, 1_000_000_000],
    ]).count;
    expect(count).toBe(999_999_999);
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
  const add3: Expression = ['Function', ['Add', 'a', 'b', 'c'], 'a', 'b', 'c'];

  test('two collections combine element-wise', () =>
    expect(str(['Map', add, ['List', 1, 2, 3], ['List', 10, 20, 30]])).toEqual(
      '[11,22,33]'
    ));

  test('result has the length of the shortest input', () =>
    expect(str(['Map', add, ['List', 1, 2, 3], ['List', 10, 20]])).toEqual(
      '[11,22]'
    ));

  test('three collections', () =>
    expect(
      str(['Map', add3, ['List', 1, 2], ['List', 3, 4], ['List', 5, 6]])
    ).toEqual('[9,12]'));

  test('laziness: .count and head of two infinite ranges are fast', () => {
    const expr = engine.box(['Map', add, ['Range', 1, 1e9], ['Range', 1, 1e9]]);
    expect(expr.count).toBe(1e9);
    expect(expr.isFiniteCollection).toBe(true);
    expect(expr.at(2)?.toString()).toEqual('4');
    expect(
      str(['Take', ['Map', add, ['Range', 1, 1e9], ['Range', 1, 1e9]], 3])
    ).toEqual('[2,4,6]');
  });

  test('mixed finite/infinite: bounded by the finite input', () => {
    const expr = engine.box(['Map', mul, ['Range', 1, 1e9], ['List', 1, 2, 3]]);
    expect(expr.count).toBe(3);
    expect(str(['Map', mul, ['Range', 1, 1e9], ['List', 1, 2, 3]])).toEqual(
      '[1,4,9]'
    );
  });

  test('single-collection form is unchanged', () =>
    expect(
      str(['Map', ['Function', ['Power', 'x', 2], 'x'], ['List', 1, 2, 3]])
    ).toEqual('[1,4,9]'));

  test('arity mismatch: too few lambda params is a STATIC error', () => {
    // The mapping function declares one parameter but two collections are
    // supplied, and `Map(f, xs, ys)` passes one element of EACH. Since the
    // static callback-arity check (2026-08-15) that is settled while the call
    // is canonicalized — the callback slot holds the diagnostic and the call
    // is invalid — rather than at application time, where it used to surface
    // as a thrown `Too many arguments` on every materializing route (.at(),
    // each(), Take).
    const expr = engine.box([
      'Map',
      ['Function', ['Power', 'x', 2], 'x'],
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(expr.isValid).toBe(false);
    expect(expr.type.toString()).toBe('error');
    expect(expr.toString()).toContain(
      'Map calls its callback with 2 arguments (one element from each of the 2 collections); `(x) => x^2` declares 1 parameter'
    );
    expect(() => expr.at(1)).not.toThrow();
  });

  // Regression pin: `.N()` on a user-written lazy Map keeps the lazy Map form,
  // and its elements numericize on access — `.at(2)` is the FLOAT √2, not the
  // exact symbolic `Sqrt(2)`.
  test('.N() of a lazy user-written Map stays lazy and numericizes on access', () => {
    const e = engine
      .box(['Map', ['Function', ['Sqrt', 'x'], 'x'], ['Range', 1, 200]])
      .N();
    expect(e.operator).toEqual('Map');
    expect(e.isLazyCollection).toBe(true);
    const el = e.at(2)!;
    expect(el.re).toBeCloseTo(1.4142135623730951, 12);
    expect(el.isNumber).toBe(true);
    // Not the exact symbolic form.
    expect(el.operator).not.toEqual('Sqrt');
  });
});

// describe('NON-ITERABLE OPERATIONS', () => {

// })

describe('CONTINUATION PLACEHOLDER', () => {
  // Use lazy collections (e.g., Map) to test continuation placeholder

  // Check various eager evaluation
  test('empty list', () => {
    const empty_list = engine.expr(['Map', ['Square', '_'], ['List']]);
    expect(
      empty_list.evaluate({ materialization: false })
    ).toMatchInlineSnapshot(
      `["Map", ["Function", ["Square", "_1"]], ["List"]]`
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
    const empty_set = engine.expr(['Map', ['Square', '_'], ['Set']]);
    expect(
      empty_set.evaluate({ materialization: false })
    ).toMatchInlineSnapshot(`["Map", ["Function", ["Square", "_1"]], ["Set"]]`);
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
      ['Square', '_'],
      ['List', 1, 1, 2, 2, 3, 4, 7, 8, 9, 10, 11, 12, 14],
    ]);
    expect(finite_list.evaluate({ materialization: false }))
      .toMatchInlineSnapshot(`
      [
        "Map",
        ["Function", ["Square", "_1"]],
        ["List", 1, 1, 2, 2, 3, 4, 7, 8, 9, 10, 11, 12, 14]
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
      ['Square', '_'],
      ['Set', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    ]);
    expect(finite_set.evaluate({ materialization: false }))
      .toMatchInlineSnapshot(`
      [
        "Map",
        ["Function", ["Square", "_1"]],
        ["Set", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
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
    // `Integers` enumerates 0, 1, -1, 2, -2, …, so squaring it produces
    // 0, 1, 1, 4, 4, … — a SET whose enumeration repeats. The previews below
    // show as many DISTINCT values as the requested head, because a set-kind
    // `Map` deduplicates as it walks (2026-08-17). They used to show fewer:
    // the walk spent head slots on duplicates and the `Set` constructor then
    // collapsed them, so a head of 5 yielded only 0, 1, 4.
    const infinite_set = engine.expr(['Map', ['Square', '_'], 'Integers']);
    expect(
      infinite_set.evaluate({ materialization: false })
    ).toMatchInlineSnapshot(
      `["Map", ["Function", ["Square", "_1"]], "Integers"]`
    );
    expect(
      infinite_set.evaluate({ materialization: true })
    ).toMatchInlineSnapshot(
      `["Set", 0, 1, 4, 9, 16, "ContinuationPlaceholder"]`
    );
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
        121,
        144,
        169,
        196,
        225,
        256,
        289,
        324,
        361,
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
        121,
        144,
        169,
        196,
        225,
        256,
        289,
        324,
        361,
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

describe('FILTER FINITENESS/COUNT DO NOT WALK (regression)', () => {
  // Filter over a large finite source used to THROW `iteration-limit-exceeded`
  // during canonicalization: the synthesized `isFinite` default derived its
  // answer from `count`, whose walk enforces `ce.iterationLimit`. Filter now
  // provides structural, O(1) `isFinite`/`isEmpty` handlers that never walk.
  const pred: Expression = ['Function', ['Greater', 'x', 2], 'x'];

  it('canonicalizes a large Filter without throwing', () => {
    expect(() =>
      engine.box(['Add', ['Filter', ['Range', 1, 100000], pred], 1])
    ).not.toThrow();
  });

  it('reports isFinite=true instantly for a finite source (no walk)', () => {
    expect(
      engine.box(['Filter', ['Range', 1, 100000], pred]).isFiniteCollection
    ).toBe(true);
  });

  it('reports an unknown count (undefined, never Infinity) past the iteration limit', () => {
    expect(
      engine.box(['Filter', ['Range', 1, 100000], pred]).count
    ).toBeUndefined();
  });

  it('still counts exactly for a finite source under the iteration limit', () => {
    expect(
      engine.box([
        'Filter',
        ['Range', 1, 50],
        ['Function', ['Greater', 'x', 10], 'x'],
      ]).count
    ).toBe(40);
  });

  it('reports an unknown count (not Infinity) for a non-finite source', () => {
    // `Range(1, n)` with an unbound `n` is not a finite collection.
    expect(
      engine.box(['Filter', ['Range', 1, 'n'], pred]).count
    ).toBeUndefined();
  });

  it('reports unknown finiteness for an infinite source', () => {
    expect(
      engine.box(['Filter', ['Cycle', ['List', 1, 2]], pred]).isFiniteCollection
    ).toBeUndefined();
  });

  it('B18 (regression guard): Sum over a small finite Filter still evaluates', () => {
    expect(
      evaluate([
        'Sum',
        ['Filter', ['List', 1, 2, 3], ['Function', ['Greater', '_', 1], '_']],
      ])
    ).toBe('5');
  });

  it('bounds an infinite Filter walk via the iteration limit with NO deadline', () => {
    // Guard: the Filter iterator (collections.ts) caps its walk at
    // `ce.iterationLimit` and throws `iteration-limit-exceeded`; the
    // `isEmpty` handler swallows that cause and reports `undefined`. Here the
    // source Range is infinite and the predicate (`x < 0`) is NEVER true, so
    // the filtered stream yields nothing and the walk is unbounded — the
    // iteration-limit guard is the ONLY thing that can stop it. With no
    // deadline armed (a fresh engine, no enclosing span) a regression in the
    // guard would hang forever here rather than hide behind a deadline. A
    // fresh engine is used so the default `iterationLimit` (1024) applies.
    const ce = new ComputeEngine();
    const neverTrue: Expression = ['Function', ['Less', 'x', 0], 'x'];
    const filter: Expression = ['Filter', ['Range', 1, 'Infinity'], neverTrue];
    // The guarded walk trips iteration-limit-exceeded, which isEmpty swallows,
    // so the observable result is `undefined` (unknown) rather than a hang.
    // Getting an answer back is the assertion: an unguarded walk of an
    // infinite never-matching Filter never produces one. The jest per-test
    // timeout below is the hang backstop, deliberately far above the real cost.
    expect(ce.box(filter).isEmptyCollection).toBeUndefined();
  }, 15_000);

  it('bounds First over an infinite never-matching Filter via the iteration limit with NO deadline', () => {
    // Companion to the `isEmpty` guard above, for the `at` walk that `First`
    // uses. `First(Filter(...))` calls the Filter `at` handler, whose
    // positive-index path must route through the guarded iterator (capping the
    // source walk at `ce.iterationLimit`) rather than the raw `expr.op1.each()`
    // — otherwise, with no deadline armed, a never-true predicate over an
    // infinite source would walk forever. The guarded walk trips
    // iteration-limit-exceeded, which the `at` handler swallows (returns
    // undefined), so `First` yields the position-preserving absence marker
    // (`NaN` for a numeric collection; BREAKING — was `Nothing`).
    const ce = new ComputeEngine();
    const neverTrue: Expression = ['Function', ['Less', 'x', 0], 'x'];
    const first: Expression = [
      'First',
      ['Filter', ['Range', 1, 'Infinity'], neverTrue],
    ];
    // Returning the absence marker at all is the assertion: an unguarded walk
    // of an infinite never-matching Filter never returns. The jest per-test
    // timeout below is the hang backstop, deliberately far above the real cost.
    expect(ce.box(first).evaluate().isNaN).toBe(true);
  }, 15_000);
});

describe('ISEMPTY / CONTAINS ARE THREE-VALUED (regression)', () => {
  // `IsEmpty`/`Contains` must not coerce an INDETERMINATE emptiness/membership
  // (e.g. a bounded Filter walk that hits its iteration limit and returns
  // `undefined`) to a definite `False`. The expression stays inert.
  const neverMatch: Expression = ['Function', 'False', '_'];

  it('IsEmpty stays inert when emptiness is indeterminate (large Filter)', () => {
    const result = engine
      .box(['IsEmpty', ['Filter', ['Range', 1, 100000], neverMatch]])
      .evaluate();
    // Not collapsed to a boolean: the operator survives.
    expect(result.operator).toBe('IsEmpty');
  });

  it('Contains stays inert when membership is indeterminate (large Filter)', () => {
    // A Filter whose membership test would require walking past the iteration
    // limit: `contains` returns undefined, so the expression stays inert.
    const result = engine
      .box(['Contains', ['Filter', ['Range', 1, 100000], neverMatch], 5])
      .evaluate();
    // Either it stays inert (`Contains`), or membership is definitely refuted
    // (the boolean `False`) — never an undefined-coerced crash. It must not
    // spuriously report `True`.
    const stayedInert = result.operator === 'Contains';
    expect(stayedInert || result.symbol === 'False').toBe(true);
  });

  it('IsEmpty still resolves for a small never-matching Filter (walk completes)', () => {
    expect(evaluate(['IsEmpty', ['Filter', ['List', 1, 2], neverMatch]])).toBe(
      'True'
    );
  });

  it('IsEmpty resolves for a non-empty literal list', () => {
    expect(evaluate(['IsEmpty', ['List', 1]])).toBe('False');
  });

  it('IsEmpty resolves for an empty literal list', () => {
    expect(evaluate(['IsEmpty', ['List']])).toBe('True');
  });

  it('Contains resolves definite membership for a literal list', () => {
    expect(evaluate(['Contains', ['List', 1, 2, 3], 2])).toBe('True');
    expect(evaluate(['Contains', ['List', 1, 2, 3], 9])).toBe('False');
  });
});

describe('LAZY BROADCAST N-WRAP HONORS numericApproximation (regression)', () => {
  // A large broadcast returns a lazy `Map`. Under `.N()`, each element must
  // float on access; under `evaluate()` it stays exact. Previously the Map
  // body did not know `numericApproximation` was requested, so `.N()` elements
  // evaluated exactly (symbolic `sin(1)` instead of `0.841…`).
  it('evaluate() keeps lazy elements exact', () => {
    const e = engine.box(['Sin', ['Range', 1, 200]]).evaluate();
    expect(e.operator).toBe('Map');
    expect(e.at(1)?.toString()).toBe('sin(1)');
  });

  it('N() floats lazy elements on access', () => {
    const e = engine.box(['Sin', ['Range', 1, 200]]).N();
    expect(e.operator).toBe('Map');
    expect(e.at(1)?.isNumberLiteral).toBe(true);
    expect(e.at(1)?.re).toBeCloseTo(0.8414709848, 9);
  });

  it('re-evaluating an N-wrapped Map does not double-wrap or regress', () => {
    const e = engine.box(['Sin', ['Range', 1, 200]]).N();
    expect(e.evaluate().at(1)?.re).toBeCloseTo(0.8414709848, 9);
    expect(e.N().at(1)?.re).toBeCloseTo(0.8414709848, 9);
  });

  it('small (eager) broadcast still floats under N()', () => {
    const e = engine.box(['Sin', ['List', 1, 2]]).N();
    expect(e.operator).toBe('List');
    expect(e.at(1)?.re).toBeCloseTo(0.8414709848, 9);
    expect(e.at(2)?.re).toBeCloseTo(0.9092974268, 9);
  });

  it('lazy Add broadcast floats element on access under N()', () => {
    const e = engine.box(['Add', ['Range', 1, 100000000], 0.5]).N();
    expect(e.operator).toBe('Map');
    expect(e.at(1)?.re).toBe(1.5);
  });

  // Tycho item 39: `.N()` of an ALREADY-EVALUATED lazy Map was an identity —
  // the Map has no evaluate handler, so the numericApproximation flag never
  // reached the elements and both access routes (each()/at) stayed exact.
  // `x.evaluate().N()` must behave like `x.N()`.
  it('N() of an already-evaluated lazy Map floats elements (evaluate-then-N route)', () => {
    const e = engine
      .box(['Sin', ['Range', 1, 200]])
      .evaluate()
      .N();
    expect(e.operator).toBe('Map');
    // at() route
    expect(e.at(1)?.isNumberLiteral).toBe(true);
    expect(e.at(1)?.re).toBeCloseTo(0.8414709848, 9);
    // each() route
    const first = e.each().next().value;
    expect(first?.re).toBeCloseTo(0.8414709848, 9);
    // At() operator route (Tycho's probe)
    expect(engine.box(['At', e.json, 1]).evaluate().re).toBeCloseTo(
      0.8414709848,
      9
    );
  });

  it('evaluate-then-N is idempotent and shape-stable', () => {
    const direct = engine.box(['Sin', ['Range', 1, 200]]).N();
    const staged = engine
      .box(['Sin', ['Range', 1, 200]])
      .evaluate()
      .N();
    // The rewrapped Map has the same shape as the directly-N'd one
    expect(staged.json).toEqual(direct.json);
    // Repeated N() does not grow the wrapping
    expect(staged.N().json).toEqual(staged.json);
    expect(staged.N().at(1)?.re).toBeCloseTo(0.8414709848, 9);
  });

  it('evaluate-then-N floats elements of a multi-collection (zipWith) lazy Map', () => {
    const e = engine
      .box(['Add', ['Range', 1, 200], ['Range', 1, 200]])
      .evaluate()
      .N();
    expect(e.operator).toBe('Map');
    expect(e.at(1)?.re).toBe(2);
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
    // until the evaluation deadline (>seconds); now inert immediately. The
    // inert `Min` operator below is the deterministic evidence: a sampler that
    // ground away would have returned a number, not the unevaluated form.
    const r = engine
      .expr([
        'Min',
        [
          'Map',
          ['Function', ['GammaLn', 'x_1'], 'x_1'],
          ['Interval', ['Open', 0], ['Open', 'PositiveInfinity']],
        ],
      ])
      .evaluate();
    expect(r.operator).toBe('Min');

    // Map over a Linspace with a symbolic endpoint reports count 3 but
    // declines enumeration: it used to VANISH from the result
    // (Min(Map(...), 5) → 5). It must stay in the symbolic Min.
    const m = engine
      .expr([
        'Min',
        ['Map', ['Function', ['Square', '_'], '_'], ['Linspace', 'x_1', 1, 3]],
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
            [
              'Filter',
              ['List', 1, 2, 8],
              ['Function', ['Greater', '_', 1], '_'],
            ],
          ])
          .evaluate()
      )
    ).toBe('2');
  });

  test('concrete controls are unaffected', () => {
    expect(
      exprToString(engine.expr(['Sum', ['Range', 1, 10]]).evaluate())
    ).toBe('55');
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
    // Phase C representation unification: `.N()` on a list is precision-driven
    // (design §D2.3), so each element is numericized at engine precision rather
    // than truncated to a machine float.
    const ce = new ComputeEngine();
    expect(exprToString(ce.box(['List', ['Divide', 1, 3], 'Pi']).N())).toBe(
      '["List", "0.(3)", "3.141592653589793238462643"]'
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

  test('all-literal list evaluates to an equal plain List (honest dimensioned type)', () => {
    // Phase C representation unification: a literal numeric list is a plain
    // canonical List (the BoxedTensor construction path is gone), so `evaluate`
    // returns an equal List with an honest dimensioned type rather than the same
    // reference via the old fast-path identity.
    const ce = new ComputeEngine();
    const big = ce.box(['List', ...Array.from({ length: 5000 }, (_, i) => i)]);
    const evaluated = big.evaluate();
    expect(evaluated.operator).toBe('List');
    expect(evaluated.isEqual(big)).toBe(true);
    expect(big.type.matches('vector')).toBe(true);
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

//
// A dictionary literal always knows its keys, so it synthesizes the narrower
// `record{k: T, …}` rather than the key-blind `dictionary<T>`. This is what
// makes a `record`-bodied type inhabitable from a literal; `record <:
// dictionary` keeps every `dictionary<T>` consumer matching.
//
describe('DICTIONARY LITERAL TYPE SYNTHESIS', () => {
  test('synthesizes a record type naming the keys', () => {
    const ce = new ComputeEngine();
    expect(ce.box({ dict: { x: 1, y: 2 } }).type.toString()).toBe(
      'record{x: integer, y: integer}'
    );
  });

  test('the boxed Dictionary/KeyValuePair route agrees', () => {
    const ce = new ComputeEngine();
    const d = ce.box([
      'Dictionary',
      ['KeyValuePair', { str: 'x' }, 1],
      ['KeyValuePair', { str: 'y' }, 2],
    ]);
    expect(d.type.toString()).toBe(
      'record{x: integer, y: integer}'
    );
  });

  test('the synthesized record still satisfies a dictionary annotation', () => {
    const ce = new ComputeEngine();
    const t = ce.box({ dict: { x: 1, y: 2 } }).type;
    expect(t.matches('dictionary<integer>')).toBe(true);
    expect(t.matches('dictionary')).toBe(true);
    expect(t.matches('collection')).toBe(true);
    // ...and now also the record shape it structurally matches.
    expect(t.matches('record{x: number, y: number}')).toBe(true);
  });

  test('a non-identifier key falls back to `dictionary<T>`', () => {
    // `typeToString` does not backtick-escape record keys, so a record type
    // built from such a key would not round-trip through `parseType`.
    const ce = new ComputeEngine();
    expect(ce.box({ dict: { 'a b': 1 } }).type.toString()).toBe(
      'dictionary<integer>'
    );
    // A word the type lexer reads as a keyword, not an identifier.
    expect(ce.box({ dict: { true: 1 } }).type.toString()).toBe(
      'dictionary<integer>'
    );
  });

  test('every synthesized record type round-trips through parseType', () => {
    const ce = new ComputeEngine();
    const s = ce.box({ dict: { x: 1, y: 2 } }).type.toString();
    expect(ce.type(s).toString()).toBe(s);
  });

  test('an empty dictionary keeps its `dictionary<never>` typing', () => {
    const ce = new ComputeEngine();
    expect(ce.box({ dict: {} }).type.toString()).toBe('dictionary<never>');
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
    expect(ce.box(['Values', dict]).evaluate().json).toEqual(['List', 1, 2, 3]);
  });

  test('Values type reflects the value types', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Values', dict]).type.toString()).toBe(
      'list<integer>'
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
    expect(T(['Equal', ['Map', inc, ['List', 1, 2]], ['List', 2, 3]])).toEqual(
      'True'
    );
    expect(T(['Equal', ['Map', inc, ['List', 1, 2]], ['List', 2, 4]])).toEqual(
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
    expect(evaluate(['Scan', ['List', 1, 2], add, ['Divide', 1]])).not.toEqual(
      '["List", 1, 3]'
    );
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
    expect(evaluate(['Sort', ['List', 3, 1, 2]])).toEqual('["List", 1, 2, 3]'));

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
    expect(engine.box(['MaxBy', emptyList, identity]).evaluate().operator).toBe(
      'MaxBy'
    ));

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
  const doubleAcc: Expression = [
    'Function',
    ['Multiply', 2, 'acc'],
    'n',
    'acc',
  ];

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
      engine.box(['ChunkBy', ['Iterate', doubleAcc, 1], identity]).evaluate()
        .operator
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
      str([
        'Partition',
        ['List', 1, 2, 3, 4, 5],
        ['Function', ['Greater', 'x', 2], 'x'],
      ])
    ).toEqual('[[3,4,5],[1,2]]'));

  test('Partition is inert on a non-finite collection', () =>
    expect(
      engine.box(['Partition', ['Iterate', doubleAcc, 1], 2]).evaluate()
        .operator
    ).toBe('Partition'));

  // --- Hybrid-lazy Partition / SlidingWindow / ChunkBy (Tycho item 52) ----
  // Small finite sources stay eager (all the pins above); larger, unknown, or
  // infinite sources keep the operator inert and serve a lazy `collection`
  // view (count / at / iterator). The predicate form is EXEMPT (no lazy view).

  // Large finite: evaluate stays symbolic, facets serve the view cheaply.
  // Laziness is pinned by the INERT operator and by index-addressed lookups,
  // not by elapsed time: a materialized Partition would evaluate to a List of
  // chunks instead of staying a `Partition`, which the first assertion below
  // catches deterministically on any machine.
  test('Partition(large, n) is inert and served lazily', () => {
    const p = engine.box(['Partition', ['Range', 1, 1_000_000], 1000]);
    expect(p.evaluate().operator).toBe('Partition');
    expect(engine.box(['Count', p]).evaluate().toString()).toBe('1000');
    // 2nd chunk is [1001..2000]; its first element is 1001.
    expect(
      engine
        .box(['At', ['At', p, 2], 1])
        .evaluate()
        .toString()
    ).toBe('1001');
  });

  test('SlidingWindow(large, k, step) is inert and served lazily', () => {
    const sw = engine.box(['SlidingWindow', ['Range', 1, 1_000_000], 1000, 1]);
    expect(sw.evaluate().operator).toBe('SlidingWindow');
    // Complete windows only: floor((1e6 - 1000)/1) + 1 = 999001.
    expect(engine.box(['Count', sw]).evaluate().toString()).toBe('999001');
    // 2nd window is [2..1001]; its first element is 2.
    expect(
      engine
        .box(['At', ['At', sw, 2], 1])
        .evaluate()
        .toString()
    ).toBe('2');
  });

  test('ChunkBy(large) reports its run count without materializing', () => {
    // 300 singleton runs (every element distinct under the identity key).
    // Non-materialization is pinned by the operator staying `ChunkBy` after
    // evaluation, which is a deterministic structural fact; elapsed time added
    // nothing to it.
    const cb = engine.box(['ChunkBy', ['Range', 1, 300], identity]);
    expect(cb.evaluate().operator).toBe('ChunkBy');
    expect(engine.box(['Count', cb]).evaluate().toString()).toBe('300');
  });

  // Infinite sources: the lazy view streams windows lazily under Take.
  test('Partition(infinite, n) streams chunks lazily', () =>
    expect(
      str(['Take', ['Partition', ['Range', 1, 'PositiveInfinity'], 3], 2])
    ).toEqual('[[1,2,3],[4,5,6]]'));

  test('Partition(infinite, n, step) streams windows lazily', () =>
    expect(
      str(['Take', ['Partition', ['Range', 1, 'PositiveInfinity'], 2, 3], 2])
    ).toEqual('[[1,2],[4,5]]'));

  test('SlidingWindow(infinite, k) streams windows lazily', () =>
    expect(
      str(['Take', ['SlidingWindow', ['Range', 1, 'PositiveInfinity'], 3], 3])
    ).toEqual('[[1,2,3],[2,3,4],[3,4,5]]'));

  test('ChunkBy(infinite) streams runs lazily', () =>
    // Cycle([1,1,2]) → runs [1,1], [2], [1,1], ...
    expect(
      str(['Take', ['ChunkBy', ['Cycle', ['List', 1, 1, 2]], identity], 3])
    ).toEqual('[[1,1],[2],[1,1]]'));

  // SlidingWindow eager happy-paths (it previously had no tests anywhere).
  test('SlidingWindow(xs, k) overlapping windows', () =>
    expect(str(['SlidingWindow', ['List', 1, 2, 3, 4, 5, 6], 3])).toEqual(
      '[[1,2,3],[2,3,4],[3,4,5],[4,5,6]]'
    ));

  test('SlidingWindow(xs, k, step) with step > 1', () =>
    expect(str(['SlidingWindow', ['List', 1, 2, 3, 4, 5, 6], 2, 2])).toEqual(
      '[[1,2],[3,4],[5,6]]'
    ));

  test('SlidingWindow(xs, k) with k ≤ 0 is inert', () =>
    expect(
      engine.box(['SlidingWindow', ['List', 1, 2, 3], 0]).evaluate().operator
    ).toBe('SlidingWindow'));

  test('SlidingWindow(xs, k, step) with step ≤ 0 is inert', () =>
    expect(
      engine.box(['SlidingWindow', ['List', 1, 2, 3], 2, 0]).evaluate().operator
    ).toBe('SlidingWindow'));

  // Predicate form is EXEMPT from the threshold: eager whenever finite (any
  // size), and fully inert (facets included) on an infinite source.
  test('Partition(predicate) stays eager past the threshold', () => {
    // 101-element source, predicate x > 50 → [ [51..101], [1..50] ].
    const pred: Expression = ['Function', ['Greater', 'x', 50], 'x'];
    const p: Expression = ['Partition', ['Range', 1, 101], pred];
    expect(engine.box(p).evaluate().operator).toBe('List');
    expect(
      engine
        .box(['Count', ['At', p, 1]])
        .evaluate()
        .toString()
    ).toBe('51');
    expect(
      engine
        .box(['Count', ['At', p, 2]])
        .evaluate()
        .toString()
    ).toBe('50');
    expect(
      engine
        .box(['At', ['At', p, 1], 1])
        .evaluate()
        .toString()
    ).toBe('51');
    expect(
      engine
        .box(['At', ['At', p, 2], 1])
        .evaluate()
        .toString()
    ).toBe('1');
  });

  test('Partition(predicate) on an infinite source is fully inert', () => {
    const pred: Expression = ['Function', ['Greater', 'x', 0], 'x'];
    const p: Expression = ['Partition', ['Range', 1, 'PositiveInfinity'], pred];
    expect(engine.box(p).evaluate().operator).toBe('Partition');
    // Facets stay inert: Count cannot resolve, so it stays symbolic.
    expect(engine.box(['Count', p]).evaluate().operator).toBe('Count');
  });

  // A lazy windowing view materializes to a List, not a Set (the static
  // `list<list>` type keeps it indexed — no generic-collection Set trap).
  test('Partition lazy view materializes to a List, not a Set', () => {
    const result = engine
      .box(['Partition', ['Range', 1, 300], 3])
      .evaluate({ materialization: true });
    expect(result.operator).toBe('List');
    expect((result.json as unknown[])[0]).toBe('List');
  });

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
    const d = engine.box(['Take', ['Dedup', ['Iterate', doubleAcc, 1]], 4]);
    expect(str(d)).toEqual('[2,4,8,16]');
  });

  test('Dedup streams a lazy Map source with adjacent repeats', () => {
    // floor(k/2) for k=1..10 → 0,1,1,2,2,3,3,4,4,5; deduped → 0,1,2,3,4,5.
    const src: Expression = [
      'Map',
      ['Function', ['Floor', ['Divide', 'x', 2]], 'x'],
      ['Range', 1, 10],
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

  test('Dedup bounds an infinite one-value source via the iteration limit with NO deadline', () => {
    // Guard: the Dedup iterator (collections.ts) advances only on DISTINCT
    // elements, so a source that repeats one value forever (`Cycle([1,1])`)
    // yields a single deduped element and then spins consuming the source
    // without ever emitting. The iterator caps that source walk at
    // `ce.iterationLimit` and throws `iteration-limit-exceeded`, which the `at`
    // handler swallows (returns undefined), so `Second` yields `Nothing`. With
    // no deadline armed (a fresh engine, no enclosing span) the iteration-limit
    // guard is the ONLY thing that can stop it — a regression would hang
    // forever here rather than hide behind a deadline. A fresh engine is used
    // so the default `iterationLimit` (1024) applies.
    const ce = new ComputeEngine();
    const second: Expression = ['Second', ['Dedup', ['Cycle', ['List', 1, 1]]]];
    // BREAKING (2026-07-22): out-of-band access yields the position-preserving
    // marker; with an indeterminate/infinite element domain that is `Missing`.
    // Producing a marker at all is the assertion — an unguarded walk of this
    // never-emitting source returns nothing, ever. The jest per-test timeout
    // below is the hang backstop, deliberately far above the real cost.
    const r = ce.box(second).evaluate();
    expect(r.symbol === 'Missing' || r.isNaN === true).toBe(true);
  }, 15_000);

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
      engine.box(['ReplaceAt', ['List', 10, 20, 30], 'k', 99]).evaluate()
        .operator
    ).toBe('ReplaceAt'));
});

describe('HYBRID-LAZY INSERT / DELETEAT / REPLACEAT (threshold views)', () => {
  const big: Expression = ['Range', 1, 1_000_000];
  const inf: Expression = ['Range', 1, 'PositiveInfinity'];
  const val = (expr: Expression): string =>
    engine.box(expr).evaluate().toString();

  // (1) A large finite source stays symbolic and is served lazily by index
  //     arithmetic. Non-materialization is pinned structurally: each
  //     `evaluate()` below must leave the operator in place (`Insert`,
  //     `DeleteAt`, `ReplaceAt`) rather than produce a million-element List,
  //     and the indexed lookups must answer from arithmetic on the source.
  //     Those are deterministic facts about the result; the elapsed-time bound
  //     this replaced measured the machine instead.
  test('large finite Insert/DeleteAt/ReplaceAt stay lazy views', () => {
    expect(engine.box(['Insert', big, 2, 99]).evaluate().operator).toBe(
      'Insert'
    );
    expect(val(['Count', ['Insert', big, 2, 99]])).toBe('1000001');
    expect(val(['At', ['Insert', big, 2, 99], 2])).toBe('99');
    expect(val(['At', ['Insert', big, 2, 99], 3])).toBe('2');
    expect(val(['Last', ['Insert', big, 2, 99]])).toBe('1000000');

    expect(engine.box(['DeleteAt', big, 2]).evaluate().operator).toBe(
      'DeleteAt'
    );
    expect(val(['Count', ['DeleteAt', big, 2]])).toBe('999999');
    expect(val(['At', ['DeleteAt', big, 2], 2])).toBe('3');

    expect(engine.box(['ReplaceAt', big, 3, 99]).evaluate().operator).toBe(
      'ReplaceAt'
    );
    expect(val(['At', ['ReplaceAt', big, 3, 99], 3])).toBe('99');
    expect(val(['At', ['ReplaceAt', big, 3, 99], 4])).toBe('4');
  });

  // (2) An infinite source is served by pure index arithmetic, plus one
  //     streamed composition.
  test('infinite Insert/DeleteAt/ReplaceAt serve elements by index', () => {
    expect(val(['At', ['Insert', inf, 2, 99], 2])).toBe('99');
    expect(val(['At', ['Insert', inf, 2, 99], 3])).toBe('2');
    expect(val(['At', ['DeleteAt', inf, 2], 2])).toBe('3');
    expect(val(['At', ['ReplaceAt', inf, 3, 99], 3])).toBe('99');
    expect(val(['At', ['ReplaceAt', inf, 3, 99], 4])).toBe('4');
    // `ListFrom` does not force a lazy `Take`, so pin the streamed `Take` view
    // directly: DeleteAt(inf, 1) drops the first element, so 1,2,3,4,… → 2,3,4.
    expect(val(['Take', ['DeleteAt', inf, 1], 3])).toBe('[2,3,4]');
  });

  // (3) A small finite source stays eager — zero contract change below the
  //     threshold.
  test('small finite input materializes eagerly', () => {
    expect(
      engine.box(['Insert', ['List', 1, 2, 3], 2, 99]).evaluate().operator
    ).toBe('List');
    expect(
      engine.box(['DeleteAt', ['List', 1, 2, 3], 2]).evaluate().operator
    ).toBe('List');
    expect(
      engine.box(['ReplaceAt', ['List', 1, 2, 3], 2, 99]).evaluate().operator
    ).toBe('List');
  });

  // (4) An invalid-index form stays fully inert (operator preserved AND facets
  //     symbolic), matching the eager path.
  test('invalid-index large/infinite forms stay inert', () => {
    expect(engine.box(['Insert', big, 0, 99]).evaluate().operator).toBe(
      'Insert'
    );
    expect(
      engine.box(['Count', ['Insert', big, 0, 99]]).evaluate().operator
    ).toBe('Count');
    // A negative index needs a finite end to count from; an infinite source
    // has none, so the form is inert.
    expect(engine.box(['DeleteAt', inf, -1]).evaluate().operator).toBe(
      'DeleteAt'
    );
    expect(
      engine.box(['Count', ['DeleteAt', inf, -1]]).evaluate().operator
    ).toBe('Count');
  });

  // (5) When a lazy view is materialized, its head is a `List`, not a `Set`
  //     (no generic-collection trap). Range(1, 200) is finite but over the
  //     eager threshold, so it takes the lazy path.
  test('a materialized lazy view is a List, not a Set', () => {
    const result = engine
      .box(['Insert', ['Range', 1, 200], 2, 99])
      .evaluate({ materialization: true });
    expect(result.operator).toBe('List');
    expect((result.json as unknown[])[0]).toBe('List');
  });
});

describe('ZIP-SHAPED LAZINESS (review findings)', () => {
  const add2: Expression = ['Function', ['Add', 'x', 'y'], 'x', 'y'];

  test('variadic Map bounded by the finite source when zipped with an infinite one', () => {
    const m = engine.box(['Map', add2, ['Repeat', 7], ['List', 1, 2]]);
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
    expect(engine.box(['ArgMax', ['Set', 1, 2]]).evaluate().operator).toBe(
      'ArgMax'
    ));
});

describe('COLLECTION NITS (Take preview, Sort boolean comparator, GroupBy typo)', () => {
  test('lazy Take of an unknown-length source previews its own tail, not the source tail', () => {
    // Take(TakeWhile(...) [99 elements], 50): the [5,5] preview must sample
    // the *taken* prefix (…,49,50), not the source (…,98,99). A previous
    // evaluate handler consumed the operand's own display preview.
    const t = engine
      .box([
        'Take',
        [
          'TakeWhile',
          ['Range', 1, 1000],
          ['Function', ['Less', 'x', 100], 'x'],
        ],
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
          .box([
            'GroupBy',
            ['List', 1, 2, 3, 4],
            ['Function', ['IsEven', 'x'], 'x'],
          ])
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
    const e = ce.box(['Map', undeterminedFn, 'd']);
    expect([...e.each()].map((x) => x.toString())).toEqual([
      'Which(1 == m, 1000000000, "True", 1)',
      'Which(2 == m, 1000000000, "True", 2)',
      'Which(3 == m, 1000000000, "True", 3)',
    ]);
  });

  test('Map evaluate() holds the body but substitutes the element value', () => {
    expect(ce.box(['Map', undeterminedFn, 'd']).evaluate().toString()).toBe(
      '[Which(1 == m, 1000000000, "True", 1),Which(2 == m, 1000000000, "True", 2),Which(3 == m, 1000000000, "True", 3)]'
    );
  });

  test('Tabulate shares the same lambda choke point', () => {
    expect(
      [...ce.box(['Tabulate', undeterminedFn, 3]).each()].map((x) =>
        x.toString()
      )
    ).toEqual([
      'Which(1 == m, 1000000000, "True", 1)',
      'Which(2 == m, 1000000000, "True", 2)',
      'Which(3 == m, 1000000000, "True", 3)',
    ]);
  });

  test('direct Apply substitutes the argument into an undetermined body', () => {
    expect(ce.box(['Apply', undeterminedFn, 2]).evaluate().toString()).toBe(
      'Which(2 == m, 1000000000, "True", 2)'
    );
  });

  test('Filter shares the choke point: predicate sees the element value', () => {
    // The predicate below cannot decide (m is undetermined), so once the
    // element value is substituted the applied predicate is `1 == m`, not the
    // old, corrupted `k == m`. Filter surfaces the undetermined predicate as
    // an error rather than silently dropping the element.
    const undeterminedPred: Expression = ['Function', ['Equal', 'k', 'm'], 'k'];
    expect(() => [...ce.box(['Filter', 'd', undeterminedPred]).each()]).toThrow(
      /True.+False/
    );
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
        .box(['Map', ['Function', ['Power', 'k', 2], 'k'], 'd'])
        .evaluate()
        .toString()
    ).toBe('[1,4,9]');
  });

  test('Map over an infinite base stays lazy (Take 3 does not materialize)', () => {
    expect(
      ce
        .box([
          'Take',
          [
            'Map',
            ['Function', ['Power', 'k', 2], 'k'],
            ['Range', 1, 'PositiveInfinity'],
          ],
          3,
        ])
        .evaluate()
        .toString()
    ).toBe('[1,4,9]');
  });
});

// Tycho item 19.3. Originally the short-term leniency for arithmetic over an
// `unknown`-returning call narrowing to scalar `number`. The durable
// `broadcastable<T>` fix has since LANDED: `2h(x,y)-1` now types
// `broadcastable<number>`, so these bases are admitted by the At gate's
// direct broadcastable-kind arm (collections.ts); the interim
// `restsOnUnknown` predicate was RETIRED (2026-07-17 — no constructible base
// still types scalar `number` while resting on an `unknown` leaf). The pins
// below stay: they lock the end-to-end contract (inert at canonicalization,
// resolve-or-error at evaluation), whichever gate admits the base. A
// genuinely provable scalar base (`\pi`, `(5)`, `sin(3)`) must still error
// loudly.
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
      ce
        .parse('a[1]')
        .subs({ a: ce.parse('h(3,4)') })
        .evaluate()
        .toString()
    ).toBe('3');
    expect(
      ce
        .parse('a[3]')
        .subs({ a: ce.parse('h(3,4)') })
        .evaluate()
        .toString()
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
    // `h` now returns a scalar. Since placeholder-signature refinement
    // (2026-08-15), the assignment refines the declared `unknown` result to
    // `number`, so the scalar-ness of the base is STATICALLY visible and `At`
    // rejects at canonicalization — a top-level `incompatible-type` error
    // rather than the pre-refinement shape (an inert `At` whose base erred at
    // evaluation, the nested form `errorCode` reads).
    ce.assign('h', ce.parse('(u, v) \\mapsto u+v'));
    expect(ce.box('h').type.toString()).toBe('(unknown, unknown) -> number');
    const r = ce
      .parse('a[1]')
      .subs({ a: ce.parse('2h(3,4)-1') })
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.operator).toBe('Error');
    expect(JSON.stringify(r.json)).toContain('incompatible-type');
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

  // A broadcast-aware union base (`integer | vector<3>`, from arithmetic
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
    ce.declare('z', 'integer | rational');
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

// Canonical-time peek through count/membership-preserving wrappers. A consumer
// like Count evaluates its operand first, so an eager Sort/RandomShuffle would
// materialize the whole collection before the count is read. The rewrite
// strips these wrappers at canonicalization since they don't change the answer.
describe('PEEK THROUGH COUNT/MEMBERSHIP-PRESERVING WRAPPERS', () => {
  const ce = new ComputeEngine();

  test('Count strips an eager Sort at canonicalization', () => {
    const expr = ce.box(['Count', ['Sort', ['Range', 1, 100000]]]);
    expect(expr.json).toEqual(['Count', ['Range', 1, 100000]]);
    // Reading the count no longer materializes/sorts 1e5 elements.
    expect(expr.evaluate().toString()).toBe('100000');
  });

  test('Length strips RandomShuffle', () => {
    const expr = ce.box(['Length', ['RandomShuffle', ['Range', 1, 50]]]);
    expect(expr.json).toEqual(['Length', ['Range', 1, 50]]);
    expect(expr.evaluate().toString()).toBe('50');
  });

  test('IsEmpty strips Sort', () => {
    const expr = ce.box(['IsEmpty', ['Sort', ['List']]]);
    expect(expr.json).toEqual(['IsEmpty', ['List']]);
    expect(expr.evaluate().symbol).toBe('True');
  });

  test('nested wrappers are fully stripped (Count(Reverse(Sort(x))))', () => {
    const expr = ce.box(['Count', ['Reverse', ['Sort', ['Range', 1, 10]]]]);
    expect(expr.json).toEqual(['Count', ['Range', 1, 10]]);
    expect(expr.evaluate().toString()).toBe('10');
  });

  test('Sort comparator is dropped by the strip', () => {
    const expr = ce.box(['Count', ['Sort', ['List', 3, 1, 2], 'cmp']]);
    expect(expr.json).toEqual(['Count', ['List', 3, 1, 2]]);
    expect(expr.evaluate().toString()).toBe('3');
  });

  test('Unique is NOT stripped for Count (not count-preserving)', () => {
    const expr = ce.box(['Count', ['Unique', ['List', 1, 1, 2]]]);
    expect(expr.json).toEqual(['Count', ['Unique', ['List', 1, 1, 2]]]);
    expect(expr.evaluate().toString()).toBe('2');
  });

  test('Contains strips Sort (membership-preserving)', () => {
    const expr = ce.box(['Contains', ['Sort', ['List', 3, 1, 2]], 2]);
    expect(expr.json).toEqual(['Contains', ['List', 3, 1, 2], 2]);
    expect(expr.evaluate().symbol).toBe('True');
  });

  test('Contains strips Unique (membership-preserving)', () => {
    const expr = ce.box(['Contains', ['Unique', ['List', 1, 1, 2]], 2]);
    expect(expr.json).toEqual(['Contains', ['List', 1, 1, 2], 2]);
    expect(expr.evaluate().symbol).toBe('True');
  });

  test('symbolic operand: Count(Sort(xs)) canonicalizes to Count(xs)', () => {
    const local = new ComputeEngine();
    const expr = local.box(['Count', ['Sort', 'xs']]);
    expect(expr.json).toEqual(['Count', 'xs']);
    expect(expr.isValid).toBe(true);
  });

  // Semantics footnote: because the strip happens at canonicalization, a Sort
  // comparator that WOULD throw is never invoked when the consumer only needs
  // the count/membership. This is intended — the answer is independent of the
  // ordering the comparator would impose.
  test('a would-throw Sort comparator is never invoked for Count', () => {
    const badFn: Expression = ['Function', ['Divide', 1, 0], 'a', 'b'];
    const expr = ce.box(['Count', ['Sort', ['List', 3, 1, 2], badFn]]);
    expect(expr.json).toEqual(['Count', ['List', 3, 1, 2]]);
    expect(expr.evaluate().toString()).toBe('3');
  });

  // Operand validation is preserved: a non-collection operand still errors.
  test('non-collection operand still errors (validation preserved)', () => {
    const expr = ce.box(['Count', 5]);
    expect(expr.isValid).toBe(false);
  });

  // The peek handlers must run the framework's default flatten step
  // (Sequence-splice + Nothing-drop) they would otherwise short-circuit, so a
  // peeked operator behaves identically to a non-peeked one (e.g. `First`).
  // Compare argument handling (json without the head) against `First`, since
  // the operator names naturally differ.
  const args = (e: ReturnType<typeof ce.box>) =>
    (e.json as Expression[]).slice(1);

  test('Length(Nothing) flattens like a non-peeked operator (First)', () => {
    const length = ce.box(['Length', 'Nothing']);
    const first = ce.box(['First', 'Nothing']);
    // Nothing is dropped by flatten -> a missing-argument error, matching First.
    expect(args(length)).toEqual(args(first));
    expect(length.isValid).toBe(false);
  });

  test('Count(Sequence(...)) splices like a non-peeked operator (Contains)', () => {
    // `Count` is 2-ary since the value/predicate forms landed, so the second
    // spliced operand is now a legitimate argument — compare against the
    // 2-ary peeked operator `Contains`, not the 1-ary `First`. What is being
    // tested is unchanged: the custom canonical handler still runs the
    // default flatten step, so the `Sequence` is spliced away.
    const count = ce.box(['Count', ['Sequence', ['List', 1, 2], 'b']]);
    const contains = ce.box(['Contains', ['Sequence', ['List', 1, 2], 'b']]);
    expect(args(count)).toEqual(args(contains));
    expect(count.operator).toBe('Count');
    expect(count.nops).toBe(2);

    // One operand past the arity is still an `unexpected-argument` error.
    const over = ce.box(['Count', ['Sequence', ['List', 1, 2], 'b', 'c']]);
    expect(args(over)).toEqual(
      args(ce.box(['Contains', ['Sequence', ['List', 1, 2], 'b', 'c']]))
    );
    expect(over.isValid).toBe(false);
  });

  // An INVALID wrapper argument (e.g. a non-function `Sort` comparator) must
  // not be silently erased by the strip: stop peeking and let the error
  // surface. Contrast with the valid-comparator strip above, which is intended.
  test('Count(Sort(xs, 5)) surfaces the invalid comparator (not silently 2)', () => {
    const expr = ce.box(['Count', ['Sort', ['List', 1, 2], 5]]);
    expect(expr.isValid).toBe(false);
    // The invalid Sort wrapper is NOT stripped — its error subexpression is
    // preserved so validation surfaces it (rather than a silent `Count` of 2).
    expect(expr.operator).toBe('Count');
    expect(expr.op1.operator).toBe('Sort');
  });

  test('Contains(Sort(xs, 5), v) surfaces the invalid comparator', () => {
    const expr = ce.box(['Contains', ['Sort', ['List', 1, 2], 5], 1]);
    expect(expr.isValid).toBe(false);
  });

  test('a valid comparator is still stripped (regression guard)', () => {
    const expr = ce.box(['Count', ['Sort', ['List', 3, 1, 2], 'Less']]);
    expect(expr.json).toEqual(['Count', ['List', 3, 1, 2]]);
    expect(expr.isValid).toBe(true);
  });
});

describe('A collection parameter that is not yet evaluated (Tycho item 107)', () => {
  // Collection handlers are consulted on the CANONICAL expression, not on an
  // evaluated one — `.at()`/`.each()`/`.count` are public on any canonical
  // expression, and the pre-evaluation broadcast in `_computeValue` zips raw
  // operands. A parameter spelled `N-1` is still an `Add` node there, and
  // every handler used to turn the failed integer read into its own DEFAULT:
  // `RotateLeft(S, N-1) + RotateLeft(S, N-2)` answered `2·RotateLeft(S, 1)`.
  // Literal offsets were unaffected, which is what hid the class.

  function fresh() {
    const ce = new ComputeEngine();
    ce.assign('S107', ce.box(['List', 1, 2, 3, 4, 5, 6]));
    ce.assign('N107', 6);
    return ce;
  }

  test('the handlers resolve a symbolic offset on the RAW expression', () => {
    const ce = fresh();
    const e = ce.box(['RotateLeft', 'S107', ['Subtract', 'N107', 1]]);
    expect(e.at(1)?.toString()).toBe('6');
    expect([...e.each()].map((x) => x.toString()).join(',')).toBe(
      '6,1,2,3,4,5'
    );
  });

  test('Add over two RotateLeft views with symbolic offsets sums the rotations', () => {
    const ce = fresh();
    const sum = ce.box([
      'Add',
      ['RotateLeft', 'S107', ['Subtract', 'N107', 1]],
      ['RotateLeft', 'S107', ['Subtract', 'N107', 2]],
    ]);
    // The canonical tree is NOT collapsed — the two views are distinct.
    expect(sum.json).toEqual([
      'Add',
      ['RotateLeft', 'S107', ['Add', 'N107', -1]],
      ['RotateLeft', 'S107', ['Add', 'N107', -2]],
    ]);
    // RotateLeft(S, 5) = [6,1,2,3,4,5], RotateLeft(S, 4) = [5,6,1,2,3,4]
    expect(sum.evaluate().toString()).toBe('[11,7,3,5,7,9]');
  });

  test('a symbolic offset matches the equivalent literal offset', () => {
    const ce = fresh();
    const symbolic = ce
      .box([
        'Add',
        ['RotateRight', 'S107', ['Subtract', 'N107', 1]],
        ['RotateRight', 'S107', ['Subtract', 'N107', 2]],
      ])
      .evaluate()
      .toString();
    const literal = ce
      .box(['Add', ['RotateRight', 'S107', 5], ['RotateRight', 'S107', 4]])
      .evaluate()
      .toString();
    expect(symbolic).toBe(literal);
  });

  test('Take and Drop resolve symbolic counts under a broadcast', () => {
    const ce = fresh();
    expect(
      ce
        .box([
          'Add',
          ['Take', 'S107', ['Subtract', 'N107', 2]],
          ['Take', 'S107', ['Subtract', 'N107', 2]],
        ])
        .evaluate()
        .toString()
    ).toBe('[2,4,6,8]');
    expect(
      ce
        .box([
          'Add',
          ['Drop', 'S107', ['Subtract', 'N107', 4]],
          ['Drop', 'S107', ['Subtract', 'N107', 4]],
        ])
        .evaluate()
        .toString()
    ).toBe('[6,8,10,12]');
  });
});

describe('A collection parameter that does not resolve stays indeterminate', () => {
  // A parameter that is present but has no integer value (a free symbol) is
  // NOT the same as an absent one. Conflating them made five operators answer
  // a collection they do not denote — `Take(S, n)` → `[]`, `Drop(S, n)` → all
  // of `S`, `RotateLeft(S, n)` → rotated by one. The rest of the family
  // (`Repeat`, `Insert`, `DeleteAt`, `ReplaceAt`, `Permutations`,
  // `Combinations`, `Tabulate`, `Chunk`, `Range`) already bailed to the
  // indeterminate channel; these five were the outliers.

  function fresh() {
    const ce = new ComputeEngine();
    ce.assign('Sx', ce.box(['List', 1, 2, 3, 4, 5, 6]));
    ce.declare('nx', 'integer');
    return ce;
  }

  const CALLS: [string, Expression][] = [
    ['Take', ['Take', 'Sx', 'nx']],
    ['Drop', ['Drop', 'Sx', 'nx']],
    ['RotateLeft', ['RotateLeft', 'Sx', 'nx']],
    ['RotateRight', ['RotateRight', 'Sx', 'nx']],
    ['Slice', ['Slice', 'Sx', 'nx', 4]],
  ];

  test.each(CALLS)('%s stays symbolic and reports no count', (_name, call) => {
    const e = fresh().box(call);
    expect(e.count).toBeUndefined();
    expect(e.evaluate().operator).toBe(e.operator);
  });

  test.each(CALLS)('%s does not collapse through a consumer', (_name, call) => {
    const ce = fresh();
    // `ListFrom` must not read the indeterminate iterator as an empty
    // collection, and `Count` must not answer a length no element backs.
    expect(ce.box(['ListFrom', call]).evaluate().operator).toBe('ListFrom');
    expect(ce.box(['Count', call]).evaluate().operator).toBe('Count');
  });

  test.each(CALLS)(
    '%s survives a broadcast instead of throwing',
    (_name, call) => {
      // Facet incoherence — an honest `count` beside an indeterminate
      // iterator — made the broadcast zip positions no element arrived for,
      // and a raw TypeError escaped `evaluate()`.
      const ce = fresh();
      expect(() =>
        ce.box(['Add', call, call] as Expression).evaluate()
      ).not.toThrow();
    }
  );

  test('an ABSENT parameter still takes the operator default', () => {
    const ce = fresh();
    expect(ce.box(['RotateLeft', 'Sx']).evaluate().toString()).toBe(
      '[2,3,4,5,6,1]'
    );
    expect(ce.box(['RotateRight', 'Sx']).evaluate().toString()).toBe(
      '[6,1,2,3,4,5]'
    );
  });

  test('a parameter with an assigned value still resolves', () => {
    const ce = fresh();
    ce.assign('mx', 3);
    expect(ce.box(['Take', 'Sx', 'mx']).evaluate().toString()).toBe('[1,2,3]');
    expect(ce.box(['Drop', 'Sx', 'mx']).evaluate().toString()).toBe('[4,5,6]');
    expect(ce.box(['RotateLeft', 'Sx', 'mx']).evaluate().toString()).toBe(
      '[4,5,6,1,2,3]'
    );
    expect(ce.box(['Slice', 'Sx', 'mx', 5]).evaluate().toString()).toBe(
      '[3,4,5]'
    );
  });

  test('infinite and lazy sources are unaffected', () => {
    const ce = fresh();
    const inf: Expression = ['Range', 1, { num: '+Infinity' }];
    expect(ce.box(['Take', inf, 3]).evaluate().toString()).toBe('[1,2,3]');
    expect(
      ce
        .box(['Take', ['Drop', inf, 2], 3])
        .evaluate()
        .toString()
    ).toBe('[3,4,5]');
    expect(
      ce
        .box(['Take', ['Cycle', ['List', 1, 2]], 5])
        .evaluate()
        .toString()
    ).toBe('[1,2,1,2,1]');
    expect(
      ce
        .box(['Take', ['Slice', inf, 5, -1], 3])
        .evaluate()
        .toString()
    ).toBe('[5,6,7]');
  });
});

describe('Partition and Fill with an unresolved argument', () => {
  function fresh() {
    const ce = new ComputeEngine();
    ce.assign('Sy', ce.box(['List', 1, 2, 3, 4, 5, 6]));
    ce.declare('ny', 'integer');
    ce.declare('gy', 'function');
    return ce;
  }

  test('Partition with a symbolic chunk size stays symbolic (was: threw)', () => {
    // The operand is typed `integer`, but the size arm keyed on "did
    // `toInteger` succeed", so it fell through to the PREDICATE arm and threw
    // a raw Error out of `evaluate()`.
    const ce = fresh();
    const e = ce.box(['Partition', 'Sy', 'ny']);
    expect(() => e.evaluate()).not.toThrow();
    expect(e.evaluate().operator).toBe('Partition');
  });

  test('Partition with an unresolved predicate stays symbolic (was: threw)', () => {
    const ce = fresh();
    for (const pred of ['gy', 'undeclaredPredicateY']) {
      const e = ce.box(['Partition', 'Sy', pred]);
      expect(() => e.evaluate()).not.toThrow();
      expect(e.evaluate().operator).toBe('Partition');
    }
  });

  test('Partition rejects a provably non-boolean predicate at canonicalization', () => {
    // Design E §9 Q3 (E3 sweep): the rejection moved from the runtime throw
    // to a canonicalization-time `incompatible-type` on the predicate arm.
    const ce = fresh();
    const e = ce.box(['Partition', 'Sy', ['Function', ['Add', 'x', 1], 'x']]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('incompatible-type');
  });

  test('Partition forms with resolved arguments are unchanged', () => {
    const ce = fresh();
    ce.assign('isEvenY', ce.parse('x \\mapsto \\mathrm{Mod}(x,2)=0'));
    expect(ce.box(['Partition', 'Sy', 2]).evaluate().toString()).toBe(
      '[[1,2],[3,4],[5,6]]'
    );
    expect(ce.box(['Partition', 'Sy', 2, 3]).evaluate().toString()).toBe(
      '[[1,2],[4,5]]'
    );
    expect(ce.box(['Partition', 'Sy', 'isEvenY']).evaluate().toString()).toBe(
      '[[2,4,6],[1,3,5]]'
    );
  });

  test('Fill with a symbolic dimension stays symbolic (was: an empty matrix)', () => {
    const ce = fresh();
    const f = ce.parse('(i,j) \\mapsto i \\cdot j').json as Expression;
    // `Fill(f, (n, 3))` answered `[]` and `Fill(f, (2, n))` answered two
    // EMPTY rows — an unresolvable dimension read as 0.
    for (const shape of [
      ['Tuple', 'ny', 3],
      ['Tuple', 2, 'ny'],
    ] as Expression[]) {
      const e = ce.box(['Fill', f, shape]);
      expect(e.count).toBeUndefined();
      expect(e.evaluate().operator).toBe('Fill');
      expect(ce.box(['ListFrom', ['Fill', f, shape]]).evaluate().operator).toBe(
        'ListFrom'
      );
    }
  });

  test('Fill with resolved dimensions is unchanged', () => {
    const ce = fresh();
    const f = ce.parse('(i,j) \\mapsto i \\cdot j').json as Expression;
    expect(
      ce
        .box(['Fill', f, ['Tuple', 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[[1,2,3],[2,4,6]]');
  });
});

describe('Indeterminate collection facets stay coherent (review round)', () => {
  function fresh() {
    const ce = new ComputeEngine();
    ce.assign('Sz', ce.box(['List', 1, 2, 3]));
    ce.declare('nz', 'integer');
    return ce;
  }

  test('membership is offset-invariant: a symbolic rotation does not answer False', () => {
    // `false` from a `contains` handler means DEFINITIVELY not a member (the
    // indeterminate answer is `undefined`). Gating it on the offset made
    // `Contains(RotateLeft(xs, n), x)` answer False for an element that is in
    // every rotation — a wrong answer, worse than the default-substitution bug
    // the gating was added for.
    const ce = fresh();
    for (const op of ['RotateLeft', 'RotateRight']) {
      expect(
        ce.box(['Contains', [op, 'Sz', 'nz'], 1] as Expression).evaluate()
          .symbol
      ).toBe('True');
      expect(
        ce.box(['Contains', [op, 'Sz', 'nz'], 99] as Expression).evaluate()
          .symbol
      ).toBe('False');
    }
  });

  test('a zip never splices an undefined cell when a count outruns its iterator', () => {
    // A lazy view can know its length while its `at`/`iterator` decline. The
    // zip trusted `count` and built a `List` whose cells were `undefined`;
    // every later reader crashed with a raw TypeError far from the cause.
    const ce = fresh();
    const sum = ce.box([
      'Add',
      ['RotateLeft', 'Sz', 'nz'],
      ['RotateLeft', 'Sz', 'nz'],
    ]);
    const v = sum.evaluate();
    expect(() => v.toString()).not.toThrow();
    for (const cell of v.ops ?? []) expect(cell).toBeDefined();
  });

  test('Take over an INFINITE source with a symbolic bound is not known non-empty', () => {
    // `n = 0` makes it empty, so `False` was a definitive wrong answer. The
    // bound is now read before the infinite-source branch.
    const ce = fresh();
    const inf: Expression = ['Range', 1, { num: '+Infinity' }];
    expect(ce.box(['IsEmpty', ['Take', inf, 'nz']]).evaluate().operator).toBe(
      'IsEmpty'
    );
    expect(ce.box(['IsEmpty', ['Take', inf, 3]]).evaluate().symbol).toBe(
      'False'
    );
    expect(ce.box(['IsEmpty', ['Take', inf, 0]]).evaluate().symbol).toBe(
      'True'
    );
  });

  test('a NaN parameter is unresolved, not absent', () => {
    // `NaN` passes a `number`-typed slot, and reading it as "omitted" put
    // `Take` back on its default — answering `[]`.
    const ce = fresh();
    expect(ce.box(['Take', 'Sz', { num: 'NaN' }]).evaluate().operator).toBe(
      'Take'
    );
    // An OMITTED optional parameter still takes the default.
    expect(ce.box(['RotateLeft', 'Sz']).evaluate().toString()).toBe('[2,3,1]');
  });

  test('Partition stays symbolic for an UNDECIDED boolean predicate', () => {
    // `x => x > n` with `n` free resolves and is typed `boolean`, but is
    // neither True nor False — undecided, not wrong. Only a predicate that
    // resolves to a non-boolean earns the throw.
    const ce = fresh();
    expect(
      ce
        .box(['Partition', 'Sz', ['Function', ['Greater', 'x', 'nz'], 'x']])
        .evaluate().operator
    ).toBe('Partition');
    expect(
      ce
        .box(['Partition', 'Sz', ['Function', ['Greater', 'x', 2], 'x']])
        .evaluate()
        .toString()
    ).toBe('[[3],[1,2]]');
    // A provably non-boolean predicate rejects at canonicalization
    // (Design E §9 Q3, E3 sweep) — see the sibling pin above.
    expect(
      ce.box(['Partition', 'Sz', ['Function', ['Add', 'x', 1], 'x']]).isValid
    ).toBe(false);
  });
});

describe('BARE SHORTHAND PREDICATE ON THE EAGER FUNCTION-SLOT OPERATORS', () => {
  // `["Greater", "_", 5]` without a `Function` wrapper is a shorthand function
  // literal. It already worked on the lazy operators (`Filter`, `Map`, `Any`,
  // `All`, `MaxBy`, …), whose canonical handlers route the operand through
  // `canonicalFunctionLiteral`; the eager ones had no canonical handler and
  // reported `incompatible-type function/boolean` instead.
  const xs: Expression = ['List', 5, 2, 10, 18];

  // [operator, bare operand, wrapped operand, expected]
  const cases: [string, Expression, Expression, string][] = [
    ['CountIf', ['Greater', '_', 5], ['Function', ['Greater', '_', 5]], '2'],
    ['IndexWhere', ['Greater', '_', 9], ['Function', ['Greater', '_', 9]], '3'],
    ['Find', ['Greater', '_', 9], ['Function', ['Greater', '_', 9]], '10'],
    [
      'Position',
      ['Greater', '_', 5],
      ['Function', ['Greater', '_', 5]],
      '[3,4]',
    ],
    ['Sort', ['Negate', '_'], ['Function', ['Negate', '_']], '[18,10,5,2]'],
    ['Ordering', ['Negate', '_'], ['Function', ['Negate', '_']], '[4,3,1,2]'],
    [
      'ChunkBy',
      ['IsEven', '_'],
      ['Function', ['IsEven', '_']],
      '[[5],[2,10,18]]',
    ],
    [
      'Partition',
      ['Greater', '_', 5],
      ['Function', ['Greater', '_', 5]],
      '[[10,18],[5,2]]',
    ],
  ];

  for (const [op, bare, wrapped, expected] of cases) {
    test(`${op} accepts the bare shorthand (box route)`, () => {
      expect(engine.box([op, xs, bare]).evaluate().toString()).toBe(expected);
    });
    test(`${op} bare shorthand agrees with the explicit Function`, () => {
      expect(engine.box([op, xs, wrapped]).evaluate().toString()).toBe(
        expected
      );
    });
  }

  test('GroupBy accepts the bare shorthand', () => {
    expect(
      engine
        .box(['GroupBy', ['List', 1, 2, 3, 4], ['IsEven', '_']])
        .evaluate()
        .toString()
    ).toBe(
      engine
        .box([
          'GroupBy',
          ['List', 1, 2, 3, 4],
          ['Function', ['IsEven', 'q'], 'q'],
        ])
        .evaluate()
        .toString()
    );
  });

  test('Fill accepts the bare shorthand in its function slot', () => {
    expect(
      engine
        .box(['Fill', ['Add', '_1', '_2'], ['Tuple', 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[[2,3,4],[3,4,5]]');
  });

  // Parse (Epsil/LaTeX) route: the shorthand and an explicit `\mapsto` lambda
  // reach the same canonical form and the same value.
  test('parse route: bare shorthand and a lambda agree', () => {
    expect(
      engine
        .parse('\\mathrm{CountIf}(\\lbrack 5,2,10,18\\rbrack, \\_ > 5)')
        .evaluate()
        .toString()
    ).toBe('2');
    expect(
      engine
        .parse(
          '\\mathrm{CountIf}(\\lbrack 5,2,10,18\\rbrack, u \\mapsto u > 5)'
        )
        .evaluate()
        .toString()
    ).toBe('2');
    expect(
      engine
        .parse('\\mathrm{Position}(\\lbrack 5,2,10,18\\rbrack, \\_ > 5)')
        .evaluate()
        .toString()
    ).toBe('[3,4]');
    expect(
      engine
        .parse('\\mathrm{Find}(\\lbrack 5,2,10,18\\rbrack, \\_ > 9)')
        .evaluate()
        .toString()
    ).toBe('10');
  });

  // A shorthand must contribute a PARAMETER (a wildcard, or a free unknown).
  // A plain value operand is still reported against the declared signature
  // rather than silently becoming a constant function.
  test('a value operand in a function slot is still a type error', () => {
    expect(engine.box(['CountIf', xs, 5]).isValid).toBe(false);
    expect(engine.box(['CountIf', xs, 5]).evaluate().toString()).toContain(
      'incompatible-type'
    );
    expect(engine.box(['Sort', xs, 5]).isValid).toBe(false);
  });

  test('arity errors survive the new canonical handlers', () => {
    expect(engine.box(['CountIf', xs]).isValid).toBe(false);
    expect(
      engine.box(['CountIf', xs, ['Greater', '_', 5], ['Greater', '_', 5]])
        .isValid
    ).toBe(false);
  });

  // `Count(xs, arg)` is overloaded on the operand's TYPE: a function is a
  // predicate, anything else is a value to match. A wildcard-bearing boolean
  // operand is a predicate; a plain boolean value is not.
  test('Count: a wildcard predicate shorthand dispatches as a PREDICATE', () => {
    expect(
      engine
        .box(['Count', ['List', 1, 2, 3, 4, 5], ['Greater', '_', 2]])
        .evaluate()
        .toString()
    ).toBe('3');
    expect(
      engine
        .box([
          'Count',
          ['List', 1, 2, 3, 4, 5],
          ['Function', ['Greater', 'q', 2], 'q'],
        ])
        .evaluate()
        .toString()
    ).toBe('3');
  });

  test('Count: a literal boolean value still dispatches as a VALUE', () => {
    expect(
      engine
        .box(['Count', ['List', 'True', 'False', 'True'], 'True'])
        .evaluate()
        .toString()
    ).toBe('2');
    expect(
      engine
        .box(['Count', ['List', 1, 2, 2, 3, 2], 2])
        .evaluate()
        .toString()
    ).toBe('3');
  });
});

describe('ITERATE APPLIES A UNARY FUNCTION TO THE ACCUMULATOR ALONE', () => {
  // `Iterate` applies `f(index, acc)`. A unary function — the documented
  // shorthand `Iterate(2 * _, 1)` — used to throw `Too many arguments …` out
  // of the collection handlers, escaping to the host on every route.
  const doubling: Expression = ['Iterate', ['Multiply', '_', 2], 1];

  test('no host throw on the .at(), each() or Take routes', () => {
    const e = engine.box(doubling);
    expect(() => e.at(4)).not.toThrow();
    expect(e.at(4)!.toString()).toBe('16');
    // NEVER `Array.from(e.each())` here — the source is infinite.
    expect(() => e.each()[Symbol.iterator]().next()).not.toThrow();
  });

  test('every route agrees on the elements', () => {
    const e = engine.box(doubling);
    const byAt = [1, 2, 3, 4, 5].map((i) => e.at(i)!.toString());
    const byEach: string[] = [];
    for (const x of e.each()) {
      byEach.push(x.toString());
      if (byEach.length >= 5) break;
    }
    expect(byAt).toEqual(['2', '4', '8', '16', '32']);
    expect(byEach).toEqual(byAt);
    expect(
      engine
        .box(['Take', doubling, 5])
        .evaluate({ materialization: 10 })
        .toString()
    ).toBe('[2,4,8,16,32]');
  });

  test('the parse route yields elements, not an arity error', () => {
    // Before the fix this evaluated to the `Too many arguments …` message
    // rather than throwing, so the value — not just the absence of a throw —
    // is what pins the behavior.
    expect(
      engine.parse('\\mathrm{Iterate}(2\\_, 1)').evaluate().toString()
    ).toBe('[2,4,8,16,32,...]');
  });

  test('a two-parameter function still receives (index, acc)', () => {
    // Factorials: element k is k * element(k-1), starting from 1.
    expect(
      engine
        .box([
          'Take',
          ['Iterate', ['Function', ['Multiply', 'n', 'acc'], 'n', 'acc'], 1],
          5,
        ])
        .evaluate({ materialization: 10 })
        .toString()
    ).toBe('[1,2,6,24,120]');
  });
});

describe('TAKE IS FINITE WHEN ITS BOUND IS (regression)', () => {
  // `Take(xs, n)` yields at most `n` elements, so a finite literal bound makes
  // it a FINITE collection whatever the source is — including a source whose
  // own length is unknown. Finiteness and exact count are separate questions:
  // the count stays `undefined` because the source may exhaust early.
  const primes: Expression = [
    'Take',
    ['Filter', ['Range', 1, 'Infinity'], ['IsPrime', '_']],
    10,
  ];

  test('a bounded Take of an unknown-length source is finite', () => {
    const e = engine.box(primes);
    expect(e.op1.count).toBeUndefined(); // the Filter's length is unknown
    expect(e.op1.isFiniteCollection).toBeUndefined();
    expect(e.isFiniteCollection).toBe(true);
    // Honest: finite, but the exact count is NOT claimed.
    expect(e.count).toBeUndefined();
  });

  test('ListFrom materializes it (the finiteness gate is satisfied)', () => {
    // The materializer, `isFiniteCollection` and `ListFrom` all gate on
    // finiteness; before the fix this stayed symbolic under plain evaluate().
    expect(engine.box(['ListFrom', primes]).evaluate().toString()).toBe(
      '[2,3,5,7,11,13,17,19,23,29]'
    );
  });

  test('a known-length source still reports its exact count', () => {
    const e = engine.box(['Take', ['Range', 1, 'Infinity'], 5]);
    expect(e.isFiniteCollection).toBe(true);
    expect(e.count).toBe(5);
  });

  test('a source that exhausts early reports its TRUE count, not the bound', () => {
    const e = engine.box(['Take', ['List', 1, 2], 5]);
    expect(e.isFiniteCollection).toBe(true);
    expect(e.count).toBe(2);
    expect(e.evaluate().toString()).toBe('[1,2]');
  });

  test('an infinite bound does NOT claim finite', () => {
    const e = engine.box(['Take', ['Range', 1, 'Infinity'], 'Infinity']);
    expect(e.isFiniteCollection).not.toBe(true);
  });

  test('a symbolic bound stays indeterminate', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    expect(
      ce.box(['Take', ['Range', 1, 'Infinity'], 'n']).isFiniteCollection
    ).toBeUndefined();
  });
});

describe('FIRST/SECOND/THIRD/LAST REQUIRE AN INDEXED COLLECTION (regression)', () => {
  // `First(Integers)` used to answer a silent `NaN` — the position-preserving
  // absence marker — as if ℤ merely had no first element. A set has no
  // POSITIONS at all, so the family now refuses set-kind operands the same way
  // `Take`/`Drop`/`At`/`Rest`/`Most` already did: `incompatible-type`.
  const COMPONENTS = ['First', 'Second', 'Third', 'Last'];
  const NON_INDEXED: [string, Expression][] = [
    ['a finite Set', ['Set', 1, 2, 3]],
    ['EmptySet', 'EmptySet'],
    ['Integers', 'Integers'],
    ['a Dictionary', ['Dictionary', ['KeyValuePair', { str: 'a' }, 1]]],
  ];

  for (const [label, xs] of NON_INDEXED) {
    for (const op of COMPONENTS) {
      test(`${op} of ${label} is an incompatible-type error`, () => {
        const e = engine.box([op, xs] as Expression);
        expect(e.toString()).toMatch(
          /incompatible-type", "indexed_collection"/
        );
        expect(e.evaluate().operator).toBe('Error');
      });
    }
    test(`Take/Drop of ${label} refuse identically (the family it matches)`, () => {
      expect(engine.box(['Take', xs, 2] as Expression).toString()).toMatch(
        /incompatible-type", "indexed_collection"/
      );
      expect(engine.box(['Drop', xs, 2] as Expression).toString()).toMatch(
        /incompatible-type", "indexed_collection"/
      );
    });
  }

  test('a set reaching the handler at RUNTIME is refused too', () => {
    // Overlap-deferred validation: the static gate admits an operand whose
    // type does not refute `indexed_collection`, so the evaluate handler is
    // the re-validation (see the add-operator checklist).
    const ce = new ComputeEngine();
    ce.assign('s', ce.box(['Set', 1, 2, 3]));
    expect(ce.box(['First', 's']).evaluate().operator).toBe('Error');
  });

  test('indexed collections are unaffected', () => {
    expect(
      engine
        .box(['First', ['List', 7, 13, 5]])
        .evaluate()
        .toString()
    ).toBe('7');
    expect(
      engine
        .box(['Last', ['List', 7, 13, 5]])
        .evaluate()
        .toString()
    ).toBe('5');
    expect(
      engine
        .box(['Second', ['Range', 1, 10]])
        .evaluate()
        .toString()
    ).toBe('2');
    // A tuple IS indexed (`First` of a point is its x-coordinate).
    expect(
      engine
        .box(['First', ['Tuple', 'x', 'y']])
        .evaluate()
        .toString()
    ).toBe('x');
  });

  test('the ABSENCE marker is unchanged for a genuinely missing position', () => {
    // An indexed collection that simply has no element there still answers the
    // position-preserving marker — NOT an error (Nothing-vs-Missing).
    expect(engine.box(['First', ['List']]).evaluate().symbol).toBe('Missing');
    expect(engine.box(['Last', ['List']]).evaluate().symbol).toBe('Missing');
    // No last element of an infinite indexed collection: NaN for a numeric one.
    expect(
      engine.box(['Last', ['Range', 1, 'Infinity']]).evaluate().isNaN
    ).toBe(true);
  });
});

describe('BARE `_` IS THE IDENTITY FUNCTION SHORTHAND (regression)', () => {
  // `_` alone in a function slot means `x => x`. Only the BARE `_` qualifies:
  // `_1`/`_2`/… are positional parameters of an enclosing shorthand and a
  // named symbol may name a function, so both stay pass-through.
  const xs: Expression = ['List', 3, 1, 2];

  test('the slot desugars to a canonical identity literal', () => {
    expect(JSON.stringify(engine.box(['Map', '_', xs]).json)).toContain(
      '["Function",["Block","_1"],"_1"]'
    );
  });

  test('Map(_, xs) yields the elements unchanged', () => {
    expect(engine.box(['Map', '_', xs]).evaluate().toString()).toBe('[3,1,2]');
  });

  test('ChunkBy(xs, _) groups by the element itself (eager operator)', () => {
    expect(
      engine
        .box(['ChunkBy', ['List', 1, 1, 2, 2, 3], '_'])
        .evaluate()
        .toString()
    ).toBe('[[1,1],[2,2],[3]]');
  });

  test('Filter(xs, _) keeps the truthy elements', () => {
    expect(
      engine
        .box(['Filter', ['List', 'True', 'False', ['Greater', 1, 0]], '_'])
        .evaluate()
        .toString()
    ).toBe('["True","True"]');
  });

  test('Sort(xs, _) sorts by the identity KEY (a unary function is a key)', () => {
    // A unary function in `Sort`'s second slot is a key extractor, not a
    // comparator (the `sortedIndices` convention), so the identity key is a
    // plain sort — a clean meaning, not garbage.
    expect(engine.box(['Sort', xs, '_']).evaluate().toString()).toBe('[1,2,3]');
    expect(engine.box(['Ordering', xs, '_']).evaluate().toString()).toBe(
      '[2,3,1]'
    );
  });

  test('a NUMBERED or named wildcard is NOT the identity shorthand', () => {
    // `_1` stays a symbol naming a (here undefined) function.
    expect(engine.box(['Map', '_1', xs]).evaluate().toString()).toBe(
      '[_1(3),_1(1),_1(2)]'
    );
    expect(engine.box(['Map', '_a', xs]).evaluate().toString()).toBe(
      '[_a(3),_a(1),_a(2)]'
    );
  });
});

// Collection-literal spread (2026-08-14, revised same day): a `Spread`
// operand of a `List`/`Set`/`Dictionary` literal is spliced at
// canonicalization — the canonical form never contains a `Spread`. The
// semantics are `Join`'s: any non-tuple collection splices; a TUPLE does not
// spread (tuples are units; `ListFrom` is the explicit converter) — provably
// a tuple is a loud `spread-tuple` error, a runtime tuple contributes itself
// as one element, and a scalar is `Join`'s `incompatible-type` error. The
// box.ts `List`/`Dictionary` fast paths defer to the canonical handlers
// whenever a `Spread` operand is present.
describe('COLLECTION-LITERAL SPREAD (box route)', () => {
  const ce = engine;

  test('a literal list splices eagerly at canonicalization', () => {
    const e = ce.box(['List', ['Spread', ['List', 1, 2]], 3]);
    expect(e.toString()).toBe('[1,2,3]');
    expect(e.json).toEqual(['List', 1, 2, 3]);
  });

  test('a literal tuple does NOT spread: loud spread-tuple error', () => {
    const e = ce.box(['List', ['Spread', ['Tuple', 1, 2]], 3]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('spread-tuple');
  });

  test('a symbolic spread lowers to a direct Join', () => {
    const ce2 = new ComputeEngine();
    const e = ce2.box(['List', ['Spread', 'xs'], 3, ['Spread', 'ys']]);
    expect(e.operator).toBe('Join');
    expect(e.json).toEqual(['Join', 'xs', ['List', 3], 'ys']);
    ce2.box(['Assign', 'xs', ['List', 1, 2]]).evaluate();
    // A spread whose value turns out to be a tuple at evaluation follows
    // Join's atomic-tuple convention: ONE element, not a splice.
    ce2.box(['Assign', 'ys', ['Tuple', 4, 5]]).evaluate();
    expect(e.evaluate().toString()).toBe('[1,2,3,(4, 5)]');
  });

  test('a lone spread canonicalizes to unary Join (list materialization)', () => {
    const ce2 = new ComputeEngine();
    expect(ce2.box(['List', ['Spread', 'xs']]).json).toEqual(['Join', 'xs']);
    expect(
      ce2
        .box(['List', ['Spread', ['Range', 1, 4]]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4]');
    // A scalar spread is Join's loud incompatible-type error.
    expect(ce2.box(['List', ['Spread', 5]]).evaluate().isValid).toBe(false);
  });

  test('an infinite spread stays lazy', () => {
    const ce2 = new ComputeEngine();
    const e = ce2.box([
      'Take',
      ['List', ['Spread', ['Range', 1, { num: '+Infinity' }]], 5],
      3,
    ]);
    expect(e.evaluate().toString()).toBe('[1,2,3]');
  });

  test('a plain literal is untouched (no spread, fast path)', () => {
    expect(ce.box(['List', 1, 2, 3]).json).toEqual(['List', 1, 2, 3]);
  });

  test('set spread lowers to SetFrom(Join(…)) and deduplicates', () => {
    const ce2 = new ComputeEngine();
    const e = ce2.box(['Set', 1, ['Spread', 'xs']]);
    expect(e.json).toEqual(['SetFrom', ['Join', ['List', 1], 'xs']]);
    ce2.box(['Assign', 'xs', ['List', 2, 2, 3]]).evaluate();
    expect(e.evaluate().toString()).toBe('Set(1, 2, 3)');
    // A literal set splices eagerly (and the plain dedup path runs).
    expect(ce2.box(['Set', 1, ['Spread', ['Set', 1, 2]]]).toString()).toBe(
      'Set(1, 2)'
    );
  });

  test('dictionary spread merges LAST-wins via DictionaryFrom(Join(…))', () => {
    const ce2 = new ComputeEngine();
    const d: Expression = [
      'Dictionary',
      ['Tuple', { str: 'a' }, 1],
      ['Tuple', { str: 'b' }, 2],
    ];
    // A later literal entry overrides a spread…
    expect(
      ce2
        .box(['Dictionary', ['Spread', d], ['Tuple', { str: 'b' }, 9]])
        .evaluate()
        .toString()
    ).toBe('{"a" -> 1, "b" -> 9}');
    // …and a later spread overrides an earlier literal entry.
    expect(
      ce2
        .box(['Dictionary', ['Tuple', { str: 'b' }, 9], ['Spread', d]])
        .evaluate()
        .toString()
    ).toBe('{"b" -> 2, "a" -> 1}');
    // Duplicate LITERAL keys keep the literal convention: FIRST wins.
    expect(
      ce2
        .box([
          'Dictionary',
          ['Tuple', { str: 'a' }, 1],
          ['Tuple', { str: 'a' }, 9],
          ['Spread', d],
        ])
        .evaluate()
        .toString()
    ).toBe('{"a" -> 1, "b" -> 2}');
    // …but a literal key REAPPEARING after a spread is the override idiom,
    // not a typo: the last one wins (the first-wins seen-set resets at
    // each spread).
    expect(
      ce2
        .box([
          'Dictionary',
          ['Tuple', { str: 'a' }, 1],
          ['Spread', d],
          ['Tuple', { str: 'a' }, 7],
        ])
        .evaluate()
        .toString()
    ).toBe('{"a" -> 7, "b" -> 2}');
  });

  test('a tuple spread in a dictionary literal collapses to the error', () => {
    // Unlike List/Set — which freeze a per-element `spread-tuple` error
    // cell in place — a dictionary has no error cell (entries are pairs),
    // so the WHOLE literal is the error. Deliberate asymmetry.
    const ce2 = new ComputeEngine();
    const e = ce2.box([
      'Dictionary',
      ['Spread', ['Tuple', 1, 2]],
      ['Tuple', { str: 'a' }, 1],
    ]);
    expect(e.operator).toBe('Error');
    expect(e.toString()).toContain('spread-tuple');
  });

  test('a symbol-keyed literal entry survives the merge lowering', () => {
    // The plain (no-spread) route accepts a bare-symbol key
    // (`BoxedDictionary` reads `key.symbol`); a spread elsewhere in the
    // literal must not change which keys are legal, so the merge handler
    // normalizes the symbol to a string.
    const ce2 = new ComputeEngine();
    expect(
      ce2
        .box([
          'Dictionary',
          ['Tuple', 'x', 1],
          ['Spread', ['Dictionary', ['Tuple', { str: 'b' }, 2]]],
        ])
        .evaluate()
        .toString()
    ).toBe('{"x" -> 1, "b" -> 2}');
  });

  test('a set spread into a LIST literal stays a list (no dedup)', () => {
    // `Join` adopts set/dictionary kind from any operand, so a direct join
    // of the set segment made the whole list literal a deduplicating SET;
    // the lowering materializes such segments through `ListFrom` instead.
    const ce2 = new ComputeEngine();
    const e = ce2.box(['List', ['Spread', ['Set', 1, 2]], 2]);
    expect(e.evaluate().toString()).toBe('[1,2,2]');
    expect(e.type.matches('list')).toBe(true);
  });

  test('a spread of a VALUELESS dictionary-typed symbol stays symbolic', () => {
    // A collection-TYPED operand with no value yet is UNRESOLVED, not a
    // scalar datum (USER-RULED 2026-08-11) — and `dictionary`/`record` are
    // collection types too. `ListFrom` on such a symbol used to wrap it as
    // a one-element list (`["d"]`), so the dictionary merge lowering
    // errored with "Expected a collection of pairs" instead of waiting for
    // the value; `typeCouldBeCollection` now covers the keyed collections.
    const ce2 = new ComputeEngine();
    ce2.declare('d', 'dictionary<integer>');
    // ListFrom stays inert on the valueless symbol...
    expect(ce2.box(['ListFrom', 'd']).evaluate().json).toEqual([
      'ListFrom',
      'd',
    ]);
    // ...so the dictionary-merge lowering survives symbolically...
    const merge = ce2.box([
      'DictionaryFrom',
      ['Join', ['ListFrom', 'd'], ['List', ['Tuple', { str: 'z' }, 3]]],
    ]);
    expect(merge.evaluate().isValid).toBe(true);
    // ...and resolves once the symbol receives its value.
    ce2
      .box(['Assign', 'd', ['Dictionary', ['Tuple', { str: 'a' }, 1]]])
      .evaluate();
    expect(merge.evaluate().json).toEqual({ dict: { a: 1, z: 3 } });
  });

  test('a record-typed symbol in a scalar position still errors loudly', () => {
    // The admission split must not leak: keyed collections (dictionary,
    // record) stay OUT of threadable/broadcast admission, so a numeric
    // function over one reports incompatible-type instead of parking as
    // symbolic residue. (Same verdict as before the split — this guards
    // the WIDE predicate from ever leaking into admission.)
    const ce2 = new ComputeEngine();
    ce2.declare('r', 'record{x: integer}');
    const e = ce2.box(['Sin', 'r']);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('incompatible-type');
  });

  test('a SET operand in a scalar position stays admitted (opposite polarity)', () => {
    // Guards the other edge of the keyed/unkeyed admission boundary: a set
    // is UNKEYED, so lift admission binds it WHOLE and the call stays typed
    // symbolic — it must NOT become an incompatible-type error. (An
    // "indexed" admission predicate was tried and refuted by exactly this:
    // the primary pins are the D10 §5.3 tests in
    // generic-function-literals.test.ts and type-variables-linalg.test.ts;
    // this twin keeps the polarity visible next to the keyed-side pin.)
    const ce2 = new ComputeEngine();
    const e = ce2.box(['Conjugate', ['Set', 1, 2]]);
    expect(e.type.toString()).toBe('set<integer>');
    expect(e.evaluate().toString()).toBe('Conjugate(Set(1, 2))');
  });
});

describe("Drop's count facet agrees with its own walk", () => {
  // A NEGATIVE count drops nothing, which is what the walk does — but the
  // count clamped its RESULT rather than the drop count, so `count - (-5)`
  // came out LARGER than the source: `Drop(1..10, -5)` reported 15 elements
  // for a walk that yields 10. The facet is what indexing bounds, emptiness
  // and the materialization gates read, so a disagreement is not confined to
  // a wrong `Length`.
  test.each([-5, -1, 0, 2, 20])('Drop(1..10, %p)', (n) => {
    const ce2 = new ComputeEngine();
    const dropped = ce2.box(['Drop', ['Range', 1, 10], n]).evaluate();
    expect(dropped.count).toBe([...dropped.each()].length);
  });

  test('a negative count drops nothing', () => {
    const ce2 = new ComputeEngine();
    expect(
      ce2
        .box(['Length', ['Drop', ['Range', 1, 10], -5]])
        .evaluate()
        .toString()
    ).toBe('10');
  });
});

describe('the iteration cap counts UNPRODUCTIVE pulls, not total pulls', () => {
  // The cap turns a walk that can never finish into `iteration-limit-exceeded`
  // instead of a hang. Only an unbroken run of non-emissions is that walk: a
  // filter (or dedup) that keeps emitting is bounded by whatever consumes it.
  // Counting productive pulls too capped `Take(Filter(1..oo, _ > 0), 1025)` at
  // the default limit of 1024 — silently truncating a walk that rejects
  // nothing.
  const INFINITY = { num: '+Infinity' };

  test('a productive Filter runs to its consumer’s bound', () => {
    const ce2 = new ComputeEngine();
    const taken = ce2
      .box([
        'Take',
        [
          'Filter',
          ['Range', 1, INFINITY],
          ['Function', ['Greater', '_', 0], '_'],
        ],
        1025,
      ])
      .evaluate();
    expect([...taken.each()].length).toBe(1025);
  });

  test('a dedup over an all-distinct source is not capped', () => {
    const ce2 = new ComputeEngine();
    expect(
      ce2
        .box(['Length', ['Unique', ['Range', 1, 3000]]])
        .evaluate()
        .toString()
    ).toBe('3000');
  });

  test('a filter that never matches still hits the cap', () => {
    // Unchanged: every pull is a rejection, so the run is unbroken. `Take`
    // swallows `iteration-limit-exceeded` to an empty result, as before.
    const ce2 = new ComputeEngine();
    const taken = ce2
      .box([
        'Take',
        ['Filter', ['Range', 1, INFINITY], ['Function', ['Less', '_', 0], '_']],
        1,
      ])
      .evaluate();
    expect([...taken.each()].length).toBe(0);
  });
});

// Ruling L10 of the numeric-lattice ratification: in a span constructor an
// infinite endpoint marks unbounded EXTENT — it does not name a last element.
// The three facts it separates are pinned here: membership excludes the
// endpoint, the element type does not widen with it, and the infinity
// surfaces only through the extent-reading operator `Length`.
describe('SPAN CONSTRUCTORS: an infinite endpoint is extent, not a member', () => {
  const ce2 = new ComputeEngine();
  const OO: Expression = { num: '+Infinity' };
  const NOO: Expression = { num: '-Infinity' };

  test('Interval excludes its infinite endpoint, and Range agrees', () => {
    // Was True before the flip: ±∞ is not a real number, so the set of reals
    // an `Interval` denotes cannot hold it.
    expect(
      ce2.expr(['Contains', ['Interval', 0, OO], OO]).evaluate().symbol
    ).toBe('False');
    expect(
      ce2.expr(['Contains', ['Interval', NOO, OO], NOO]).evaluate().symbol
    ).toBe('False');
    // `Range` already answered this way; the two constructors now agree.
    expect(
      ce2.expr(['Contains', ['Range', 1, OO], OO]).evaluate().symbol
    ).toBe('False');
  });

  test('finite membership is unchanged, endpoints included', () => {
    expect(
      ce2.expr(['Contains', ['Interval', 0, OO], 5]).evaluate().symbol
    ).toBe('True');
    // A closed endpoint is still a member — only the INFINITE one is extent.
    expect(
      ce2.expr(['Contains', ['Interval', 0, OO], 0]).evaluate().symbol
    ).toBe('True');
    expect(
      ce2.expr(['Contains', ['Interval', 0, 10], 10]).evaluate().symbol
    ).toBe('True');
    expect(
      ce2.expr(['Contains', ['Interval', ['Open', 0], 10], 0]).evaluate().symbol
    ).toBe('False');
    expect(
      ce2.expr(['Contains', ['Interval', 0, 10], -1]).evaluate().symbol
    ).toBe('False');
  });

  test('the element type does not leak the endpoint', () => {
    // Every member of `Range(1, +oo)` is a finite integer.
    expect(String(ce2.expr(['Range', 1, OO]).type)).toBe(
      'indexed_collection<integer>'
    );
    // An `Interval` reports the same elements however far it reaches.
    expect(String(ce2.expr(['Interval', 0, OO]).type)).toBe('set<real>');
  });

  test('Length reads the extent of an unbounded Range', () => {
    // Inert before the flip. Only `Range` gets this arm: no convention has
    // been settled for the length of the other infinite collections.
    const len = ce2.expr(['Length', ['Range', 1, OO]]).evaluate();
    expect(len.toString()).toBe('+oo');
    expect(len.isSame(ce2.PositiveInfinity)).toBe(true);
    expect(ce2.expr(['Length', ['Range', NOO, -1]]).evaluate().toString()).toBe(
      '+oo'
    );
    // A bounded Range still counts, and still types exactly `integer`.
    expect(ce2.expr(['Length', ['Range', 1, 10]]).evaluate().toString()).toBe(
      '10'
    );
    expect(String(ce2.expr(['Length', ['Range', 1, 10]]).type)).toBe('integer');
    // An `Interval` keeps the inert form.
    expect(ce2.expr(['Length', ['Interval', 0, 1]]).evaluate().operator).toBe(
      'Length'
    );
  });

  test('the type Length reports satisfies the type Length declares', () => {
    // The `type` handler returns the `+oo` singleton, but a handler result is
    // widened by `widenValueTypes()`, which replaces every value-literal type
    // by its ordinary counterpart: `infinity`. The declaration is spelled
    // with `infinity` for that reason. Declared as `+oo` it named a type no
    // stored result could have, so this subtype test failed.
    const declared = (ce2.lookupDefinition('Length')!.operator as any).signature
      .type.result;
    const reported = ce2.expr(['Length', ['Range', 1, OO]]).type;
    expect(reported.toString()).toBe('infinity | integer');
    expect(reported.matches(declared)).toBe(true);
    // A finite collection keeps the tighter report, still within the
    // declaration.
    const finite = ce2.expr(['Length', ['Range', 1, 10]]).type;
    expect(finite.toString()).toBe('integer');
    expect(finite.matches(declared)).toBe(true);
  });

  test('the type Count reports satisfies the type Count declares', () => {
    // Migration parity with `Length` above. `Count` ALREADY evaluated to `+oo`
    // over an unbounded source while declaring a bare `integer`, so the value
    // was not below the declaration. The declaration is now `integer |
    // infinity`, spelled with `infinity` for the same `widenValueTypes()`
    // reason `Length` documents.
    const declared = (ce2.lookupDefinition('Count')!.operator as any).signature
      .type.result;
    for (const source of [
      ['Range', 1, OO],
      ['Repeat', 5],
    ] as any[]) {
      const call = ce2.expr(['Count', source]);
      expect(call.evaluate().toString()).toBe('+oo');
      expect(call.type.matches(declared)).toBe(true);
    }
    // The 1-arg form narrows to the exact `integer` for the two cases it can
    // decide STRUCTURALLY: a literal `List`/`Set` node holds exactly the
    // operands it was written with, and a list type with declared dimensions
    // fixes the count in the type itself.
    expect(ce2.expr(['Count', ['List', 1, 2, 3]]).type.toString()).toBe(
      'integer'
    );
    expect(ce2.expr(['Count', ['List', 1, 2, 3]]).evaluate().toString()).toBe(
      '3'
    );
    expect(ce2.expr(['Count', ['Set', 1, 2, 3]]).type.toString()).toBe(
      'integer'
    );
    const dimensioned = new ComputeEngine();
    dimensioned.declare('v3', 'vector<integer^3>');
    expect(dimensioned.box(['Count', 'v3']).type.toString()).toBe('integer');
    // Every other source keeps the wide claim, `Range(1, 5)` included:
    // narrowing it would mean asking the source whether it is finite, and
    // that facet walks a lazy collection.
    expect(ce2.expr(['Count', ['Range', 1, 5]]).type.toString()).toBe(
      'infinity | integer'
    );
    dimensioned.declare('lst', 'list<integer>');
    expect(dimensioned.box(['Count', 'lst']).type.toString()).toBe(
      'infinity | integer'
    );
    // Both 2-arg forms decline on a non-finite source, so they keep the exact
    // `integer` — a count used as an index is not widened by a case that
    // cannot arise there.
    const value = ce2.expr(['Count', ['List', 1, 2, 2], 2]);
    expect(value.type.toString()).toBe('integer');
    expect(value.evaluate().toString()).toBe('2');
    const predicate = ce2.expr([
      'Count',
      ['Range', 1, OO],
      ['Function', ['Greater', 'x', 2], 'x'],
    ]);
    expect(predicate.type.toString()).toBe('integer');
    expect(predicate.evaluate().operator).toBe('Count');
  });

  test('a Range with an infinite LOWER bound produces no elements', () => {
    // The elements of a `Range` are `lower + k·step`, so an infinite lower
    // bound is the enumeration origin — and it is an extent marker, never a
    // member. Computing from it handed out `-oo` at every position, which
    // both contradicts the declared finite element type and loops a consumer
    // forever on the same value. Every element-producing route declines.
    const r = ce2.expr(['Range', NOO, -1]);
    expect(String(r.type)).toBe('indexed_collection<integer>');
    expect(r.isEnumerableCollection).toBe(false);
    expect([...r.each()]).toEqual([]);
    expect(r.at(1)).toBeUndefined();
    // `At`/`First` report the numeric absence marker for a position that
    // holds no element; what matters is that `-oo` is not handed out as one.
    expect(ce2.expr(['At', ['Range', NOO, -1], 1]).evaluate().toString()).toBe(
      'NaN'
    );
    expect(ce2.expr(['First', ['Range', NOO, -1]]).evaluate().toString()).toBe(
      'NaN'
    );
    // `Take` has nothing to take, so it stays in its lazy form.
    expect(ce2.expr(['Take', ['Range', NOO, -1], 3]).evaluate().operator).toBe(
      'Take'
    );
    // Membership inside the span is indeterminate, not refuted: the step grid
    // has no anchor to count from. Outside the span it is still refuted.
    expect(
      ce2.expr(['Contains', ['Range', NOO, -1], -5]).evaluate().operator
    ).toBe('Contains');
    expect(
      ce2.expr(['Contains', ['Range', NOO, -1], 3]).evaluate().symbol
    ).toBe('False');
  });

  test('a Range with an infinite UPPER bound still enumerates', () => {
    // Only the ORIGIN is unusable. `Range(1, oo)` starts at 1 and steps
    // normally; it simply never ends.
    const r = ce2.expr(['Range', 1, OO]);
    expect(r.isEnumerableCollection).toBe(true);
    expect(r.at(3)?.toString()).toBe('3');
    expect(ce2.expr(['First', ['Range', 1, OO]]).evaluate().toString()).toBe(
      '1'
    );
    expect(
      ce2
        .expr(['ListFrom', ['Take', ['Range', 1, OO], 3]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
    // An endless range has no last element: asking for one is declined, and
    // reports the numeric absence marker rather than the extent marker.
    expect(ce2.expr(['Last', ['Range', 1, OO]]).evaluate().toString()).toBe(
      'NaN'
    );
  });
});
