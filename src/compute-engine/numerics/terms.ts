import Complex from 'complex.js';
import Decimal from 'decimal.js';

import { BoxedExpression, IComputeEngine } from '../public';

import { bignumPreferred } from '../boxed-expression/utils';

import { applyCoefficient } from '../boxed-expression/factor';
import {
  Rational,
  isRational,
  isRationalNegativeOne,
  isRationalOne,
  isRationalZero,
  neg,
} from './rationals';
import { add, asCoefficient, mul } from '../boxed-expression/numerics';

export class Terms {
  private engine: IComputeEngine;
  private terms: { coef: Rational; term: BoxedExpression }[] = [];

  constructor(ce: IComputeEngine, terms: ReadonlyArray<BoxedExpression>) {
    this.engine = ce;
    for (const term of terms) this.add(term);
  }

  sub(term: BoxedExpression): void {
    this.add(term, [-1, 1] as Rational);
  }

  add(term2: BoxedExpression, coef2?: Rational): void {
    coef2 ??= [1, 1] as Rational;
    let [coef, term] = asCoefficient(term2);
    coef = mul(coef, coef2);
    if (isRationalZero(coef)) return;

    if (term.head === 'Add') {
      for (const x of term.ops!) this.add(x, coef);
      return;
    }

    if (term.head === 'Negate') {
      this.add(term.op1, neg(coef));
      return;
    }

    const i = this.find(term);
    if (i >= 0) {
      this.terms[i].coef = add(this.terms[i].coef, coef);
      return;
    }
    this.terms.push({ coef, term });
  }

  find(term: BoxedExpression): number {
    return this.terms.findIndex((x) => x.term.isSame(term));
  }

  /** If `exact` is true, keep exact numbers */
  reduceNumbers({ exact }: { exact: boolean }): void {
    const ce = this.engine;
    let terms = this.terms;
    this.terms = [];
    let posInfinityCount = 0;
    let negInfinityCount = 0;
    let real = 0;
    let imaginary = 0;
    let rational = [0, 1] as Rational;
    let bignum = ce._BIGNUM_ZERO;

    // Iterate over all the terms and isolate numeric values
    for (const { coef, term } of terms) {
      if (term.isNaN) {
        this.terms = [{ term: ce.NaN, coef: [1, 1] }];
        return;
      }
      if (term.isFinite === false) {
        if (term.isPositive) posInfinityCount++;
        else negInfinityCount++;
        continue;
      }

      if (term.numericValue !== null) {
        const n = applyCoefficient(term.numericValue, coef);
        if (n !== null) {
          if (isRational(n)) rational = add(rational, n);
          else if (n instanceof Decimal) bignum = bignum.add(n);
          else if (n instanceof Complex) {
            if (bignumPreferred(ce)) bignum = bignum.add(n.re);
            else real += n.re;
            imaginary += n.im;
          } else if (bignumPreferred(ce)) bignum = bignum.add(n);
          else real += n;
          continue;
        }
      }

      this.terms.push({ coef, term });
    }

    if (posInfinityCount > 0 && negInfinityCount > 0) {
      this.terms = [{ term: ce.NaN, coef: [1, 1] }];
      return;
    }
    if (posInfinityCount > 0) {
      this.terms = [{ term: ce.PositiveInfinity, coef: [1, 1] }];
      return;
    }
    if (negInfinityCount > 0) {
      this.terms = [{ term: ce.NegativeInfinity, coef: [1, 1] }];
      return;
    }

    // Should we collapse the numeric values?
    if (
      !exact ||
      !Number.isInteger(real) ||
      !bignum.isInteger() ||
      !Number.isInteger(imaginary)
    ) {
      if (!isRationalZero(rational)) {
        bignum = bignum.add(ce.bignum(rational[0]).div(ce.bignum(rational[1])));
        rational = [0, 1] as Rational;
      }

      if (!bignum.isZero() && bignumPreferred(ce)) {
        bignum = bignum.add(real);
        bignum = bignum.add(ce.bignum(rational[0]).div(ce.bignum(rational[1])));

        this.terms.push({ term: ce.number(bignum), coef: [1, 1] });

        if (imaginary !== 0) {
          this.terms.push({
            term: ce.number(ce.complex(0, imaginary)),
            coef: [1, 1],
          });
        }
        return;
      }
      const r =
        real + bignum.toNumber() + Number(rational[0]) / Number(rational[1]);

      if (imaginary !== 0) {
        this.terms.push({
          term: ce.number(ce.complex(r, imaginary)),
          coef: [1, 1],
        });
      } else if (r !== 0) this.terms.push({ term: ce.number(r), coef: [1, 1] });
      return;
    }

    if (!bignum.isZero()) {
      bignum = bignum.add(real);
      real = 0;
      if (!isRationalZero(rational)) {
        bignum = bignum.add(ce.bignum(rational[0]).div(ce.bignum(rational[1])));
        rational = [0, 1] as Rational;
      }
      this.terms.push({ coef: [1, 1], term: ce.number(bignum) });
    }

    if (imaginary !== 0) {
      if (!isRationalZero(rational))
        real += Number(rational[0]) / Number(rational[1]);

      this.terms.push({
        coef: [1, 1],
        term: ce.number(ce.complex(real, imaginary)),
      });
    } else if (real !== 0)
      this.terms.push({ coef: [1, 1], term: ce.number(real) });

    if (!isRationalZero(rational))
      this.terms.push({ coef: [1, 1], term: ce.number(rational) });
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    const terms = this.terms.filter(
      ({ coef, term }) => !isRationalZero(coef) && !term.isZero
    );

    if (terms.length === 0) return ce.Zero;

    if (terms.length === 1) {
      const { coef, term } = terms[0];
      if (isRationalOne(coef)) return term;
      if (isRationalNegativeOne(coef)) return ce.neg(term);
      return ce.mul(ce.number(coef), term);
    }

    return ce.function(
      'Add',
      terms.map(({ coef, term }) => ce.mul(ce.number(coef), term))
    );
  }
}
