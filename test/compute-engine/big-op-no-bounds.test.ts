import { ComputeEngine } from '../../src/compute-engine';

/**
 * A sum or a product written with no bounds (`\sum_k x^k`) has the indexing
 * clause `Limits(k, Nothing, Nothing)`. Such a clause runs over
 * k = 1, 2, 3, …, on every route (user decision 2026-10-20): `evaluate()`,
 * `N()`, `simplify()` and the derivative give the same result as for the
 * explicit clause `Limits(k, 1, +∞)`. So `\sum_k \frac{1}{k^2}` evaluates to
 * π²/6, as `\sum_{k=1}^{\infty} \frac{1}{k^2}` does. The canonical form keeps
 * the clause with no bounds; the defaults apply when the operator is
 * evaluated (`withDefaultBigOpBounds()` in `library/utils.ts`).
 *
 * Before 2026-10-20, these stayed unevaluated under `evaluate()` and
 * `simplify()`, while `N()` already ran over 1..+∞. Before 2026-10-19, the
 * two `Nothing` bounds were read as a one-point range (`Σ_{k=a}^{a}`): the
 * index was replaced by `Nothing` in the body (`x^{k-1}` became `1/x`, `x^k`
 * became `Error("missing")`), and on the canonical route a body without the
 * index lost its indexing clause (`\sum_k y` became `y`).
 */

const ce = new ComputeEngine();

const NO_BOUNDS = ['Limits', 'k', 'Nothing', 'Nothing'] as const;
const EXPLICIT = ['Limits', 'k', 1, 'PositiveInfinity'] as const;

function json(x: { json: unknown }): string {
  return JSON.stringify(x.json);
}

/**
 * The JSON of a result of the explicit form, with its clause written as the
 * clause with no bounds. An operator that stays unevaluated keeps the clause
 * it was written with, so this is what the form with no bounds gives.
 */
function asNoBounds(x: { json: unknown }): string {
  return json(x)
    .split(JSON.stringify(EXPLICIT))
    .join(JSON.stringify(NO_BOUNDS));
}

describe('A sum or a product with no bounds: box route', () => {
  test.each([
    ['Sum', ['Power', 'x', ['Subtract', 'k', 1]]],
    ['Sum', ['Power', 'x', 'k']],
    ['Product', ['Power', 'x', 'k']],
    ['Sum', 'y'],
    ['Product', 'y'],
    ['Sum', 'k'],
    ['Sum', ['Power', 'k', -2]],
    ['Product', ['Add', 1, ['Power', 'k', -2]]],
    ['Sum', ['Divide', ['Power', 'x', 'k'], ['Factorial', 'k']]],
  ])(
    '%s(%j, Limits(k, Nothing, Nothing)) is the same as over 1..+∞',
    (op, body) => {
      const expr = ce.box([op, body, NO_BOUNDS] as any);
      const explicit = ce.box([op, body, EXPLICIT] as any);
      // The indexing clause is kept by canonicalization.
      expect(expr.operator).toBe(op);
      expect(json(expr)).toContain('["Limits","k","Nothing","Nothing"]');
      expect(json(expr.evaluate())).toBe(asNoBounds(explicit.evaluate()));
      expect(json(expr.N())).toBe(asNoBounds(explicit.N()));
      expect(json(expr.simplify())).toBe(asNoBounds(explicit.simplify()));
    }
  );

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

  test('a telescoping body is read as over 1..+∞', () => {
    const sumBody = [
      'Subtract',
      ['Power', ['Add', 'x', 'k', 1], 2],
      ['Power', ['Add', 'x', 'k'], 2],
    ];
    expect(json(ce.box(['Sum', sumBody, NO_BOUNDS] as any).evaluate())).toBe(
      asNoBounds(ce.box(['Sum', sumBody, EXPLICIT] as any).evaluate())
    );

    const productBody = ['Divide', ['Add', 'x', 'k', 1], ['Add', 'x', 'k']];
    expect(
      json(ce.box(['Product', productBody, NO_BOUNDS] as any).evaluate())
    ).toBe(
      asNoBounds(ce.box(['Product', productBody, EXPLICIT] as any).evaluate())
    );
  });

  test('the structural form is also read as over 1..+∞', () => {
    const expr = ce.function(
      'Sum',
      [ce.box(['Power', 'x', 'k']), ce.box(NO_BOUNDS as any)],
      { form: 'structural' }
    );
    expect(json(expr.evaluate())).toBe(
      '["When",["Divide","x",["Add",["Negate","x"],1]],["Less",["Abs","x"],1]]'
    );
    // `\sum_{k=1}^{\infty} y` stays unevaluated under `evaluate()`.
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
    // [LaTeX, evaluate(), N(), simplify()], as strings. `same` is the
    // expression itself.
    ['\\sum_k \\frac{1}{k^2}', 'pi^2 / 6', '1.64493406684822643647', 'same'],
    [
      '\\sum_k x^{k-1}',
      '1 / (1 - x) {|x| < 1}',
      '1 / (1 - x) {|x| < 1}',
      'same',
    ],
    ['\\sum_k x^k', 'x / (1 - x) {|x| < 1}', 'x / (1 - x) {|x| < 1}', 'same'],
    ['\\sum_k \\frac{x^k}{k!}', 'e^x - 1', 'e^x - 1', 'same'],
    [
      '\\prod_k (1+\\frac{1}{k^2})',
      'sinh(pi) / pi',
      '3.676077910374995',
      'same',
    ],
    ['\\prod_k x^k', 'same', 'same', 'same'],
    // The value depends on the sign of `y` (0 for y = 0), so it stays.
    ['\\sum_k y', 'same', 'same', 'same'],
    ['\\prod_k y', 'same', 'same', 'same'],
    ['\\sum_k k', '+oo', '+oo', '+oo'],
    ['\\sum_k 2k', '+oo', '+oo', '+oo'],
    ['\\prod_k 2', '+oo', '+oo', '+oo'],
    ['\\prod_k \\frac{1}{2}', '0', '0', '0'],
    ['\\prod_k 1', '1', '1', '1'],
    ['\\prod_k (-2)', 'same', 'same', 'same'],
    ['\\sum_k 0', '0', '0', '0'],
  ])('%s', (latex, evaluated, numeric, simplified) => {
    const expr = ce.parse(latex);
    expect(json(expr)).toContain('["Limits","k","Nothing","Nothing"]');
    const expected = (s: string) => (s === 'same' ? expr.toString() : s);
    expect(expr.evaluate().toString()).toBe(expected(evaluated));
    expect(expr.N().toString()).toBe(expected(numeric));
    expect(expr.simplify().toString()).toBe(expected(simplified));
  });

  test('\\sum_k y keeps its LaTeX form', () => {
    expect(ce.parse('\\sum_k y').latex).toBe('\\sum_{k}y');
  });

  test('the closed forms agree with N()', () => {
    expect(ce.parse('\\sum_k \\frac{1}{k^2}').evaluate().N().re).toBeCloseTo(
      Math.PI ** 2 / 6,
      12
    );
    const product = ce.parse('\\prod_k (1+\\frac{1}{k^2})');
    expect(product.evaluate().N().re).toBeCloseTo(product.N().re, 12);
    // At x = 0.3, Σ_{k≥1} x^k = x/(1 − x) = 3/7.
    const geometric = ce.parse('\\sum_k x^k').evaluate();
    expect(geometric.subs({ x: 0.3 }).N().re).toBeCloseTo(3 / 7, 12);
  });

  test('evaluateAsync() also reads the sum as over 1..+∞', async () => {
    const sum = await ce.parse('\\sum_k \\frac{1}{k^2}').evaluateAsync();
    expect(sum.toString()).toBe('pi^2 / 6');
    const product = await ce
      .parse('\\prod_k (1+\\frac{1}{k^2})')
      .evaluateAsync();
    expect(product.toString()).toBe('sinh(pi) / pi');
  });

  test('the derivative of a sum with no bounds is that of the sum over 1..+∞', () => {
    const d1 = ce.parse('\\frac{d}{dx}\\sum_k x^k').evaluate();
    expect(json(d1)).toBe(
      json(ce.parse('\\frac{d}{dx}\\sum_{k=1}^{\\infty} x^k').evaluate())
    );
    // d/dx x/(1 − x) = 1/(1 − x)²: 4 at x = 0.5.
    expect(d1.subs({ x: 0.5 }).N().re).toBeCloseTo(4, 12);
    const d2 = ce.parse('\\frac{d}{dx}\\sum_k y').evaluate();
    expect(json(d2)).toBe('0');
    // A closed form of the sum is differentiated: `Σ_{k≥1} x^k/k!` is
    // `e^x − 1`.
    const d3 = ce.parse('\\frac{d}{dx}\\sum_k \\frac{x^k}{k!}').evaluate();
    expect(d3.toString()).toBe('e^x');
  });

  test('a series of derivatives with no closed form is not used', () => {
    // `Σ_{k≥1} sin(kx)/k` converges (to (π − x)/2 on (0, 2π)), but the
    // series of derivatives `Σ_{k≥1} cos(kx)` does not. The derivative is
    // −1/2 there, so the term-by-term derivative would be wrong.
    for (const latex of [
      '\\frac{d}{dx}\\sum_k \\frac{\\sin(kx)}{k}',
      '\\frac{d}{dx}\\sum_{k=1}^{\\infty} \\frac{\\sin(kx)}{k}',
      '\\frac{d}{dx}\\sum_k \\frac{\\sin(kx)}{k^2}',
    ])
      expect(ce.parse(latex).evaluate().operator).toBe('D');
    // A finite range is still differentiated term by term.
    expect(
      ce.parse('\\frac{d}{dx}\\sum_{k=1}^{n} \\sin(kx)').evaluate().toString()
    ).toBe('sum_(k=1)^(n)(k * cos(k * x))');
  });

  test('a sum with one bound only still has no derivative', () => {
    const d = ce.parse('\\frac{d}{dx}\\sum_{k=1} x^k').evaluate();
    expect(d.operator).toBe('D');
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
