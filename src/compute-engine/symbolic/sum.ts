import { BoxedExpression, IComputeEngine, Rational } from '../public';

import { complexAllowed, bignumPreferred } from '../boxed-expression/utils';

import { flattenOps } from './flatten';
import {
  add,
  asRational,
  isRationalInteger,
  isRationalZero,
  machineDenominator,
  machineNumerator,
  mul,
} from '../numerics/rationals';
import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { asCoefficient } from '../numerics/factor';
import { canonicalAdd } from '../library/arithmetic-add';

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

  // Each term is factored as the product of a numeric coefficient and
  // an expression
  private _terms: { coef: BoxedExpression; term: BoxedExpression }[] = [];

  constructor(
    ce: IComputeEngine,
    xs?: BoxedExpression[],
    options?: { canonical?: boolean }
  ) {
    options ??= {};
    if (!('canonical' in options)) this._isCanonical = true;
    else this._isCanonical = options.canonical!;
    this.engine = ce;

    this._rational = [0, 1];

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
   * A term is a coefficient and an expression.
   * Optionally, the term is multiplied by the constant `c` before being added.
   *
   * If the sum already has this term, the coefficient is added
   * to the previous one. Otherwise, a new entry is added.
   *
   * E.g. "2x + x + 1/5 y"
   *  -> [['x', [3, 1]], ['y', [1, 5]]]
   */
  addTerm(term: BoxedExpression, c?: BoxedExpression) {
    if (term.isNothing) return;
    if (term.isNaN || (term.isImaginary && !complexAllowed(this.engine))) {
      this._naNCount += 1;
      return;
    }

    if (this._isCanonical && term.numericValue !== null) {
      if (term.isInfinity) {
        if (term.isPositive) this._posInfinityCount += 1;
        else this._negInfinityCount += 1;
        return;
      }

      const r = asRational(term);
      if (r) {
        if (c === undefined) {
          this._rational = add(this._rational, r);
          return;
        }

        const cr = asRational(c);
        if (cr) {
          this._rational = add(this._rational, mul(r, cr));
          return;
        }
      }

      const num = term.numericValue;

      if (num !== null && typeof num === 'number') {
        if (bignumPreferred(this.engine)) this._bignum = this._bignum.add(num);
        else this._number += num;
        return;
      }

      if (num !== null && num instanceof Decimal) {
        this._bignum = this._bignum.add(num);
        return;
      }

      if (num !== null && num instanceof Complex) {
        let re = num.re;
        let im = num.im;
        if (c === undefined) {
          this._number += re;
          re = 0;
          if (Number.isInteger(im)) {
            this._imaginary += im;
            im = 0;
          }
        }

        if (re === 0 && im === 0) return;
        term = this.engine.number(this.engine.complex(re, im));
      }
    }

    let coef: BoxedExpression;
    [coef, term] = asCoefficient(term);

    // If the term was a numeric expression, e.g. "2√5" (<= term.isOne),
    // use the coef as a basis if not a numeric value.
    // This will allow us to factor out exact literals.
    // if (term.isOne && coef.numericValue === null) [term, coef] = [coef, term];

    if (coef.isZero) return;

    if (c !== undefined) coef = this.engine.mul(coef, c);

    if (term.head === 'Negate') {
      this.addTerm(term.op1, this.engine.neg(coef));
      return;
    }

    if (term.head === 'Add') {
      for (const x of term.ops!) this.addTerm(x, coef);
      return;
    }

    // if (term.isOne) {
    //   for (let i = 0; i < this._terms.length; i++) {
    //     if (this._terms[i].term.isOne) {
    //       if (this._terms[i].coef.head === 'Add') {
    //         this._terms[i].coef.ops!.push(coef);
    //       } else {
    //         this._terms[i].coef = this.engine._fn('Add', [
    //           this._terms[i].coef,
    //           coef,
    //         ]);
    //       }
    //       return;
    //     }
    //   }
    //   this._terms.push({ coef, term });
    //   return;
    // }

    if (term.numericValue === null) {
      for (let i = 0; i < this._terms.length; i++) {
        if (
          this._terms[i].term.numericValue === null &&
          term.isSame(this._terms[i].term)
        ) {
          if (this._terms[i].coef.head === 'Add') {
            this._terms[i].coef.ops!.push(coef);
          } else {
            this._terms[i].coef = canonicalAdd(this.engine, [
              this._terms[i].coef,
              coef,
            ]);
          }
          return;
        }
      }
    }

    this._terms.push({ coef, term });
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

    // Reduce the coefficients
    // √2 + 2√2 -> 3√2
    // for (let i = 0; i < this._terms.length; i++) {
    //   const coef = this._terms[i].coef;
    //   if (coef.head === 'Add') {
    //     const sum = new Sum(ce, coef.ops!);
    //     this._terms[i].coef = sum.asExpression(mode);
    //   }
    // }

    const xs: BoxedExpression[] = [];
    for (let { coef, term } of this._terms) {
      if (mode === 'numeric') coef = coef.N();
      if (!coef.isZero) xs.push(ce.mul(coef, term));
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
      if (this._imaginary !== 0) {
        let re = this._number;
        this._number = 0;
        if (isRationalInteger(this._rational)) {
          re += Number(this._rational[0]);
          this._rational = [0, 1];
        }
        xs.push(ce.number(ce.complex(re, this._imaginary)));
      }
      if (!isRationalZero(this._rational)) xs.push(ce.number(this._rational));
      if (bignumPreferred(this.engine)) {
        const sum = this._bignum.add(this._number);
        if (!sum.isZero()) xs.push(ce.number(sum));
      } else {
        const sum = this._bignum.toNumber() + this._number;
        if (sum !== 0) xs.push(ce.number(sum));
      }
    }
    return flattenOps(xs, 'Add');
  }

  asExpression(mode: 'expression' | 'numeric'): BoxedExpression {
    return canonicalAdd(this.engine, this.terms(mode));
  }
}
