import { BoxedExpression, IComputeEngine, Rational } from '../public';

import { sortAdd } from '../boxed-expression/order';
import { complexAllowed, bignumPreferred } from '../boxed-expression/utils';

import { flattenOps } from './flatten';
import {
  add,
  asCoefficient,
  asRational,
  isMachineRational,
  isRationalNegativeOne,
  isRationalOne,
  isRationalZero,
  machineDenominator,
  machineNumerator,
  mul,
  neg,
} from '../numerics/rationals';
import Complex from 'complex.js';
import Decimal from 'decimal.js';

export class Sum {
  private engine: IComputeEngine;

  // If `false`, the running sums are not calculated
  private _isCanonical = true;

  // Factor out exact literals (if canonical) in running sums
  private _rational: Rational;
  private _imaginary = 0; // integers only
  private _number: number;
  private _bignum: Decimal;

  private _posInfinityCount = 0;
  private _negInfinityCount = 0;
  private _naNCount = 0;

  // Each term is factored as the product of a rational and an expression
  // For now, only rationals are factored, so `1.2x + 2.5x` are not combined.
  private _terms: { coef: Rational; term: BoxedExpression }[] = [];

  constructor(
    ce: IComputeEngine,
    xs?: BoxedExpression[],
    options?: { canonical?: boolean }
  ) {
    options ??= {};
    if (!('canonical' in options)) this._isCanonical = true;
    else this._isCanonical = options.canonical!;
    this.engine = ce;

    this._rational = bignumPreferred(ce) ? [BigInt(0), BigInt(1)] : [0, 1];

    this._bignum = ce._BIGNUM_ZERO;
    this._number = 0;

    if (xs) for (const x of xs) this.addTerm(x);
  }

  get isEmpty(): boolean {
    if (!this._isCanonical) return this._terms.length === 0;

    return (
      this._terms.length === 0 &&
      isRationalZero(this._rational) &&
      this._imaginary === 0 &&
      this._number === 0 &&
      this._bignum.isZero() &&
      this._negInfinityCount === 0 &&
      this._posInfinityCount === 0 &&
      this._naNCount === 0
    );
  }

  /**
   * Add a term to the sum.
   *
   * A term is a rational coefficient and an expression.
   * Optionally, the term is multiplied by the constant `c` before being added.
   *
   * If the sum already has this term, the coefficient is added
   * to the previous one. Otherwise, a new entry is added.
   *
   * E.g. "2x + x + 1/5 y"
   *  -> [['x', [3, 1]], ['y', [1, 5]]]
   */
  addTerm(term: BoxedExpression, c?: Rational) {
    if (term.isNothing) return;
    if (term.isNaN || (term.isImaginary && !complexAllowed(this.engine))) {
      this._naNCount += 1;
      return;
    }

    if (this._isCanonical) {
      if (term.numericValue !== null) {
        if (term.isInfinity) {
          if (term.isPositive) this._posInfinityCount += 1;
          else this._negInfinityCount += 1;
          return;
        }

        const r = asRational(term);
        if (r) {
          this._rational = add(this._rational, c === undefined ? r : mul(r, c));
          return;
        }

        const num = term.numericValue;

        if (num !== null && typeof num === 'number') {
          console.assert(!Number.isInteger(num));
          if (bignumPreferred(this.engine))
            this._bignum = this._bignum.add(num);
          else this._number += num;
          return;
        }

        if (num !== null && num instanceof Decimal) {
          console.assert(!num.isInteger());
          this._bignum = this._bignum.add(num);
          return;
        }

        if (num !== null && num instanceof Complex) {
          let re = num.re;
          let im = num.im;
          if (Number.isInteger(re)) {
            this._rational = add(this._rational, mul([re, 1], c ?? [1, 1]));
            re = 0;
          } else {
            if (bignumPreferred(this.engine))
              this._bignum = this._bignum.add(re);
            else this._number += re;
            re = 0;
          }
          if (Number.isInteger(im)) {
            if (c === undefined) this._imaginary += im;
            else if (isMachineRational(c))
              this._imaginary += (im * c[0]) / c[1];
            else
              this._imaginary += this.engine
                .bignum(c[0])
                .mul(im)
                .div(this.engine.bignum(c[1]))
                .toNumber();
            im = 0;
          }
          if (re === 0 && im === 0) return;
          term = this.engine.number(this.engine.complex(re, im));
        }
      }
    }

    let coef: Rational;
    [coef, term] = asCoefficient(term);

    if (isRationalZero(coef)) return;

    if (c !== undefined) coef = mul(coef, c);

    if (term.head === 'Negate') {
      this.addTerm(term.op1, neg(coef));
      return;
    }

    if (term.head === 'Add') {
      for (const x of term.ops!) this.addTerm(x, coef);
      return;
    }

    let hasTerm = false;
    if (term.numericValue === null) {
      // There's an overhead to calculate the hash.
      // For best results, only use the hash if there are many terms
      if (this._terms.length > 500) {
        const h = term.hash;
        for (let i = 0; i < this._terms.length; i++) {
          if (
            this._terms[i].term.numericValue === null &&
            h === this._terms[i].term.hash &&
            term.isSame(this._terms[i].term)
          ) {
            this._terms[i].coef = add(this._terms[i].coef, coef);
            hasTerm = true;
            break;
          }
        }
      } else {
        for (let i = 0; i < this._terms.length; i++) {
          if (
            this._terms[i].term.numericValue === null &&
            term.isSame(this._terms[i].term)
          ) {
            this._terms[i].coef = add(this._terms[i].coef, coef);
            hasTerm = true;
            break;
          }
        }
      }
    }

    if (!hasTerm) this._terms.push({ term, coef });
  }

  // For debugging
  toString(): string {
    const xs = this.terms('expression');
    if (xs.length === 0) return '0';
    return xs.map((x) => x.toString()).join('\\n');
  }

  terms(mode: 'expression' | 'numeric'): BoxedExpression[] {
    const ce = this.engine;

    if (this._naNCount > 0) return [ce.NaN];
    if (this._imaginary !== 0 && !complexAllowed(ce)) return [ce.NaN];

    if (this._posInfinityCount > 0 && this._negInfinityCount > 0)
      return [ce.NaN];
    if (this._posInfinityCount > 0) return [ce.PositiveInfinity];
    if (this._negInfinityCount > 0) return [ce.NegativeInfinity];

    const xs: BoxedExpression[] = [];
    for (const { coef, term } of this._terms) {
      if (!isRationalZero(coef)) {
        if (isRationalOne(coef)) xs.push(term);
        else if (isRationalNegativeOne(coef)) xs.push(ce.neg(term));
        else if (machineDenominator(coef) === 1)
          xs.push(ce.mul([ce.number(coef[0]), term]));
        else if (machineNumerator(coef) === 1)
          xs.push(ce.div(term, ce.number(coef[1])));
        else xs.push(ce.mul([ce.number(coef), term]));
      }
    }

    if (mode === 'numeric') {
      if (bignumPreferred(this.engine)) {
        let sum = this._bignum.add(this._number);
        if (!isRationalZero(this._rational))
          sum = sum.add(
            ce.bignum(this._rational[0]).div(ce.bignum(this._rational[1]))
          );

        if (this._imaginary !== 0)
          xs.push(ce.number(ce.complex(sum.toNumber(), this._imaginary)));
        else if (!sum.isZero()) xs.push(ce.number(sum));
      } else {
        let sum = this._bignum.toNumber() + this._number;
        if (!isRationalZero(this._rational))
          sum +=
            machineNumerator(this._rational) /
            machineDenominator(this._rational);

        if (this._imaginary !== 0)
          xs.push(ce.number(ce.complex(sum, this._imaginary)));
        else if (sum !== 0) xs.push(ce.number(sum));
      }
    } else {
      if (!isRationalZero(this._rational)) xs.push(ce.number(this._rational));
      if (this._imaginary !== 0) {
        if (!complexAllowed(ce)) return [ce.NaN];
        xs.push(ce.number(ce.complex(0, this._imaginary)));
      }
      if (bignumPreferred(this.engine)) {
        const sum = this._bignum.add(this._number);
        if (!sum.isZero()) xs.push(ce.number(sum));
      } else {
        if (!this._bignum.isZero()) xs.push(ce.number(this._bignum));
        if (this._number !== 0) xs.push(ce.number(this._number));
      }
    }
    return flattenOps(xs, 'Add');
  }

  asExpression(mode: 'expression' | 'numeric'): BoxedExpression {
    const ce = this.engine;

    const xs = this.terms(mode);
    if (xs.length === 0) return ce.Zero;
    if (xs.length === 1) return xs[0];

    return ce._fn('Add', sortAdd(ce, xs));
  }
}
