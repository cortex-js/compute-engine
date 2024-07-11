import { BoxedExpression, IComputeEngine } from '../public';

import { NumericValue } from '../numeric-value/public';

// Represent a sum of terms
export class Terms {
  private engine: IComputeEngine;
  private terms: { coef: NumericValue; term: BoxedExpression }[] = [];

  _numericValueOne: NumericValue | null = null;
  get coefOne(): NumericValue {
    if (this._numericValueOne === null)
      this._numericValueOne = this.engine._numericValue(1);
    return this._numericValueOne;
  }

  constructor(
    ce: IComputeEngine,
    terms: ReadonlyArray<BoxedExpression>,
    { exact = true } = {}
  ) {
    this.engine = ce;
    // @fastpath: if there is only one term, and the term is a numericValue, @fixme
    let posInfinityCount = 0;
    let negInfinityCount = 0;
    // We're going to keep track of numeric values in an array, so that we can
    // sum them exactly at the end (some inexact values may cancel each other,
    // for example (0.1 - 0.1 + 1/4) -> 1/4.
    // If we added as we go, we would get 0.25.
    let numericValues: NumericValue[] = [];
    for (const term of terms) {
      if (term.isZero) continue;
      if (term.isImaginary && term.isInfinity) {
        this.terms = [{ term: ce.ComplexInfinity, coef: this.coefOne }];
        return;
      }
      if (term.isNaN || term.symbol === 'Undefined') {
        this.terms = [{ term: ce.NaN, coef: this.coefOne }];
        return;
      }

      const [coef, rest] = ce._toNumericValue(term);
      if (coef.isPositiveInfinity) posInfinityCount += 1;
      else if (coef.isNegativeInfinity) negInfinityCount += 1;

      if (rest.isOne) {
        if (!coef.isZero) numericValues.push(coef);
      } else this.add(rest, coef);
    }

    if (posInfinityCount > 0 && negInfinityCount > 0) {
      this.terms = [{ term: ce.NaN, coef: this.coefOne }];
      return;
    }
    if (posInfinityCount > 0) {
      this.terms = [{ term: ce.PositiveInfinity, coef: this.coefOne }];
      return;
    }
    if (negInfinityCount > 0) {
      this.terms = [{ term: ce.NegativeInfinity, coef: this.coefOne }];
      return;
    }
    if (numericValues.length !== 0) {
      if (!exact) {
        this.add(
          ce._fromNumericValue(numericValues.reduce((a, b) => a.add(b.N())))
        );
      } else {
        // If we're doing an exact sum, we may have multiple terms: one
        // rational and one for square roots. We need to sum them separately.
        ce._numericValue(0)
          .sum(...numericValues)
          .forEach((x) => this.add(ce._fromNumericValue(x)));
      }
    }
  }

  // sub(term: BoxedExpression): void {
  //   this.add(term, this.engine._numericValue(-1));
  // }

  private add(term2: BoxedExpression, coef2?: NumericValue): void {
    let [coef, term] = this.engine._toNumericValue(term2);
    if (coef2 !== undefined) coef = coef.mul(coef2);
    if (coef.isZero) return;

    if (term.head === 'Add') {
      for (const x of term.ops!) this.add(x, coef);
      return;
    }

    if (term.head === 'Negate') {
      this.add(term.op1, coef.neg());
      return;
    }

    if (term.isOne) {
      // We have a numeric value. Keep it in the terms,
      // so that "1+sqrt(3)" remains exact.
      this.terms.push({
        coef: this.engine._numericValue(1),
        term: this.engine._fromNumericValue(coef, term),
      });
      return;
    }

    // Try to find a like term, i.e. if "2x", look for "x"
    const i = this.find(term);
    if (i >= 0) {
      this.terms[i].coef = this.terms[i].coef.add(coef);
      return;
    }
    console.assert(term.numericValue === null || term.isOne);
    this.terms.push({ coef, term });
  }

  find(term: BoxedExpression): number {
    return this.terms.findIndex((x) => x.term.isSame(term));
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    //@fixme: might not be needed
    const terms = this.terms.filter(
      ({ coef, term }) => !coef.isZero && !term.isZero
    );

    if (terms.length === 0) return ce.Zero;

    if (terms.length === 1) {
      const { coef, term } = terms[0];
      if (coef.isOne) return term;
      if (coef.isNegativeOne) return ce.function('Negate', [term]);

      return this.engine._fromNumericValue(coef, term);
    }

    return ce.function(
      'Add',
      terms.map(({ coef, term }) => this.engine._fromNumericValue(coef, term))
    );
  }
}
