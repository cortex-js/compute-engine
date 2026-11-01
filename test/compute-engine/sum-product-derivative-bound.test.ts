import { ComputeEngine } from '../../src/compute-engine';

// A bound of a `Sum` or a `Product` can have a free symbol and still have a
// constant value: `D(x, x)` has `x` free (the derivative is taken at `x`),
// but its value is 1. Such a bound is evaluated, and the operator is
// enumerated over its value. A bound whose value still has a free symbol
// (`D(x^2, x)` is `2x`) keeps the operator symbolic.

const ce = new ComputeEngine();

const D_X = ['D', 'x', 'x'];
const D_X2_OVER_X = ['Divide', ['D', ['Power', 'x', 2], 'x'], 'x'];

describe('a bound with a constant derivative value', () => {
  test.each([
    [['Sum', 'k', ['Limits', 'k', 1, ['Add', D_X, 2]]], '6'],
    [['Sum', 'k', ['Limits', 'k', 1, D_X2_OVER_X]], '3'],
    [['Sum', 'k', ['Limits', 'k', D_X, 3]], '6'],
    [['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, ['Add', D_X, 2]]], '14'],
    [['Sum', 'y', ['Limits', 'k', 1, ['Add', D_X, 2]]], '3y'],
    [['Product', 'k', ['Limits', 'k', 1, ['Add', D_X, 2]]], '6'],
    [['Product', 'y', ['Limits', 'k', 1, ['Add', D_X, 2]]], 'y^3'],
  ] as const)('%j evaluates to %s', (json, expected) => {
    const e = ce.box(json as any);
    expect(e.evaluate().toString()).toBe(expected);
    expect(e.N().toString()).toBe(expected);
  });

  test.each([
    // The bound parses as `D(x + 2, x)`, which is 1.
    ['\\sum_{k=1}^{\\frac{d}{dx}x+2} k', '1'],
    ['\\prod_{k=1}^{\\frac{d}{dx}x+2} (k+1)', '2'],
    ['\\sum_{k=1}^{\\frac{\\frac{d}{dx}x^2}{x}} k', '3'],
    ['\\prod_{k=1}^{\\frac{\\frac{d}{dx}x^2}{x}} k', '2'],
  ])('%s evaluates to %s', (latex, expected) => {
    const e = ce.parse(latex);
    expect(e.evaluate().toString()).toBe(expected);
    expect(e.N().toString()).toBe(expected);
  });

  test('a symbol bound with an assigned value is read', () => {
    const ce = new ComputeEngine();
    ce.assign('m', 3);
    const e = ce.box(['Sum', 'k', ['Limits', 'k', 1, 'm']]);
    expect(e.evaluate().toString()).toBe('6');
  });

  test('a bound that is not an integer is rounded down, as a number is', () => {
    const viaD = ce.box(['Sum', 'k', ['Limits', 'k', 1, ['Add', D_X, 0.5]]]);
    const literal = ce.box(['Sum', 'k', ['Limits', 'k', 1, 1.5]]);
    expect(viaD.evaluate().toString()).toBe(literal.evaluate().toString());
  });
});

describe('simplify() agrees with evaluate() for a bound with a constant value', () => {
  // A closed form substitutes the bound for the index, and the enumeration
  // rounds the value of the bound down. A bound whose value is not an
  // integer is not put into a closed form.
  test.each([
    [['Product', 'k', ['Limits', 'k', 1, ['Add', D_X, 0.5]]], '1'],
    [['Product', 'k', ['Limits', 'k', 1, ['Multiply', 'Pi', D_X]]], '6'],
    [['Sum', 'k', ['Limits', 'k', 1, ['Multiply', 'Pi', D_X]]], '6'],
    [
      [
        'Sum',
        ['Divide', 1, ['Multiply', 'k', ['Add', 'k', 1]]],
        ['Limits', 'k', 1, ['Add', D_X, 1.5]],
      ],
      '2/3',
    ],
    [['Sum', 'k', ['Limits', 'k', 1, ['Add', D_X, 2]]], '6'],
    [['Product', 'k', ['Limits', 'k', 1, ['Add', D_X, 2]]], '6'],
  ] as const)('%j is %s', (json, expected) => {
    const e = ce.box(json as any);
    expect(e.evaluate().toString()).toBe(expected);
    expect(e.simplify().evaluate().toString()).toBe(expected);
  });
});

describe('a bound with a free symbol and an absent or infinite value', () => {
  test('a bound whose value is absent gives NaN', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t) \\coloneq \\begin{cases} 0.5 & t < 1 \\end{cases}').evaluate();
    const closed = ce.box(['Sum', 'k', ['Limits', 'k', ['g', 3], 3]]);
    const viaD = ce.box([
      'Sum',
      'k',
      ['Limits', 'k', ['g', ['Add', D_X, 2]], 3],
    ]);
    expect(closed.evaluate().toString()).toBe('NaN');
    expect(viaD.evaluate().toString()).toBe('NaN');
  });

  test('a bound whose value is an infinity keeps the operator symbolic', () => {
    // The series rules read a bound as written and recognize only an
    // infinity, so `D(x, x) + ∞` is not read as an infinite domain.
    const e = ce.box([
      'Sum',
      ['Power', 'k', -2],
      ['Limits', 'k', 1, ['Add', D_X, 'PositiveInfinity']],
    ]);
    expect(e.evaluate().operator).toBe('Sum');
    expect(e.N().operator).toBe('Sum');
  });
});

describe('a bound whose value has a free symbol', () => {
  test.each([
    ['Sum', ['Limits', 'k', 1, ['D', ['Power', 'x', 2], 'x']]],
    ['Product', ['Limits', 'k', 1, ['D', ['Power', 'x', 2], 'x']]],
    ['Sum', ['Limits', 'k', 1, 'n']],
    ['Sum', ['Limits', 'k', 1, ['Subtract', 'n', 1]]],
  ] as const)('%s over %j stays symbolic', (op, limits) => {
    // The value is the operator, or a closed form in the bound (the product
    // `Π_{k=1}^{b} k` is `b!`), and it is not a number.
    const e = ce.box([op, 'k', limits] as any);
    expect(e.evaluate().unknowns.length).toBeGreaterThan(0);
    expect(e.N().unknowns.length).toBeGreaterThan(0);
  });
});
