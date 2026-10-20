import { ComputeEngine } from '../../src/compute-engine';

/**
 * A sum or a product written with no bounds (`\sum_k x^k`) has the indexing
 * clause `Limits(k, Nothing, Nothing)`. Such a clause runs over the default
 * domain (k = 1, 2, 3, …), so `\sum_k \frac{1}{k^2}` `.N()` is π²/6.
 *
 * The two bounds are the same symbol, `Nothing`, and the test for a
 * one-point range (`Σ_{k=a}^{a}`) used to accept them as a point. The index
 * was then replaced by `Nothing` in the body (`x^{k-1}` became `1/x`, `x^k`
 * became `Error("missing")`), and on the canonical route a body without the
 * index lost its indexing clause (`\sum_k y` became `y`). Now each of these
 * stays unevaluated, as `\sum_k k` already did.
 */

const ce = new ComputeEngine();

const NO_BOUNDS = ['Limits', 'k', 'Nothing', 'Nothing'] as const;

function json(x: { json: unknown }): string {
  return JSON.stringify(x.json);
}

describe('A sum or a product with no bounds: box route', () => {
  test.each([
    ['Sum', ['Power', 'x', ['Subtract', 'k', 1]]],
    ['Sum', ['Power', 'x', 'k']],
    ['Product', ['Power', 'x', 'k']],
    ['Sum', 'y'],
    ['Product', 'y'],
    ['Sum', 'k'],
  ])('%s(%j, Limits(k, Nothing, Nothing)) stays unevaluated', (op, body) => {
    const expr = ce.box([op, body, NO_BOUNDS] as any);
    // The indexing clause is kept by canonicalization.
    expect(expr.operator).toBe(op);
    expect(json(expr)).toContain('["Limits","k","Nothing","Nothing"]');
    expect(json(expr.evaluate())).toBe(json(expr));
    expect(json(expr.N())).toBe(json(expr));
    expect(json(expr.simplify())).toBe(json(expr));
  });

  test('a clause with no index and no bounds is dropped', () => {
    // `Limits(Nothing, Nothing, Nothing)` describes nothing: the operator is
    // its body, as `Sum(x^2)` is.
    const clause = ['Limits', 'Nothing', 'Nothing', 'Nothing'];
    expect(json(ce.box(['Sum', ['Power', 'x', 2], clause] as any))).toBe(
      '["Power","x",2]'
    );
    const structural = ce.function(
      'Sum',
      [ce.box(['Power', 'x', 2]), ce.box(clause as any)],
      { form: 'structural' }
    );
    expect(json(structural.evaluate())).toBe('["Power","x",2]');
  });

  test('a telescoping body is not given a closed form', () => {
    // With bounds `a` and `b`, the closed form is `(x+b+1)² − (x+a)²`. With
    // no bounds, there is no value to substitute.
    const sum = ce.box([
      'Sum',
      [
        'Subtract',
        ['Power', ['Add', 'x', 'k', 1], 2],
        ['Power', ['Add', 'x', 'k'], 2],
      ],
      NO_BOUNDS,
    ] as any);
    expect(json(sum.evaluate())).toBe(json(sum));

    const product = ce.box([
      'Product',
      ['Divide', ['Add', 'x', 'k', 1], ['Add', 'x', 'k']],
      NO_BOUNDS,
    ] as any);
    expect(json(product.evaluate())).toBe(json(product));
  });

  test('the structural form also stays unevaluated', () => {
    const expr = ce.function(
      'Sum',
      [ce.box(['Power', 'x', 'k']), ce.box(NO_BOUNDS as any)],
      { form: 'structural' }
    );
    expect(expr.evaluate().operator).toBe('Sum');
    const constant = ce.function(
      'Sum',
      [ce.box('y'), ce.box(NO_BOUNDS as any)],
      { form: 'structural' }
    );
    expect(constant.evaluate().operator).toBe('Sum');
  });

  test('a one-point range is still reduced', () => {
    expect(
      json(
        ce
          .box(['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 'a', 'a']])
          .evaluate()
      )
    ).toBe('["Power","x","a"]');
    expect(json(ce.box(['Sum', 'y', ['Limits', 'k', 3, 3]]))).toBe('"y"');
  });
});

describe('A sum or a product with no bounds: parse route', () => {
  test.each([
    ['\\sum_k x^{k-1}', 'Sum'],
    ['\\sum_k x^k', 'Sum'],
    ['\\prod_k x^k', 'Product'],
    ['\\sum_k y', 'Sum'],
    ['\\prod_k y', 'Product'],
    ['\\sum_k k', 'Sum'],
    ['\\sum_k 2k', 'Sum'],
    ['\\prod_k 2', 'Product'],
  ])('%s stays unevaluated', (latex, op) => {
    const expr = ce.parse(latex);
    expect(expr.operator).toBe(op);
    expect(json(expr)).toContain('["Limits","k","Nothing","Nothing"]');
    expect(json(expr.evaluate())).toBe(json(expr));
    expect(json(expr.N())).toBe(json(expr));
    // `simplify()` read the `Nothing` bounds as values: `\sum_k k` gave 1,
    // `\sum_k y` gave `y` and `\prod_k y` gave `Root(y, 1)`.
    expect(json(expr.simplify())).toBe(json(expr));
  });

  test('\\sum_k y keeps its LaTeX form', () => {
    expect(ce.parse('\\sum_k y').latex).toBe('\\sum_{k}y');
  });

  test('a clause with no bounds runs over the default domain', () => {
    const expr = ce.parse('\\sum_k \\frac{1}{k^2}');
    expect(expr.N().re).toBeCloseTo(Math.PI ** 2 / 6, 10);
  });

  test('the derivative of a sum with no bounds stays unevaluated', () => {
    // The sum has no value, so its derivative is not computed either.
    const d1 = ce.parse('\\frac{d}{dx}\\sum_k x^k').evaluate();
    expect(d1.operator).toBe('D');
    const d2 = ce.parse('\\frac{d}{dx}\\sum_k y').evaluate();
    expect(d2.operator).toBe('D');
  });
});

describe('simplify() of a sum or a product with more than one indexing clause', () => {
  // The simplification rules read only the first clause. They read the other
  // indexes as free symbols and dropped their clauses: the sum below gave
  // `6j`, not 18, and the product gave `j^3`.
  test.each([
    [
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 2],
    ],
    ['Sum', 'j', ['Limits', 'i', 1, 3], ['Limits', 'j', 1, 'n']],
    ['Product', 'j', ['Limits', 'i', 1, 3], ['Limits', 'j', 1, 'n']],
  ])('%s(%j, …) keeps every clause', (...input) => {
    const expr = ce.box(input as any);
    expect(json(expr.simplify())).toBe(json(expr));
  });

  test('the sum still evaluates', () => {
    const expr = ce.box([
      'Sum',
      ['Multiply', 'i', 'j'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 2],
    ]);
    expect(json(expr.evaluate())).toBe('18');
  });
});
