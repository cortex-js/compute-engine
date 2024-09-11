import type { BoxedExpression, IComputeEngine } from '../public';

import { canonicalAdd } from './arithmetic-add';
import { canonicalMultiply } from './arithmetic-multiply';

import { MACHINE_PRECISION } from '../numerics/numeric';

import type { NumericValue } from '../numeric-value/public';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { BigNumericValue } from '../numeric-value/big-numeric-value';
import { MachineNumericValue } from '../numeric-value/machine-numeric-value';

// Represent a sum of terms
export class Terms {
  private engine: IComputeEngine;
  private terms: { coef: BoxedExpression; term: BoxedExpression }[] = [];

  constructor(ce: IComputeEngine, terms: ReadonlyArray<BoxedExpression>) {
    this.engine = ce;
    let posInfinityCount = 0;
    let negInfinityCount = 0;
    // We're going to keep track of numeric values in an array, so that we can
    // sum them exactly at the end (some inexact values may cancel each other,
    // for example (0.1 - 0.1 + 1/4) -> 1/4.
    // If we added as we go, we would get 0.25.
    const numericValues: NumericValue[] = [];
    for (const term of terms) {
      if (
        (term.type === 'imaginary' || term.type === 'complex') &&
        term.isInfinity
      ) {
        this.terms = [{ term: ce.ComplexInfinity, coef: ce.One }];
        return;
      }
      if (term.isNaN || term.symbol === 'Undefined') {
        this.terms = [{ term: ce.NaN, coef: ce.One }];
        return;
      }

      const [coef, rest] = term.toNumericValue();
      if (coef.isPositiveInfinity) posInfinityCount += 1;
      else if (coef.isNegativeInfinity) negInfinityCount += 1;

      if (rest.isEqual(1)) {
        if (!coef.isZero) numericValues.push(coef);
      } else this.add(coef, rest);
    }

    if (posInfinityCount > 0 && negInfinityCount > 0) {
      this.terms = [{ term: ce.NaN, coef: ce.One }];
      return;
    }
    if (posInfinityCount > 0) {
      this.terms = [{ term: ce.PositiveInfinity, coef: ce.One }];
      return;
    }
    if (negInfinityCount > 0) {
      this.terms = [{ term: ce.NegativeInfinity, coef: ce.One }];
      return;
    }
    if (numericValues.length === 1) {
      this.add(numericValues[0], ce.One);
    } else if (numericValues.length > 0) {
      // We're doing an exact sum, we may have multiple terms: a
      // rational and a radical. We need to sum them separately.
      const bignum = (x) => ce.bignum(x);
      const makeExact = (x) => new ExactNumericValue(x, factory, bignum);
      const factory =
        ce.precision > MACHINE_PRECISION
          ? (x) => new BigNumericValue(x, bignum)
          : (x) => new MachineNumericValue(x, makeExact);
      ExactNumericValue.sum(numericValues, factory, bignum).forEach((x) =>
        this.add(x, ce.One)
      );
    }
  }

  private add(coef: NumericValue, term: BoxedExpression): void {
    if (term.isEqual(0) || coef.isZero) return;
    if (term.isEqual(1)) {
      // We have a numeric value. Keep it in the terms,
      // so that "1+sqrt(3)" remains exact.
      const ce = this.engine;
      this.terms.push({ coef: ce.One, term: ce.number(coef) });
      return;
    }

    if (term.operator === 'Add') {
      for (const x of term.ops!) {
        const [c, t] = x.toNumericValue();
        this.add(coef.mul(c), t);
      }
      return;
    }

    if (term.operator === 'Negate') {
      this.add(coef.neg(), term.op1);
      return;
    }

    // Try to find a like term, i.e. if "2x", look for "x"
    const i = this.find(term);
    if (i >= 0) {
      if (this.terms[i].coef.isNumberLiteral && coef) {
        const newCoef = coef.add(this.terms[i].coef.numericValue!);
        if (newCoef.isExact) this.terms[i].coef = this.engine.number(newCoef);
        else
          this.terms[i].coef = this.engine.function('Add', [
            this.terms[i].coef,
            this.engine.number(coef),
          ]);
      } else {
        this.terms[i].coef = this.engine.function('Add', [
          this.terms[i].coef,
          this.engine.number(coef),
        ]);
      }
      return;
    }
    console.assert(term.numericValue === null || term.isEqual(1));
    this.terms.push({ coef: this.engine.number(coef), term });
  }

  private find(term: BoxedExpression): number {
    return this.terms.findIndex((x) => x.term.isSame(term));
  }

  N(): BoxedExpression {
    const ce = this.engine;

    const terms = this.terms;

    if (terms.length === 0) return ce.Zero;

    if (terms.length === 1) {
      const { coef, term } = terms[0];
      if (coef.isEqual(1)) return term.N();
      if (coef.isEqual(-1)) return term.N().neg();

      return term.N().mul(ce.box(coef.N()));
    }

    return canonicalAdd(ce, [
      ...terms.map(({ coef, term }) =>
        coef.isEqual(1) ? term : canonicalMultiply(ce, [term, ce.box(coef.N())])
      ),
    ]);
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    const terms = this.terms;

    if (terms.length === 0) return ce.Zero;

    if (terms.length === 1) {
      const { coef, term } = terms[0];
      if (term.isNaN) return ce.NaN;
      if (coef.isEqual(0)) return ce.Zero;
      if (coef.isEqual(1)) return term;
      if (coef.isEqual(-1)) return term.neg();

      if (term.isEqual(1)) return ce.box(coef);
      return canonicalMultiply(ce, [term, ce.box(coef)]);
    }

    return canonicalAdd(
      ce,
      terms.map(({ coef, term }) =>
        coef.isEqual(0)
          ? ce.Zero
          : coef.isEqual(1)
            ? term
            : canonicalMultiply(ce, [term, ce.box(coef)])
      )
    );
  }
}
