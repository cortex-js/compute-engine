import type { BoxedExpression } from '../public';

import { order } from './order';
import type { Rational } from '../numerics/types';
import {
  add,
  mul as rationalMul,
  asMachineRational,
  inverse,
  isOne,
  machineDenominator,
  machineNumerator,
  neg,
  rationalGcd,
  reducedRational,
  isZero,
} from '../numerics/rationals';
import { asRadical } from './arithmetic-power';

import { flatten } from './flatten';
import { asRational } from './numerics';
import { NumericValue } from '../numeric-value/public';
import { mul } from './arithmetic-multiply';
import { canonicalDivide } from './arithmetic-divide';
import type { IComputeEngine } from '../types';

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
  engine: IComputeEngine;

  // Running literal products (if canonical)
  coefficient: NumericValue;

  // Other terms of the product, `term` is the key
  terms: {
    term: BoxedExpression;
    exponent: Rational;
  }[] = [];

  // If `false`, the running products are not calculated
  private _isCanonical = true;

  static from(expr: BoxedExpression): Product {
    return new Product(expr.engine, [expr]);
  }

  constructor(
    ce: IComputeEngine,
    xs?: ReadonlyArray<BoxedExpression>,
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
  mul(term: BoxedExpression, exp?: Rational) {
    console.assert(term.isCanonical || term.isStructural);
    if (this.coefficient.isNaN) return;

    if (term.isNaN) {
      this.coefficient = this.engine._numericValue(NaN);
      return;
    }

    if (term.operator === 'Multiply') {
      for (const t of term.ops!) this.mul(t, exp);
      return;
    }

    if (term.operator === 'Negate') {
      this.mul(term.op1, exp);
      this.coefficient = this.coefficient.neg();
      return;
    }

    if (this._isCanonical) {
      if (term.symbol === 'Nothing') return;

      exp ??= [1, 1];

      // If we're calculating a canonical product, fold exact literals into
      // running terms
      const num = term.numericValue;
      if (num !== null) {
        if (term.is(1)) return;

        if (term.is(0)) {
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
          if (isOne(exp)) {
            this.coefficient = this.engine._numericValue(
              term.isNegative ? -Infinity : Infinity
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

      if (!term.symbol) {
        // If possible, factor out a rational coefficient
        let coef: NumericValue;
        [coef, term] = term.toNumericValue();
        if (exp && !isOne(exp)) coef = coef.pow(this.engine._numericValue(exp));
        this.coefficient = this.coefficient.mul(coef);
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
    if (term.operator === 'Power') {
      // Term is `Power(op1, op2)`
      const r = asRational(term.op2);
      if (r) {
        this.mul(term.op1, rationalMul(exponent, r));
        return;
      }
    }

    if (term.operator === 'Sqrt') {
      // Term is `Sqrt(op1)`
      this.mul(term.op1, rationalMul(exponent, [1, 2]));
      return;
    }

    if (term.operator === 'Root') {
      // Term is `Root(op1, op2)`
      const r = asRational(term.op2);
      if (r) {
        this.mul(term.op1, rationalMul(exponent, inverse(r)));
        return;
      }
    }

    if (term.operator === 'Divide') {
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
        x.exponent = add(x.exponent, exponent);
        found = true;
        break;
      }
    }
    if (!found) this.terms.push({ term, exponent });
  }

  /** Divide the product by a term of coefficient */
  div(term: NumericValue | BoxedExpression) {
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
        terms: BoxedExpression[];
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

    const xs: { exponent: Rational; terms: BoxedExpression[] }[] = [];
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
  ): BoxedExpression {
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
  asNumeratorDenominator(): [BoxedExpression, BoxedExpression] {
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

  asRationalExpression(): BoxedExpression {
    const [numerator, denominator] = this.asNumeratorDenominator();
    return canonicalDivide(numerator, denominator);
  }
}

export function commonTerms(
  lhs: Product,
  rhs: Product
): [NumericValue, BoxedExpression] {
  const ce = lhs.engine;

  //
  // Extract common number literal between the two products
  //
  const coef = lhs.coefficient.gcd(rhs.coefficient);

  if (coef.isOne) return [ce._numericValue(1), ce.One];

  //
  // Extract common terms between the two products
  //

  const xs: BoxedExpression[] = [];

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

// Put the exponents in a bucket:
// - exponent 1
// - positive integer exponents
// - positive fractional exponents
// - negative integer exponents
// - negative fractional exponents
function degreeKey(exponent: Rational): number {
  if (isOne(exponent)) return 0;
  const [n, d] = [machineNumerator(exponent), machineDenominator(exponent)];
  if (n > 0 && Number.isInteger(n / d)) return 1;
  if (n > 0) return 2;
  if (Number.isInteger(n / d)) return 3;
  return 4;
}

function degreeOrder(
  a: {
    exponent: Rational;
    terms: BoxedExpression[];
  },
  b: {
    exponent: Rational;
    terms: BoxedExpression[];
  }
): number {
  const keyA = degreeKey(a.exponent);
  const keyB = degreeKey(b.exponent);
  if (keyA !== keyB) return keyA - keyB;

  const [a_n, a_d] = [
    machineNumerator(a.exponent),
    machineDenominator(a.exponent),
  ];
  const [b_n, b_d] = [
    machineNumerator(b.exponent),
    machineDenominator(b.exponent),
  ];
  return a_n / a_d - b_n / b_d;
}

function termsAsExpression(
  ce: IComputeEngine,
  terms: { exponent: Rational; terms: ReadonlyArray<BoxedExpression> }[]
): BoxedExpression {
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
