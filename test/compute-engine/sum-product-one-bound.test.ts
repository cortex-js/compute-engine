/**
 * A sum or product with only ONE bound stays unevaluated, as an integral with
 * only one bound does (user decision of 2026-10-01). No default is chosen for
 * the missing bound, under `evaluate()` and `N()` alike.
 *
 * Before:
 * - `\sum_{k=1} k` evaluated to `1`: the subscript `k=1` was read as the
 *   UPPER bound, `Limits(k, Nothing, 1)`. It is now the lower bound,
 *   `Limits(k, 1, Nothing)`.
 * - `\sum^{10} k` and `\prod^{5} k` dropped the bound (`["Sum", "k"]`). The
 *   bound is now kept, with no index: `Limits(Nothing, Nothing, 10)`.
 * - `Sum(k, Limits(k, Nothing, 10))` evaluated to `55` (lower bound 1). It
 *   serialized as `\sum_{k}^{10}k`, which parsed back as `Limits(k, 1, 10)`;
 *   `\sum_{k}^{10}` now parses as `Limits(k, Nothing, 10)`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('PARSING A BIG OPERATOR WITH ONE BOUND', () => {
  test('\\sum_{k=1} k: the subscript is the lower bound', () => {
    expect(ce.parse('\\sum_{k=1} k').json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 1, 'Nothing'],
    ]);
    expect(ce.parse('\\prod_{k=1} k').json).toEqual([
      'Product',
      'k',
      ['Limits', 'k', 1, 'Nothing'],
    ]);
  });

  test('\\sum_{k}^{10} k: no default lower bound', () => {
    expect(ce.parse('\\sum_{k}^{10} k').json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 'Nothing', 10],
    ]);
    expect(ce.parse('\\prod_{k}^{5} k').json).toEqual([
      'Product',
      'k',
      ['Limits', 'k', 'Nothing', 5],
    ]);
  });

  test('\\sum^{10} k and \\prod^{5} k keep the bound', () => {
    expect(ce.parse('\\sum^{10} k').json).toEqual([
      'Sum',
      'k',
      ['Limits', 'Nothing', 'Nothing', 10],
    ]);
    expect(ce.parse('\\prod^{5} k').json).toEqual([
      'Product',
      'k',
      ['Limits', 'Nothing', 'Nothing', 5],
    ]);
  });

  test('a one-sided inequality in the subscript is a lower bound', () => {
    expect(ce.parse('\\sum_{k \\ge 1} k').json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 1, 'Nothing'],
    ]);
    expect(ce.parse('\\sum_{1 \\le k} k').json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 1, 'Nothing'],
    ]);
  });
});

describe('A SUM OR PRODUCT WITH ONE BOUND STAYS UNEVALUATED', () => {
  const ONE_BOUND: [string, () => Expression][] = [
    ['\\sum_{k=1} k', () => ce.parse('\\sum_{k=1} k')],
    ['\\sum_{k}^{10} k', () => ce.parse('\\sum_{k}^{10} k')],
    ['\\sum^{10} k', () => ce.parse('\\sum^{10} k')],
    ['\\prod_{k=1} k', () => ce.parse('\\prod_{k=1} k')],
    ['\\prod_{k}^{5} k', () => ce.parse('\\prod_{k}^{5} k')],
    ['\\prod^{5} k', () => ce.parse('\\prod^{5} k')],
    [
      'Sum(k, Limits(k, Nothing, 10))',
      () => ce.box(['Sum', 'k', ['Limits', 'k', 'Nothing', 10]]),
    ],
    [
      'Sum(k, Limits(k, 1, Nothing))',
      () => ce.box(['Sum', 'k', ['Limits', 'k', 1, 'Nothing']]),
    ],
    [
      'Sum(1/k^2, Limits(k, 1, Nothing))',
      () => ce.box(['Sum', ['Power', 'k', -2], ['Limits', 'k', 1, 'Nothing']]),
    ],
    [
      'Product(k, Limits(k, Nothing, 5))',
      () => ce.box(['Product', 'k', ['Limits', 'k', 'Nothing', 5]]),
    ],
    [
      'Product(k, Limits(k, 1, Nothing))',
      () => ce.box(['Product', 'k', ['Limits', 'k', 1, 'Nothing']]),
    ],
    ['the flat Sum(k, k, 10)', () => ce.box(['Sum', 'k', 'k', 10])],
    ['the flat Product(k, k, 5)', () => ce.box(['Product', 'k', 'k', 5])],
    [
      'one of two indexes with one bound',
      () =>
        ce.box([
          'Sum',
          ['Multiply', 'i', 'j'],
          ['Limits', 'i', 1, 3],
          ['Limits', 'j', 'Nothing', 2],
        ]),
    ],
  ];

  test.each(ONE_BOUND)('%s: evaluate()', (_, make) => {
    const expr = make();
    const value = expr.evaluate();
    expect(value.json).toEqual(expr.json);
  });

  test.each(ONE_BOUND)('%s: N()', (_, make) => {
    const expr = make();
    const value = expr.N();
    expect(value.json).toEqual(expr.json);
  });

  // `simplify()` read the `Nothing` bound as a value: `\sum_{k=1} k` gave
  // `1/2` and `\sum_{k=1} y` gave `0`.
  test.each([
    ...ONE_BOUND,
    ['\\sum_{k=1} y', () => ce.parse('\\sum_{k=1} y')],
    ['\\prod_{k=1} y', () => ce.parse('\\prod_{k=1} y')],
  ] as [string, () => Expression][])('%s: simplify()', (_, make) => {
    const expr = make();
    expect(expr.simplify().json).toEqual(expr.json);
  });

  test('evaluateAsync() stays unevaluated', async () => {
    const sum = ce.box(['Sum', 'k', ['Limits', 'k', 'Nothing', 10]]);
    expect((await sum.evaluateAsync()).json).toEqual(sum.json);
    const product = ce.box(['Product', 'k', ['Limits', 'k', 1, 'Nothing']]);
    expect((await product.evaluateAsync()).json).toEqual(product.json);
  });

  test('compiling falls back to the interpreter', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const expr of [
        ce.box(['Sum', 'k', ['Limits', 'k', 'Nothing', 10]]),
        ce.box(['Sum', 'k', ['Limits', 'k', 1, 'Nothing']]),
        ce.box(['Product', 'k', ['Limits', 'k', 'Nothing', 5]]),
        ce.parse('\\sum^{10} k'),
      ]) {
        expect(compile(expr).success).toBe(false);
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe('ROUND-TRIPS THROUGH LATEX', () => {
  const ROUND_TRIP: [unknown, string][] = [
    [['Sum', 'k', ['Limits', 'k', 'Nothing', 10]], '\\sum_{k}^{10}k'],
    [['Sum', 'k', ['Limits', 'k', 1, 'Nothing']], '\\sum_{k=1}k'],
    [['Sum', 'k', ['Limits', 'Nothing', 'Nothing', 10]], '\\sum^{10}k'],
    [['Product', 'k', ['Limits', 'k', 'Nothing', 5]], '\\prod_{k}^5k'],
    [['Product', 'k', ['Limits', 'k', 1, 'Nothing']], '\\prod_{k=1}k'],
    [['Product', 'k', ['Limits', 'Nothing', 'Nothing', 5]], '\\prod^5k'],
    [['Sum', 'k', ['Limits', 'k', 1, 10]], '\\sum_{k=1}^{10}k'],
    [['Sum', 'k', ['Limits', 'k', 'Nothing', 'Nothing']], '\\sum_{k}k'],
  ];

  test.each(ROUND_TRIP)('%j', (json, latex) => {
    const expr = ce.box(json as any);
    expect(expr.latex).toBe(latex);
    expect(ce.parse(expr.latex).json).toEqual(expr.json);
  });

  test('toString() writes no Nothing index', () => {
    expect(ce.parse('\\sum^{10} k').toString()).toBe('sum^(10)(k)');
    expect(ce.parse('\\sum_{k}^{10} k').toString()).toBe('sum_(k)^(10)(k)');
    expect(ce.parse('\\sum_{k=1} k').toString()).toBe('sum_(k=1)(k)');
  });
});

describe('THE OTHER FORMS ARE UNCHANGED', () => {
  test('both bounds', () => {
    expect(ce.parse('\\sum_{k=1}^{10} k').evaluate().re).toBe(55);
    expect(ce.parse('\\prod_{k=1}^{5} k').evaluate().re).toBe(120);
    expect(ce.box(['Sum', 'k', ['Limits', 'k', 1, 10]]).N().re).toBe(55);
    expect(ce.box(['Sum', 'k', 'k', 1, 10]).evaluate().re).toBe(55);
    expect(
      ce.parse('\\sum_{k=1}^{\\infty} \\frac{1}{k^2}').evaluate().latex
    ).toBe('\\frac{\\pi^2}{6}');
  });

  test('an indexing set', () => {
    expect(
      ce.box(['Sum', 'k', ['Element', 'k', ['List', 1, 2, 3]]]).evaluate().re
    ).toBe(6);
    expect(ce.parse('\\sum_{n \\in \\{1,2,3\\}} n').evaluate().re).toBe(6);
  });

  test('no bounds at all', () => {
    const sum = ce.parse('\\sum_{k} k');
    expect(sum.json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 'Nothing', 'Nothing'],
    ]);
    // A clause with no bounds runs over 1..+∞ (user decision 2026-10-20),
    // as `\sum_{k=1}^{\infty} k` does.
    expect(sum.evaluate().json).toEqual('PositiveInfinity');
    expect(
      ce
        .box(['Sum', ['Power', 'k', -2], ['Limits', 'k', 'Nothing', 'Nothing']])
        .N().re
    ).toBeCloseTo(Math.PI ** 2 / 6, 10);
  });

  test('a one-sided `i \\le upper` subscript keeps the implied lower bound 1', () => {
    expect(ce.parse('\\sum_{i \\le 10} i').evaluate().re).toBe(55);
  });

  test('a subscript with no index keeps both bounds', () => {
    const sum = ce.parse('\\sum_1^9 k');
    expect(sum.json).toEqual(['Sum', 'k', ['Limits', 'Nothing', 1, 9]]);
  });

  test('a subscript with no index keeps an arithmetic lower bound (CE-1763)', () => {
    expect(ce.parse('\\sum_{a+1}^5 x').json).toEqual([
      'Sum',
      'x',
      ['Limits', 'Nothing', ['Add', 'a', 1], 5],
    ]);
    expect(ce.parse('\\prod_{2a}^{n} x').json).toEqual([
      'Product',
      'x',
      ['Limits', 'Nothing', ['Multiply', 2, 'a'], 'n'],
    ]);
  });

  test('a subscript with no index that is a predicate is not a bound', () => {
    expect(ce.parse('\\sum_{d\\mid n} d').json).toEqual(['Sum', 'd']);
    expect(ce.parse('\\sum_{i\\notin S} x').json).toEqual(['Sum', 'x']);
  });

  test('a subscript with no index that holds no number is not a bound', () => {
    // `ij` names two indexes; it is not the bound `i·j`.
    expect(ce.parse('\\sum_{ij} a_{ij}').json).toEqual(['Sum', 'a_ij']);
    expect(ce.parse('\\prod_{\\alpha\\beta} x').json).toEqual(['Product', 'x']);
  });
});

describe('THE LATEX OF A SUM WITH NO INDEX AND AN ARITHMETIC LOWER BOUND', () => {
  const roundTrip = (json: any) => {
    const latex = ce.box(json, { canonical: false }).latex;
    return [latex, ce.parse(latex, { canonical: false }).json];
  };

  test('reads back as the same canonical sum (CE-1763)', () => {
    for (const json of [
      ['Sum', 'x', ['Limits', 'Nothing', ['Add', 'a', 1], 5]],
      ['Product', 'x', ['Limits', 'Nothing', ['Multiply', 2, 'a'], 'n']],
      ['Sum', 'x', ['Element', 'k', 'S'], ['Limits', 'Nothing', -1, 5]],
      // `a^{1/2}` is written `\sqrt{a}`.
      [
        'Sum',
        'x',
        ['Limits', 'Nothing', ['Power', 'a', ['Rational', 1, 2]], 5],
      ],
      // `e^{a+1}` is written as `Exp(a+1)`.
      ['Sum', 'x', ['Limits', 'Nothing', ['Exp', ['Add', 'a', 1]], 5]],
    ] as const) {
      const sum = ce.box(json as any);
      expect(ce.parse(sum.latex).isSame(sum)).toBe(true);
    }
  });

  test('a squared bound before a bounded range keeps both ranges', () => {
    // The serializer writes `Power(a, 2)` as `Square(a)`, `a^2`; the
    // superscript `3` stays with `i`.
    const sum = ce.box([
      'Sum',
      'x',
      ['Limits', 'Nothing', ['Power', 'a', 2], 'Nothing'],
      ['Limits', 'i', 1, 3],
    ]);
    expect(sum.latex).toBe('\\sum_{a^2}\\sum_{i=1}^3x');
    expect(ce.parse(sum.latex).json).toEqual([
      'Sum',
      ['Sum', 'x', ['Limits', 'i', 1, 3]],
      ['Limits', 'Nothing', ['Power', 'a', 2], 'Nothing'],
    ]);
  });

  test('reads back with its bounds', () => {
    expect(
      roundTrip(['Sum', 'x', ['Limits', 'Nothing', ['Add', 'a', 1], 5]])
    ).toEqual([
      '\\sum_{a+1}^5x',
      ['Sum', 'x', ['Tuple', 'Nothing', ['Add', 'a', 1], 5]],
    ]);
  });

  test('after an `Element` clause, is written as a nested operator', () => {
    // `\sum_{k\in S, a+1}^{5}` would read `a+1` as the condition of
    // `k\in S`.
    expect(
      roundTrip([
        'Sum',
        'x',
        ['Element', 'k', 'S'],
        ['Limits', 'Nothing', ['Add', 'a', 1], 5],
      ])
    ).toEqual([
      '\\sum_{k\\in S}\\sum_{a+1}^5x',
      [
        'Sum',
        ['Sum', 'x', ['Tuple', 'Nothing', ['Add', 'a', 1], 5]],
        ['Element', 'k', 'S'],
      ],
    ]);
  });

  test('after an index-less number bound, shares the operator', () => {
    expect(
      roundTrip([
        'Sum',
        'x',
        ['Limits', 'Nothing', 1, 3],
        ['Limits', 'Nothing', ['Add', 'a', 1], 5],
      ])
    ).toEqual([
      '\\sum_{1, a+1}^{3, 5}x',
      [
        'Sum',
        'x',
        ['Tuple', 'Nothing', 1, 3],
        ['Tuple', 'Nothing', ['Add', 'a', 1], 5],
      ],
    ]);
  });
});

describe('A SUM WITH NO INDEX', () => {
  test('evaluate() of a sum with no index is the same expression', () => {
    for (const latex of ['\\sum^{10} k', '\\sum_1^{n} k']) {
      const sum = ce.parse(latex);
      expect(sum.evaluate().isSame(sum)).toBe(true);
    }
  });
});
