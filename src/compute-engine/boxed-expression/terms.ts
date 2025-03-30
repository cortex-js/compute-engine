import { canonicalAdd } from './arithmetic-add';
import { canonicalMultiply } from './arithmetic-mul-div';

import { MACHINE_PRECISION } from '../numerics/numeric';

import type { NumericValue } from '../numeric-value/types';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { BigNumericValue } from '../numeric-value/big-numeric-value';
import { MachineNumericValue } from '../numeric-value/machine-numeric-value';
import type { BoxedExpression, ComputeEngine } from '../global-types';

// Represent a sum of terms
export class Terms {
  private engine: ComputeEngine;
  private terms: { coef: NumericValue[]; term: BoxedExpression }[] = [];

  constructor(ce: ComputeEngine, terms: ReadonlyArray<BoxedExpression>) {
    this.engine = ce;
    let posInfinityCount = 0;
    let negInfinityCount = 0;
    // We're going to keep track of numeric values in an array, so that we can
    // sum them exactly at the end (some inexact values may cancel each other,
    // for example (0.1 - 0.1 + 1/4) -> 1/4.
    // If we added as we go, we would get 0.25.
    const numericValues: NumericValue[] = [];
    for (const term of terms) {
      if (term.type.is('complex') && term.isInfinity) {
        this.terms = [{ term: ce.ComplexInfinity, coef: [] }];
        return;
      }
      if (term.isNaN || term.symbol === 'Undefined') {
        this.terms = [{ term: ce.NaN, coef: [] }];
        return;
      }

      const [coef, rest] = term.toNumericValue();
      if (coef.isPositiveInfinity) posInfinityCount += 1;
      else if (coef.isNegativeInfinity) negInfinityCount += 1;

      if (rest.is(1)) {
        if (!coef.isZero) numericValues.push(coef);
      } else this.add(coef, rest);
    }

    if (posInfinityCount > 0 && negInfinityCount > 0) {
      this.terms = [{ term: ce.NaN, coef: [] }];
      return;
    }
    if (posInfinityCount > 0) {
      this.terms = [{ term: ce.PositiveInfinity, coef: [] }];
      return;
    }
    if (negInfinityCount > 0) {
      this.terms = [{ term: ce.NegativeInfinity, coef: [] }];
      return;
    }
    if (numericValues.length === 1) {
      this.add(numericValues[0], ce.One);
    } else if (numericValues.length > 0) {
      // We're doing an exact sum, we may have multiple terms: a
      // rational and a radical. We need to sum them separately.
      nvSum(ce, numericValues).forEach((x) => this.add(x, ce.One));
    }
  }

  private add(coef: NumericValue, term: BoxedExpression): void {
    if (term.is(0) || coef.isZero) return;
    if (term.is(1)) {
      // We have a numeric value. Keep it in the terms,
      // so that "1+sqrt(3)" remains exact.
      const ce = this.engine;
      this.terms.push({ coef: [], term: ce.number(coef) });
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
      // There was an existing term matching: add the coefficients
      this.terms[i].coef.push(coef);
      return;
    }

    // This is a new term: just add it
    console.assert(term.numericValue === null || term.is(1));
    this.terms.push({ coef: [coef], term });
  }

  private find(term: BoxedExpression): number {
    return this.terms.findIndex((x) => x.term.isSame(term));
  }

  N(): BoxedExpression {
    const ce = this.engine;

    const terms = this.terms;

    if (terms.length === 0) return ce.Zero;

    const rest: BoxedExpression[] = [];
    const numericValues: NumericValue[] = [];

    // Gather all the numericValues and the rest
    for (const { coef, term } of terms) {
      if (coef.length === 0) {
        if (term.isNumberLiteral) {
          if (typeof term.numericValue === 'number')
            numericValues.push(ce._numericValue(term.numericValue));
          else numericValues.push(term.numericValue!);
        } else rest.push(term);
      } else {
        const sum = coef.reduce((acc, x) => acc.add(x)).N();

        if (sum.isZero) continue;

        if (sum.eq(1)) rest.push(term.N());
        else if (sum.eq(-1)) rest.push(term.N().neg());
        else rest.push(term.N().mul(ce.box(sum)));
      }
    }

    const sum = nvSumN(ce, numericValues);
    if (!sum.isZero) {
      if (rest.length === 0) return ce.box(sum);
      rest.push(ce.box(sum));
    }
    return canonicalAdd(ce, rest);
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    const terms = this.terms;

    if (terms.length === 0) return ce.Zero;

    return canonicalAdd(
      ce,
      terms.map(({ coef, term }) => {
        // Add the coefficients
        if (coef.length === 0) return term;

        const coefs = nvSum(ce, coef);
        if (coefs.length === 0) return term;
        if (coefs.length > 1) {
          return canonicalMultiply(ce, [
            canonicalAdd(
              ce,
              coefs.map((x) => ce.box(x))
            ),
            term,
          ]);
        }
        const sum = coefs[0];
        if (sum.isNaN) return ce.NaN;
        if (sum.isZero) return ce.Zero;
        if (sum.eq(1)) return term;
        if (sum.eq(-1)) return term.neg();
        if (term.is(1)) return ce.box(sum);

        return term.mul(ce.box(sum));
      })
    );
  }
}

function nvSum(
  ce: ComputeEngine,
  numericValues: NumericValue[]
): NumericValue[] {
  const bignum = (x) => ce.bignum(x);
  const makeExact = (x) => new ExactNumericValue(x, factory, bignum);
  const factory =
    ce.precision > MACHINE_PRECISION
      ? (x) => new BigNumericValue(x, bignum, ce.tolerance)
      : (x) => new MachineNumericValue(x, makeExact, ce.tolerance);
  return ExactNumericValue.sum(numericValues, factory, bignum);
}

function nvSumN(
  ce: ComputeEngine,
  numericValues: NumericValue[]
): NumericValue {
  const bignum = (x) => ce.bignum(x);
  const makeExact = (x) => new ExactNumericValue(x, factory, bignum);
  const factory =
    ce.precision > MACHINE_PRECISION
      ? (x) => new BigNumericValue(x, bignum, ce.tolerance)
      : (x) => new MachineNumericValue(x, makeExact, ce.tolerance);
  const result = ExactNumericValue.sum(numericValues, factory, bignum);

  if (result.length === 0) return makeExact(0);
  if (result.length === 1) return result[0].N();

  return result.reduce((acc, x) => acc.add(x).N());
}
