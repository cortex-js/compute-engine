import type { BoxedExpression } from '../global-types';
import { asSmallInteger } from './numerics';
import { add } from './arithmetic-add';

/**
 * Coefficient of a univariate (single variable) polynomial.
 *
 * The first element is a constant.
 * The second element is the coefficient of the variable.
 * The third element is the coefficient of the variable squared.
 * ...etc
 *
 * `3x^3 + 5x + √5 + 2` -> ['√5 + 2', 5, null, 3]
 *
 * If a coefficient does not apply (there are no corresponding term), it is `null`.
 *
 */
export type UnivariateCoefficients = (null | BoxedExpression)[];
export type MultivariateCoefficients = (null | (null | BoxedExpression)[])[];

/** Given `term` */
function coefficientDegree(
  term: BoxedExpression,
  vars: string[]
): [coef: BoxedExpression, degrees: number[]] {
  if (term.operator === 'Negate') {
  } else if (term.operator === 'Multiply') {
  } else if (term.operator === 'Power') {
  } else {
    // if (term.symbol in vars)...
    // Sqrt, Ln, trig, constants, numbers
  }
  return [term, [1, 0, 0]];
}

/**
 * Return a list of coefficient of powers of `vars` in `poly`,
 * starting with power 0.
 *
 * If `poly`  is not a polynomial, return `null`.
 */
export function coefficients(
  poly: BoxedExpression,
  vars: string
): UnivariateCoefficients | null;
export function coefficients(
  poly: BoxedExpression,
  vars: string[]
): MultivariateCoefficients | null;
export function coefficients(
  poly: BoxedExpression,
  vars: string | string[]
): UnivariateCoefficients | MultivariateCoefficients | null {
  return univariateCoefficients([[]]) ?? [[]];
}

/**
 * Return a polynomial expression of `vars` with coefficient
 * of powers `coefs`.
 *
 * `poly === polynomial(coefficients(poly), getVars(poly))`
 *
 */
// export function polynomial(
//   coefs: UnivariateCoefficients,
//   vars: string
// ): BoxedExpression;
// export function polynomial(
//   coefs: MultivariateCoefficients,
//   vars: string[]
// ): BoxedExpression;

// export function polynomial(
//   coefs: UnivariateCoefficients | MultivariateCoefficients,
//   vars: string | string[]
// ): BoxedExpression {
//   if (typeof vars === 'string') vars = [vars];
//   const terms: BoxedExpression[] = [];

//   let degree = 0;
//   for (const coef of coefs) {
//     if (coef === null) continue;
//     if (degree === 0) {
//       // Constant term
//       terms.push(coef[0]);
//     } else if (degree === 1) {
//       const term: BoxedExpression[] = [];
//       for (const [i, v] of vars) {
//         if (coef[i]) {
//         }
//       }
//     } else {
//     }
//     degree += 1;
//   }

//   if (terms.length === 0) return 0;
//   if (terms.length === 1) return terms[0];
//   return ['Add', ...terms];
// }

/** If possible, attempt to return a UnivariateCoefficient.
 * If the coefficients really are multivariate, return `null` */
function univariateCoefficients(
  coefs: UnivariateCoefficients | MultivariateCoefficients
): UnivariateCoefficients | null {
  const result: UnivariateCoefficients = [];

  return null;
}

/**
 * Return the sum of positive integer exponents for an expression.
 */
function getDegree(expr: BoxedExpression | undefined): number {
  if (expr === undefined) return 0;

  if (expr.symbol) {
    return (expr.valueDefinition?.isConstant ?? false) ? 0 : 1;
  }

  if (expr.ops) {
    const operator = expr.operator;
    if (operator === 'Power') return expr.op2.re;

    if (operator === 'Multiply') {
      return [...expr.ops].reduce((acc, x) => acc + getDegree(x), 0);
    }
    if (operator === 'Add' || operator === 'Subtract') {
      return Math.max(...expr.ops.map((x) => getDegree(x)));
    }
    if (operator === 'Negate') return getDegree(expr.op1);
  }
  return 0;
}

/**
 * The total degree of an expression is the sum of the
 * positive integer degrees of the factors in the expression:
 *
 * `3√2x^5y^3` -> 5 + 3 = 8
 */
export function totalDegree(expr: BoxedExpression): number {
  // e.g. "x"
  if (expr.symbol && !expr.isConstant) return 1;

  if (expr.operator === 'Power' && expr.op2.isNumberLiteral) {
    // If the base has no unknowns, the degree is 0, e.g. 2^3
    if (totalDegree(expr.op1) === 0) return 0;
    const deg = asSmallInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 0;
  }

  if (expr.operator === 'Multiply') {
    let deg = 0;
    for (const arg of expr.ops!) {
      const t = totalDegree(arg);
      deg = deg + t;
    }
    return deg;
  }

  if (expr.operator === 'Add' || expr.operator === 'Subtract') {
    let deg = 0;
    for (const arg of expr.ops!) deg = Math.max(deg, totalDegree(arg));
    return deg;
  }

  if (expr.operator === 'Negate') return totalDegree(expr.op1);

  if (expr.operator === 'Divide') return totalDegree(expr.op1);

  return 0;
}

/**
 * The max degree of a polynomial is the largest positive integer degree
 * in the factors (monomials) of the expression
 *
 * `3√2x^5y^3` -> 5
 *
 */
export function maxDegree(expr: BoxedExpression): number {
  // e.g. "x"
  if (expr.symbol && !expr.isConstant) return 1;

  if (expr.operator === 'Power' && expr.op2.isNumberLiteral) {
    // If the base has no unknowns, the degree is 0, e.g. 2^3
    if (maxDegree(expr.op1) === 0) return 0;

    const deg = asSmallInteger(expr.op2);
    if (deg !== null && deg > 0) return deg;
    return 0;
  }

  if (
    expr.operator === 'Multiply' ||
    expr.operator === 'Add' ||
    expr.operator === 'Subtract'
  ) {
    let deg = 0;
    for (const arg of expr.ops!) deg = Math.max(deg, totalDegree(arg));
    return deg;
  }

  if (expr.operator === 'Negate') return maxDegree(expr.op1);

  if (expr.operator === 'Divide') return maxDegree(expr.op1);

  return 0;
}

/**
 * Return a lexicographic key of the expression, for example
 * `xy^2` -> `x y`
 * `x\frac{1}{y}` -> `x y`
 * `2xy + y^2` -> `x y y`
 *
 */
export function lex(expr: BoxedExpression): string {
  // Consider symbols, but ignore constants such as "Pi" or "ExponentialE"
  if (expr.symbol && !expr.isConstant) return expr.symbol;
  if (!expr.ops) return '';
  return expr.ops
    .map((x) => lex(x))
    .join(' ')
    .trim();
}

export function revlex(expr: BoxedExpression): string {
  return lex(expr).split(' ').reverse().join(' ').trim();
}

//
// ==================== POLYNOMIAL ARITHMETIC ====================
//

/**
 * Get the degree of a polynomial in a specific variable.
 * Returns -1 if the expression is not a polynomial in the variable.
 *
 * Examples:
 * - `polynomialDegree(x^3 + 2x + 1, 'x')` → 3
 * - `polynomialDegree(x*y + y^2, 'x')` → 1
 * - `polynomialDegree(sin(x), 'x')` → -1 (not a polynomial)
 */
export function polynomialDegree(
  expr: BoxedExpression,
  variable: string
): number {
  // Constant or different symbol
  if (expr.isNumberLiteral) return 0;
  if (expr.symbol) {
    if (expr.symbol === variable) return 1;
    // Other symbols (constants or different variables) have degree 0 in this variable
    return 0;
  }

  const op = expr.operator;

  if (op === 'Negate') return polynomialDegree(expr.op1, variable);

  if (op === 'Add' || op === 'Subtract') {
    let maxDeg = 0;
    for (const arg of expr.ops!) {
      const deg = polynomialDegree(arg, variable);
      if (deg < 0) return -1; // Not a polynomial
      maxDeg = Math.max(maxDeg, deg);
    }
    return maxDeg;
  }

  if (op === 'Multiply') {
    let totalDeg = 0;
    for (const arg of expr.ops!) {
      const deg = polynomialDegree(arg, variable);
      if (deg < 0) return -1; // Not a polynomial
      totalDeg += deg;
    }
    return totalDeg;
  }

  if (op === 'Power') {
    const baseDeg = polynomialDegree(expr.op1, variable);
    if (baseDeg < 0) return -1;
    if (baseDeg === 0) {
      // Base doesn't depend on variable, but exponent might (e.g., e^x)
      if (expr.op2.has(variable)) return -1;
      return 0;
    }

    // Exponent must be a non-negative integer
    const exp = asSmallInteger(expr.op2);
    if (exp === null || exp < 0) return -1;
    return baseDeg * exp;
  }

  // For any other operator (Sin, Cos, Ln, etc.), check if it contains the variable
  if (expr.has(variable)) return -1;
  return 0;
}

/**
 * Extract coefficients of a univariate polynomial.
 * Returns an array where index i contains the coefficient of x^i.
 * Returns null if the expression is not a polynomial in the variable.
 *
 * Examples:
 * - `getPolynomialCoefficients(x^3 + 2x + 1, 'x')` → [1, 2, 0, 1]
 * - `getPolynomialCoefficients(3x^2 - x + 5, 'x')` → [5, -1, 3]
 */
export function getPolynomialCoefficients(
  expr: BoxedExpression,
  variable: string
): BoxedExpression[] | null {
  const ce = expr.engine;
  const degree = polynomialDegree(expr, variable);
  if (degree < 0) return null;

  // Initialize coefficient array with zeros
  const coeffs: BoxedExpression[] = new Array(degree + 1).fill(ce.Zero);

  // Expand the expression to get standard form
  const expanded = expr.expand();

  // Helper to add a term's coefficient at a specific degree
  const addCoefficient = (coef: BoxedExpression, deg: number): boolean => {
    if (deg > degree) return false;
    coeffs[deg] = coeffs[deg].add(coef);
    return true;
  };

  // Process a single term (not an Add expression)
  const processTerm = (term: BoxedExpression): boolean => {
    // Get the degree and coefficient of this term
    const termDeg = polynomialDegree(term, variable);
    if (termDeg < 0) return false;

    if (termDeg === 0) {
      // Constant term (doesn't contain variable)
      return addCoefficient(term, 0);
    }

    // For terms containing the variable, extract the coefficient
    if (term.symbol === variable) {
      return addCoefficient(ce.One, 1);
    }

    if (term.operator === 'Negate') {
      const innerDeg = polynomialDegree(term.op1, variable);
      if (innerDeg === 0) {
        return addCoefficient(term, 0);
      }
      // Process the negated term and negate its coefficient
      const innerCoeffs = getPolynomialCoefficients(term.op1, variable);
      if (!innerCoeffs) return false;
      for (let i = 0; i < innerCoeffs.length; i++) {
        if (!innerCoeffs[i].is(0)) {
          addCoefficient(innerCoeffs[i].neg(), i);
        }
      }
      return true;
    }

    if (term.operator === 'Power') {
      // x^n case
      if (term.op1.symbol === variable) {
        const exp = asSmallInteger(term.op2);
        if (exp !== null && exp >= 0) {
          return addCoefficient(ce.One, exp);
        }
      }
      // (something)^n where something doesn't contain variable
      if (!term.op1.has(variable)) {
        return addCoefficient(term, 0);
      }
      return false;
    }

    if (term.operator === 'Multiply') {
      // Separate coefficient from variable part
      const factors = term.ops!;
      let coef: BoxedExpression = ce.One;
      let varDeg = 0;

      for (const factor of factors) {
        if (!factor.has(variable)) {
          coef = coef.mul(factor);
        } else if (factor.symbol === variable) {
          varDeg += 1;
        } else if (
          factor.operator === 'Power' &&
          factor.op1.symbol === variable
        ) {
          const exp = asSmallInteger(factor.op2);
          if (exp !== null && exp >= 0) {
            varDeg += exp;
          } else {
            return false;
          }
        } else {
          // Complex factor containing variable
          return false;
        }
      }
      return addCoefficient(coef, varDeg);
    }

    return false;
  };

  // Process the expanded expression
  if (expanded.operator === 'Add') {
    for (const term of expanded.ops!) {
      if (!processTerm(term)) return null;
    }
  } else {
    if (!processTerm(expanded)) return null;
  }

  return coeffs;
}

/**
 * Construct a polynomial expression from its coefficients.
 * coeffs[i] is the coefficient of x^i.
 *
 * Examples:
 * - `fromCoefficients([1, 2, 0, 1], 'x')` → x^3 + 2x + 1
 * - `fromCoefficients([5, -1, 3], 'x')` → 3x^2 - x + 5
 */
export function fromCoefficients(
  coeffs: BoxedExpression[],
  variable: string
): BoxedExpression {
  if (coeffs.length === 0) return coeffs[0]?.engine.Zero ?? null!;

  const ce = coeffs[0].engine;
  const x = ce.symbol(variable);
  const terms: BoxedExpression[] = [];

  for (let i = 0; i < coeffs.length; i++) {
    const coef = coeffs[i];
    if (coef.is(0)) continue;

    if (i === 0) {
      // Constant term
      terms.push(coef);
    } else if (i === 1) {
      // Linear term
      if (coef.is(1)) {
        terms.push(x);
      } else if (coef.is(-1)) {
        terms.push(x.neg());
      } else {
        terms.push(coef.mul(x));
      }
    } else {
      // Higher degree term
      const xPow = ce.box(['Power', variable, i]);
      if (coef.is(1)) {
        terms.push(xPow);
      } else if (coef.is(-1)) {
        terms.push(xPow.neg());
      } else {
        terms.push(coef.mul(xPow));
      }
    }
  }

  if (terms.length === 0) return ce.Zero;
  if (terms.length === 1) return terms[0];
  return add(...terms);
}

/**
 * Polynomial long division.
 * Returns [quotient, remainder] such that dividend = divisor * quotient + remainder.
 * Returns null if inputs are not valid polynomials or divisor is zero.
 *
 * Examples:
 * - `polynomialDivide(x^3-1, x-1, 'x')` → [x^2+x+1, 0]
 * - `polynomialDivide(x^3+2x+1, x+1, 'x')` → [x^2-x+3, -2]
 */
export function polynomialDivide(
  dividend: BoxedExpression,
  divisor: BoxedExpression,
  variable: string
): [BoxedExpression, BoxedExpression] | null {
  const ce = dividend.engine;

  // Get coefficients
  const dividendCoeffs = getPolynomialCoefficients(dividend, variable);
  const divisorCoeffs = getPolynomialCoefficients(divisor, variable);

  if (!dividendCoeffs || !divisorCoeffs) return null;

  // Check for division by zero
  if (divisorCoeffs.every((c) => c.is(0))) return null;

  // Find the actual degree (ignore trailing zeros)
  const actualDegree = (coeffs: BoxedExpression[]): number => {
    for (let i = coeffs.length - 1; i >= 0; i--) {
      if (!coeffs[i].is(0)) return i;
    }
    return -1;
  };

  const dividendDeg = actualDegree(dividendCoeffs);
  const divisorDeg = actualDegree(divisorCoeffs);

  if (divisorDeg < 0) return null; // Division by zero
  if (dividendDeg < 0) {
    // Dividend is zero
    return [ce.Zero, ce.Zero];
  }

  if (dividendDeg < divisorDeg) {
    // Degree of dividend < degree of divisor: quotient is 0, remainder is dividend
    return [ce.Zero, dividend];
  }

  // Clone coefficients for manipulation
  const remainder = dividendCoeffs.map((c) => c);
  const quotientCoeffs: BoxedExpression[] = new Array(
    dividendDeg - divisorDeg + 1
  ).fill(ce.Zero);

  const leadingDivisor = divisorCoeffs[divisorDeg];

  // Polynomial long division algorithm
  for (let i = dividendDeg; i >= divisorDeg; i--) {
    if (remainder[i].is(0)) continue;

    // Compute the quotient term coefficient
    // IMPORTANT: Don't call .simplify() to avoid infinite recursion when called
    // from simplification rules. Arithmetic operations produce canonical forms.
    const quotientCoef = remainder[i].div(leadingDivisor);
    quotientCoeffs[i - divisorDeg] = quotientCoef;

    // Subtract quotientCoef * divisor * x^(i - divisorDeg) from remainder
    for (let j = 0; j <= divisorDeg; j++) {
      const product = quotientCoef.mul(divisorCoeffs[j]);
      remainder[i - divisorDeg + j] =
        remainder[i - divisorDeg + j].sub(product);
    }
  }

  const quotient = fromCoefficients(quotientCoeffs, variable);
  const remainderPoly = fromCoefficients(remainder, variable);

  // IMPORTANT: Don't call .simplify() on the result to avoid infinite recursion
  // when called from within simplification rules (e.g., polynomial cancellation)
  return [quotient, remainderPoly];
}

/**
 * Compute the GCD of two polynomials using the Euclidean algorithm.
 * Returns a monic polynomial (leading coefficient = 1).
 *
 * Examples:
 * - `polynomialGCD(x^2-1, x-1, 'x')` → x-1
 * - `polynomialGCD(x^3-1, x^2-1, 'x')` → x-1
 */
export function polynomialGCD(
  a: BoxedExpression,
  b: BoxedExpression,
  variable: string
): BoxedExpression {
  const ce = a.engine;

  // Handle trivial cases
  const degA = polynomialDegree(a, variable);
  const degB = polynomialDegree(b, variable);

  if (degA < 0 || degB < 0) return ce.One; // Not polynomials, return 1

  // If one is zero, return the other (normalized)
  const aCoeffs = getPolynomialCoefficients(a, variable);
  const bCoeffs = getPolynomialCoefficients(b, variable);

  if (!aCoeffs || aCoeffs.every((c) => c.is(0))) {
    return makeMonic(b, variable);
  }
  if (!bCoeffs || bCoeffs.every((c) => c.is(0))) {
    return makeMonic(a, variable);
  }

  // Euclidean algorithm
  let p = a;
  let q = b;

  while (true) {
    const qCoeffs = getPolynomialCoefficients(q, variable);
    if (!qCoeffs || qCoeffs.every((c) => c.is(0))) {
      break;
    }

    const divResult = polynomialDivide(p, q, variable);
    if (!divResult) {
      // Division failed, return 1
      return ce.One;
    }

    const [, remainder] = divResult;
    p = q;
    q = remainder;
  }

  return makeMonic(p, variable);
}

/**
 * Make a polynomial monic (leading coefficient = 1).
 */
function makeMonic(poly: BoxedExpression, variable: string): BoxedExpression {
  const ce = poly.engine;
  const coeffs = getPolynomialCoefficients(poly, variable);

  if (!coeffs) return poly;

  // Find leading coefficient
  let leadingCoef: BoxedExpression | null = null;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    if (!coeffs[i].is(0)) {
      leadingCoef = coeffs[i];
      break;
    }
  }

  if (!leadingCoef || leadingCoef.is(1)) return poly;

  // Divide all coefficients by leading coefficient
  // IMPORTANT: Don't call .simplify() to avoid infinite recursion when called
  // from simplification rules. Arithmetic operations produce canonical forms.
  const monicCoeffs = coeffs.map((c) => c.div(leadingCoef!));
  return fromCoefficients(monicCoeffs, variable);
}

/**
 * Cancel common polynomial factors in a rational expression (Divide).
 * Returns the simplified expression.
 *
 * Examples:
 * - `cancelCommonFactors((x^2-1)/(x-1), 'x')` → x+1
 * - `cancelCommonFactors((x+1)/(x^2+3x+2), 'x')` → 1/(x+2)
 */
export function cancelCommonFactors(
  expr: BoxedExpression,
  variable: string
): BoxedExpression {
  const ce = expr.engine;

  if (expr.operator !== 'Divide') return expr;

  const numerator = expr.op1;
  const denominator = expr.op2;

  // Check if both are polynomials
  const numDeg = polynomialDegree(numerator, variable);
  const denDeg = polynomialDegree(denominator, variable);

  if (numDeg < 0 || denDeg < 0) return expr;

  // Compute GCD
  const gcd = polynomialGCD(numerator, denominator, variable);

  // Check if GCD is trivial (degree 0)
  const gcdDeg = polynomialDegree(gcd, variable);
  if (gcdDeg <= 0) return expr;

  // Divide numerator and denominator by GCD
  const numDivResult = polynomialDivide(numerator, gcd, variable);
  const denDivResult = polynomialDivide(denominator, gcd, variable);

  if (!numDivResult || !denDivResult) return expr;

  const [newNumerator] = numDivResult;
  const [newDenominator] = denDivResult;

  // Check if denominator became 1
  const denCoeffs = getPolynomialCoefficients(newDenominator, variable);
  if (denCoeffs && denCoeffs.length === 1 && denCoeffs[0].is(1)) {
    return newNumerator;
  }

  return newNumerator.div(newDenominator);
}
