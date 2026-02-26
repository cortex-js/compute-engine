import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';

import { isRelationalOperator } from '../latex-syntax/utils';
import { isNumber, isFunction, isSymbol } from './type-guards';
import { NumericValue } from '../numeric-value/types';

import { Product, commonTerms, mul } from './arithmetic-mul-div';
import { add } from './arithmetic-add';
import {
  polynomialDegree,
  getPolynomialCoefficients,
  polynomialDivide,
  fromCoefficients,
} from './polynomials';
import { asSmallInteger } from './numerics';
import { expand } from './expand';

function hasNonTrivialRadical(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    'radical' in value &&
    typeof value.radical === 'number' &&
    value.radical !== 1
  );
}

/** Combine rational expressions into a single fraction */
export function together(op: Expression): Expression {
  const ce = op.engine;
  const h = op.operator;

  // Thread over inequality
  if (isFunction(op)) {
    if (isRelationalOperator(h)) return ce.function(h, op.ops.map(together));

    if (h === 'Divide') return op.ops[0].div(op.ops[1]);

    if (h === 'Negate') return together(op.ops[0]).neg();

    if (h === 'Add') {
      const [numer, denom] = op.ops.reduce(
        (acc, x) => {
          if (isFunction(x, 'Divide')) {
            acc[0].push(x.ops[0]);
            acc[1].push(x.ops[1]);
          } else acc[0].push(x);
          return acc;
        },
        [[], []] as Expression[][]
      );
      return add(...numer).div(add(...denom));
    }
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
export function factorPerfectSquare(expr: Expression): Expression | null {
  const ce = expr.engine;

  // Must be an Add expression
  if (!isFunction(expr, 'Add')) return null;

  const terms = expr.ops;

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
  term: Expression,
  ce: ComputeEngine
): Expression | null {
  // Try taking the square root and simplifying it
  // Using .simplify() here is safe - see comment above
  const sqrt = term.sqrt().simplify();

  // Check if it's a non-canonical Sqrt operator (shouldn't happen with canonical input)
  if (sqrt.operator === 'Sqrt') return null;

  // Check if it's a Number with a radical component (like √8)
  // These are represented as Number with numericValue.radical property
  if (isNumber(sqrt)) {
    if (hasNonTrivialRadical(sqrt.numericValue)) return null;
  }

  // For expressions with Abs, extract the inner value since we're looking for
  // the algebraic base (we'll check signs separately)
  // e.g., 2|x| → 2x for matching purposes
  if (isFunction(sqrt, 'Abs')) return sqrt.op1;

  // Handle Multiply(coefficient, Abs(...))
  if (isFunction(sqrt, 'Multiply')) {
    const absFactors = sqrt.ops.filter((op) => op.operator === 'Abs');
    if (absFactors.length > 0) {
      // Replace Abs with its inner value
      const newOps = sqrt.ops.map((op) =>
        isFunction(op, 'Abs') ? op.op1 : op
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
export function factorDifferenceOfSquares(expr: Expression): Expression | null {
  const ce = expr.engine;

  // Must be an Add expression with exactly 2 terms (one positive, one negative)
  if (!isFunction(expr, 'Add')) return null;

  const terms = expr.ops;
  if (terms.length !== 2) return null;

  // Try to extract square roots of both terms
  // One should be positive, one negative
  const results: Array<{
    sqrt: Expression;
    isNegative: boolean;
  }> = [];

  for (const term of terms) {
    // Check if term is negative
    let isNeg = isFunction(term, 'Negate');
    let absTerm = isNeg && isFunction(term) ? term.op1 : term;

    // Also handle negative numeric literals
    if (!isNeg && isNumber(term) && term.isNegative === true) {
      isNeg = true;
      absTerm = term.neg(); // Get the absolute value
    }

    // Also handle negative terms from Multiply with negative coefficient
    if (!isNeg && isFunction(term, 'Multiply')) {
      const ops = term.ops;
      // Check if first operand is negative number
      if (isNumber(ops[0]) && ops[0].isNegative === true) {
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
  expr: Expression,
  variable: string
): Expression | null {
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
  if (a.isSame(0)) return null;

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
  if (isNumber(sqrtDisc)) {
    if (hasNonTrivialRadical(sqrtDisc.numericValue)) return null;
  }

  // Additional check: verify both roots will be rational
  // The roots are (-b ± √discriminant) / 2a
  const twoA = ce.number(2).mul(a);
  const root1 = b.neg().add(sqrtDisc).div(twoA);
  const root2 = b.neg().sub(sqrtDisc).div(twoA);

  // Check if roots have radical components
  const checkRadical = (expr: Expression): boolean => {
    if (expr.operator === 'Sqrt') return true;
    if (isNumber(expr)) {
      if (hasNonTrivialRadical(expr.numericValue)) return true;
    }
    // Check in subexpressions
    if (isFunction(expr)) {
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

  if (a.isSame(1)) {
    return ce.box(['Multiply', factor1.json, factor2.json]);
  } else {
    return ce.box(['Multiply', a.json, factor1.json, factor2.json]);
  }
}

/**
 * Factor a polynomial using the Rational Root Theorem.
 *
 * For a polynomial with integer coefficients, any rational root p/q must have
 * p dividing the constant term and q dividing the leading coefficient.
 *
 * Strategy: enumerate candidates, test, divide out roots, recurse.
 * Caps at 100 candidates to avoid pathological cases.
 *
 * IMPORTANT: Does not call .simplify() to avoid infinite recursion.
 */
export function factorByRationalRoots(
  expr: Expression,
  variable: string
): Expression | null {
  const ce = expr.engine;
  const coeffs = getPolynomialCoefficients(expr, variable);
  if (!coeffs) return null;

  const degree = coeffs.length - 1;
  if (degree < 2) return null;

  // Extract integer values for leading and constant coefficients
  const leadingInt = asSmallInteger(coeffs[degree]);
  const constantInt = asSmallInteger(coeffs[0]);
  if (leadingInt === null || constantInt === null) return null;
  if (leadingInt === 0 || constantInt === 0) return null;

  // Get divisors of a positive integer
  const divisors = (n: number): number[] => {
    n = Math.abs(n);
    const result: number[] = [];
    for (let i = 1; i * i <= n; i++) {
      if (n % i === 0) {
        result.push(i);
        if (i !== n / i) result.push(n / i);
      }
    }
    return result;
  };

  // Enumerate candidate rational roots ±p/q
  const pDivisors = divisors(constantInt);
  const qDivisors = divisors(leadingInt);
  const candidates: [number, number][] = [];
  const seen = new Set<number>();
  for (const p of pDivisors) {
    for (const q of qDivisors) {
      const pos = p / q;
      const neg = -p / q;
      if (!seen.has(pos)) {
        seen.add(pos);
        candidates.push([p, q]);
      }
      if (!seen.has(neg)) {
        seen.add(neg);
        candidates.push([-p, q]);
      }
    }
  }

  if (candidates.length > 100) return null;

  const x = ce.symbol(variable);
  const factors: Expression[] = [];
  let remaining = expr;

  for (const [p, q] of candidates) {
    // Check remaining degree
    const remDeg = polynomialDegree(remaining, variable);
    if (remDeg <= 0) break;

    const root = q === 1 ? ce.number(p) : ce.number(p).div(ce.number(q));
    // Evaluate the remaining polynomial at the candidate root
    const value = remaining.subs({ [variable]: root }).N();
    if (!value.isSame(0)) continue;

    // Root found — divide out (x - root)
    const linearFactor =
      q === 1 ? x.sub(ce.number(p)) : ce.number(q).mul(x).sub(ce.number(p));

    const divResult = polynomialDivide(remaining, linearFactor, variable);
    if (!divResult) continue;

    factors.push(linearFactor);
    remaining = divResult[0];
  }

  if (factors.length === 0) return null;

  // Try quadratic factoring on any remaining degree-2 polynomial
  const remDeg = polynomialDegree(remaining, variable);
  if (remDeg === 2) {
    const quadFactored = factorQuadratic(remaining, variable);
    if (quadFactored !== null) remaining = quadFactored;
  }

  factors.push(remaining);

  if (factors.length === 1) return factors[0];
  return ce.box(['Multiply', ...factors.map((f) => f.json)]);
}

/**
 * Extract the integer content (GCD of all integer coefficients) from a
 * polynomial, then recursively factor the primitive part.
 * Returns null if content is 1 or coefficients are not all integers.
 *
 * IMPORTANT: Does not call .simplify() to avoid infinite recursion.
 */
function extractContent(expr: Expression, variable: string): Expression | null {
  const ce = expr.engine;
  const coeffs = getPolynomialCoefficients(expr, variable);
  if (!coeffs) return null;

  // Extract integer values from all coefficients
  const intCoeffs: number[] = [];
  for (const c of coeffs) {
    const n = asSmallInteger(c);
    if (n === null) return null;
    intCoeffs.push(n);
  }

  // Compute GCD of all non-zero coefficients
  const gcd = (a: number, b: number): number => {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      [a, b] = [b, a % b];
    }
    return a;
  };

  let content = 0;
  for (const c of intCoeffs) {
    if (c !== 0) content = gcd(content, c);
  }

  if (content <= 1) return null;

  // Divide all coefficients by the content to get the primitive part
  const primitiveCoeffs = coeffs.map((c) => {
    const n = asSmallInteger(c)!;
    return ce.number(n / content);
  });

  // Reconstruct the primitive polynomial
  const primitive = fromCoefficients(primitiveCoeffs, variable);

  // Recursively factor the primitive part
  const factoredPrimitive = factorPolynomial(primitive, variable);

  return ce.number(content).mul(factoredPrimitive);
}

/**
 * Factor a polynomial expression.
 * Attempts various factoring strategies:
 * 1. Content extraction (GCD of integer coefficients)
 * 2. Perfect square trinomials
 * 3. Difference of squares
 * 4. Quadratic factoring (for rational roots)
 * 5. Rational root factoring (degree 3+)
 *
 * Falls back to the existing factor() function if polynomial factoring doesn't apply.
 *
 * IMPORTANT: Does not call .simplify() to avoid infinite recursion.
 */
export function factorPolynomial(
  expr: Expression,
  variable?: string
): Expression {
  // Try content extraction first (requires variable)
  if (variable !== undefined) {
    const contentFactored = extractContent(expr, variable);
    if (contentFactored !== null) return contentFactored;
  }

  // Try perfect square trinomial
  const perfectSquare = factorPerfectSquare(expr);
  if (perfectSquare !== null) return perfectSquare;

  // Try difference of squares
  const diffSquares = factorDifferenceOfSquares(expr);
  if (diffSquares !== null) return diffSquares;

  if (variable !== undefined) {
    // Try quadratic factoring
    const quadratic = factorQuadratic(expr, variable);
    if (quadratic !== null) return quadratic;

    // Try rational root factoring (degree 3+)
    const rationalRoot = factorByRationalRoots(expr, variable);
    if (rationalRoot !== null) return rationalRoot;
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
export function factor(expr: Expression): Expression {
  const h = expr.operator;
  if (isFunction(expr) && isRelationalOperator(h)) {
    let lhs = Product.from(expr.op1);
    let rhs = Product.from(expr.op2);
    const [coef, common] = commonTerms(lhs, rhs);

    let flip = coef.sgn() === -1;

    if (!coef.isOne) {
      lhs.div(coef);
      rhs.div(coef);
    }

    if (!common.isSame(1)) {
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

  if (isFunction(expr) && h === 'Negate') return factor(expr.ops[0]).neg();

  if (isFunction(expr) && h === 'Add') {
    const ce = expr.engine;
    let common: NumericValue | undefined = undefined;

    // Calculate the GCD of all coefficients
    const terms: { coeff: NumericValue; term: Expression }[] = [];
    for (const op of expr.ops) {
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

// ==================== PARTIAL FRACTION DECOMPOSITION ====================

/** Information about a factor of the denominator */
interface FactorInfo {
  factor: Expression;
  multiplicity: number;
  degree: number;
}

/**
 * Walk a Multiply/Power tree and collect factors that contain the variable.
 * Numeric constants are ignored since they don't contribute variable-containing factors.
 * Identical factors (by .isSame()) are merged with accumulated multiplicities.
 */
function collectFactors(expr: Expression, variable: string): FactorInfo[] {
  const rawFactors: FactorInfo[] = [];
  collectFactorsRaw(expr, variable, rawFactors);

  // Merge identical factors
  const merged: FactorInfo[] = [];
  for (const f of rawFactors) {
    let found = false;
    for (const m of merged) {
      if (m.factor.isSame(f.factor)) {
        m.multiplicity += f.multiplicity;
        found = true;
        break;
      }
    }
    if (!found) merged.push({ ...f });
  }

  return merged;
}

/** Recursively collect raw factors without merging */
function collectFactorsRaw(
  expr: Expression,
  variable: string,
  result: FactorInfo[]
): void {
  if (isFunction(expr, 'Multiply')) {
    for (const op of expr.ops) {
      collectFactorsRaw(op, variable, result);
    }
    return;
  }

  if (isFunction(expr, 'Power')) {
    const base = expr.op1;
    const exp = asSmallInteger(expr.op2);
    if (exp !== null && exp > 0 && base.has(variable)) {
      const deg = polynomialDegree(base, variable);
      result.push({ factor: base, multiplicity: exp, degree: deg });
      return;
    }
    // If the base doesn't contain the variable or exponent is not a positive integer,
    // treat as a numeric constant
    if (!expr.has(variable)) return;
    // Non-integer exponent with variable — shouldn't happen for polynomials
    const deg = polynomialDegree(expr, variable);
    result.push({ factor: expr, multiplicity: 1, degree: deg });
    return;
  }

  // Plain expression
  if (!expr.has(variable)) return; // Numeric constant
  if (isNumber(expr)) return;

  const deg = polynomialDegree(expr, variable);
  result.push({ factor: expr, multiplicity: 1, degree: deg });
}

/**
 * Solve a linear system using Gaussian elimination with integer arithmetic.
 * The matrix is an augmented matrix [A|b] with dimensions rows x (numVars+1).
 * Returns [numerator, denominator] pairs for each unknown, or null if inconsistent.
 *
 * IMPORTANT: Uses integer arithmetic throughout to avoid floating point issues.
 */
function solveLinearSystem(
  matrix: number[][],
  numVars: number
): [number, number][] | null {
  const rows = matrix.length;
  const cols = numVars + 1; // augmented

  // Clone the matrix to avoid mutation
  const m = matrix.map((row) => [...row]);

  const pivotRow: number[] = new Array(numVars).fill(-1);

  // Forward elimination
  let currentRow = 0;
  for (let col = 0; col < numVars && currentRow < rows; col++) {
    // Find pivot: largest absolute value in this column
    let maxVal = 0;
    let maxRow = -1;
    for (let row = currentRow; row < rows; row++) {
      const absVal = Math.abs(m[row][col]);
      if (absVal > maxVal) {
        maxVal = absVal;
        maxRow = row;
      }
    }

    if (maxVal === 0) continue; // Skip zero column

    // Swap rows
    if (maxRow !== currentRow) {
      [m[currentRow], m[maxRow]] = [m[maxRow], m[currentRow]];
    }

    pivotRow[col] = currentRow;

    // Eliminate below
    for (let row = 0; row < rows; row++) {
      if (row === currentRow) continue;
      if (m[row][col] === 0) continue;

      const factor = m[row][col];
      const pivotVal = m[currentRow][col];

      for (let j = 0; j < cols; j++) {
        m[row][j] = m[row][j] * pivotVal - factor * m[currentRow][j];
      }
    }

    currentRow++;
  }

  // Back substitution: extract solutions as [numerator, denominator]
  const solution: [number, number][] = new Array(numVars);
  for (let col = 0; col < numVars; col++) {
    const pr = pivotRow[col];
    if (pr === -1) {
      // Free variable — set to 0
      solution[col] = [0, 1];
      continue;
    }

    const num = m[pr][cols - 1];
    const den = m[pr][col];
    if (den === 0) return null; // Inconsistent

    // Reduce the fraction
    const g = gcd(Math.abs(num), Math.abs(den));
    const sign = den < 0 ? -1 : 1;
    solution[col] = [(sign * num) / g, (sign * den) / g];
  }

  return solution;
}

/** GCD of two non-negative integers */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1; // Avoid division by zero
}

/**
 * Decompose a rational expression into partial fractions.
 *
 * Given P(x)/Q(x), produces a sum of simpler fractions:
 *   polynomial_part + A₁/(factor₁) + A₂/(factor₁²) + ... + (Bx+C)/(quadratic) + ...
 *
 * Algorithm:
 * 1. If not a Divide or not polynomial, return unchanged.
 * 2. If improper (deg(numer) >= deg(denom)), perform polynomial division.
 * 3. Factor the denominator.
 * 4. Collect factors with multiplicities.
 * 5. Set up a linear system for the unknown coefficients.
 * 6. Solve via Gaussian elimination with integer arithmetic.
 * 7. Reconstruct the partial fraction sum.
 *
 * IMPORTANT: Does not call .simplify() to avoid infinite recursion
 * when called from the simplification pipeline.
 */
export function partialFraction(
  expr: Expression,
  variable: string
): Expression {
  const ce = expr.engine;

  // Step 1: Must be a Divide expression
  if (!isFunction(expr, 'Divide')) return expr;

  const numer = expr.op1;
  const denom = expr.op2;

  // Both must be polynomials in the variable
  const numerDeg = polynomialDegree(numer, variable);
  const denomDeg = polynomialDegree(denom, variable);
  if (numerDeg < 0 || denomDeg < 0) return expr;
  if (denomDeg === 0) return expr; // Denominator is a constant

  // Step 2: If improper fraction, do polynomial division
  let quotient: Expression | null = null;
  let remainder: Expression;

  if (numerDeg >= denomDeg) {
    const divResult = polynomialDivide(numer, denom, variable);
    if (!divResult) return expr;
    quotient = divResult[0];
    remainder = divResult[1];

    // Step 3: If remainder is zero, just return the quotient
    const remCoeffs = getPolynomialCoefficients(remainder, variable);
    if (remCoeffs && remCoeffs.every((c) => c.isSame(0))) {
      return quotient;
    }
  } else {
    remainder = numer;
  }

  // Step 4: Factor the denominator
  const factoredDenom = factorPolynomial(denom, variable);

  // Step 5: Collect factors with multiplicities
  const factors = collectFactors(factoredDenom, variable);

  // If no variable-containing factors found, return unchanged
  if (factors.length === 0) return expr;

  // If there's only one factor with multiplicity 1, it's already irreducible
  if (factors.length === 1 && factors[0].multiplicity === 1) {
    // Already irreducible — can't decompose further
    if (quotient) return quotient.add(remainder.div(denom));
    return expr;
  }

  // Check that all factor degrees are <= 2
  for (const f of factors) {
    if (f.degree > 2 || f.degree < 0) return expr;
  }

  // Verify that the sum of degree*multiplicity equals denomDeg
  let totalFactorDeg = 0;
  for (const f of factors) {
    totalFactorDeg += f.degree * f.multiplicity;
  }
  if (totalFactorDeg !== denomDeg) return expr;

  // Step 6: Set up template terms and the linear system
  // For each factor with multiplicity m:
  //   Linear (degree 1): A_k / factor^k for k=1..m
  //   Quadratic (degree 2): (A_k*x + B_k) / factor^k for k=1..m
  interface TemplateTerm {
    isLinear: boolean; // true if factor is linear (degree 1)
    factor: Expression;
    power: number; // k in factor^k
    unknownIndex: number; // index of A (and B for quadratic is unknownIndex+1)
  }

  const templateTerms: TemplateTerm[] = [];
  let unknownCount = 0;

  for (const f of factors) {
    for (let k = 1; k <= f.multiplicity; k++) {
      if (f.degree === 1) {
        templateTerms.push({
          isLinear: true,
          factor: f.factor,
          power: k,
          unknownIndex: unknownCount,
        });
        unknownCount++;
      } else {
        // degree === 2
        templateTerms.push({
          isLinear: false,
          factor: f.factor,
          power: k,
          unknownIndex: unknownCount,
        });
        unknownCount += 2; // A and B for (Ax+B)
      }
    }
  }

  // The number of unknowns must equal denomDeg
  if (unknownCount !== denomDeg) return expr;

  // Step 7: Build the coefficient matrix
  // For each template term, compute cofactor = expandedDenom / (factor^power)
  // Then multiply by the unknown pattern and collect coefficients

  // Get expanded denominator coefficients
  const expandedDenom = expand(denom);
  const denomCoeffs = getPolynomialCoefficients(expandedDenom, variable);
  if (!denomCoeffs) return expr;

  // Get remainder coefficients
  const expandedRemainder = expand(remainder);
  const remCoeffs = getPolynomialCoefficients(expandedRemainder, variable);
  if (!remCoeffs) return expr;

  // Build the augmented matrix: rows = denomDeg, cols = unknownCount + 1
  const systemRows = denomDeg;
  const augMatrix: number[][] = [];
  for (let i = 0; i < systemRows; i++) {
    augMatrix.push(new Array(unknownCount + 1).fill(0));
  }

  // Fill RHS with remainder coefficients (ascending order: [const, x, x², ...])
  for (let i = 0; i < systemRows; i++) {
    const coeff = i < remCoeffs.length ? asSmallInteger(remCoeffs[i]) : 0;
    if (coeff === null) return expr; // Non-integer coefficient — bail
    augMatrix[i][unknownCount] = coeff;
  }

  // For each template term, compute cofactor and fill columns
  for (const t of templateTerms) {
    // Compute the denominator of this template term: factor^power
    let termDenom: Expression;
    if (t.power === 1) {
      termDenom = t.factor;
    } else {
      termDenom = ce.box(['Power', t.factor.json, t.power]);
    }

    // Cofactor = expandedDenom / termDenom
    const cofactorResult = polynomialDivide(expandedDenom, termDenom, variable);
    if (!cofactorResult) return expr;

    const cofactor = cofactorResult[0];
    // Check remainder is zero
    const cofRem = cofactorResult[1];
    const cofRemCoeffs = getPolynomialCoefficients(cofRem, variable);
    if (!cofRemCoeffs || !cofRemCoeffs.every((c) => c.isSame(0))) return expr;

    // Get cofactor coefficients
    const expandedCofactor = expand(cofactor);
    const cofCoeffs = getPolynomialCoefficients(expandedCofactor, variable);
    if (!cofCoeffs) return expr;

    // Convert cofactor coefficients to integers
    const intCofCoeffs: number[] = [];
    for (let i = 0; i < systemRows; i++) {
      const c = i < cofCoeffs.length ? asSmallInteger(cofCoeffs[i]) : 0;
      if (c === null) return expr; // Non-integer — bail
      intCofCoeffs.push(c);
    }

    if (t.isLinear) {
      // Linear: A * cofactor
      // The coefficient of x^i from A*cofactor is A * cofCoeffs[i]
      for (let i = 0; i < systemRows; i++) {
        augMatrix[i][t.unknownIndex] += intCofCoeffs[i];
      }
    } else {
      // Quadratic: (A*x + B) * cofactor
      // B * cofactor contributes B * cofCoeffs[i] to row i
      // A * x * cofactor contributes A * cofCoeffs[i-1] to row i (shifted by 1)
      const aIdx = t.unknownIndex;
      const bIdx = t.unknownIndex + 1;
      for (let i = 0; i < systemRows; i++) {
        // B * cofactor[i]
        augMatrix[i][bIdx] += intCofCoeffs[i];
        // A * x * cofactor: coefficient of x^i is cofCoeffs[i-1]
        if (i > 0) {
          augMatrix[i][aIdx] += intCofCoeffs[i - 1];
        }
      }
    }
  }

  // Step 8: Solve the linear system
  const solution = solveLinearSystem(augMatrix, unknownCount);
  if (!solution) return expr;

  // Step 9: Reconstruct the partial fractions
  const x = ce.symbol(variable);
  const partialTerms: Expression[] = [];

  if (quotient) partialTerms.push(quotient);

  for (const t of templateTerms) {
    // Build the denominator of this term: factor^power
    let termDenom: Expression;
    if (t.power === 1) {
      termDenom = t.factor;
    } else {
      termDenom = ce.box(['Power', t.factor.json, t.power]);
    }

    // Build the numerator
    let termNumer: Expression;
    if (t.isLinear) {
      const [num, den] = solution[t.unknownIndex];
      if (num === 0) continue; // Skip zero terms
      termNumer =
        den === 1 ? ce.number(num) : ce.number(num).div(ce.number(den));
    } else {
      // Quadratic: A*x + B
      const [aNum, aDen] = solution[t.unknownIndex];
      const [bNum, bDen] = solution[t.unknownIndex + 1];
      if (aNum === 0 && bNum === 0) continue; // Skip zero terms

      const terms: Expression[] = [];
      if (aNum !== 0) {
        const aCoeff =
          aDen === 1 ? ce.number(aNum) : ce.number(aNum).div(ce.number(aDen));
        terms.push(aCoeff.mul(x));
      }
      if (bNum !== 0) {
        const bCoeff =
          bDen === 1 ? ce.number(bNum) : ce.number(bNum).div(ce.number(bDen));
        terms.push(bCoeff);
      }

      termNumer = terms.length === 1 ? terms[0] : add(...terms);
    }

    partialTerms.push(termNumer.div(termDenom));
  }

  if (partialTerms.length === 0) return ce.Zero;
  if (partialTerms.length === 1) return partialTerms[0];
  return add(...partialTerms);
}
