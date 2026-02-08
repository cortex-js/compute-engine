import type { BoxedExpression } from '../global-types';

import { isRelationalOperator } from '../latex-syntax/utils';
import { NumericValue } from '../numeric-value/types';

import { Product, commonTerms, mul } from './arithmetic-mul-div';
import { add } from './arithmetic-add';
import {
  polynomialDegree,
  getPolynomialCoefficients,
  fromCoefficients,
} from './polynomials';
import { asSmallInteger } from './numerics';

/** Combine rational expressions into a single fraction */
export function together(op: BoxedExpression): BoxedExpression {
  const ce = op.engine;
  const h = op.operator;

  // Thread over inequality
  if (isRelationalOperator(h)) return ce.function(h, op.ops!.map(together));

  if (h === 'Divide') return op.ops![0].div(op.ops![1]);

  if (h === 'Negate') return together(op.ops![0]).neg();

  if (h === 'Add') {
    const [numer, denom] = op.ops!.reduce(
      (acc, x) => {
        if (x.operator === 'Divide') {
          acc[0].push(x.ops![0]);
          acc[1].push(x.ops![1]);
        } else acc[0].push(x);
        return acc;
      },
      [[], []] as BoxedExpression[][]
    );
    return add(...numer).div(add(...denom));
  }

  return op;
}

/**
 * Detect if an expression is a perfect square trinomial.
 * Returns the factored form (a±b)² if successful, null otherwise.
 *
 * Patterns:
 * - a² + 2ab + b² → (a+b)²
 * - a² - 2ab + b² → (a-b)²
 *
 * Strategy: Try to extract square roots of each term to find the bases a and b,
 * then verify the middle term matches ±2ab.
 *
 * IMPORTANT: Does not call .simplify() to avoid infinite recursion.
 */
export function factorPerfectSquare(
  expr: BoxedExpression
): BoxedExpression | null {
  const ce = expr.engine;

  // Must be an Add expression
  if (expr.operator !== 'Add') return null;

  const terms = expr.ops!;

  // Perfect square trinomial must have exactly 3 terms
  if (terms.length !== 3) return null;

  // Try all permutations: any two terms could be the squares, the third is the cross term
  // For efficiency, we'll try to identify which terms look like squares
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;

      // Try terms[i] and terms[j] as the square terms, remaining as cross term
      const crossIdx = 3 - i - j; // The remaining index
      const term1 = terms[i];
      const term2 = terms[j];
      const crossTerm = terms[crossIdx];

      // Try to extract square roots of term1 and term2
      const sqrt1 = extractSquareRoot(term1, ce);
      const sqrt2 = extractSquareRoot(term2, ce);

      if (sqrt1 === null || sqrt2 === null) continue;

      // Check if cross term matches ±2*sqrt1*sqrt2
      const positiveCross = ce.number(2).mul(sqrt1).mul(sqrt2);
      const negativeCross = positiveCross.neg();

      if (crossTerm.isSame(positiveCross)) {
        // Pattern: sqrt1² + 2*sqrt1*sqrt2 + sqrt2² = (sqrt1+sqrt2)²
        return ce.box(['Square', sqrt1.add(sqrt2).json]);
      } else if (crossTerm.isSame(negativeCross)) {
        // Pattern: sqrt1² - 2*sqrt1*sqrt2 + sqrt2² = (sqrt1-sqrt2)²
        return ce.box(['Square', sqrt1.sub(sqrt2).json]);
      }
    }
  }

  return null;
}

/**
 * Helper function to extract the square root of a term if it's a perfect square.
 * Returns null if the term is not a perfect square.
 *
 * Examples:
 * - x² → x (or |x| if we can't determine sign)
 * - 4x² → 2|x|
 * - 9 → 3
 * - 8 → null (not a perfect square, would be √8)
 * - 2x → null (not a perfect square)
 *
 * IMPORTANT: This function calls .simplify() on the sqrt result to extract
 * the square root properly. This is safe because:
 * 1. We're only simplifying individual term square roots, not the whole expression
 * 2. The sqrt simplification doesn't call factoring on Add expressions
 * 3. We're not in a simplification loop yet - we're in the factoring phase
 */
function extractSquareRoot(
  term: BoxedExpression,
  ce: any
): BoxedExpression | null {
  // Try taking the square root and simplifying it
  // Using .simplify() here is safe - see comment above
  const sqrt = term.sqrt().simplify();

  // Check if it's a non-canonical Sqrt operator (shouldn't happen with canonical input)
  if (sqrt.operator === 'Sqrt') return null;

  // Check if it's a Number with a radical component (like √8)
  // These are represented as Number with numericValue.radical property
  if (sqrt.isNumberLiteral && sqrt.numericValue) {
    const nv = sqrt.numericValue as any;
    // If radical exists and is not 1, it's an irrational sqrt
    if (nv.radical !== undefined && nv.radical !== 1) return null;
  }

  // For expressions with Abs, extract the inner value since we're looking for
  // the algebraic base (we'll check signs separately)
  // e.g., 2|x| → 2x for matching purposes
  if (sqrt.operator === 'Abs') {
    return sqrt.op1;
  }

  // Handle Multiply(coefficient, Abs(...))
  if (sqrt.operator === 'Multiply') {
    const absFactors = sqrt.ops!.filter((op) => op.operator === 'Abs');
    if (absFactors.length > 0) {
      // Replace Abs with its inner value
      const newOps = sqrt.ops!.map((op) =>
        op.operator === 'Abs' ? op.op1! : op
      );
      return ce.box(['Multiply', ...newOps.map((op) => op.json)]);
    }
  }

  return sqrt;
}

/**
 * Detect if an expression is a difference of squares.
 * Returns the factored form (a-b)(a+b) if successful, null otherwise.
 *
 * Pattern: a² - b² → (a-b)(a+b)
 *
 * IMPORTANT: Does not call .simplify() on the result to avoid infinite recursion.
 */
export function factorDifferenceOfSquares(
  expr: BoxedExpression
): BoxedExpression | null {
  const ce = expr.engine;

  // Must be an Add expression with exactly 2 terms (one positive, one negative)
  if (expr.operator !== 'Add') return null;

  const terms = expr.ops!;
  if (terms.length !== 2) return null;

  // Try to extract square roots of both terms
  // One should be positive, one negative
  const results: Array<{
    sqrt: BoxedExpression;
    isNegative: boolean;
  }> = [];

  for (const term of terms) {
    // Check if term is negative
    let isNeg = term.operator === 'Negate';
    let absTerm = isNeg ? term.op1! : term;

    // Also handle negative numeric literals
    if (!isNeg && term.isNumberLiteral && term.isNegative === true) {
      isNeg = true;
      absTerm = term.neg(); // Get the absolute value
    }

    // Also handle negative terms from Multiply with negative coefficient
    if (!isNeg && term.operator === 'Multiply') {
      const ops = term.ops!;
      // Check if first operand is negative number
      if (ops[0].isNumberLiteral && ops[0].isNegative === true) {
        isNeg = true;
        // Create positive version by negating the coefficient
        const newOps = [ops[0].neg(), ...ops.slice(1)];
        absTerm = ce.box(['Multiply', ...newOps.map((op) => op.json)]);
      }
    }

    const sqrt = extractSquareRoot(absTerm, ce);
    if (sqrt === null) return null;

    results.push({ sqrt, isNegative: isNeg });
  }

  // We need exactly one positive and one negative square
  const posSquares = results.filter((r) => !r.isNegative);
  const negSquares = results.filter((r) => r.isNegative);

  if (posSquares.length !== 1 || negSquares.length !== 1) return null;

  const a = posSquares[0].sqrt;
  const b = negSquares[0].sqrt;

  // Pattern: a² - b² = (a-b)(a+b)
  return ce.box(['Multiply', a.sub(b).json, a.add(b).json]);
}

/**
 * Factor a quadratic polynomial using the quadratic formula.
 * Returns factored form if successful, null otherwise.
 *
 * For ax² + bx + c, finds roots r₁ and r₂ and returns:
 * - a(x - r₁)(x - r₂) if both roots are rational
 * - null if not a quadratic or roots are complex/irrational
 *
 * IMPORTANT: Does not call .simplify() to avoid infinite recursion.
 */
export function factorQuadratic(
  expr: BoxedExpression,
  variable: string
): BoxedExpression | null {
  const ce = expr.engine;

  // Check if it's a quadratic polynomial
  const degree = polynomialDegree(expr, variable);
  if (degree !== 2) return null;

  // Get coefficients [c, b, a] for ax² + bx + c
  const coeffs = getPolynomialCoefficients(expr, variable);
  if (!coeffs || coeffs.length < 3) return null;

  const c = coeffs[0];
  const b = coeffs[1];
  const a = coeffs[2];

  // Quick check: if a is zero, it's not really quadratic
  if (a.is(0)) return null;

  // Calculate discriminant: b² - 4ac
  const discriminant = b.pow(2).sub(ce.number(4).mul(a).mul(c));

  // Only factor if discriminant is a perfect square (rational roots)
  // Check if discriminant is non-negative
  if (discriminant.isNegative === true) return null;

  // Try to compute the square root
  const sqrtDisc = discriminant.sqrt();

  // Check if the square root is exact (rational or integer)
  // If sqrt produces a Sqrt expression, it's not exact
  if (sqrtDisc.operator === 'Sqrt') return null;

  // Check if it's a Number with a radical component (like √8)
  if (sqrtDisc.isNumberLiteral && sqrtDisc.numericValue) {
    const nv = sqrtDisc.numericValue as any;
    // If radical exists and is not 1, it's an irrational sqrt
    if (nv.radical !== undefined && nv.radical !== 1) return null;
  }

  // Additional check: verify both roots will be rational
  // The roots are (-b ± √discriminant) / 2a
  const twoA = ce.number(2).mul(a);
  const root1 = b.neg().add(sqrtDisc).div(twoA);
  const root2 = b.neg().sub(sqrtDisc).div(twoA);

  // Check if roots have radical components
  const checkRadical = (expr: BoxedExpression): boolean => {
    if (expr.operator === 'Sqrt') return true;
    if (expr.isNumberLiteral && expr.numericValue) {
      const nv = expr.numericValue as any;
      if (nv.radical !== undefined && nv.radical !== 1) return true;
    }
    // Check in subexpressions
    if (expr.ops) {
      for (const op of expr.ops) {
        if (checkRadical(op)) return true;
      }
    }
    return false;
  };

  if (checkRadical(root1) || checkRadical(root2)) return null;

  // Construct factored form: a(x - r₁)(x - r₂)
  const x = ce.symbol(variable);
  const factor1 = x.sub(root1);
  const factor2 = x.sub(root2);

  if (a.is(1)) {
    return ce.box(['Multiply', factor1.json, factor2.json]);
  } else {
    return ce.box(['Multiply', a.json, factor1.json, factor2.json]);
  }
}

/**
 * Factor a polynomial expression.
 * Attempts various factoring strategies:
 * 1. Perfect square trinomials
 * 2. Difference of squares
 * 3. Quadratic factoring (for rational roots)
 *
 * Falls back to the existing factor() function if polynomial factoring doesn't apply.
 *
 * IMPORTANT: Does not call .simplify() to avoid infinite recursion.
 */
export function factorPolynomial(
  expr: BoxedExpression,
  variable?: string
): BoxedExpression {
  // Try perfect square trinomial
  const perfectSquare = factorPerfectSquare(expr);
  if (perfectSquare !== null) return perfectSquare;

  // Try difference of squares
  const diffSquares = factorDifferenceOfSquares(expr);
  if (diffSquares !== null) return diffSquares;

  // Try quadratic factoring if variable is specified
  if (variable !== undefined) {
    const quadratic = factorQuadratic(expr, variable);
    if (quadratic !== null) return quadratic;
  }

  // Fall back to existing factor function (GCD-based)
  return factor(expr);
}

/**
 * Return an expression factored as a product.
 * - 2x + 4 -> 2(x + 2)
 * - 2x < 4 -> x < 2
 * - (2x) * (2y) -> 4xy
 */
export function factor(expr: BoxedExpression): BoxedExpression {
  const h = expr.operator;
  if (isRelationalOperator(h)) {
    let lhs = Product.from(expr.op1);
    let rhs = Product.from(expr.op2);
    const [coef, common] = commonTerms(lhs, rhs);

    let flip = coef.sgn() === -1;

    if (!coef.isOne) {
      lhs.div(coef);
      rhs.div(coef);
    }

    if (!common.is(1)) {
      // We have some symbolic factor in common ("x", etc...)
      if (common.isPositive) {
        lhs.div(common);
        rhs.div(common);
      } else if (common.isNegative) {
        lhs.div(common.neg());
        rhs.div(common.neg());
        flip = !flip;
      }
    }

    if (flip) [lhs, rhs] = [rhs, lhs];

    return expr.engine.function(h, [lhs.asExpression(), rhs.asExpression()]);
  }

  if (h === 'Negate') return factor(expr.ops![0]).neg();

  if (h === 'Add') {
    const ce = expr.engine;
    let common: NumericValue | undefined = undefined;

    // Calculate the GCD of all coefficients
    const terms: { coeff: NumericValue; term: BoxedExpression }[] = [];
    for (const op of expr.ops!) {
      const [coeff, term] = op.toNumericValue();
      common = common ? common.gcd(coeff) : coeff;
      if (!coeff.isZero) terms.push({ coeff, term });
    }

    if (!common || common.isOne) return expr;

    const newTerms = terms.map(({ coeff, term }) =>
      mul(term, ce.box(coeff.div(common)))
    );

    return mul(ce.number(common), add(...newTerms));
  }

  return Product.from(together(expr)).asExpression();
}
