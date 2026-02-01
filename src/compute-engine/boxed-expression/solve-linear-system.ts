import type { BoxedExpression, ComputeEngine } from '../global-types';
import { polynomialDegree } from './polynomials';
import { findUnivariateRoots } from './solve';

/**
 * Check if an expression is linear in the given variables.
 * Returns false if any term contains a product of multiple variables (e.g., xy).
 *
 * For example:
 * - `x + 2y + 3` → true (linear)
 * - `x*y + 1` → false (contains product of variables)
 * - `x^2 + 1` → false (quadratic, but caught by polynomialDegree check)
 */
function isLinearInVariables(
  expr: BoxedExpression,
  variables: string[]
): boolean {
  // Count how many of the given variables appear in the expression
  const countVariables = (e: BoxedExpression): number => {
    let count = 0;
    for (const v of variables) {
      if (e.symbol === v) return 1;
      if (e.has(v)) count++;
    }
    return count;
  };

  // Check each term
  const checkTerm = (term: BoxedExpression): boolean => {
    // If the term doesn't contain any variable, it's fine (constant)
    const varCount = countVariables(term);
    if (varCount === 0) return true;

    // If it's just a symbol that's one of our variables, it's linear
    if (term.symbol && variables.includes(term.symbol)) return true;

    // Handle Multiply: each variable should appear in at most one factor
    if (term.operator === 'Multiply') {
      let varFactorCount = 0;
      for (const factor of term.ops!) {
        if (countVariables(factor) > 0) {
          varFactorCount++;
          // If this factor contains multiple variables, it's not linear
          if (countVariables(factor) > 1) return false;
          // If the factor is not just a symbol (e.g., x^2), check if it's linear
          if (!factor.symbol && factor.has(variables[0])) {
            // Check if any variable in the factor has degree > 1
            for (const v of variables) {
              if (factor.has(v) && polynomialDegree(factor, v) > 1) return false;
            }
          }
        }
      }
      // If more than one factor contains variables, it's a product like xy
      return varFactorCount <= 1;
    }

    // Handle Add: each term should be linear
    if (term.operator === 'Add') {
      return term.ops!.every((t) => checkTerm(t));
    }

    // Handle Negate
    if (term.operator === 'Negate') {
      return checkTerm(term.op1);
    }

    // Handle Subtract
    if (term.operator === 'Subtract') {
      return checkTerm(term.op1) && checkTerm(term.op2);
    }

    // For other operators, if it contains more than one variable, likely not linear
    return varCount <= 1;
  };

  return checkTerm(expr);
}

/**
 * Solve a system of linear equations.
 *
 * @param equations - Array of BoxedExpression representing equations (Equal expressions)
 * @param variables - Array of variable names to solve for
 * @returns Object mapping variable names to their solutions, or null if unsolvable
 *
 * @example
 * ```typescript
 * const e = ce.parse('\\begin{cases}x+y=70\\\\2x-4y=80\\end{cases}');
 * const result = e.solve(['x', 'y']);
 * // result = { x: BoxedExpression(60), y: BoxedExpression(10) }
 * ```
 */
export function solveLinearSystem(
  equations: BoxedExpression[],
  variables: string[]
): Record<string, BoxedExpression> | null {
  if (equations.length === 0 || variables.length === 0) return null;

  const ce = equations[0].engine;
  const n = variables.length;
  const m = equations.length;

  // Need at least as many equations as variables for a unique solution
  if (m < n) return null;

  // Build augmented matrix [A|b] where Ax = b
  const matrix = buildAugmentedMatrix(equations, variables, ce);
  if (!matrix) return null;

  const { A, b } = matrix;

  // Solve using Gaussian elimination with partial pivoting
  const solutions = gaussianElimination(A, b, n, ce);
  if (!solutions) return null;

  // Build result object
  const result: Record<string, BoxedExpression> = {};
  for (let i = 0; i < n; i++) {
    result[variables[i]] = solutions[i].simplify();
  }

  return result;
}

/**
 * Extract linear coefficients from an equation for given variables.
 * Returns null if the equation is not linear in the variables.
 *
 * For equation: 2x - 4y = 80 (represented as Equal(Add(2x, -4y), 80))
 * With variables ['x', 'y'], returns:
 * { coefficients: [2, -4], constant: -80 }
 *
 * The equation is normalized to form: a1*x1 + a2*x2 + ... + an*xn - c = 0
 * where c is the constant on the RHS
 */
function extractLinearCoefficients(
  equation: BoxedExpression,
  variables: string[]
): { coefficients: BoxedExpression[]; constant: BoxedExpression } | null {
  const ce = equation.engine;

  // Handle Equal(lhs, rhs) -> lhs - rhs = 0
  let expr: BoxedExpression;
  if (equation.operator === 'Equal') {
    const lhs = equation.op1;
    const rhs = equation.op2;
    expr = lhs.sub(rhs).expand();
  } else {
    // Assume equation = 0
    expr = equation.expand();
  }

  // Check that all variables appear with degree at most 1 (linear)
  for (const v of variables) {
    const deg = polynomialDegree(expr, v);
    if (deg < 0 || deg > 1) return null; // Not a polynomial or degree > 1
  }

  // Check that no term contains a product of multiple variables (e.g., xy)
  // This catches cases like xy = 6 which has degree 1 in x and y individually
  // but is not a linear equation in the system
  if (!isLinearInVariables(expr, variables)) return null;

  // Extract coefficient for each variable
  const coefficients: BoxedExpression[] = [];
  for (const v of variables) {
    const coef = extractCoefficient(expr, v, ce);
    if (coef === null) return null;
    coefficients.push(coef);
  }

  // Extract constant term (terms not containing any variable)
  const constant = extractConstantTerm(expr, variables, ce).neg();

  return { coefficients, constant };
}

/**
 * Extract the coefficient of a single variable from a linear expression.
 * For 2x + 3y + 5, extractCoefficient(expr, 'x') returns 2.
 */
function extractCoefficient(
  expr: BoxedExpression,
  variable: string,
  ce: ComputeEngine
): BoxedExpression | null {
  // If the expression doesn't contain the variable, coefficient is 0
  if (!expr.has(variable)) return ce.Zero;

  // If it's just the variable, coefficient is 1
  if (expr.symbol === variable) return ce.One;

  // Handle Negate
  if (expr.operator === 'Negate') {
    const inner = extractCoefficient(expr.op1, variable, ce);
    return inner?.neg() ?? null;
  }

  // Handle Multiply: look for variable * coefficient
  if (expr.operator === 'Multiply') {
    const ops = expr.ops!;
    let coef: BoxedExpression = ce.One;
    let foundVar = false;

    for (const op of ops) {
      if (op.symbol === variable) {
        if (foundVar) return null; // Variable appears twice (non-linear)
        foundVar = true;
      } else if (op.has(variable)) {
        return null; // Variable in complex subexpression
      } else {
        coef = coef.mul(op);
      }
    }

    return foundVar ? coef : ce.Zero;
  }

  // Handle Add: sum the coefficients from each term
  if (expr.operator === 'Add') {
    let totalCoef: BoxedExpression = ce.Zero;
    for (const term of expr.ops!) {
      const termCoef = extractCoefficient(term, variable, ce);
      if (termCoef === null) return null;
      totalCoef = totalCoef.add(termCoef);
    }
    return totalCoef;
  }

  // Handle Subtract
  if (expr.operator === 'Subtract') {
    const leftCoef = extractCoefficient(expr.op1, variable, ce);
    const rightCoef = extractCoefficient(expr.op2, variable, ce);
    if (leftCoef === null || rightCoef === null) return null;
    return leftCoef.sub(rightCoef);
  }

  // For Power, Divide, etc., check if it contains the variable
  if (expr.has(variable)) {
    // If it contains the variable in a non-linear way, fail
    return null;
  }

  return ce.Zero;
}

/**
 * Extract the constant term (terms not containing any of the variables).
 */
function extractConstantTerm(
  expr: BoxedExpression,
  variables: string[],
  ce: ComputeEngine
): BoxedExpression {
  // Check if expression contains any variable
  const hasAnyVar = variables.some((v) => expr.has(v));
  if (!hasAnyVar) return expr;

  // Handle Add: collect constant terms
  if (expr.operator === 'Add') {
    let constant: BoxedExpression = ce.Zero;
    for (const term of expr.ops!) {
      const termHasVar = variables.some((v) => term.has(v));
      if (!termHasVar) {
        constant = constant.add(term);
      }
    }
    return constant;
  }

  // Handle Negate
  if (expr.operator === 'Negate') {
    return extractConstantTerm(expr.op1, variables, ce).neg();
  }

  // Handle Subtract
  if (expr.operator === 'Subtract') {
    const leftConst = extractConstantTerm(expr.op1, variables, ce);
    const rightConst = extractConstantTerm(expr.op2, variables, ce);
    return leftConst.sub(rightConst);
  }

  // If the expression contains variables but is not Add/Subtract, constant is 0
  return ce.Zero;
}

/**
 * Build the augmented matrix [A|b] from a system of linear equations.
 */
function buildAugmentedMatrix(
  equations: BoxedExpression[],
  variables: string[],
  ce: ComputeEngine
): { A: BoxedExpression[][]; b: BoxedExpression[] } | null {
  const m = equations.length;
  const n = variables.length;

  const A: BoxedExpression[][] = [];
  const b: BoxedExpression[] = [];

  for (let i = 0; i < m; i++) {
    const result = extractLinearCoefficients(equations[i], variables);
    if (!result) return null;

    A.push(result.coefficients);
    b.push(result.constant);
  }

  return { A, b };
}

/**
 * Solve Ax = b using Gaussian elimination with partial pivoting.
 * Returns the solution vector or null if no unique solution exists.
 *
 * Uses exact rational arithmetic when possible, preserving fractions
 * throughout the computation for exact results.
 */
function gaussianElimination(
  A: BoxedExpression[][],
  b: BoxedExpression[],
  n: number,
  ce: ComputeEngine
): BoxedExpression[] | null {
  const m = A.length;

  // Create augmented matrix [A|b]
  const aug: BoxedExpression[][] = [];
  for (let i = 0; i < m; i++) {
    aug.push([...A[i], b[i]]);
  }

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot row (row with largest absolute value in current column)
    // Use symbolic comparison for exact arithmetic
    let maxRow = col;

    for (let row = col + 1; row < m; row++) {
      const cmp = compareAbsoluteValues(aug[row]?.[col], aug[maxRow]?.[col]);
      if (cmp === 1) {
        // |aug[row][col]| > |aug[maxRow][col]|
        maxRow = row;
      }
    }

    // Check for zero pivot (singular matrix or no unique solution)
    if (isEffectivelyZero(aug[maxRow]?.[col])) {
      return null; // Singular matrix - no unique solution
    }

    // Swap rows if needed
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    const pivot = aug[col][col];

    // Eliminate below
    // The division and multiplication preserve exact rationals
    for (let row = col + 1; row < m; row++) {
      const factor = aug[row][col].div(pivot);
      aug[row][col] = ce.Zero;

      for (let j = col + 1; j <= n; j++) {
        aug[row][j] = aug[row][j].sub(factor.mul(aug[col][j]));
      }
    }
  }

  // Check for inconsistency (non-zero in last column of zero rows)
  for (let row = n; row < m; row++) {
    const lastCol = aug[row][n];
    if (!isEffectivelyZero(lastCol)) {
      // Check if all coefficients in this row are zero
      let allZero = true;
      for (let col = 0; col < n; col++) {
        if (!isEffectivelyZero(aug[row][col])) {
          allZero = false;
          break;
        }
      }
      if (allZero) {
        return null; // Inconsistent system
      }
    }
  }

  // Back substitution
  // Division preserves exact rationals when possible
  const solution: BoxedExpression[] = new Array(n);

  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n]; // RHS
    for (let j = i + 1; j < n; j++) {
      sum = sum.sub(aug[i][j].mul(solution[j]));
    }
    solution[i] = sum.div(aug[i][i]);
  }

  return solution;
}

/**
 * Compare the absolute values of two BoxedExpressions.
 * Returns:
 *   1 if |a| > |b|
 *   0 if |a| = |b|
 *  -1 if |a| < |b|
 *  undefined if comparison is indeterminate
 *
 * Uses symbolic comparison when possible, falling back to numeric.
 */
function compareAbsoluteValues(
  a: BoxedExpression | undefined,
  b: BoxedExpression | undefined
): 1 | 0 | -1 | undefined {
  if (!a || !b) return undefined;

  // Get absolute values
  const absA = a.abs();
  const absB = b.abs();

  // Try symbolic comparison first
  // For purely numeric expressions, this should work exactly
  const aNum = absA.numericValue;
  const bNum = absB.numericValue;

  // If both are numeric values (not expressions), compare them exactly
  if (aNum !== null && bNum !== null) {
    // Handle machine numbers
    if (typeof aNum === 'number' && typeof bNum === 'number') {
      if (aNum === bNum) return 0;
      return aNum > bNum ? 1 : -1;
    }

    // Handle NumericValue objects (exact rationals, etc.)
    if (typeof aNum === 'object' && 're' in aNum) {
      const aRe = aNum.re;
      const bRe = typeof bNum === 'number' ? bNum : (bNum as any).re;
      if (aRe === bRe) return 0;
      return aRe > bRe ? 1 : -1;
    }

    if (typeof bNum === 'object' && 're' in bNum) {
      const aRe = typeof aNum === 'number' ? aNum : (aNum as any).re;
      const bRe = bNum.re;
      if (aRe === bRe) return 0;
      return aRe > bRe ? 1 : -1;
    }
  }

  // Fallback: evaluate numerically
  const aVal = absA.N().numericValue;
  const bVal = absB.N().numericValue;

  if (aVal === null || bVal === null) return undefined;

  const aReal = typeof aVal === 'number' ? aVal : (aVal as any).re ?? aVal;
  const bReal = typeof bVal === 'number' ? bVal : (bVal as any).re ?? bVal;

  if (typeof aReal !== 'number' || typeof bReal !== 'number') return undefined;
  if (isNaN(aReal) || isNaN(bReal)) return undefined;

  if (aReal === bReal) return 0;
  return aReal > bReal ? 1 : -1;
}

/**
 * Check if a BoxedExpression is zero (or effectively zero).
 * Uses symbolic check first, then numeric fallback with tolerance.
 */
function isEffectivelyZero(expr: BoxedExpression | undefined): boolean {
  if (!expr) return true;

  // Try symbolic zero check first
  if (expr.is(0)) return true;

  // Check if the expression simplifies to zero
  const simplified = expr.simplify();
  if (simplified.is(0)) return true;

  // Fallback: check numeric value with small tolerance
  const numVal = expr.N().numericValue;
  if (numVal === null) return false;

  const re = typeof numVal === 'number' ? numVal : (numVal as any).re;
  if (typeof re === 'number' && Math.abs(re) < 1e-14) return true;

  return false;
}

/**
 * Solve a system of polynomial equations that may be non-linear.
 * Currently supports:
 * 1. Product + sum pattern: xy = p, x + y = s (2 equations, 2 variables)
 * 2. Substitution-reducible: one equation is linear in one variable
 *
 * @param equations - Array of BoxedExpression representing equations (Equal expressions)
 * @param variables - Array of variable names to solve for
 * @returns Array of solution objects, or null if unsolvable
 *
 * @example
 * ```typescript
 * // Product + sum pattern
 * const e = ce.parse('\\begin{cases}xy=6\\\\x+y=5\\end{cases}');
 * const result = e.solve(['x', 'y']);
 * // result = [{ x: 2, y: 3 }, { x: 3, y: 2 }]
 * ```
 */
export function solvePolynomialSystem(
  equations: BoxedExpression[],
  variables: string[]
): Array<Record<string, BoxedExpression>> | null {
  if (equations.length !== 2 || variables.length !== 2) return null;

  const ce = equations[0].engine;
  const [x, y] = variables;

  // Normalize equations to lhs - rhs = 0 form
  const normalized = equations.map((eq) => {
    if (eq.operator === 'Equal') {
      return eq.op1.sub(eq.op2).expand().simplify();
    }
    return eq.expand().simplify();
  });

  // Try product + sum pattern first
  const productSumResult = tryProductSumPattern(normalized, x, y, ce);
  if (productSumResult) return productSumResult;

  // Try substitution method
  const substitutionResult = trySubstitutionMethod(normalized, x, y, ce);
  if (substitutionResult) return substitutionResult;

  return null;
}

/**
 * Try to solve using the product + sum pattern.
 * Pattern: xy = p, x + y = s
 * Solution: x and y are roots of t² - st + p = 0
 */
function tryProductSumPattern(
  equations: BoxedExpression[],
  x: string,
  y: string,
  ce: ComputeEngine
): Array<Record<string, BoxedExpression>> | null {
  let productEq: BoxedExpression | null = null;
  let sumEq: BoxedExpression | null = null;
  let product: BoxedExpression | null = null;
  let sum: BoxedExpression | null = null;

  for (const eq of equations) {
    // Check if this is a product equation: xy - p = 0 or p - xy = 0
    const productInfo = extractProductEquation(eq, x, y, ce);
    if (productInfo) {
      productEq = eq;
      product = productInfo.product;
      continue;
    }

    // Check if this is a sum equation: x + y - s = 0 or s - x - y = 0
    const sumInfo = extractSumEquation(eq, x, y, ce);
    if (sumInfo) {
      sumEq = eq;
      sum = sumInfo.sum;
      continue;
    }
  }

  if (!productEq || !sumEq || !product || !sum) return null;

  // Now solve: x and y are roots of t² - s*t + p = 0
  // Construct the quadratic: t² - sum*t + product = 0
  const t = '_t';
  const quadratic = ce
    .box([
      'Add',
      ['Square', t],
      ['Negate', ['Multiply', sum, t]],
      product,
    ])
    .simplify();

  const roots = findUnivariateRoots(quadratic, t);
  if (roots.length === 0) return null;

  // Filter to only real roots (exclude complex numbers)
  const realRoots = filterRealRoots(roots);
  if (realRoots.length === 0) return null;

  // Build solution pairs
  const solutions: Array<Record<string, BoxedExpression>> = [];

  if (realRoots.length === 1) {
    // Double root - both x and y have the same value
    const val = realRoots[0].simplify();
    solutions.push({ [x]: val, [y]: val });
  } else if (realRoots.length >= 2) {
    // Two distinct roots - return both orderings
    const r1 = realRoots[0].simplify();
    const r2 = realRoots[1].simplify();
    solutions.push({ [x]: r1, [y]: r2 });
    // Only add second solution if roots are different
    if (!r1.isSame(r2)) {
      solutions.push({ [x]: r2, [y]: r1 });
    }
  }

  return solutions.length > 0 ? solutions : null;
}

/**
 * Extract product equation of the form xy = p.
 * Returns the product value p, or null if not a product equation.
 */
function extractProductEquation(
  eq: BoxedExpression,
  x: string,
  y: string,
  ce: ComputeEngine
): { product: BoxedExpression } | null {
  // eq is in the form: lhs - rhs = 0 (already expanded)
  // We're looking for: xy - p = 0 or c*xy - p = 0

  // Check if the equation contains both variables
  if (!eq.has(x) || !eq.has(y)) return null;

  // Check if it's a simple product: should have total degree 2 (degree 1 in each var)
  const degX = polynomialDegree(eq, x);
  const degY = polynomialDegree(eq, y);
  if (degX !== 1 || degY !== 1) return null;

  // Extract the coefficient of xy term and the constant term
  const xyCoef = extractXYCoefficient(eq, x, y, ce);
  if (!xyCoef || xyCoef.coef.is(0)) return null;

  // The equation is: coef * xy + constant = 0
  // So: xy = -constant / coef
  // Product p = -constant / coef
  const product = xyCoef.constant.neg().div(xyCoef.coef).simplify();

  return { product };
}

/**
 * Extract coefficient of xy term and constant from an expression.
 */
function extractXYCoefficient(
  expr: BoxedExpression,
  x: string,
  y: string,
  ce: ComputeEngine
): { coef: BoxedExpression; constant: BoxedExpression } | null {
  let xyCoef: BoxedExpression = ce.Zero;
  let constant: BoxedExpression = ce.Zero;

  // Handle Add
  if (expr.operator === 'Add') {
    for (const term of expr.ops!) {
      const termResult = extractXYCoefficientFromTerm(term, x, y, ce);
      if (termResult === null) return null;
      xyCoef = xyCoef.add(termResult.coef);
      constant = constant.add(termResult.constant);
    }
    return { coef: xyCoef, constant };
  }

  // Handle single term
  const termResult = extractXYCoefficientFromTerm(expr, x, y, ce);
  if (termResult === null) return null;
  return termResult;
}

/**
 * Extract xy coefficient from a single term.
 */
function extractXYCoefficientFromTerm(
  term: BoxedExpression,
  x: string,
  y: string,
  ce: ComputeEngine
): { coef: BoxedExpression; constant: BoxedExpression } | null {
  const hasX = term.has(x);
  const hasY = term.has(y);

  // Constant term (no variables)
  if (!hasX && !hasY) {
    return { coef: ce.Zero, constant: term };
  }

  // Term with only one variable - not a pure product equation
  if (hasX !== hasY) {
    return null; // Has x but not y, or y but not x - not a pure xy = p form
  }

  // Term has both x and y - should be c*x*y
  if (term.operator === 'Multiply') {
    let coef: BoxedExpression = ce.One;
    let foundX = false;
    let foundY = false;

    for (const factor of term.ops!) {
      if (factor.symbol === x) {
        if (foundX) return null; // x appears twice
        foundX = true;
      } else if (factor.symbol === y) {
        if (foundY) return null; // y appears twice
        foundY = true;
      } else if (factor.has(x) || factor.has(y)) {
        return null; // Variable in complex subexpression
      } else {
        coef = coef.mul(factor);
      }
    }

    if (foundX && foundY) {
      return { coef, constant: ce.Zero };
    }
    return null;
  }

  // Simple x*y (implicit multiply handled differently?)
  if (term.symbol === x || term.symbol === y) {
    return null; // Just x or y alone, not xy
  }

  return null;
}

/**
 * Extract sum equation of the form x + y = s.
 * Returns the sum value s, or null if not a sum equation.
 */
function extractSumEquation(
  eq: BoxedExpression,
  x: string,
  y: string,
  ce: ComputeEngine
): { sum: BoxedExpression } | null {
  // eq is in the form: lhs - rhs = 0 (already expanded)
  // We're looking for: ax + by - s = 0 where equation is linear in both vars

  // Must have both variables
  if (!eq.has(x) || !eq.has(y)) return null;

  // Must be linear in both
  const degX = polynomialDegree(eq, x);
  const degY = polynomialDegree(eq, y);
  if (degX !== 1 || degY !== 1) return null;

  // Must not have xy term (that would make it non-linear in the system sense)
  if (!isLinearInVariables(eq, [x, y])) return null;

  // Extract coefficients: ax + by + c = 0
  const coefX = extractCoefficient(eq, x, ce);
  const coefY = extractCoefficient(eq, y, ce);
  const constant = extractConstantTerm(eq, [x, y], ce);

  if (coefX === null || coefY === null) return null;

  // For a "sum" equation we need coefX = coefY (both 1 or both equal)
  // Actually, we need ax + by = s, so sum s = -(c/a) when a=b, or we normalize
  // Let's be more flexible: sum = -constant when coefX = coefY = 1
  // Or more generally: if we can write it as x + y = s (possibly after scaling)

  // Check if coefficients are equal (or one is multiple of other)
  const ratio = coefX.div(coefY).simplify();
  if (!ratio.is(1) && !ratio.is(-1)) {
    // Coefficients are different - not a simple x + y = s form
    // Could still handle ax + by = s but let's start simple
    return null;
  }

  if (ratio.is(1)) {
    // coefX = coefY, so ax + ay = -c means x + y = -c/a
    const sum = constant.neg().div(coefX).simplify();
    return { sum };
  } else {
    // ratio is -1: coefX = -coefY, so ax - ay = -c means x - y = -c/a
    // This is not a sum equation
    return null;
  }
}

/**
 * Check if a BoxedExpression represents a real value (not complex).
 */
function isRealValue(expr: BoxedExpression): boolean {
  const simplified = expr.simplify();
  // Check if it's a complex number
  if (simplified.operator === 'Complex') return false;
  // Check if it has an imaginary part
  const im = simplified.im;
  if (im !== undefined && im !== 0) return false;
  return true;
}

/**
 * Filter roots to only include real values (exclude complex numbers).
 */
function filterRealRoots(
  roots: ReadonlyArray<BoxedExpression>
): BoxedExpression[] {
  return roots.filter((r) => isRealValue(r));
}

/**
 * Try to solve using the substitution method.
 * If one equation is linear in one variable, solve for that variable
 * and substitute into the other equation.
 */
function trySubstitutionMethod(
  equations: BoxedExpression[],
  x: string,
  y: string,
  ce: ComputeEngine
): Array<Record<string, BoxedExpression>> | null {
  // Try each equation and each variable
  for (let i = 0; i < equations.length; i++) {
    const eq = equations[i];
    const otherEq = equations[1 - i];

    // Try solving for x
    const solveForXResult = trySolveLinearFor(eq, x, y, ce);
    if (solveForXResult) {
      // x = f(y), substitute into other equation
      const substituted = otherEq
        .subs({ [x]: solveForXResult }, { canonical: true })
        .simplify();

      // Solve the resulting univariate equation for y
      const yRoots = filterRealRoots(findUnivariateRoots(substituted, y));
      if (yRoots.length > 0) {
        const solutions: Array<Record<string, BoxedExpression>> = [];
        for (const yVal of yRoots) {
          const ySimplified = yVal.simplify();
          const xVal = solveForXResult
            .subs({ [y]: ySimplified }, { canonical: true })
            .simplify();
          // Only include if both x and y are real
          if (isRealValue(xVal) && isRealValue(ySimplified)) {
            solutions.push({ [x]: xVal, [y]: ySimplified });
          }
        }
        if (solutions.length > 0) return solutions;
      }
    }

    // Try solving for y
    const solveForYResult = trySolveLinearFor(eq, y, x, ce);
    if (solveForYResult) {
      // y = f(x), substitute into other equation
      const substituted = otherEq
        .subs({ [y]: solveForYResult }, { canonical: true })
        .simplify();

      // Solve the resulting univariate equation for x
      const xRoots = filterRealRoots(findUnivariateRoots(substituted, x));
      if (xRoots.length > 0) {
        const solutions: Array<Record<string, BoxedExpression>> = [];
        for (const xVal of xRoots) {
          const xSimplified = xVal.simplify();
          const yVal = solveForYResult
            .subs({ [x]: xSimplified }, { canonical: true })
            .simplify();
          // Only include if both x and y are real
          if (isRealValue(xSimplified) && isRealValue(yVal)) {
            solutions.push({ [x]: xSimplified, [y]: yVal });
          }
        }
        if (solutions.length > 0) return solutions;
      }
    }
  }

  return null;
}

/**
 * Try to solve an equation for one variable, assuming it's linear in that variable.
 * Returns the expression for the variable, or null if not linear.
 *
 * For equation ax + f(y) = 0, returns x = -f(y)/a
 */
function trySolveLinearFor(
  eq: BoxedExpression,
  solveFor: string,
  otherVar: string,
  ce: ComputeEngine
): BoxedExpression | null {
  // Check if the equation is linear in solveFor
  const deg = polynomialDegree(eq, solveFor);
  if (deg !== 1) return null;

  // Extract coefficient of solveFor and the rest
  // eq = a * solveFor + rest(otherVar) = 0
  // solveFor = -rest / a

  const coef = extractCoefficient(eq, solveFor, ce);
  if (coef === null || coef.is(0)) return null;

  // rest = eq - coef * solveFor
  const rest = eq.sub(coef.mul(ce.symbol(solveFor))).simplify();

  // solveFor = -rest / coef
  const solution = rest.neg().div(coef).simplify();

  return solution;
}

/**
 * Inequality operators that we handle
 */
const INEQUALITY_OPERATORS = ['Less', 'LessEqual', 'Greater', 'GreaterEqual'];

/**
 * Check if an operator is an inequality operator
 */
function isInequalityOperator(op: string | null): boolean {
  return op !== null && INEQUALITY_OPERATORS.includes(op);
}

/**
 * Represents a linear inequality constraint in 2D.
 * Form: a*x + b*y + c <= 0 (or < 0 for strict)
 */
interface LinearConstraint {
  a: number; // coefficient of x
  b: number; // coefficient of y
  c: number; // constant term
  strict: boolean; // true for < or >, false for <= or >=
}

/**
 * Solve a system of linear inequalities in 2 variables.
 * Returns the vertices of the feasible region (convex polygon).
 *
 * @param inequalities - Array of BoxedExpression representing inequalities
 * @param variables - Array of exactly 2 variable names
 * @returns Array of vertex coordinate objects, or null if unsolvable/unbounded
 *
 * @example
 * ```typescript
 * const e = ce.parse('\\begin{cases}x+y\\leq 10\\\\x\\geq 0\\\\y\\geq 0\\end{cases}');
 * const result = e.solve(['x', 'y']);
 * // result = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]
 * ```
 */
export function solveLinearInequalitySystem(
  inequalities: BoxedExpression[],
  variables: string[]
): Array<Record<string, BoxedExpression>> | null {
  // Only support 2-variable systems
  if (variables.length !== 2) return null;
  if (inequalities.length < 2) return null;

  const ce = inequalities[0].engine;
  const [xVar, yVar] = variables;

  // Extract constraints
  const constraints: LinearConstraint[] = [];
  for (const ineq of inequalities) {
    const constraint = extractLinearConstraint(ineq, xVar, yVar, ce);
    if (!constraint) return null; // Not a linear inequality
    constraints.push(constraint);
  }

  // Find all intersection points of constraint boundaries
  const candidates: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const intersection = findLineIntersection(constraints[i], constraints[j]);
      if (intersection) {
        candidates.push(intersection);
      }
    }
  }

  // Filter candidates: keep only points that satisfy ALL constraints
  const vertices = candidates.filter((pt) =>
    constraints.every((c) => satisfiesConstraint(pt, c))
  );

  if (vertices.length === 0) return null;

  // Remove duplicate vertices
  const uniqueVertices = removeDuplicatePoints(vertices);

  if (uniqueVertices.length === 0) return null;

  // Order vertices in convex hull order (counterclockwise)
  const orderedVertices = orderConvexHull(uniqueVertices);

  // Convert to BoxedExpression result format
  return orderedVertices.map((pt) => ({
    [xVar]: ce.number(pt.x).simplify(),
    [yVar]: ce.number(pt.y).simplify(),
  }));
}

/**
 * Extract a linear constraint from an inequality expression.
 * Normalizes to form: a*x + b*y + c <= 0 (or < 0)
 */
function extractLinearConstraint(
  ineq: BoxedExpression,
  xVar: string,
  yVar: string,
  ce: ComputeEngine
): LinearConstraint | null {
  const op = ineq.operator;
  if (!isInequalityOperator(op)) return null;

  // Get lhs and rhs
  const lhs = ineq.op1;
  const rhs = ineq.op2;
  if (!lhs || !rhs) return null;

  // Normalize: move everything to left side
  // For Less/LessEqual: lhs < rhs => lhs - rhs < 0
  // For Greater/GreaterEqual: lhs > rhs => rhs - lhs < 0
  let expr: BoxedExpression;
  let strict: boolean;

  if (op === 'Less' || op === 'LessEqual') {
    expr = lhs.sub(rhs).expand().simplify();
    strict = op === 'Less';
  } else {
    // Greater or GreaterEqual: flip to Less form
    expr = rhs.sub(lhs).expand().simplify();
    strict = op === 'Greater';
  }

  // Check if linear in both variables
  const degX = polynomialDegree(expr, xVar);
  const degY = polynomialDegree(expr, yVar);
  if (degX > 1 || degY > 1) return null;
  if (!isLinearInVariables(expr, [xVar, yVar])) return null;

  // Extract coefficients
  const coefX = extractCoefficient(expr, xVar, ce);
  const coefY = extractCoefficient(expr, yVar, ce);
  const constant = extractConstantTerm(expr, [xVar, yVar], ce);

  if (coefX === null || coefY === null) return null;

  // Get numeric values (handle both plain numbers and ExactNumericValue objects)
  const aVal = coefX.N().numericValue;
  const bVal = coefY.N().numericValue;
  const cVal = constant.N().numericValue;

  // Extract real number from numericValue (may be number or object with 're' property)
  const toNumber = (val: unknown): number | null => {
    if (typeof val === 'number') return val;
    if (val && typeof val === 'object' && 're' in val) {
      const re = (val as { re: number }).re;
      if (typeof re === 'number') return re;
    }
    return null;
  };

  const a = toNumber(aVal);
  const b = toNumber(bVal);
  const c = toNumber(cVal);

  if (a === null || b === null || c === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c))
    return null;

  return { a, b, c, strict };
}

/**
 * Find the intersection of two lines given by constraints.
 * Line 1: a1*x + b1*y + c1 = 0
 * Line 2: a2*x + b2*y + c2 = 0
 */
function findLineIntersection(
  c1: LinearConstraint,
  c2: LinearConstraint
): { x: number; y: number } | null {
  // Using Cramer's rule
  const det = c1.a * c2.b - c2.a * c1.b;

  // Lines are parallel (no intersection)
  if (Math.abs(det) < 1e-14) return null;

  const x = (c1.b * c2.c - c2.b * c1.c) / det;
  const y = (c2.a * c1.c - c1.a * c2.c) / det;

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

/**
 * Check if a point satisfies a constraint.
 */
function satisfiesConstraint(
  pt: { x: number; y: number },
  c: LinearConstraint
): boolean {
  const val = c.a * pt.x + c.b * pt.y + c.c;

  if (c.strict) {
    // Strict inequality: val < 0, but allow small tolerance at boundary
    return val < 1e-10;
  } else {
    // Non-strict: val <= 0
    return val <= 1e-10;
  }
}

/**
 * Remove duplicate points (within tolerance)
 */
function removeDuplicatePoints(
  points: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  const tolerance = 1e-10;
  const result: Array<{ x: number; y: number }> = [];

  for (const pt of points) {
    const isDuplicate = result.some(
      (existing) =>
        Math.abs(existing.x - pt.x) < tolerance &&
        Math.abs(existing.y - pt.y) < tolerance
    );
    if (!isDuplicate) {
      result.push(pt);
    }
  }

  return result;
}

/**
 * Order points in counterclockwise convex hull order.
 * Uses Graham scan algorithm.
 */
function orderConvexHull(
  points: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  // Find centroid
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  // Sort by angle from centroid
  return [...points].sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });
}
