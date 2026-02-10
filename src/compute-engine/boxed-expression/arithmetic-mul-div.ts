import { isSubtype } from '../../common/type/subtype';

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isNumber, isFunction, isSymbol } from './type-guards';
import { NumericValue } from '../numeric-value/types';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import type { Rational } from '../numerics/types';
import {
  add as rationalAdd,
  mul as rationalMul,
  asMachineRational,
  inverse,
  isOne,
  neg,
  rationalGcd,
  reducedRational,
  isZero,
} from '../numerics/rationals';
import { SMALL_INTEGER } from '../numerics/numeric';
import { bigint } from '../numerics/bigint';

import { order } from './order';
import { asRadical } from './arithmetic-power';
import { flatten } from './flatten';
import { asRational, asSmallInteger } from './numerics';
import { negateProduct } from './negate';
import { add } from './arithmetic-add';

//
// ── Product class ──────────────────────────────────────────────────────
//

/**
 * Group terms in a product by common term.
 *
 * All the terms should be canonical.
 * - the arguments should have been flattened for `Multiply`
 *
 * - any argument of power been distributed, i.e.
 *      (ab)^2 ->  a^2 b^2
 * *
 * 3 + √5 + √(x+1) + x^2 + (a+b)^2 + d
 *  -> [ [[3, "d"], [1, 1]],
 *       [[5, "x+1"], [1, 2]],
 *       [[1, "a+b"], [2, 1]]
 *      ]
 *
 */
export class Product {
  engine: ComputeEngine;

  // Running literal products (if canonical)
  coefficient: NumericValue;

  // Other terms of the product, `term` is the key
  terms: {
    term: Expression;
    exponent: Rational;
  }[] = [];

  // If `false`, the running products are not calculated
  private _isCanonical = true;

  static from(expr: Expression): Product {
    return new Product(expr.engine, [expr]);
  }

  constructor(
    ce: ComputeEngine,
    xs?: ReadonlyArray<Expression>,
    readonly options?: { canonical?: boolean }
  ) {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;
    this._isCanonical = options.canonical!;

    this.engine = ce;
    this.coefficient = ce._numericValue(1);

    if (xs) for (const x of xs) this.mul(x);
  }

  /**
   * Add a term to the product.
   *
   * If `this._isCanonical` a running product of exact terms is kept.
   * Otherwise, terms and their exponent are tallied.
   */
  mul(term: Expression, exp?: Rational) {
    console.assert(term.isCanonical || term.isStructural);
    if (this.coefficient.isNaN) return;

    if (term.isNaN) {
      this.coefficient = this.engine._numericValue(NaN);
      return;
    }

    if (isFunction(term) && term.operator === 'Multiply') {
      for (const t of term.ops) this.mul(t, exp);
      return;
    }

    if (isFunction(term) && term.operator === 'Negate') {
      this.mul(term.op1, exp);
      this.coefficient = this.coefficient.neg();
      return;
    }

    if (this._isCanonical) {
      if (isSymbol(term) && term.symbol === 'Nothing') return;

      exp ??= [1, 1];

      // If we're calculating a canonical product, fold exact literals into
      // running terms
      const num = isNumber(term) ? term.numericValue : undefined;
      if (num !== undefined) {
        if (term.is(1)) return;

        if (term.is(0)) {
          // infinity * 0 -> NaN (indeterminate form)
          if (
            this.coefficient.isPositiveInfinity ||
            this.coefficient.isNegativeInfinity
          ) {
            this.coefficient = this.engine._numericValue(NaN);
            return;
          }
          this.coefficient = this.engine._numericValue(isZero(exp) ? NaN : 0);
          return;
        }

        if (term.is(-1)) {
          if (isOne(exp)) this.coefficient = this.coefficient.neg();
          else {
            this.coefficient = this.coefficient.mul(
              this.engine._numericValue(-1).pow(this.engine._numericValue(exp))
            );
          }
          return;
        }

        if (term.isInfinity) {
          // 0 * infinity -> NaN (indeterminate form)
          if (this.coefficient.isZero) {
            this.coefficient = this.engine._numericValue(NaN);
            return;
          }
          if (isOne(exp)) {
            // Multiply the signs: coef * infinity
            // e.g., -2 * +∞ = -∞, 2 * -∞ = -∞, -2 * -∞ = +∞
            const coefSign = this.coefficient.sgn() ?? 1;
            const termSign = term.isNegative ? -1 : 1;
            const resultSign = coefSign * termSign;
            this.coefficient = this.engine._numericValue(
              resultSign < 0 ? -Infinity : Infinity
            );
          } else this.terms.push({ term, exponent: exp });
          return;
        }

        if (isOne(exp)) {
          this.coefficient = this.coefficient.mul(num);
        } else
          this.coefficient = this.coefficient.mul(
            this.engine._numericValue(num).pow(this.engine._numericValue(exp))
          );
        return;
      }

      const radical = asRadical(term);
      if (radical !== null) {
        this.coefficient = this.coefficient.mul(
          this.engine
            ._numericValue({
              radical: (radical[0] as number) * (radical[1] as number),
              rational: [1, Number(radical[1])],
            })
            .pow(this.engine._numericValue(exp))
        );
        return;
      }

      if (!isSymbol(term)) {
        // Skip numeric coefficient extraction for symbolic radicals like √2, ∛2, 2^{1/3}
        // These should stay symbolic rather than evaluating to floats
        const isSymbolicRadical =
          isFunction(term) &&
          (term.operator === 'Sqrt' ||
            term.operator === 'Root' ||
            term.operator === 'Power') &&
          isNumber(term.op1);

        if (!isSymbolicRadical) {
          // If possible, factor out a rational coefficient
          let coef: NumericValue;
          [coef, term] = term.toNumericValue();
          if (exp && !isOne(exp))
            coef = coef.pow(this.engine._numericValue(exp));
          this.coefficient = this.coefficient.mul(coef);
        }
      }
    }

    // Note: term should be positive, so no need to handle the -1 case
    if (term.is(1) && (!exp || isOne(exp))) return;
    if (term.is(0) === false && exp && isZero(exp)) return;
    if (term.is(0)) {
      if (exp && isZero(exp)) this.coefficient = this.engine._numericValue(NaN);
      else this.coefficient = this.engine._numericValue(0);
      return;
    }

    const exponent: Rational = exp ?? [1, 1];

    // If this is a power expression, extract the exponent
    if (isFunction(term) && term.operator === 'Power') {
      // Term is `Power(op1, op2)`
      const r = asRational(term.op2);
      if (r) {
        // Don't extract non-integer exponents for numeric bases
        // This would cause 2^{3/5} to evaluate numerically instead of staying symbolic
        // Only extract when: base is not a number, or exponent is an integer
        const baseIsNumeric = isNumber(term.op1);
        const expIsInteger = r[1] === 1 || r[1] === -1; // denominator is ±1
        if (!baseIsNumeric || expIsInteger) {
          this.mul(term.op1, rationalMul(exponent, r));
          return;
        }
        // Otherwise, keep the Power expression as a single term
      }
    }

    if (isFunction(term) && term.operator === 'Sqrt') {
      // Term is `Sqrt(op1)`
      // Don't extract non-integer exponents for numeric bases
      // This keeps √2 symbolic instead of evaluating to 1.414...
      const baseIsNumeric = isNumber(term.op1);
      if (!baseIsNumeric) {
        this.mul(term.op1, rationalMul(exponent, [1, 2]));
        return;
      }
      // Otherwise, keep the Sqrt expression as a single term
    }

    if (isFunction(term) && term.operator === 'Root') {
      // Term is `Root(op1, op2)`
      const r = asRational(term.op2);
      if (r) {
        // Don't extract non-integer exponents for numeric bases
        // This keeps ∛2 symbolic instead of evaluating to 1.259...
        const baseIsNumeric = isNumber(term.op1);
        if (!baseIsNumeric) {
          this.mul(term.op1, rationalMul(exponent, inverse(r)));
          return;
        }
        // Otherwise, keep the Root expression as a single term
      }
    }

    if (isFunction(term) && term.operator === 'Divide') {
      // In order to correctly account for the denominator, invert it.
      // For example, in the case `a^4/a^2' we want to add
      // `a^(-2)` to the product, not `1/a^2`. The former will get the exponent
      // extracted, while the latter will consider the denominator as a
      // separate term.

      this.mul(term.op1, exponent);
      this.mul(term.op2, neg(exponent));
      return;
    }

    // Look for the base, and add the exponent if already in the list of terms
    let found = false;
    for (const x of this.terms) {
      if (x.term.isSame(term)) {
        x.exponent = rationalAdd(x.exponent, exponent);
        found = true;
        break;
      }
    }
    if (!found) this.terms.push({ term, exponent });
  }

  /** Divide the product by a term of coefficient */
  div(term: NumericValue | Expression) {
    if (term instanceof NumericValue)
      this.coefficient = this.coefficient.div(term);
    else this.mul(term, [-1, 1]);
  }

  /** The terms of the product, grouped by degrees.
   *
   * If `mode` is `rational`, rationals are split into separate numerator and
   * denominator, so that a rational expression can be created later
   * If `mode` is `expression`, a boxed expression is returned, without
   * splitting rationals
   * If `mode` is `numeric`, the literals are combined into one expression
   *
   */
  groupedByDegrees(options?: { mode?: 'rational' | 'expression' | 'numeric' }):
    | {
        exponent: Rational;
        terms: Expression[];
      }[]
    | null {
    options ??= {};
    if (!('mode' in options)) options.mode = 'expression';
    const mode = options.mode;

    if (
      mode === 'numeric' &&
      (this.coefficient.isNegativeInfinity ||
        this.coefficient.isPositiveInfinity)
    )
      return [];

    //
    // Add the coefficient
    //
    if (this.coefficient.isZero) return [];
    const ce = this.engine;

    // If we have no terms (i.e. it's a literal), just return the coeff
    if (this.terms.length === 0) {
      if (mode === 'numeric') {
        const c = this.coefficient.N();
        return [{ exponent: [1, 1], terms: [ce.number(c)] }];
      } else {
        return [{ exponent: [1, 1], terms: [ce.number(this.coefficient)] }];
      }
    }

    const xs: { exponent: Rational; terms: Expression[] }[] = [];
    if (!this.coefficient.isOne) {
      if (mode === 'rational' && this.coefficient.type === 'finite_rational') {
        // Numerator
        const num = this.coefficient.numerator;
        if (!num.isOne) xs.push({ exponent: [1, 1], terms: [ce.number(num)] });
        // Denominator
        const denom = this.coefficient.denominator;
        if (!denom.isOne)
          xs.push({ exponent: [-1, 1], terms: [ce.number(denom)] });
      } else if (mode === 'numeric') {
        const c = this.coefficient.N();
        xs.push({ exponent: [1, 1], terms: [ce.number(c)] });
      } else {
        xs.push({ exponent: [1, 1], terms: [ce.number(this.coefficient)] });
      }
    }

    //
    // Other terms
    //
    for (const t of this.terms) {
      // Exponent of 0 indicate a term that has been simplified, i.e. `x/x`
      const exponent = reducedRational(t.exponent);
      if (exponent[0] === 0) continue;
      let found = false;
      for (const x of xs) {
        if (exponent[0] === x.exponent[0] && exponent[1] === x.exponent[1]) {
          x.terms.push(t.term);
          found = true;
          break;
        }
      }
      if (!found) xs.push({ exponent, terms: [t.term] });
    }
    return xs;
  }

  asExpression(
    options: { numericApproximation: boolean } = { numericApproximation: false }
  ): Expression {
    const ce = this.engine;

    const coef = this.coefficient;
    if (coef.isNaN) return ce.NaN;
    if (coef.isPositiveInfinity) return ce.PositiveInfinity;
    if (coef.isNegativeInfinity) return ce.NegativeInfinity;
    if (coef.isZero) return ce.Zero;

    // If the coef is -1, temporarily set it to 1
    const isNegativeOne = coef.isNegativeOne;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const groupedTerms = this.groupedByDegrees({
      mode: options.numericApproximation ? 'numeric' : 'expression',
    });
    if (groupedTerms === null) return ce.NaN;

    // If the coef is -1, negate the expression and reset the coef
    if (isNegativeOne) {
      const result = termsAsExpression(ce, groupedTerms).neg();
      this.coefficient = ce._numericValue(-1);
      return result;
    }

    return termsAsExpression(ce, groupedTerms);
  }

  /** The product, expressed as a numerator and denominator */
  asNumeratorDenominator(): [Expression, Expression] {
    const ce = this.engine;
    const coef = this.coefficient;
    if (coef.isZero) return [ce.Zero, ce.One];
    if (coef.isPositiveInfinity || coef.isNegativeInfinity) {
      if (this.terms.length === 0) {
        return [
          coef.isPositiveInfinity ? ce.PositiveInfinity : ce.NegativeInfinity,
          ce.One,
        ];
      }
      return [ce.NaN, ce.NaN];
    }

    // If the coef is -1, temporarily set it to 1
    const isNegativeOne = coef.isNegativeOne;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const xs = this.groupedByDegrees({ mode: 'rational' });

    this.coefficient = coef;

    if (xs === null) return [ce.NaN, ce.NaN];

    const xsNumerator = xs.filter((x) => x.exponent[0] >= 0);
    const xsDenominator = xs
      .filter((x) => x.exponent[0] < 0)
      .map((x) => ({
        exponent: neg(x.exponent),
        terms: x.terms,
      }));

    const num = termsAsExpression(ce, xsNumerator);

    return [
      isNegativeOne ? num.neg() : num,
      termsAsExpression(ce, xsDenominator),
    ];
  }

  asRationalExpression(): Expression {
    const [numerator, denominator] = this.asNumeratorDenominator();
    return canonicalDivide(numerator, denominator);
  }
}

export function commonTerms(
  lhs: Product,
  rhs: Product
): [NumericValue, Expression] {
  const ce = lhs.engine;

  //
  // Extract common number literal between the two products
  //
  const coef = lhs.coefficient.gcd(rhs.coefficient);

  if (coef.isOne) return [ce._numericValue(1), ce.One];

  //
  // Extract common terms between the two products
  //

  const xs: Expression[] = [];

  for (const x of lhs.terms) {
    // Find the term in the rhs product
    const y = rhs.terms.find((y) => x.term.isSame(y.term));
    if (!y) continue;
    const exponent = rationalGcd(x.exponent, y.exponent);
    if (isOne(exponent)) xs.push(x.term);
    else {
      const [n, d] = asMachineRational(exponent);
      if (d === 1) xs.push(x.term.pow(n));
      else if (n === 1) xs.push(x.term.root(d));
      else xs.push(x.term.pow(n).root(d));
    }
  }

  // Put everything together
  return [coef, xs.length === 0 ? ce.One : mul(...xs)];
}

function termsAsExpression(
  ce: ComputeEngine,
  terms: { exponent: Rational; terms: ReadonlyArray<Expression> }[]
): Expression {
  let result = terms.map(({ terms, exponent }) => {
    const t = flatten(terms, 'Multiply');
    const base = t.length <= 1 ? t[0] : ce._fn('Multiply', [...t].sort(order));
    return isOne(exponent) ? base : base.pow(ce.number(exponent));
  });

  result = flatten(result, 'Multiply');
  if (result.length === 0) return ce.One;
  if (result.length === 1) return result[0];

  return ce._fn('Multiply', result.sort(order));
}

//
// ── Divide ─────────────────────────────────────────────────────────────
//

/**
 * Canonical form of 'Divide' (and 'Rational')
 * - remove denominator of 1
 * - simplify the signs
 * - factor out negate (make the numerator and denominator positive)
 * - if numerator and denominator are integer literals, return a rational number
 *   or Rational expression
 * - evaluate number literals
 */
export function canonicalDivide(
  op1: Expression,
  op2: Expression
): Expression {
  const ce = op1.engine;
  if (!op1.isValid || !op2.isValid) return ce._fn('Divide', [op1, op2]);

  if (op1.isNaN || op2.isNaN) return ce.NaN;

  // A fully-determined expression (no free variables) that is not already a
  // literal. Such expressions may evaluate to 0 or ∞ (e.g. 1-1, tan(π/2))
  // and we want to avoid collapsing divisions like 0/(1-1) or
  // tan(π/2)/tan(π/2) during canonicalization. We use `unknowns` instead of
  // `symbols` because `symbols` includes mathematical constants like Pi and E,
  // which would let expressions like tan(π/2) slip through the guard.
  const op2IsConstantExpression =
    op2.unknowns.length === 0 && !isNumber(op2);

  // 0/0 = NaN, a/0 = ~∞ (a≠0)
  // Note: We only check .is(0) here, not .N().is(0), because .N() can be
  // expensive (e.g., Monte Carlo integration) and canonicalization must be fast.
  // Expressions like (1-1)/0 won't be detected as 0/0 here, but will be
  // handled during simplification.
  if (op2.is(0)) return op1.is(0) ? ce.NaN : ce.ComplexInfinity;

  // 0/a = 0 (a≠0, a is finite)
  if (op1.is(0) && op2.isFinite !== false) {
    // Be conservative with constant (no-unknown) denominators that aren't
    // already a literal number. Avoid 0/(1-1) -> 0 during canonicalization.
    // Use structural mode so the expression is bound and can evaluate later.
    if (op2IsConstantExpression)
      return ce.function('Divide', [op1, op2], {
        form: 'structural',
      });
    return ce.Zero;
  }

  // a/∞ = 0, ∞/∞ = NaN (check before a/a = 1 rule)
  if (op2.isInfinity) return op1.isInfinity ? ce.NaN : ce.Zero;

  // a/a = 1 (if a ≠ 0 and a is finite)
  if (op2.is(0) === false && op2.isFinite !== false) {
    if (
      isSymbol(op1) &&
      isSymbol(op2) &&
      op1.symbol === op2.symbol &&
      op1.isConstant
    )
      return ce.One;

    // (x+1)/(x+1) = 1 (if x+1 ≠ 0)
    if (op1.isSame(op2)) {
      // Same conservative guard as above: don't collapse constant expressions
      // like (1-1)/(1-1) or tan(π/2)/tan(π/2) into 1 during canonicalization.
      // Use structural mode so the expression is bound and can evaluate later.
      if (op2IsConstantExpression)
        return ce.function('Divide', [op1, op2], {
          form: 'structural',
        });
      return ce.One;
    }
  }

  // -a/-b = a/b
  if (
    isFunction(op1) &&
    op1.operator === 'Negate' &&
    isFunction(op2) &&
    op2.operator === 'Negate'
  ) {
    op1 = op1.op1;
    op2 = op2.op1;
  }

  // (a/b)/(c/d) = (a*d)/(b*c)
  if (
    isFunction(op1) &&
    op1.operator === 'Divide' &&
    isFunction(op2) &&
    op2.operator === 'Divide'
  ) {
    return canonicalDivide(
      canonicalMultiply(ce, [op1.op1, op2.op2]),
      canonicalMultiply(ce, [op1.op2, op2.op1])
    );
  }

  // (a/b)/c = a/(b*c)
  if (isFunction(op1) && op1.operator === 'Divide')
    return canonicalDivide(op1.op1, canonicalMultiply(ce, [op1.op2, op2]));

  // a/(b/c) = (a*c)/b
  if (isFunction(op2) && op2.operator === 'Divide')
    return canonicalDivide(canonicalMultiply(ce, [op1, op2.op2]), op2.op1);

  // a/1 = a
  if (op2.is(1)) return op1;

  // a/(-1) = -a
  if (op2.is(-1)) return op1.neg();

  // 1/a = a^-1
  if (op1.is(1)) return op2.inv();

  // Note: (-1)/a ≠ -(a^-1). We distribute Negate over Divide.

  // √a/√b = (1/b)√(ab) as a numeric value
  if (
    isFunction(op1) &&
    op1.operator === 'Sqrt' &&
    isFunction(op2) &&
    op2.operator === 'Sqrt'
  ) {
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2.op1);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: a * b, rational: [1, b] }));
  } else if (isFunction(op1) && op1.operator === 'Sqrt') {
    // √a/b = (1/b)√a as a numeric value
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: a, rational: [1, b] }));
  } else if (isFunction(op2) && op2.operator === 'Sqrt') {
    // a/√b = (a/b)√b as a numeric value
    const a = asSmallInteger(op1);
    const b = asSmallInteger(op2.op1);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: b, rational: [a, b] }));
  }

  // Are both op1 and op2 a numeric value?
  const v1 = isNumber(op1) ? op1.numericValue : undefined;
  const v2 = isNumber(op2) ? op2.numericValue : undefined;
  if (v1 !== undefined && v2 !== undefined) {
    if (
      (typeof v1 !== 'number' && v1.im !== 0) ||
      (typeof v2 !== 'number' && v2.im !== 0)
    ) {
      // If we have an imaginary part, keep the division
      return ce._fn('Divide', [op1, op2]);
    }

    // a/b with a and b integer literals -> a/b rational
    // But handle division by zero: 0/0 = NaN, a/0 = ~∞
    if (
      typeof v1 === 'number' &&
      Number.isInteger(v1) &&
      typeof v2 === 'number' &&
      Number.isInteger(v2)
    ) {
      if (v2 === 0) return v1 === 0 ? ce.NaN : ce.ComplexInfinity;
      return ce.number([v1, v2]);
    }

    if (typeof v1 === 'number' && Number.isInteger(v1)) {
      if (v1 === 0) return ce.Zero;
      if (typeof v2 !== 'number' && isSubtype(v2.type, 'integer')) {
        const b = v2.bignumRe;
        if (b !== undefined) {
          if (b.isInteger()) return ce.number([bigint(v1)!, bigint(b)!]);
        } else {
          const d = v2.re;
          if (Number.isInteger(d)) return ce.number([v1, d]);
        }
      }
    }

    return ce._fn('Divide', [op1, op2]);
  }

  // At least one of op1 or op2 are not numeric value.
  // Try to factor them.

  // Exact numeric values in operands are now pre-folded by canonicalMultiply,
  // so toNumericValue here just extracts the remaining coefficient+term.
  const [c1, t1] = op1.toNumericValue();
  console.assert(!c1.isZero); // zeros already filtered above

  const [c2, t2] = op2.toNumericValue();
  console.assert(!c2.isZero); // zeros already filtered above

  const c = c1.div(c2);

  if (c.isOne) return t2.is(1) ? t1 : ce._fn('Divide', [t1, t2]);

  if (c.isNegativeOne)
    return t2.is(1) ? t1.neg() : ce._fn('Divide', [t1.neg(), t2]);

  // If c is exact, use as a product: `c * (t1/t2)`
  // So, π/4 -> 1/4 * π (prefer multiplication over division)
  if (c.isExact) {
    if (t1.is(1) && t2.is(1)) return ce.number(c);
    if (t2.is(1)) return canonicalMultiply(ce, [ce.number(c), t1]);

    return ce._fn('Divide', [
      canonicalMultiply(ce, [ce.number(c.numerator), t1]),
      canonicalMultiply(ce, [ce.number(c.denominator), t2]),
    ]);
  }
  return ce._fn('Divide', [op1, op2]);
}

export function div(
  num: Expression,
  denom: number | Expression
): Expression {
  const ce = num.engine;

  num = num.canonical;
  if (typeof denom !== 'number') denom = denom.canonical;

  // If the numerator is NaN, return NaN
  if (num.isNaN) return ce.NaN;

  if (typeof denom === 'number') {
    if (isNaN(denom)) return ce.NaN;
    if (num.is(0)) {
      // 0/0 = NaN, 0/±∞ = NaN
      if (denom === 0 || !isFinite(denom)) return ce.NaN;
      return num; // 0
    }
    // a/1 = a
    if (denom === 1) return num;
    // a/(-1) = -a
    if (denom === -1) return num.neg();
    // a/0 = ~∞ (a≠0) - ComplexInfinity as "better NaN"
    if (denom === 0) return ce.ComplexInfinity;

    if (isNumber(num)) {
      const n = num.numericValue;
      // If num and denom are literal integers, we keep an exact result
      if (typeof n === 'number') {
        if (Number.isInteger(n) && Number.isInteger(denom))
          return ce.number(ce._numericValue({ rational: [n, denom] }));
      } else if (n.isExact && Number.isInteger(denom)) {
        return ce.number(n.asExact!.div(denom));
      }
    }
  } else {
    if (denom.isNaN) return ce.NaN;
    if (num.is(0)) {
      if (denom.is(0) || denom.isFinite === false) return ce.NaN;
      return ce.Zero;
    }

    // a/1 = a
    if (denom.is(1)) return num;

    // a/(-1) = -a
    if (denom.is(-1)) return num.neg();

    // a/0 = NaN (a≠0)
    if (denom.is(0)) return ce.NaN;

    if (isNumber(num) && isNumber(denom)) {
      const numV = num.numericValue;
      const denomV = denom.numericValue;
      if (
        typeof numV === 'number' &&
        typeof denomV === 'number' &&
        Number.isInteger(numV) &&
        Number.isInteger(denomV)
      ) {
        return ce.number(ce._numericValue({ rational: [numV, denomV] }));
      } else if (
        typeof numV === 'number' &&
        Number.isInteger(numV) &&
        typeof denomV !== 'number'
      ) {
        if (denomV.isExact) {
          return ce.number(ce._numericValue(numV).div(denomV.asExact!));
        }
      } else if (
        typeof denomV === 'number' &&
        Number.isInteger(denomV) &&
        typeof numV !== 'number'
      ) {
        if (numV.isExact) {
          return ce.number(numV.asExact!.div(denomV));
        }
      } else if (typeof numV !== 'number' && typeof denomV !== 'number') {
        if (numV.isExact && denomV.isExact) {
          return ce.number(numV.asExact!.div(denomV.asExact!));
        }
      }
    }
  }
  const result = new Product(ce, [num]);
  result.div(typeof denom === 'number' ? ce._numericValue(denom) : denom);
  return result.asRationalExpression();
}

//
// ── Multiply ───────────────────────────────────────────────────────────
//

/**
 * The canonical form of `Multiply`:
 * - removes `1` and `-1`
 * - simplifies the signs:
 *    - i.e. `-y \times -x` -> `x \times y`
 *    - `2 \times -x` -> `-2 \times x`
 * - arguments are sorted
 * - complex numbers promoted (['Multiply', 2, 'ImaginaryUnit'] -> 2i)
 * - Numeric values are promoted (['Multiply', 2, 'Sqrt', 3] -> 2√3)
 *
 * The input ops may not be canonical, the result is canonical.
 */

export function canonicalMultiply(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  //
  // Remove negations and negative numbers
  //
  let sign = 1;
  let xs: Expression[] = [];
  for (const op of ops) {
    const [o, s] = unnegate(op);
    sign *= s;
    xs.push(o);
  }

  //
  // Filter out ones
  //
  xs = xs.filter((x) => !x.is(1));

  //
  // Fold exact numeric operands (integers, rationals, radicals)
  // e.g. Multiply(2, x, 5) → Multiply(10, x)
  //
  {
    const exactNumerics: NumericValue[] = [];
    const nonNumeric: Expression[] = [];
    for (const x of xs) {
      if (isNumber(x) && !x.isInfinity && !x.isNaN) {
        const nv = x.numericValue;
        if (typeof nv === 'number' || nv.isExact) {
          exactNumerics.push(
            typeof nv === 'number' ? ce._numericValue(nv) : nv
          );
          continue;
        }
      }
      nonNumeric.push(x);
    }
    if (exactNumerics.length >= 2) {
      let product = exactNumerics[0];
      for (let i = 1; i < exactNumerics.length; i++)
        product = product.mul(exactNumerics[i]);
      if (product.isZero) {
        // 0 * ±∞ = NaN, 0 * NaN = NaN
        if (nonNumeric.some((x) => x.isInfinity || x.isNaN)) return ce.NaN;
        return ce.Zero;
      }
      if (!product.eq(1)) nonNumeric.unshift(ce.number(product));
      xs = nonNumeric;
    }
    // else: 0 or 1 exact numerics — xs is unchanged, no folding needed
  }

  //
  // If an integer or a rational is followed by a sqrt or an imaginary unit
  // we promote it
  //
  const ys: Expression[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    // Last item?
    if (i + 1 >= xs.length) {
      ys.push(x);
      continue;
    }
    const next = xs[i + 1];

    // Do we have a number literal followed either by a sqrt or an imaginary unit?

    if (isNumber(x)) {
      // Do we have a Sqrt expression?
      if (
        isFunction(next) &&
        next.operator === 'Sqrt' &&
        isNumber(next.op1) &&
        next.op1.type.matches('finite_integer')
      ) {
        // Next is a sqrt of a literal integer
        let radical: number | NumericValue = next.op1.numericValue;
        if (typeof radical !== 'number') radical = radical.re;

        if (radical >= SMALL_INTEGER) {
          ys.push(x);
          continue;
        }

        // Is it preceded by a rational?
        if (x.type.matches('finite_rational')) {
          const rational = x.numericValue;
          const [num, den] =
            typeof rational === 'number'
              ? [rational, 1]
              : [rational.numerator.re, rational.denominator.re];
          ys.push(
            ce.number(ce._numericValue({ rational: [num, den], radical }))
          );
          i++;
          continue;
        }
      } else if (
        isNumber(next) &&
        next.numericValue instanceof NumericValue
      ) {
        // Do we have a radical as a numeric value?
        const nextNv = next.numericValue;
        if (
          nextNv instanceof ExactNumericValue &&
          isOne(nextNv.rational) &&
          nextNv.radical !== 1
        ) {
          // We have a number (n) followed by a radical (r)
          // Convert to a numeric value
          const r = asRational(x);
          if (r) {
            ys.push(
              ce.number(
                ce._numericValue({ rational: r, radical: nextNv.radical })
              )
            );
            i++;
            continue;
          }
        } else if (nextNv.im === 1) {
          // "Next" is an imaginary unit. Is it preceded by a real number?
          const nv = x.numericValue;
          if (typeof nv === 'number') {
            ys.push(ce.number(ce.complex(0, nv)));
            i++;
            continue;
          } else if (nv.im === 0) {
            if (Number.isInteger(nv.re)) {
              ys.push(ce.number(ce.complex(0, nv.re)));
              i++;
              continue;
            } else if (!nv.isExact) {
              ys.push(ce.number(ce.complex(0, nv.re)));
              i++;
              continue;
            }
          }
        }
      }
    }
    ys.push(x);
  }

  // Account for the sign (if negative)
  if (sign < 0) {
    if (ys.length === 0) return ce.number(-1);
    if (ys.length === 1) return ys[0].neg();
    return negateProduct(ce, ys);
  }

  if (ys.length === 0) return ce.number(1);
  if (ys.length === 1) return ys[0];
  return ce._fn('Multiply', [...ys].sort(order));
}

function unnegate(op: Expression): [Expression, sign: number] {
  let sign = 1;
  while (isFunction(op) && op.operator === 'Negate') {
    sign = -sign;
    op = op.op1;
  }

  // If a negative number, make it positive
  if (isNumber(op) && op.isNegative) {
    sign = -sign;
    op = op.neg();
  }

  return [op, sign];
}

// Moved from expand.ts to break expand ↔ arithmetic-mul-div cycle
function expandProduct(
  lhs: Readonly<Expression>,
  rhs: Readonly<Expression>
): Expression {
  if (
    isFunction(lhs) &&
    lhs.operator === 'Negate' &&
    isFunction(rhs) &&
    rhs.operator === 'Negate'
  )
    return expandProduct(lhs.op1, rhs.op1);

  const ce = lhs.engine;

  if (isFunction(lhs) && lhs.operator === 'Negate')
    return expandProduct(lhs.op1, rhs).neg();
  if (isFunction(rhs) && rhs.operator === 'Negate')
    return expandProduct(lhs, rhs.op1).neg();

  if (
    isFunction(lhs) &&
    lhs.operator === 'Divide' &&
    isFunction(rhs) &&
    rhs.operator === 'Divide'
  ) {
    const denom = lhs.op2.mul(rhs.op2);
    return expandProduct(lhs.op1, rhs.op1).div(denom);
  }

  if (isFunction(lhs) && lhs.operator === 'Divide')
    return expandProduct(lhs.op1, rhs).div(lhs.op2);
  if (isFunction(rhs) && rhs.operator === 'Divide')
    return expandProduct(lhs, rhs.op1).div(rhs.op2);

  if (isFunction(lhs) && lhs.operator === 'Add') {
    const terms: Expression[] = lhs.ops.map((x) => expandProduct(x, rhs));
    return add(...terms);
  }
  if (isFunction(rhs) && rhs.operator === 'Add') {
    const terms: Expression[] = rhs.ops.map((x) => expandProduct(lhs, x));
    return add(...terms);
  }

  return new Product(ce, [lhs, rhs]).asExpression();
}

export function expandProducts(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | null {
  if (ops.length === 0) return null;
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) return expandProduct(ops[0], ops[1]);

  const rhs = expandProducts(ce, ops.slice(1));
  return rhs === null ? null : expandProduct(ops[0], rhs);
}

export function mul(...xs: ReadonlyArray<Expression>): Expression {
  console.assert(xs.length > 0);
  if (xs.length === 1) return xs[0];

  const ce = xs[0].engine;

  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    if (isFunction(exp)) xs = exp.ops;
  }

  return new Product(ce, xs).asRationalExpression();
}

export function mulN(...xs: ReadonlyArray<Expression>): Expression {
  console.assert(xs.length > 0);
  const ce = xs[0].engine;
  xs = xs.map((x) => x.N());
  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    if (isFunction(exp)) xs = exp.ops;
  }

  return new Product(ce, xs).asExpression({ numericApproximation: true });
}
