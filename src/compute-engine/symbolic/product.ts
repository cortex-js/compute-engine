import Complex from 'complex.js';
import { Decimal } from 'decimal.js';

import { BoxedExpression, IComputeEngine } from '../public';

import { order } from '../boxed-expression/order';
import {
  Rational,
  isOne,
  machineDenominator,
  machineNumerator,
  neg,
  rationalGcd,
  reducedRational,
} from '../numerics/rationals';
import { asRationalSqrt } from '../library/arithmetic-power';

import { flattenOps } from './flatten';
import { asRational, add } from '../boxed-expression/numerics';
import { NumericValue } from '../numeric-value/public';

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
  mul(term: BoxedExpression) {
    console.assert(term.isCanonical);

    if (term.head === 'Multiply') {
      for (const t of term.ops!) this.mul(t);
      return;
    }

    if (term.head === 'Negate') {
      this.mul(term.op1);
      this.coefficient = this.coefficient.neg();
      return;
    }

    if (this._isCanonical) {
      if (term.symbol === 'Nothing') return;

      // If we're calculation a canonical  product, fold exact literals into
      // running terms
      if (term.numericValue !== null) {
        if (term.isOne) return;

        if (term.isZero) {
          this.coefficient = this.engine._numericValue(0);
          return;
        }

        if (term.isNegativeOne) {
          this.coefficient = this.coefficient.neg();
          return;
        }

        if (term.isInfinity) {
          this.coefficient = this.engine._numericValue(
            term.isNegative ? -Infinity : Infinity
          );

          return;
        }

        const num = term.numericValue;
        if (num !== null) {
          this.coefficient = this.coefficient.mul(
            num instanceof Decimal || num instanceof Complex
              ? this.engine._numericValue(num)
              : num
          );
          return;
        }
      }

      const radical = asRationalSqrt(term);
      if (radical) {
        this.coefficient = this.coefficient.mul({
          radical: (radical[0] as number) * (radical[1] as number),
          rational: [1, Number(radical[1])],
        });
        return;
      }
    }

    let rest = term;
    if (this._isCanonical && !term.symbol) {
      // If possible, factor out a rational coefficient
      let coef: NumericValue;
      [coef, rest] = this.engine._toNumericValue(term);
      this.coefficient = this.coefficient.mul(coef);
    }

    // Note: rest should be positive, so no need to handle the -1 case
    if (rest.isOne) return;

    // If this is a power expression, extract the exponent
    let exponent: Rational = [1, 1];
    if (rest.head === 'Power') {
      // Term is `Power(op1, op2)`
      const r = asRational(rest.op2);
      if (r) {
        const exponentExpr = rest.op2;
        exponent = r;
        rest = rest.op1;
        if (rest.head === 'Multiply') {
          // We have Power(Multiply(...), exponent): apply the power law
          // to each term
          for (const x of rest.ops!)
            this.mul(this.engine._fn('Power', [x, exponentExpr]));
          return;
        } else if (rest.head === 'Divide') {
          // We have Power(Divide(...), exponent): apply the power law
          // to each term
          this.mul(this.engine._fn('Power', [rest.op1, exponentExpr]));
          this.mul(
            this.engine._fn('Power', [
              rest.op2,
              this.engine.number(neg(exponent)),
            ])
          );
          return;
        }
      }
    } else if (rest.head === 'Divide') {
      this.mul(rest.op1);
      exponent = [-1, 1];
      rest = rest.op2;
    }

    // Look for the base, and add the exponent if already in the list of terms
    let found = false;
    for (const x of this.terms) {
      if (x.term.isSame(rest)) {
        x.exponent = add(x.exponent, exponent);
        found = true;
        break;
      }
    }
    if (!found) this.terms.push({ term: rest, exponent });
  }

  /** Divide the product by a term of coefficient */
  div(term: NumericValue | BoxedExpression) {
    if (term instanceof NumericValue)
      this.coefficient = this.coefficient.div(term);
    else this.mul(term.engine.inv(term));
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
    const xs: { exponent: Rational; terms: BoxedExpression[] }[] = [];
    if (!this.coefficient.isOne) {
      if (mode === 'rational' && this.coefficient.isExact) {
        // Numerator
        let num = ce._fromNumericValue(this.coefficient.num);
        if (!num.isOne) xs.push({ exponent: [1, 1], terms: [num] });
        // Denominator
        const denom = ce._fromNumericValue(this.coefficient.denom);
        if (!denom.isOne) xs.push({ exponent: [-1, 1], terms: [denom] });
      } else if (mode === 'numeric') {
        const c = this.coefficient.N();
        xs.push({
          exponent: [1, 1],
          terms: [ce.number(ce.complex(c.re, c.im))],
        });
      } else {
        xs.push({
          exponent: [1, 1],
          terms: [ce._fromNumericValue(this.coefficient)],
        });
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

  asExpression(mode: 'N' | 'evaluate' = 'evaluate'): BoxedExpression {
    const ce = this.engine;

    const coef = this.coefficient;
    if (coef.isPositiveInfinity) return ce.PositiveInfinity;
    if (coef.isNegativeInfinity) return ce.NegativeInfinity;
    if (coef.isZero) return ce.Zero;

    // If the coef is -1, temporarily set it to 1
    const isNegativeOne = coef.isNegativeOne;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const groupedTerms = this.groupedByDegrees({
      mode: mode === 'N' ? 'numeric' : 'expression',
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
    if (coef.isPositiveInfinity || coef.isNegativeInfinity)
      return [ce.NaN, ce.NaN];

    // If the coef is -1, temporarily set it to 1
    const isNegativeOne = coef.isNegativeOne;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const xs = this.groupedByDegrees({ mode: 'rational' });

    if (isNegativeOne) this.coefficient = ce._numericValue(-1);

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
    if (denominator.isOne) return numerator;
    if (denominator.isNegativeOne) return numerator.neg();
    return this.engine._fn('Divide', [numerator, denominator]);
  }
}

export function commonTerms(lhs: Product, rhs: Product): BoxedExpression {
  const ce = lhs.engine;

  // The common coefficient between the two products
  const coef = lhs.coefficient.gcd(rhs.coefficient);

  // Extract common terms between two products

  const xs: BoxedExpression[] = [];

  for (const x of lhs.terms) {
    // Find the term in the rhs product
    const y = rhs.terms.find((y) => x.term.isSame(y.term));
    if (!y) continue;
    const exponent = rationalGcd(x.exponent, y.exponent);
    if (isOne(exponent)) xs.push(x.term);
    else xs.push(ce.pow(x.term, exponent));
  }

  // Put everything together
  return ce.function('Multiply', [ce._fromNumericValue(coef), ...xs]);
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
  let result: ReadonlyArray<BoxedExpression> = terms
    .sort(degreeOrder)
    .map((x) => {
      const t = flattenOps(x.terms, 'Multiply');
      const base =
        t.length <= 1 ? t[0] : ce._fn('Multiply', [...t].sort(order));
      return ce.pow(base, x.exponent);
    });
  result = flattenOps(result, 'Multiply') ?? result;
  if (result.length === 0) return ce.One;
  if (result.length === 1) return result[0];
  return ce._fn('Multiply', [...result].sort(order));
}
