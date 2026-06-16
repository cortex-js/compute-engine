import { engine, expressionError } from '../../utils';

function evaluate(expr: string): string {
  return engine.parse(expr).evaluate().toString();
}

describe('POLYNOMIALS', () => {
  test('Univariate', () => {
    expect(expressionError('6x+2+3x^5')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('6x+2+q+\\sqrt{2}x^3+c+3x^5')).toMatchInlineSnapshot(
      `[]`
    );
  });
  test('Multivariate', () => {
    expect(expressionError('y^4x^2+ 6x+2+3y^7x^5')).toMatchInlineSnapshot(`[]`);
  });
});

describe('POLYNOMIAL DEGREE', () => {
  test('constant', () =>
    expect(
      evaluate('\\operatorname{PolynomialDegree}(5, x)')
    ).toMatchInlineSnapshot(`0`));

  test('linear', () =>
    expect(
      evaluate('\\operatorname{PolynomialDegree}(3x + 1, x)')
    ).toMatchInlineSnapshot(`1`));

  test('quadratic', () =>
    expect(
      evaluate('\\operatorname{PolynomialDegree}(x^2 + 2x + 1, x)')
    ).toMatchInlineSnapshot(`2`));

  test('cubic', () =>
    expect(
      evaluate('\\operatorname{PolynomialDegree}(x^3 + 2x + 1, x)')
    ).toMatchInlineSnapshot(`3`));
});

describe('COEFFICIENT LIST', () => {
  test('linear', () =>
    expect(
      evaluate('\\operatorname{CoefficientList}(3x + 1, x)')
    ).toMatchInlineSnapshot(`[3,1]`));

  test('quadratic', () =>
    expect(
      evaluate('\\operatorname{CoefficientList}(x^2 + 2x + 1, x)')
    ).toMatchInlineSnapshot(`[1,2,1]`));

  test('cubic with missing term', () =>
    expect(
      evaluate('\\operatorname{CoefficientList}(x^3 + 2x + 1, x)')
    ).toMatchInlineSnapshot(`[1,0,2,1]`));
});

describe('POLYNOMIAL DIVISION', () => {
  test('quotient: x³ - 1 by x - 1', () =>
    expect(
      evaluate('\\operatorname{PolynomialQuotient}(x^3 - 1, x - 1, x)')
    ).toMatchInlineSnapshot(`x^2 + x + 1`));

  test('remainder: x³ - 1 by x - 1', () =>
    expect(
      evaluate('\\operatorname{PolynomialRemainder}(x^3 - 1, x - 1, x)')
    ).toMatchInlineSnapshot(`0`));

  test('quotient: x³ + 2x + 1 by x + 1', () =>
    expect(
      evaluate('\\operatorname{PolynomialQuotient}(x^3 + 2x + 1, x + 1, x)')
    ).toMatchInlineSnapshot(`x^2 - x + 3`));

  test('remainder: x³ + 2x + 1 by x + 1', () =>
    expect(
      evaluate('\\operatorname{PolynomialRemainder}(x^3 + 2x + 1, x + 1, x)')
    ).toMatchInlineSnapshot(`-2`));
});

describe('POLYNOMIAL GCD', () => {
  test('x² - 1 and x - 1', () =>
    expect(
      evaluate('\\operatorname{PolynomialGCD}(x^2 - 1, x - 1, x)')
    ).toMatchInlineSnapshot(`x - 1`));

  test('x³ - 1 and x² - 1', () =>
    expect(
      evaluate('\\operatorname{PolynomialGCD}(x^3 - 1, x^2 - 1, x)')
    ).toMatchInlineSnapshot(`x - 1`));

  test('x² + 3x + 2 and x + 1', () =>
    expect(
      evaluate('\\operatorname{PolynomialGCD}(x^2 + 3x + 2, x + 1, x)')
    ).toMatchInlineSnapshot(`x + 1`));
});

describe('RESULTANT', () => {
  test('common factor → 0 (x² - 1, x - 1)', () =>
    expect(
      evaluate('\\operatorname{Resultant}(x^2 - 1, x - 1, x)')
    ).toMatchInlineSnapshot(`0`));

  test('coprime linear factors (x - 2, x - 3)', () =>
    expect(
      evaluate('\\operatorname{Resultant}(x - 2, x - 3, x)')
    ).toMatchInlineSnapshot(`-1`));

  test('x² + 1 and x² - 1 → 4', () =>
    expect(
      evaluate('\\operatorname{Resultant}(x^2 + 1, x^2 - 1, x)')
    ).toMatchInlineSnapshot(`4`));

  test('against a constant: Res(x² + 1, 7) → 7² = 49', () =>
    expect(
      evaluate('\\operatorname{Resultant}(x^2 + 1, 7, x)')
    ).toMatchInlineSnapshot(`49`));

  test('two constants → 1', () =>
    expect(
      evaluate('\\operatorname{Resultant}(5, 3, x)')
    ).toMatchInlineSnapshot(`1`));

  test('Wester: shared (x + 1) factor → 0', () =>
    expect(
      evaluate(
        '\\operatorname{Resultant}(3x^4 + 3x^3 + x^2 - x - 2, x^3 - 3x^2 + x + 5, x)'
      )
    ).toMatchInlineSnapshot(`0`));

  test('symbolic coefficients: Res(x² + a, x + b) → a + b²', () =>
    expect(
      evaluate('\\operatorname{Resultant}(x^2 + a, x + b, x)')
    ).toMatchInlineSnapshot(`b^2 + a`));

  test('swap carries the (-1)^(mn) sign for odd m·n', () => {
    // Res(x³ - 2, x - 1) = (x³-2 at x=1) = -1 ... times (-1)^3 = 1
    expect(
      evaluate('\\operatorname{Resultant}(x^3 - 2, x - 1, x)')
    ).toMatchInlineSnapshot(`1`);
    // Reversing the arguments flips the sign (m·n = 3 is odd).
    expect(
      evaluate('\\operatorname{Resultant}(x - 1, x^3 - 2, x)')
    ).toMatchInlineSnapshot(`-1`);
  });

  test('multiplicativity: Res(A·B, C) = Res(A,C)·Res(B,C)', () => {
    const A = 'x^2 + 1';
    const B = 'x - 3';
    const C = '2x^2 - x + 4';
    const lhs = engine
      .expr([
        'Resultant',
        engine.parse(`(${A})(${B})`).evaluate(),
        engine.parse(C),
        'x',
      ])
      .evaluate();
    const rhs = engine
      .expr(['Resultant', engine.parse(A), engine.parse(C), 'x'])
      .evaluate()
      .mul(
        engine.expr(['Resultant', engine.parse(B), engine.parse(C), 'x']).evaluate()
      );
    expect(lhs.isSame(rhs)).toBe(true);
  });

  test('non-polynomial argument stays unevaluated', () => {
    const result = engine
      .parse('\\operatorname{Resultant}(\\sin x, x - 1, x)')
      .evaluate();
    expect(result.toString()).toContain('Resultant');
  });
});

describe('CANCEL COMMON FACTORS', () => {
  test('(x² - 1)/(x - 1)', () =>
    expect(
      evaluate('\\operatorname{Cancel}(\\frac{x^2 - 1}{x - 1}, x)')
    ).toMatchInlineSnapshot(`x + 1`));

  test('(x + 1)/(x² + 3x + 2)', () =>
    expect(
      evaluate('\\operatorname{Cancel}(\\frac{x + 1}{x^2 + 3x + 2}, x)')
    ).toMatchInlineSnapshot(`1 / (x + 2)`));

  test('(x³ - x)/(x² - 1)', () =>
    expect(
      evaluate('\\operatorname{Cancel}(\\frac{x^3 - x}{x^2 - 1}, x)')
    ).toMatchInlineSnapshot(`x`));
});

describe('POLYNOMIAL CONSTRUCTOR', () => {
  test('cubic from coefficients', () =>
    expect(
      evaluate('\\operatorname{Polynomial}([1, 0, 2, 1], x)')
    ).toMatchInlineSnapshot(`x^3 + 2x + 1`));

  test('quadratic from coefficients', () =>
    expect(
      evaluate('\\operatorname{Polynomial}([3, -1, 5], x)')
    ).toMatchInlineSnapshot(`3x^2 - x + 5`));

  test('constant polynomial', () =>
    expect(
      evaluate('\\operatorname{Polynomial}([7], x)')
    ).toMatchInlineSnapshot(`7`));

  test('linear polynomial', () =>
    expect(
      evaluate('\\operatorname{Polynomial}([2, 3], x)')
    ).toMatchInlineSnapshot(`2x + 3`));

  test('round-trip with CoefficientList', () => {
    const expr = engine.parse('x^3 + 2x + 1');
    const coeffs = expr.polynomialCoefficients('x');
    const reconstructed = engine
      .expr(['Polynomial', ['List', ...coeffs!.map((c) => c.json)], 'x'])
      .evaluate();
    expect(reconstructed.isSame(expr)).toBe(true);
  });
});

describe('DISCRIMINANT', () => {
  test('quadratic x² + 2x + 1 (perfect square)', () =>
    expect(
      evaluate('\\operatorname{Discriminant}(x^2 + 2x + 1, x)')
    ).toMatchInlineSnapshot(`0`));

  test('quadratic x² - 5x + 6 (two roots)', () =>
    expect(
      evaluate('\\operatorname{Discriminant}(x^2 - 5x + 6, x)')
    ).toMatchInlineSnapshot(`1`));

  test('quadratic x² + 1 (no real roots)', () =>
    expect(
      evaluate('\\operatorname{Discriminant}(x^2 + 1, x)')
    ).toMatchInlineSnapshot(`-4`));

  test('quadratic 2x² + 3x - 2', () =>
    expect(
      evaluate('\\operatorname{Discriminant}(2x^2 + 3x - 2, x)')
    ).toMatchInlineSnapshot(`25`));

  test('cubic x³ - 6x² + 11x - 6 (three distinct roots)', () => {
    // (x-1)(x-2)(x-3), discriminant = 4
    const result = engine.parse(
      '\\operatorname{Discriminant}(x^3 - 6x^2 + 11x - 6, x)'
    ).evaluate();
    expect(result.re).toBe(4);
  });

  test('cubic x³ - 3x + 2 (repeated root)', () =>
    expect(
      evaluate('\\operatorname{Discriminant}(x^3 - 3x + 2, x)')
    ).toMatchInlineSnapshot(`0`));

  test('linear returns undefined', () => {
    const result = engine.parse(
      '\\operatorname{Discriminant}(2x + 1, x)'
    ).evaluate();
    expect(result.toString()).toContain('Discriminant');
  });
});
