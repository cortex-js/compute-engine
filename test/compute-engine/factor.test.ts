import { BoxedExpression, ComputeEngine } from '../../src/compute-engine';
import {
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
} from '../../src/compute-engine/boxed-expression/factor';

const ce = new ComputeEngine();

function parse(latex: string): BoxedExpression {
  return ce.parse(latex);
}

describe('Perfect Square Trinomial Factoring', () => {
  test('x² + 2x + 1 → (x+1)²', () => {
    const expr = parse('x^2 + 2x + 1');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    // Canonical form is Power with exponent 2, not Square
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
    expect(factored?.op1?.latex).toBe('x+1');
  });

  test('x² - 2x + 1 → (x-1)²', () => {
    const expr = parse('x^2 - 2x + 1');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
    expect(factored?.op1?.latex).toBe('x-1');
  });

  test('a² + 2ab + b² → (a+b)²', () => {
    const expr = parse('a^2 + 2ab + b^2');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
    // Check that the base is a+b (order may vary)
    const base = factored?.op1;
    expect(base?.operator).toBe('Add');
  });

  test('a² - 2ab + b² → (a-b)²', () => {
    const expr = parse('a^2 - 2ab + b^2');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
  });

  test('4x² + 12x + 9 → (2x+3)²', () => {
    const expr = parse('4x^2 + 12x + 9');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
  });

  test('4x² - 12x + 9 → (2x-3)²', () => {
    const expr = parse('4x^2 - 12x + 9');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
  });

  test('non-perfect square returns null', () => {
    const expr = parse('x^2 + 3x + 1');
    const factored = factorPerfectSquare(expr);
    expect(factored).toBeNull();
  });

  test('not a trinomial returns null', () => {
    const expr = parse('x^2 + 2x + 1 + x');
    const factored = factorPerfectSquare(expr);
    expect(factored).toBeNull();
  });

  test('not an Add expression returns null', () => {
    const expr = parse('x^2');
    const factored = factorPerfectSquare(expr);
    expect(factored).toBeNull();
  });
});

describe('Difference of Squares Factoring', () => {
  test('x² - 4 → (x-2)(x+2)', () => {
    const expr = parse('x^2 - 4');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('x² - 1 → (x-1)(x+1)', () => {
    const expr = parse('x^2 - 1');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('a² - b² → (a-b)(a+b)', () => {
    const expr = parse('a^2 - b^2');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('4x² - 9 → (2x-3)(2x+3)', () => {
    const expr = parse('4x^2 - 9');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('sum of squares returns null', () => {
    const expr = parse('x^2 + 4');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).toBeNull();
  });

  test('not two terms returns null', () => {
    const expr = parse('x^2 - 4 + 1');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).toBeNull();
  });
});

describe('Quadratic Factoring', () => {
  test('x² + 5x + 6 → (x+2)(x+3)', () => {
    const expr = parse('x^2 + 5x + 6');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
    // The factored form should have 2 factors (both linear in x)
    expect(factored?.ops?.length).toBeGreaterThanOrEqual(2);
  });

  test('x² - 5x + 6 → (x-2)(x-3)', () => {
    const expr = parse('x^2 - 5x + 6');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('x² - 1 → (x-1)(x+1)', () => {
    const expr = parse('x^2 - 1');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('2x² - 8 → 2(x-2)(x+2)', () => {
    const expr = parse('2x^2 - 8');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
    // Should have 3 factors: 2, (x-2), (x+2)
    expect(factored?.ops?.length).toBeGreaterThanOrEqual(2);
  });

  test('irreducible quadratic returns null', () => {
    const expr = parse('x^2 + 1');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).toBeNull();
  });

  test('quadratic with irrational roots returns null', () => {
    const expr = parse('x^2 + 2x - 1');
    const factored = factorQuadratic(expr, 'x');
    // √8 is not rational, so this should return null
    expect(factored).toBeNull();
  });

  test('not a quadratic returns null', () => {
    const expr = parse('x^3 + 2x + 1');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).toBeNull();
  });

  test('linear expression returns null', () => {
    const expr = parse('2x + 3');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).toBeNull();
  });
});

describe('Polynomial Factoring (general)', () => {
  test('factors perfect square trinomial', () => {
    const expr = parse('x^2 + 2x + 1');
    const factored = factorPolynomial(expr);
    expect(factored.operator).toBe('Power');
    expect(factored.op2?.is(2)).toBe(true);
  });

  test('factors difference of squares', () => {
    const expr = parse('x^2 - 4');
    const factored = factorPolynomial(expr);
    expect(factored.operator).toBe('Multiply');
  });

  test('factors quadratic when variable specified', () => {
    const expr = parse('x^2 + 5x + 6');
    const factored = factorPolynomial(expr, 'x');
    expect(factored.operator).toBe('Multiply');
  });

  test('returns expression unchanged if no factoring applies', () => {
    const expr = parse('x + y + z');
    const factored = factorPolynomial(expr);
    // If no factoring pattern applies, returns the original expression
    expect(factored).toBeTruthy();
  });
});

describe('Integration with sqrt simplification', () => {
  test('sqrt(x² + 2x + 1) → |x+1|', () => {
    const expr = parse('\\sqrt{x^2 + 2x + 1}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });

  test('sqrt(x² - 2x + 1) → |x-1|', () => {
    const expr = parse('\\sqrt{x^2 - 2x + 1}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x-1');
  });

  test('sqrt(a² + 2ab + b²) → |a+b|', () => {
    const expr = parse('\\sqrt{a^2 + 2ab + b^2}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt(a² - 2ab + b²) → |a-b|', () => {
    const expr = parse('\\sqrt{a^2 - 2ab + b^2}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt(4x² + 12x + 9) → |2x+3|', () => {
    const expr = parse('\\sqrt{4x^2 + 12x + 9}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt(4x² - 12x + 9) → |2x-3|', () => {
    const expr = parse('\\sqrt{4x^2 - 12x + 9}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt of non-perfect square unchanged', () => {
    const expr = parse('\\sqrt{x^2 + 3x + 1}');
    const simplified = expr.simplify();
    // Should remain as sqrt since it's not a perfect square
    expect(simplified.operator).toBe('Sqrt');
  });

  test('already factored form works', () => {
    const expr = parse('\\sqrt{(x+1)^2}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });
});

describe('Issue #180 regression tests', () => {
  test('sqrt(x² + 2x + 1) simplifies correctly', () => {
    const expr = parse('\\sqrt{x^2+2x+1}');
    const simplified = expr.simplify();
    // LaTeX output may vary slightly - check for Abs operator instead
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });

  test('factored form still works', () => {
    const expr = parse('\\sqrt{(x+1)^2}');
    const simplified = expr.simplify();
    // Both \vert and \left| are acceptable LaTeX for absolute value
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });

  test('rational simplification with factoring', () => {
    const expr = parse('\\frac{x^2-1}{x-1}');
    const simplified = expr.simplify();
    // After factoring numerator to (x-1)(x+1), should cancel to x+1
    expect(simplified.latex).toBe('x+1');
  });
});
