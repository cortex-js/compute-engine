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
        expect(compile(expr, { to: 'python' }).success).toBe(false);
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
    expect(sum.evaluate().json).toEqual(sum.json);
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
});

describe('A SUM WITH NO INDEX', () => {
  test('evaluate() of a sum with no index is the same expression', () => {
    for (const latex of ['\\sum^{10} k', '\\sum_1^{n} k']) {
      const sum = ce.parse(latex);
      expect(sum.evaluate().isSame(sum)).toBe(true);
    }
  });
});
