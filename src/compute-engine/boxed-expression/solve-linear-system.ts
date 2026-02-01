import type { BoxedExpression, ComputeEngine } from '../global-types';
import { polynomialDegree } from './polynomials';

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
