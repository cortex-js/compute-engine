import { checkDeadline } from '../../common/interruptible.js';
import { BigDecimal } from '../../big-decimal/index.js';
import type { Expression } from '../global-types.js';
import { asSmallInteger } from './numerics.js';
import { add } from './arithmetic-add.js';
import { expand } from './expand.js';
import { multivariateGCD } from './multivariate-gcd.js';
import { totalDegree } from './polynomial-degree.js';
import { isNumber, isFunction, isSymbol } from './type-guards.js';

// Re-export degree functions from leaf module (no circular deps)
export { totalDegree, maxDegree, lex, revlex } from './polynomial-degree.js';

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
export type UnivariateCoefficients = (null | Expression)[];
export type MultivariateCoefficients = (null | (null | Expression)[])[];

/**
 * Return a list of coefficient of powers of `vars` in `poly`,
 * starting with power 0.
 *
 * If `poly`  is not a polynomial, return `null`.
 */
export function coefficients(
  poly: Expression,
  vars: string
): UnivariateCoefficients | null;
export function coefficients(
  poly: Expression,
  vars: string[]
): MultivariateCoefficients | null;
export function coefficients(
  _poly: Expression,
  _vars: string | string[]
): UnivariateCoefficients | MultivariateCoefficients | null {
  // Coefficient extraction is not implemented. Retain the existing empty
  // coefficient table until callers can handle an explicit unsupported result.
  return univariateCoefficients([[]]) ?? [[]];
}

/** If possible, attempt to return a UnivariateCoefficient.
 * If the coefficients really are multivariate, return `null` */
function univariateCoefficients(
  _coefs: UnivariateCoefficients | MultivariateCoefficients
): UnivariateCoefficients | null {
  // Multivariate-to-univariate conversion is not implemented.
  const _result: UnivariateCoefficients = [];

  return null;
}

/**
 * Return the sum of positive integer exponents for an expression.
 */
function _getDegree(expr: Expression | undefined): number {
  if (expr === undefined) return 0;

  if (isSymbol(expr)) {
    return (expr.valueDefinition?.isConstant ?? false) ? 0 : 1;
  }

  if (isFunction(expr)) {
    const operator = expr.operator;
    if (operator === 'Power') return expr.op2.re;

    if (operator === 'Multiply') {
      return [...expr.ops].reduce((acc, x) => acc + _getDegree(x), 0);
    }
    if (operator === 'Add' || operator === 'Subtract') {
      return Math.max(...expr.ops.map((x) => _getDegree(x)));
    }
    if (operator === 'Negate') return _getDegree(expr.op1);
  }
  return 0;
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
export function polynomialDegree(expr: Expression, variable: string): number {
  // Constant or different symbol
  if (isNumber(expr)) return 0;
  if (isSymbol(expr)) {
    if (expr.symbol === variable) return 1;
    // Other symbols (constants or different variables) have degree 0 in this variable
    return 0;
  }

  if (!isFunction(expr)) {
    if (expr.has(variable)) return -1;
    return 0;
  }

  const op = expr.operator;

  if (op === 'Negate') return polynomialDegree(expr.op1, variable);

  if (op === 'Add' || op === 'Subtract') {
    let maxDeg = 0;
    for (const arg of expr.ops) {
      const deg = polynomialDegree(arg, variable);
      if (deg < 0) return -1; // Not a polynomial
      maxDeg = Math.max(maxDeg, deg);
    }
    return maxDeg;
  }

  if (op === 'Multiply') {
    let totalDeg = 0;
    for (const arg of expr.ops) {
      const deg = polynomialDegree(arg, variable);
      if (deg < 0) return -1; // Not a polynomial
      totalDeg += deg;
    }
    return totalDeg;
  }

  // A quotient by a factor free of the variable is a polynomial with scaled
  // coefficients: `x²/a` has degree 2 in `x`, as `a⁻¹·x²` already has. A
  // symbolic or machine-float denominator stays a `Divide` in canonical form
  // (an exact number denominator folds into a `Rational` coefficient).
  if (op === 'Divide') {
    if (expr.op2.has(variable)) return -1;
    return polynomialDegree(expr.op1, variable);
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
  expr: Expression,
  variable: string
): Expression[] | null {
  const ce = expr.engine;
  const degree = polynomialDegree(expr, variable);
  if (degree < 0) return null;

  // Initialize coefficient array with zeros
  const coeffs: Expression[] = new Array(degree + 1).fill(ce.Zero);

  // Expand the expression to get standard form
  const expanded = expand(expr);

  // Helper to add a term's coefficient at a specific degree. Uses a canonical
  // `Add` (`ce.function`), which folds exact operands EXACTLY (integers,
  // rationals, radicals); the `.add()` method folds two number literals to a
  // float, which would numericize an irrational coefficient such as `(1−√5)/2`
  // (e.g. from the power-gcd substitution x² = u).
  const addCoefficient = (coef: Expression, deg: number): boolean => {
    if (deg > degree) return false;
    coeffs[deg] = ce.function('Add', [coeffs[deg], coef]);
    return true;
  };

  // Process a single term (not an Add expression)
  const processTerm = (term: Expression): boolean => {
    // Get the degree and coefficient of this term
    const termDeg = polynomialDegree(term, variable);
    if (termDeg < 0) return false;

    if (termDeg === 0) {
      // Constant term (doesn't contain variable)
      return addCoefficient(term, 0);
    }

    // For terms containing the variable, extract the coefficient
    if (isSymbol(term, variable)) {
      return addCoefficient(ce.One, 1);
    }

    if (isFunction(term, 'Negate')) {
      const innerDeg = polynomialDegree(term.op1, variable);
      if (innerDeg === 0) {
        return addCoefficient(term, 0);
      }
      // Process the negated term and negate its coefficient
      const innerCoeffs = getPolynomialCoefficients(term.op1, variable);
      if (!innerCoeffs) return false;
      for (let i = 0; i < innerCoeffs.length; i++) {
        if (!innerCoeffs[i].isSame(0)) {
          addCoefficient(innerCoeffs[i].neg(), i);
        }
      }
      return true;
    }

    if (isFunction(term, 'Divide')) {
      // `p(x)/d` with `d` free of the variable: the coefficients of `p`,
      // each divided by `d` (see the matching case in `polynomialDegree`).
      if (term.op2.has(variable)) return false;
      const numCoeffs = getPolynomialCoefficients(term.op1, variable);
      if (!numCoeffs) return false;
      for (let i = 0; i < numCoeffs.length; i++) {
        if (numCoeffs[i].isSame(0)) continue;
        if (!addCoefficient(ce.function('Divide', [numCoeffs[i], term.op2]), i))
          return false;
      }
      return true;
    }

    if (isFunction(term, 'Power')) {
      // x^n case
      if (isSymbol(term.op1, variable)) {
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

    if (isFunction(term, 'Multiply')) {
      // Separate coefficient from variable part
      const factors = term.ops;
      let coef: Expression = ce.One;
      let varDeg = 0;

      for (const factor of factors) {
        if (!factor.has(variable)) {
          // Canonical `Multiply` (folds exact operands exactly); `.mul()` would
          // fold two number literals to a float (see `addCoefficient`).
          coef = ce.function('Multiply', [coef, factor]);
        } else if (isSymbol(factor, variable)) {
          varDeg += 1;
        } else if (
          isFunction(factor, 'Power') &&
          isSymbol(factor.op1, variable)
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
  if (isFunction(expanded, 'Add')) {
    for (const term of expanded.ops) {
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
  coeffs: Expression[],
  variable: string
): Expression {
  if (coeffs.length === 0) return coeffs[0]?.engine.Zero ?? null!;

  const ce = coeffs[0].engine;
  const x = ce.symbol(variable);
  const terms: Expression[] = [];

  for (let i = 0; i < coeffs.length; i++) {
    const coef = coeffs[i];
    if (coef.isSame(0)) continue;

    if (i === 0) {
      // Constant term
      terms.push(coef);
    } else if (i === 1) {
      // Linear term
      if (coef.isSame(1)) {
        terms.push(x);
      } else if (coef.isSame(-1)) {
        terms.push(x.neg());
      } else {
        terms.push(coef.mul(x));
      }
    } else {
      // Higher degree term
      const xPow = ce.expr(['Power', variable, i]);
      if (coef.isSame(1)) {
        terms.push(xPow);
      } else if (coef.isSame(-1)) {
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
  dividend: Expression,
  divisor: Expression,
  variable: string
): [Expression, Expression] | null {
  // Respect the engine deadline: the Euclidean loop in polynomialGCD (via
  // the cancel-common-factors simplify rule) calls this repeatedly, and the
  // coefficient expressions of its remainders can grow at each step. A single
  // simplify() call was observed running for minutes: the `.sub()` method had
  // turned exact radical coefficients into floats, whose big-decimal digits
  // grew at each division. Each division is ms-scale, so an unstrided check is
  // cheap.
  checkDeadline(dividend.engine._deadlineFrame);

  const ce = dividend.engine;

  // Get coefficients
  const dividendCoeffs = getPolynomialCoefficients(dividend, variable);
  const divisorCoeffs = getPolynomialCoefficients(divisor, variable);

  if (!dividendCoeffs || !divisorCoeffs) return null;

  // Check for division by zero
  if (divisorCoeffs.every((c) => c.isSame(0))) return null;

  // Find the actual degree (ignore trailing zeros)
  const actualDegree = (coeffs: Expression[]): number => {
    for (let i = coeffs.length - 1; i >= 0; i--) {
      if (!coeffs[i].isSame(0)) return i;
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
  const quotientCoeffs: Expression[] = new Array(
    dividendDeg - divisorDeg + 1
  ).fill(ce.Zero);

  const leadingDivisor = divisorCoeffs[divisorDeg];

  // Polynomial long division algorithm
  for (let i = dividendDeg; i >= divisorDeg; i--) {
    if (remainder[i].isSame(0)) continue;

    // Compute the quotient term coefficient
    // IMPORTANT: Don't call .simplify() to avoid infinite recursion when called
    // from simplification rules. Arithmetic operations produce canonical forms.
    const quotientCoef = remainder[i].div(leadingDivisor);
    quotientCoeffs[i - divisorDeg] = quotientCoef;

    // Subtract quotientCoef * divisor * x^(i - divisorDeg) from remainder
    for (let j = 0; j < divisorDeg; j++) {
      const product = quotientCoef.mul(divisorCoeffs[j]);
      remainder[i - divisorDeg + j] = exactSub(
        remainder[i - divisorDeg + j],
        product
      );
    }
    // The leading term cancels by construction (quotientCoef·lc = remainder[i]).
    // Set it to an exact zero instead of computing `remainder[i] − quotientCoef·lc`:
    // with symbolic or radical coefficients that difference is not always
    // recognized as structurally 0, and a leading coefficient that is zero in
    // value but not in form keeps the degree from dropping.
    remainder[i] = ce.Zero;
  }

  const quotient = fromCoefficients(quotientCoeffs, variable);
  const remainderPoly = fromCoefficients(remainder, variable);

  // IMPORTANT: Don't call .simplify() on the result to avoid infinite recursion
  // when called from within simplification rules (e.g., polynomial cancellation)
  return [quotient, remainderPoly];
}

/**
 * `a − b` for two polynomial coefficients, exact when both are exact.
 *
 * The `.sub()` method folds two exact number literals whose radicals differ
 * (`√2 − 1`, `√3 + √2`) to a float, because such a sum has no exact
 * number-literal form. A canonical `Add` keeps that sum exact and symbolic
 * (`−1 + √2`). Other operands go through `.sub()`, which also expands and
 * collects like terms.
 */
function exactSub(a: Expression, b: Expression): Expression {
  if (isNumber(a) && isNumber(b) && a.isExact && b.isExact)
    return a.engine.function('Add', [a, b.neg()]);
  return a.sub(b);
}

/** True if `expr` holds an inexact number literal (a machine or big float)
 * at any depth. */
function hasInexactNumber(expr: Expression): boolean {
  if (isNumber(expr)) return !expr.isExact;
  if (isFunction(expr)) return expr.ops.some(hasInexactNumber);
  return false;
}

/**
 * The maximum number of significant digits of a float coefficient that
 * `polynomialGCD` reads as the exact decimal it spells (`1.5` as `3/2`).
 *
 * A double always keeps 15 significant decimal digits (DBL_DIG), so a double
 * written with at most 15 digits is that decimal. A double computed from an
 * irrational value (`√2` → `1.4142135623730951`) almost always needs 16 or 17
 * digits to round-trip, and a big decimal computed at the default working
 * precision has about 21 digits (`1.27788620849254495171`): neither qualifies,
 * so the GCD of such values is still refused.
 */
const SHORT_DECIMAL_DIGITS = 15;

/**
 * The exact rational value of a polynomial coefficient, or `undefined` when
 * there is none that `polynomialGCD` can use.
 *
 * An exact coefficient is returned unchanged. A finite real float literal
 * whose decimal form has at most `SHORT_DECIMAL_DIGITS` significant digits
 * becomes the exact rational of that decimal. Any other inexact coefficient
 * (a long float, a complex float, or a float nested inside an expression)
 * gives `undefined`.
 */
function shortExactCoefficient(coef: Expression): Expression | undefined {
  if (!hasInexactNumber(coef)) return coef;
  if (!isNumber(coef) || coef.im !== 0) return undefined;
  const d = coef.bignumRe ?? new BigDecimal(coef.re);
  if (!d.isFinite() || d._digitCount() > SHORT_DECIMAL_DIGITS) return undefined;
  if (d.exponent >= 0)
    return coef.engine.number(d.significand * 10n ** BigInt(d.exponent));
  return coef.engine.number([d.significand, 10n ** BigInt(-d.exponent)]);
}

/**
 * Compute the GCD of two polynomials using the Euclidean algorithm.
 * Returns a monic polynomial (leading coefficient = 1).
 *
 * The GCD is computed over exact coefficients only. A float coefficient with
 * few digits (`1.5`) is first replaced by the exact rational it spells
 * (`3/2`, see `shortExactCoefficient()`); the GCD of the two polynomials is
 * then exact, and is also a GCD of the float operands up to a constant factor.
 * When another coefficient of either operand, or a coefficient of a
 * remainder, is inexact, the result is the trivial GCD `1`: with floats, a
 * remainder that is zero in exact arithmetic is a small nonzero value, so the
 * Euclidean loop does not find the common factor. It continues with
 * remainders whose big-decimal coefficients keep every digit and grow at each
 * step.
 *
 * Examples:
 * - `polynomialGCD(x^2-1, x-1, 'x')` → x-1
 * - `polynomialGCD(x^3-1, x^2-1, 'x')` → x-1
 */
export function polynomialGCD(
  a: Expression,
  b: Expression,
  variable: string
): Expression {
  const ce = a.engine;

  // Handle trivial cases
  const degA = polynomialDegree(a, variable);
  const degB = polynomialDegree(b, variable);

  if (degA < 0 || degB < 0) return ce.One; // Not polynomials, return 1

  // If one is zero, return the other (normalized)
  const aCoeffs = getPolynomialCoefficients(a, variable);
  const bCoeffs = getPolynomialCoefficients(b, variable);

  if (!aCoeffs || aCoeffs.every((c) => c.isSame(0))) {
    return makeMonic(b, variable);
  }
  if (!bCoeffs || bCoeffs.every((c) => c.isSame(0))) {
    return makeMonic(a, variable);
  }

  // Euclidean algorithm
  let p = a;
  let q = b;

  // Inexact coefficients: use their exact values when they are short decimals,
  // otherwise no GCD (see the function comment).
  if (aCoeffs.some(hasInexactNumber) || bCoeffs.some(hasInexactNumber)) {
    const aExact = aCoeffs.map(shortExactCoefficient);
    const bExact = bCoeffs.map(shortExactCoefficient);
    if (aExact.some((c) => c === undefined)) return ce.One;
    if (bExact.some((c) => c === undefined)) return ce.One;
    p = fromCoefficients(aExact as Expression[], variable);
    q = fromCoefficients(bExact as Expression[], variable);
  }

  while (true) {
    // Bound the remainder sequence by the engine deadline (defense in depth):
    // with symbolic coefficients a single step's remainder can fail to reduce
    // in degree, so without a checkpoint the loop could spin unboundedly.
    checkDeadline(ce._deadlineFrame);

    const qCoeffs = getPolynomialCoefficients(q, variable);
    // `null` means the coefficients could not be extracted (e.g. they
    // contain parameter divisions like (a/b)·x², which Euclid remainders
    // routinely produce) — NOT that q is zero. Conflating the two returned
    // a non-divisor as the "GCD" (e.g. gcd(a + bx⁴, x⁶) → x⁴ + a/b), which
    // cancelCommonFactors then used to silently drop terms.
    if (!qCoeffs) return ce.One; // cannot continue: no provable common factor
    if (qCoeffs.some(hasInexactNumber)) return ce.One;
    if (qCoeffs.every((c) => c.isSame(0))) break;
    // A nonzero *constant* remainder (degree 0 in `variable`) means the
    // operands are coprime over the coefficient field, so the GCD is a unit
    // → 1. Detecting this here is also load-bearing for termination: dividing
    // a polynomial by a symbolic constant can yield a spurious nonzero
    // constant remainder (never structurally 0), which would otherwise loop
    // forever building ever-larger coefficient expressions (e.g.
    // gcd(u − a, b₂u² + b₁u + b₀), the symbolic-coefficient rational-integrand
    // path).
    if (leadingIndex(qCoeffs) === 0) return ce.One;

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

/** Index of the leading (highest-degree) non-zero coefficient, or -1 if the
 * coefficient array represents the zero polynomial. */
function leadingIndex(coeffs: Expression[]): number {
  for (let i = coeffs.length - 1; i >= 0; i--)
    if (!coeffs[i].isSame(0)) return i;
  return -1;
}

/**
 * Compute the resultant of two univariate polynomials `a` and `b` in
 * `variable`. The resultant is the determinant of the Sylvester matrix; it is
 * zero iff the polynomials share a common (non-constant) factor.
 *
 * Computed by the Euclidean recursion over the coefficient field (exact
 * rationals / radicals — no floating point), avoiding an explicit Sylvester
 * determinant. With `m = deg a`, `n = deg b`, and `R = a mod b` of degree `r`:
 *
 *   Res(a, b) = (-1)^(m·n) · lc(b)^(m - r) · Res(b, R)
 *
 * with base cases Res(a, const c) = c^deg(a) and Res(const, const) = 1.
 *
 * Returns `undefined` if either argument is not a polynomial in `variable`.
 *
 * Examples:
 * - `polynomialResultant(x² - 1, x - 1, 'x')` → 0 (common factor x - 1)
 * - `polynomialResultant(x² + 1, x² - 1, 'x')` → 4
 * - `polynomialResultant(x² + a, x + b, 'x')` → a + b²
 */
export function polynomialResultant(
  a: Expression,
  b: Expression,
  variable: string
): Expression | undefined {
  const result = resultantRec(a, b, variable);
  return result ?? undefined;
}

/** Recursive core of {@link polynomialResultant}. Returns `null` (not a
 * polynomial) so the public wrapper can map it to `undefined`. */
function resultantRec(
  a: Expression,
  b: Expression,
  variable: string
): Expression | null {
  const ce = a.engine;
  checkDeadline(ce._deadlineFrame);

  const aCoeffs = getPolynomialCoefficients(a, variable);
  const bCoeffs = getPolynomialCoefficients(b, variable);
  if (!aCoeffs || !bCoeffs) return null;

  const m = leadingIndex(aCoeffs);
  const n = leadingIndex(bCoeffs);

  // Degenerate: the resultant with a zero polynomial is 0.
  if (m < 0 || n < 0) return ce.Zero;

  // Res(const, const) = 1 (empty Sylvester matrix).
  if (m === 0 && n === 0) return ce.One;

  // Res(a, c) = c^deg(a) for a constant c (and the symmetric case).
  if (n === 0) return bCoeffs[0].pow(m);
  if (m === 0) return aCoeffs[0].pow(n);

  // Keep the higher-degree operand first; the swap costs a sign (-1)^(m·n).
  if (m < n) {
    const sub = resultantRec(b, a, variable);
    if (sub === null) return null;
    return (m * n) % 2 === 0 ? sub : sub.neg();
  }

  // m ≥ n ≥ 1: reduce by one ordinary (field) division step.
  const divResult = polynomialDivide(a, b, variable);
  if (!divResult) return null;
  const remainder = divResult[1];

  const remCoeffs = getPolynomialCoefficients(remainder, variable);
  if (!remCoeffs) return null;
  const r = leadingIndex(remCoeffs);

  // A zero remainder means b divides a — they share a factor, so Res = 0.
  if (r < 0) return ce.Zero;

  const sub = resultantRec(b, remainder, variable);
  if (sub === null) return null;

  // Res(a, b) = (-1)^(m·n) · lc(b)^(m - r) · Res(b, R)
  let result = bCoeffs[n].pow(m - r).mul(sub);
  if ((m * n) % 2 !== 0) result = result.neg();
  return result;
}

/**
 * Compute the GCD of two or more univariate polynomials — the polynomial
 * counterpart of the variadic `GCD` operator applied to polynomial operands.
 *
 * The common variable is inferred from the operands: every operand must be a
 * polynomial in the same single variable. Returns a monic polynomial,
 * consistent with `polynomialGCD` and the `PolynomialGCD` operator.
 *
 * Returns `undefined` when the operands are not polynomials in one or two
 * shared variables (≥3 variables, non-polynomial, or fewer than two operands),
 * OR when the polynomial GCD is trivial (a constant, degree 0). The trivial
 * case is deferred so the caller can keep the existing integer-GCD-with-
 * symbolic-operands behavior: a bare symbol may stand for an unknown integer
 * (where `GCD(x, 6)` should stay unevaluated) rather than a polynomial
 * indeterminate over ℚ (where it would be 1). Callers wanting the coprime → 1
 * answer should use the explicit `PolynomialGCD(p, q, x)`.
 *
 * Multivariate operands (≥2 variables) take a "Stage B" path (see
 * `multivariateBinaryGCD`): Brown's dense modular GCD over ℤ_p, with the result
 * **verified** by exact division. Large inputs (e.g. the 7-variable Fateman
 * products) are deferred via a cheap term-count cap; sparse interpolation
 * (Zippel) for that scale is future work (ROADMAP B11).
 *
 * Examples:
 * - `polynomialGCDMulti([x²-1, x²+2x+1])` → x+1
 * - `polynomialGCDMulti([x³-1, x²-1])` → x-1
 * - `polynomialGCDMulti([x²-y², x²+3xy+2y²])` → x+y  (bivariate)
 * - `polynomialGCDMulti([(x+y+z)(x-z), (x+y+z)(y+2z)])` → x+y+z  (trivariate)
 * - `polynomialGCDMulti([x, 6])` → undefined (trivial gcd, deferred)
 */
export function polynomialGCDMulti(
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length < 2) return undefined;

  // Infer the common variables across all operands.
  const vars = new Set<string>();
  for (const op of ops) for (const v of op.unknowns) vars.add(v);

  if (vars.size === 1) {
    const variable = [...vars][0];

    // Every operand must be a polynomial in `variable`.
    for (const op of ops)
      if (polynomialDegree(op, variable) < 0) return undefined;

    // Reduce: gcd(p₁, p₂, …, pₙ) = gcd(gcd(p₁, p₂), p₃) …
    let result = polynomialGCD(ops[0], ops[1], variable);
    for (let i = 2; i < ops.length; i++)
      result = polynomialGCD(result, ops[i], variable);

    // Return only a non-trivial common factor. A constant GCD is ambiguous
    // with integer-GCD semantics for symbolic operands, as documented by
    // `polynomialGCDMulti`.
    if (polynomialDegree(result, variable) < 1) return undefined;
    return result;
  }

  if (vars.size >= 2) {
    // Stage B multivariate GCD (Brown's modular algorithm). Reduce pairwise;
    // any failed pair (trivial, unverifiable, or too complex) defers the whole
    // result.
    let result: Expression | undefined = multivariateBinaryGCD(ops[0], ops[1]);
    for (let i = 2; i < ops.length && result !== undefined; i++)
      result = multivariateBinaryGCD(result, ops[i]);
    return result;
  }

  return undefined;
}

/**
 * Multivariate polynomial GCD (≥2 variables) via Brown's dense modular
 * algorithm (`multivariate-gcd.ts`, ROADMAP B11 Stage B): the GCD is computed
 * over ℤ_p and **verified by exact division** before being returned. Yields the
 * integer-primitive GCD, or `undefined` for a trivial (constant) GCD, a
 * non-divisor / failed reconstruction, or an input above a cheap term-count cap
 * (so the `GCD` operator never churns on large inputs like the 7-variable
 * Fateman products — those defer instantly; Brown also self-bounds via an
 * internal work budget).
 *
 * IMPORTANT: does not call `.simplify()` — only `Expand` and the pure kernel —
 * so it is safe even if reached during evaluation.
 */
function multivariateBinaryGCD(
  a: Expression,
  b: Expression
): Expression | undefined {
  const ce = a.engine;
  const ae = ce.expr(['Expand', a]).evaluate();
  const be = ce.expr(['Expand', b]).evaluate();

  const termCount = (e: Expression) =>
    isFunction(e, 'Add') ? e.ops.length : 1;
  if (termCount(ae) > 80 || termCount(be) > 80) return undefined;

  const vars = [...new Set<string>([...ae.unknowns, ...be.unknowns])];
  if (vars.length < 2) return undefined;

  const g = multivariateGCD(ce, ae, be, vars);
  if (g === null) return undefined;
  // A constant (degree-0) GCD is deferred, matching the univariate path's
  // treatment of a coprime/trivial result.
  if (g.unknowns.length === 0) return undefined;
  return g;
}

/**
 * Make a polynomial monic (leading coefficient = 1).
 */
function makeMonic(poly: Expression, variable: string): Expression {
  const coeffs = getPolynomialCoefficients(poly, variable);

  if (!coeffs) return poly;

  // Find leading coefficient
  let leadingCoef: Expression | null = null;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    if (!coeffs[i].isSame(0)) {
      leadingCoef = coeffs[i];
      break;
    }
  }

  if (!leadingCoef || leadingCoef.isSame(1)) return poly;

  // Divide all coefficients by leading coefficient
  // IMPORTANT: Don't call .simplify() to avoid infinite recursion when called
  // from simplification rules. Arithmetic operations produce canonical forms.
  const monicCoeffs = coeffs.map((c) => c.div(leadingCoef!));
  // The leading coefficient is 1 by construction. Set it to an exact 1: with a
  // float leading coefficient, `1.5 / 1.5` is the float 1, which prints as
  // `1x`.
  monicCoeffs[coeffs.lastIndexOf(leadingCoef)] = poly.engine.One;
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
  expr: Expression,
  variable: string
): Expression {
  if (!isFunction(expr, 'Divide')) return expr;

  const numerator = expr.op1;
  const denominator = expr.op2;

  // Check if both are polynomials
  const numDeg = polynomialDegree(numerator, variable);
  const denDeg = polynomialDegree(denominator, variable);

  if (numDeg < 0 || denDeg < 0) return expr;

  // Compute GCD. The univariate Euclidean path treats every other variable as
  // an opaque coefficient. This misses a genuinely multivariate common factor
  // in two ways, both requiring a fall back to Brown's multivariate algorithm:
  //   1. It reports a *trivial* (constant-in-`variable`) GCD for a genuinely
  //      multivariate pair — `gcd(-3y·x² + 2x, x³)` → 1, real factor `x`.
  //   2. It returns a *nonconstant-but-incomplete* monic factor that keeps
  //      `variable` while dropping a pure-coefficient common factor in another
  //      variable — e.g. `y·(x+1) / (y·(x+1)²)` gives univariate gcd `x+1`,
  //      missing the shared `y`. Cancelling with it yields `y / (y·(x+1))`,
  //      which is value-correct but NOT lowest terms.
  // Ordered univariate-first so the common (cheap) single-unknown path is
  // unaffected; only pay for the multivariate pass when there are ≥2 unknowns
  // (`multivariateBinaryGCD` expands both operands before running).
  let gcd = polynomialGCD(numerator, denominator, variable);
  // The univariate Euclidean GCD divides both operands exactly by construction.
  // A multivariate `mgcd` (Brown's algorithm) may be a strictly better factor
  // but need not divide exactly under `polynomialDivide`'s symbolic coefficient
  // division, so keep the univariate result as a fallback: preferring `mgcd`
  // must never REGRESS a valid univariate cancellation to no reduction.
  const univariateGcd = gcd;
  const unknowns = new Set([...numerator.unknowns, ...denominator.unknowns]);
  if (unknowns.size >= 2) {
    if (polynomialDegree(gcd, variable) <= 0) {
      // Case 1: univariate GCD is trivial in `variable`.
      gcd = multivariateBinaryGCD(numerator, denominator) ?? gcd;
    } else {
      // Case 2: univariate GCD is nonconstant but may be incomplete. Prefer
      // the multivariate GCD only when it captures a factor the univariate
      // result missed: strictly more unknowns, or the same unknowns at a
      // higher total degree. The exact-remainder guard below rejects any
      // over-eager `mgcd` that doesn't actually divide, so this is value-safe.
      const mgcd = multivariateBinaryGCD(numerator, denominator);
      if (mgcd) {
        const mUnknowns = mgcd.unknowns.length;
        const uUnknowns = gcd.unknowns.length;
        if (
          mUnknowns > uUnknowns ||
          (mUnknowns === uUnknowns && totalDegree(mgcd) > totalDegree(gcd))
        )
          gcd = mgcd;
      }
    }
  }

  // Attempt cancellation with a candidate GCD. Returns the reduced expression,
  // or `null` when the candidate is trivial (constant) or does not divide both
  // operands exactly — a wrong GCD, cancelling with which would silently change
  // the value of the expression.
  const tryCancel = (g: Expression): Expression | null => {
    // A multivariate GCD need not involve `variable` (it may be a factor in
    // another unknown), so "trivial" is "constant", not "degree 0 in `variable`".
    if (g.unknowns.length === 0) return null;

    const numDivResult = polynomialDivide(numerator, g, variable);
    const denDivResult = polynomialDivide(denominator, g, variable);
    if (!numDivResult || !denDivResult) return null;

    const [newNumerator, numRemainder] = numDivResult;
    const [newDenominator, denRemainder] = denDivResult;
    if (!numRemainder.isSame(0) || !denRemainder.isSame(0)) return null;

    // Check if denominator became 1
    const denCoeffs = getPolynomialCoefficients(newDenominator, variable);
    if (denCoeffs && denCoeffs.length === 1 && denCoeffs[0].isSame(1))
      return newNumerator;

    return newNumerator.div(newDenominator);
  };

  // Prefer the chosen (possibly multivariate) GCD, but if it does not divide
  // exactly, fall back to the univariate GCD rather than returning `expr`
  // unreduced — otherwise preferring `mgcd` could regress a valid cancellation.
  const cancelled =
    tryCancel(gcd) ?? (gcd !== univariateGcd ? tryCancel(univariateGcd) : null);
  return cancelled ?? expr;
}
