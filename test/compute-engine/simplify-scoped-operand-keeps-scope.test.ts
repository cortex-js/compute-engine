import { ComputeEngine } from '../../src/compute-engine';

// When `simplify()` rewrites an operand of a scoped operator (a bound of a
// `Sum` or a `Product`, the limits of an `Integrate`) and keeps the body as
// it is, the rebuilt expression must keep the local scope that binds the
// index. Without it, the index in the body is read as a free symbol: with
// `g(0) = 0.5`, `Sum(k, Limits(k, g(0), 3))` simplified to
// `Sum(k, Limits(k, 0.5, 3))`, and its value was `4k`, not 6.

describe('a simplified bound keeps the binding of the index', () => {
  const ce = new ComputeEngine();
  ce.parse('g(t) \\coloneq \\begin{cases} 0.5 & t < 1 \\end{cases}').evaluate();

  test.each([
    [['Sum', 'k', ['Limits', 'k', ['g', 0], 3]], '6'],
    [['Product', 'k', ['Limits', 'k', ['g', 0], 3]], '0'],
    [['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, ['Add', ['g', 0], 2]]], '5'],
    [['Add', 1, ['Sum', 'k', ['Limits', 'k', ['g', 0], 3]]], '7'],
    // A nested sum: both indexes stay bound.
    [
      [
        'Sum',
        ['Sum', 'k', ['Limits', 'k', ['g', 0], 'j']],
        ['Limits', 'j', 1, 3],
      ],
      '10',
    ],
    // A rule that rebuilds the outer operator keeps its scope, which is the
    // parent of the scope of the nested sum: 2·(1 + 3 + 6), 1·3·6 and
    // 2³·1·3·6.
    [
      [
        'Sum',
        ['Multiply', 2, ['Sum', 'k', ['Limits', 'k', ['g', 0], 'j']]],
        ['Limits', 'j', 1, 3],
      ],
      '20',
    ],
    [
      [
        'Product',
        ['Sum', 'k', ['Limits', 'k', ['g', 0], 'j']],
        ['Limits', 'j', 1, 3],
      ],
      '18',
    ],
    [
      [
        'Product',
        ['Multiply', 2, ['Sum', 'k', ['Limits', 'k', ['g', 0], 'j']]],
        ['Limits', 'j', 1, 3],
      ],
      '144',
    ],
    // A numeric integral: its value has an error estimate, so it is compared
    // as a number.
    [['Integrate', 'x', ['Limits', 'x', ['g', 0], 1]], 0.375],
  ])('%j', (json, expected) => {
    const e = ce.box(json as any);
    const s = e.simplify();
    // The value of the expression before the simplification, then the value
    // after it, with N() and with evaluate()
    for (const value of [e.N(), s.N(), s.evaluate()]) {
      if (typeof expected === 'number')
        expect(value.re).toBeCloseTo(expected, 10);
      else expect(value.toString()).toBe(expected);
    }
  });
});
