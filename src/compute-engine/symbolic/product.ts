import { BoxedExpression, IComputeEngine, Rational } from '../public';

import { flattenOps } from './flatten';
import { order } from '../boxed-expression/order';
import {
  add,
  asCoefficient,
  asRational,
  isBigRational,
  isMachineRational,
  isRational,
  isRationalOne,
  machineDenominator,
  machineNumerator,
  mul,
  neg,
  reducedRational,
} from '../numerics/rationals';
import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { complexAllowed, bignumPreferred } from '../boxed-expression/utils';

/**
 * Group terms in a product by common term.
 *
 * All the terms should be canonical.
 * - the arguments should have been flattened for `Multiply`
 *
 * - any argument of power been factored out, i.e.
 *      (ab)^2 ->  a^2 b^2
 * *
 * 3 + √5 + √(x+1) + x^2 + (a+b)^2 + d
 *  -> [ [[3, "d"], [1, 1]],
 *       [[5, "x+1"], [1, 2]],
 *       [[x, "a+b"], [2, 1]]
 *      ]
 *
 */
export class Product {
  engine: IComputeEngine;

  // Running products (if canonical)
  private _rational: Rational;
  private _squareRootRational: Rational;
  private _complex: Complex;
  private _bignum: Decimal;
  private _number: number;

  // Other terms of the product, `term` is the key
  private _terms: {
    term: BoxedExpression;
    exponent: Rational;
  }[] = [];

  private _hasInfinity = false;
  private _hasZero = false;

  // If `false`, the running products are not calculated
  private _isCanonical = true;

  constructor(
    ce: IComputeEngine,
    xs?: BoxedExpression[],
    options?: { canonical?: boolean }
  ) {
    options ??= {};
    if (!('canonical' in options)) options.canonical = true;
    this._isCanonical = options.canonical!;

    this.engine = ce;
    this._rational = bignumPreferred(ce)
      ? [ce._BIGNUM_ONE, ce._BIGNUM_ONE]
      : [1, 1];
    this._squareRootRational = this._rational;
    this._complex = Complex.ONE;
    this._bignum = ce._BIGNUM_ONE;
    this._number = 1;

    if (xs) for (const x of xs) this.addTerm(x);
  }

  get isEmpty(): boolean {
    if (!this._isCanonical) return this._terms.length === 0;
    return (
      this._terms.length === 0 &&
      this._hasInfinity === false &&
      this._hasZero === false &&
      isRationalOne(this._rational) &&
      isRationalOne(this._squareRootRational) &&
      this._complex.re === 1 &&
      this._complex.im === 0 &&
      this._bignum.eq(this.engine._BIGNUM_ONE) &&
      this._number === 1
    );
  }

  /**
   * Add a term to the product.
   *
   * If `this._isCanonical` a running product of exact terms is kept.
   * Otherwise, terms and their exponent are tallied.
   */
  addTerm(term: BoxedExpression) {
    console.assert(term.isCanonical);

    if (this._isCanonical) {
      if (term.isNothing) return;

      if (term.head === 'Sqrt') {
        const r = asRational(term.op1);
        if (r) {
          this._squareRootRational = mul(this._squareRootRational, r);
          return;
        }
      }

      // If we're calculation a canonical  product, fold exact literals into
      // running terms
      if (term.isLiteral) {
        if (term.isOne) return;

        if (term.isZero) {
          this._hasZero = true;
          return;
        }

        if (term.isNegativeOne) {
          this._rational = neg(this._rational);
          return;
        }

        if (term.isInfinity) {
          this._hasInfinity = true;
          return;
        }

        const num = term.numericValue;
        if (typeof num === 'number') {
          if (Number.isInteger(num))
            this._rational = mul(this._rational, [num, 1]);
          else if (bignumPreferred(this.engine)) {
            this._bignum = this._bignum.mul(Math.abs(num));
            if (num < 0) this._rational = neg(this._rational);
          } else {
            this._number *= Math.abs(num);
            if (num < 0) this._rational = neg(this._rational);
          }
          return;
        }

        if (num instanceof Decimal) {
          if (num.isInteger())
            this._rational = mul(this._rational, [
              num,
              this.engine._BIGNUM_ONE,
            ]);
          else if (bignumPreferred(this.engine)) {
            this._bignum = this._bignum.mul(num.abs());
            if (num.isNegative()) this._rational = neg(this._rational);
          } else {
            this._number *= Math.abs(num.toNumber());
            if (num.isNegative()) this._rational = neg(this._rational);
          }
          return;
        }
        if (num instanceof Complex) {
          this._complex = this._complex.mul(num);
          return;
        }
        if (isRational(num)) {
          this._rational = mul(this._rational, num);
          return;
        }
      }
    }

    let rest = term;
    if (this._isCanonical) {
      let coef: Rational;
      [coef, rest] = asCoefficient(term);
      this._rational = mul(this._rational, coef);
    }

    if (rest.isLiteral && rest.isOne) return;

    // If this is a power expression, extract the exponent
    let exponent: Rational = [1, 1];
    if (rest.head === 'Power' && rest.op2.isLiteral) {
      // Term is `Power(op1, op2)`
      const r = asRational(rest.op2);
      if (r) {
        exponent = r;
        rest = rest.op1;
      }
    }

    // If the base is non-negative, look for the base, and add the exponent
    // if already in the list of terms
    let found = false;
    if (rest.isNonNegative) {
      for (const x of this._terms) {
        if (x.term.isSame(rest)) {
          x.exponent = add(x.exponent, exponent);
          found = true;
          break;
        }
      }
    }
    if (!found) this._terms.push({ term: rest, exponent });
  }

  unitTerms(
    mode: 'rational' | 'expression' | 'numeric'
  ): { exponent: Rational; terms: BoxedExpression[] }[] {
    const xs: { exponent: Rational; terms: BoxedExpression[] }[] = [];

    const ce = this.engine;

    if (mode === 'numeric') {
      if (!complexAllowed(ce) && this._complex.im !== 0)
        return [{ exponent: [1, 1], terms: [ce._NAN] }];

      // Collapse all numeric literals
      if (bignumPreferred(ce)) {
        let b = ce._BIGNUM_ONE;
        if (!isRationalOne(this._rational)) {
          if (isBigRational(this._rational))
            b = this._rational[0].div(this._rational[1]);
          else b = ce.bignum(this._rational[0]).div(this._rational[1]);
        }

        if (!isRationalOne(this._squareRootRational)) {
          if (isBigRational(this._squareRootRational))
            b = b.mul(
              this._squareRootRational[0]
                .div(this._squareRootRational[1])
                .sqrt()
            );
          else
            b = b.mul(
              ce
                .bignum(this._squareRootRational[0])
                .div(this._squareRootRational[1])
                .sqrt()
            );
        }

        b = b.mul(this._bignum).mul(this._number);

        if (this._complex.im === 0) b = b.mul(this._complex.re);
        else {
          const z = this._complex.mul(b.toNumber());
          return [{ exponent: [1, 1], terms: [ce.number(z)] }];
        }
        return [{ exponent: [1, 1], terms: [ce.number(b)] }];
      } else {
        // Machine preferred
        let n = 1;
        if (!isRationalOne(this._rational)) {
          if (isBigRational(this._rational))
            n = this._rational[0].toNumber() / this._rational[1].toNumber();
          else n = this._rational[0] / this._rational[1];
        }

        if (!isRationalOne(this._squareRootRational)) {
          if (isBigRational(this._squareRootRational))
            n *= Math.sqrt(
              this._squareRootRational[0].toNumber() /
                this._squareRootRational[1].toNumber()
            );
          else
            n *= Math.sqrt(
              this._squareRootRational[0] / this._squareRootRational[1]
            );
        }

        n *= this._number * this._bignum.toNumber();

        if (this._complex.im === 0) n *= this._complex.re;
        else {
          const z = this._complex.mul(n);
          return [{ exponent: [1, 1], terms: [ce.number(z)] }];
        }

        return [{ exponent: [1, 1], terms: [ce.number(n)] }];
      }
    }

    //
    // Terms of degree 1 (exponent = [1,1])
    //
    const unitTerms: BoxedExpression[] = [];
    if (this._hasInfinity) unitTerms.push(ce._POSITIVE_INFINITY);

    this._rational = reducedRational(this._rational);
    this._squareRootRational = reducedRational(this._squareRootRational);

    if (!isRationalOne(this._rational)) {
      if (mode === 'rational') {
        if (machineNumerator(this._rational) !== 1)
          unitTerms.push(ce.number(this._rational[0]));
        if (machineDenominator(this._rational) !== 1)
          xs.push({
            exponent: [-1, 1],
            terms: [ce.number(this._rational[1])],
          });
      } else {
        unitTerms.push(ce.number(this._rational));
      }
    }

    if (!isRationalOne(this._squareRootRational)) {
      if (mode === 'rational') {
        if (machineNumerator(this._squareRootRational) !== 1)
          unitTerms.push(ce.sqrt(ce.number(this._squareRootRational[0])));
        if (machineDenominator(this._squareRootRational) !== 1)
          xs.push({
            exponent: [-1, 1],
            terms: [ce.sqrt(ce.number(this._squareRootRational[1]))],
          });
      } else {
        unitTerms.push(ce.sqrt(ce.number(this._squareRootRational)));
      }
    }

    // Complex
    if (this._complex.re !== 1 || this._complex.im !== 0) {
      if (this._complex.im === 0) this._number *= Math.abs(this._complex.re);
      if (this._complex.re < 0) this._rational = neg(this._rational);
      else {
        unitTerms.push(ce.number(this._complex));
      }
    }

    // Literal
    if (!this._bignum.equals(ce._BIGNUM_ONE))
      unitTerms.push(ce.number(this._bignum.mul(this._number)));
    else if (this._number !== 1) unitTerms.push(ce.number(this._number));

    if (unitTerms.length > 0) xs.push({ exponent: [1, 1], terms: unitTerms });

    return xs;
  }

  /** The terms of the product, grouped by degrees.
   *
   * If `mode` is `rational`, rationals are split into separate numerator and
   * denominator, so that a rational expression can be created later
   * If `mode` is `expression`, a regular expression is returned, without
   * splitting rationals
   * If `mode` is `numeric`, the literals are combined into one expression
   *
   */
  groupedByDegrees(options?: {
    mode?: 'rational' | 'expression' | 'numeric';
  }): {
    exponent: Rational;
    terms: BoxedExpression[];
  }[] {
    options ??= {};
    if (!('mode' in options)) options.mode = 'expression';

    const ce = this.engine;

    if (options.mode === 'numeric') {
      if (this._complex.im !== 0 && !complexAllowed(ce))
        return [{ exponent: [1, 1], terms: [ce._NAN] }];

      if (this._hasInfinity)
        return [{ exponent: [1, 1], terms: [ce._POSITIVE_INFINITY] }];
    }

    const xs = this.unitTerms(options.mode ?? 'expression');

    //
    // Other terms
    //
    for (const t of this._terms) {
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

  // terms(): BoxedExpression[] {
  //   return termsAsExpressions(this.engine, this.groupedByDegrees());
  // }

  asExpression(mode: 'N' | 'evaluate' = 'evaluate'): BoxedExpression {
    const ce = this.engine;

    if (this._hasInfinity) {
      if (this._hasZero) return ce._NAN;
      if (this._terms.length === 0) {
        if (machineNumerator(this._rational) > 0) return ce._POSITIVE_INFINITY;
        return ce._NEGATIVE_INFINITY;
      }
    }

    if (this._hasZero) return ce._ZERO;

    let terms = termsAsExpressions(
      ce,
      this.groupedByDegrees({ mode: mode === 'N' ? 'numeric' : 'expression' })
    );

    terms = flattenOps(terms, 'Multiply') ?? terms;
    if (terms.length === 0) return ce._ONE;
    if (terms.length === 1) return terms[0];
    return this.engine._fn('Multiply', terms);
  }

  /** The product, expressed as a numerator and denominator */
  asNumeratorDenominator(): [BoxedExpression, BoxedExpression] {
    const xs = this.groupedByDegrees({ mode: 'rational' });
    const xsNumerator: {
      exponent: Rational;
      terms: BoxedExpression[];
    }[] = [];
    const xsDenominator: {
      exponent: Rational;
      terms: BoxedExpression[];
    }[] = [];

    for (const x of xs)
      if (
        (typeof x.exponent[0] === 'number' && x.exponent[0] >= 0) ||
        (typeof x.exponent[0] !== 'number' && x.exponent[0].isPositive())
      )
        xsNumerator.push(x);
      else
        xsDenominator.push({
          exponent: neg(x.exponent),
          terms: x.terms,
        });

    const ce = this.engine;

    let numeratorTerms = termsAsExpressions(ce, xsNumerator);
    numeratorTerms = flattenOps(numeratorTerms, 'Multiply') ?? numeratorTerms;
    let numerator = ce._ONE;
    if (numeratorTerms.length === 1) numerator = numeratorTerms[0];
    else if (numeratorTerms.length > 0)
      numerator = ce._fn('Multiply', numeratorTerms);

    let denominatorTerms = termsAsExpressions(ce, xsDenominator);
    denominatorTerms =
      flattenOps(denominatorTerms, 'Multiply') ?? denominatorTerms;
    let denominator = ce._ONE;
    if (denominatorTerms.length === 1) denominator = denominatorTerms[0];
    else if (denominatorTerms.length > 0)
      denominator = ce._fn('Multiply', denominatorTerms);

    return [numerator, denominator];
  }

  asRationalExpression(): BoxedExpression {
    const [numerator, denominator] = this.asNumeratorDenominator();
    if (denominator.isOne) return numerator;
    if (denominator.isNegativeOne) return this.engine.negate(numerator);
    return this.engine._fn('Divide', [numerator, denominator]);
  }
}

// Put the exponents in a bucket:
// - exponent 1
// - positive integer exponents
// - positive fractional exponents
// - negative integer exponents
// - negative fractional exponents
function degreeKey(exponent: Rational): number {
  if (isRationalOne(exponent)) return 0;
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
  if (isBigRational(a.exponent) && isBigRational(b.exponent)) {
    return a.exponent[0]
      .div(a.exponent[1])
      .sub(b.exponent[0].div(b.exponent[1]))
      .toNumber();
  }
  if (isBigRational(a.exponent) && isMachineRational(b.exponent)) {
    return a.exponent[0]
      .div(a.exponent[1])
      .sub(b.exponent[0] / b.exponent[1])
      .toNumber();
  }
  if (isMachineRational(a.exponent) && isBigRational(b.exponent)) {
    return b.exponent[0]
      .div(b.exponent[1])
      .add(-a.exponent[0] / a.exponent[1])
      .toNumber();
  }
  return (
    (a.exponent[0] as number) / (a.exponent[1] as number) -
    (b.exponent[0] as number) / (b.exponent[1] as number)
  );
}

function termsAsExpressions(
  ce: IComputeEngine,
  terms: { exponent: Rational; terms: BoxedExpression[] }[]
): BoxedExpression[] {
  terms = terms.sort(degreeOrder);
  const result = terms.map((x) => {
    const t = flattenOps(x.terms, 'Multiply') ?? x.terms;
    const base = t.length <= 1 ? t[0] : ce._fn('Multiply', t.sort(order));
    if (isRationalOne(x.exponent)) return base;
    return ce.power(base, x.exponent);
  });
  return flattenOps(result, 'Multiply') ?? result;
}
