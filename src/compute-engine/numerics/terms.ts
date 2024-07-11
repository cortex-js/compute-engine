import { BoxedExpression, IComputeEngine } from '../public';

import { NumericValue } from '../numeric-value/public';

// Represent a sum of terms
export class Terms {
  private engine: IComputeEngine;
  private terms: { coef: NumericValue; term: BoxedExpression }[] = [];

  constructor(
    ce: IComputeEngine,
    terms: ReadonlyArray<BoxedExpression>,
    { exact = true } = {}
  ) {
    this.engine = ce;
    let posInfinityCount = 0;
    let negInfinityCount = 0;
    // We're going to keep track of numeric values in an array, so that we can
    // sum them exactly at the end (some inexact values may cancel each other,
    // for example (0.1 - 0.1 + 1/4) -> 1/4.
    // If we added as we go, we would get 0.25.
    let numericValues: NumericValue[] = [];
    for (const term of terms) {
      if (term.isImaginary && term.isInfinity) {
        this.terms = [{ term: ce.ComplexInfinity, coef: ce._numericValue(1) }];
        return;
      }
      if (term.isNaN || term.symbol === 'Undefined') {
        this.terms = [{ term: ce.NaN, coef: ce._numericValue(1) }];
        return;
      }

      const [coef, rest] = ce._toNumericValue(term);
      if (coef.isPositiveInfinity) posInfinityCount += 1;
      else if (coef.isNegativeInfinity) negInfinityCount += 1;

      if (rest.isOne) {
        if (!coef.isZero) numericValues.push(coef);
      } else this.add(coef, rest);
    }

    if (posInfinityCount > 0 && negInfinityCount > 0) {
      this.terms = [{ term: ce.NaN, coef: ce._numericValue(1) }];
      return;
    }
    if (posInfinityCount > 0) {
      this.terms = [{ term: ce.PositiveInfinity, coef: ce._numericValue(1) }];
      return;
    }
    if (negInfinityCount > 0) {
      this.terms = [{ term: ce.NegativeInfinity, coef: ce._numericValue(1) }];
      return;
    }
    if (numericValues.length !== 0) {
      if (!exact) {
        this.add(
          numericValues.reduce((a, b) => a.add(b.N())),
          ce.One
        );
      } else {
        // If we're doing an exact sum, we may have multiple terms: a
        // rational and a radical. We need to sum them separately.
        ce._numericValue(0)
          .sum(...numericValues)
          .forEach((x) => this.add(x, ce.One));
      }
    }
  }

  private add(coef: NumericValue, term: BoxedExpression): void {
    const [coef2, term2] = this.engine._toNumericValue(term);
    console.assert(coef2.isOne);

    if (term.isZero || coef.isZero) return;
    if (term.isOne) {
      // We have a numeric value. Keep it in the terms,
      // so that "1+sqrt(3)" remains exact.
      this.terms.push({
        coef: this.engine._numericValue(1),
        term: this.engine._fromNumericValue(coef, term),
      });
      return;
    }

    if (term.head === 'Add') {
      for (const x of term.ops!) {
        const [c, t] = this.engine._toNumericValue(x);
        this.add(coef.mul(c), t);
      }
      return;
    }

    if (term.head === 'Negate') {
      this.add(coef.neg(), term.op1);
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

  private find(term: BoxedExpression): number {
    return this.terms.findIndex((x) => x.term.isSame(term));
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    const terms = this.terms;

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
