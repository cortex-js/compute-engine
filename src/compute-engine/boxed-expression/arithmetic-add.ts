import { getImaginaryFactor } from './utils';

import { flatten } from './flatten';
import { addOrder, order } from './order';
import { Type } from '../../common/type/types';
import { widen } from '../../common/type/utils';
import { isSubtype } from '../../common/type/subtype';
import { BoxedType } from '../../common/type/boxed-type';
import type {
  BoxedExpression,
  TensorInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isBoxedTensor } from './boxed-tensor';
import { isBoxedNumber, isBoxedFunction, isBoxedSymbol } from './type-guards';

import { MACHINE_PRECISION } from '../numerics/numeric';
import type { NumericValue } from '../numeric-value/types';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value';
import { BigNumericValue } from '../numeric-value/big-numeric-value';
import { MachineNumericValue } from '../numeric-value/machine-numeric-value';

/**
 *
 * The canonical form of `Add`:
 * - canonicalize the arguments
 * - remove `0`
 * - capture complex numbers (`a + ib` or `ai + b`)
 * - sort the terms
 *
 */
export function canonicalAdd(
  ce: ComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Make canonical, flatten, and lift nested expressions (associative)
  ops = flatten(ops, 'Add');

  // Remove literal 0
  ops = ops.filter((x) => !isBoxedNumber(x) || !x.is(0));

  if (ops.length === 0) return ce.Zero;
  if (ops.length === 1 && !ops[0].isIndexedCollection) return ops[0];

  // Iterate over the terms and check if any are complex numbers
  // (a real number followed by an imaginary number)
  const xs: BoxedExpression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (isBoxedNumber(op)) {
      const nv = op.numericValue;

      if (
        typeof nv === 'number' ||
        (isSubtype(nv.type, 'real') && !nv.isExact) ||
        isSubtype(nv.type, 'integer')
      ) {
        // We have a number such as 4, 3.14, etc. but not 2/3, √2, etc.
        // Check the following term to see if it's an imaginary number

        const next = ops[i + 1];
        if (next) {
          const facExpr = getImaginaryFactor(next);
          const fac = facExpr && isBoxedNumber(facExpr) ? facExpr.numericValue : undefined;
          if (fac !== undefined) {
            const im = typeof fac === 'number' ? fac : fac.re;
            if (im !== 0) {
              const re = typeof nv === 'number' ? nv : nv.re;
              xs.push(ce.number(ce._numericValue({ re, im: im ?? 0 })));
              i++;
              continue;
            }
          }
        }
      }
    }
    xs.push(op);
  }

  if (xs.length === 1) return xs[0];

  // Commutative: sort
  return ce._fn('Add', [...xs].sort(addOrder));
}

export function addType(
  args: ReadonlyArray<BoxedExpression>
): Type | BoxedType {
  if (args.length === 0) return 'finite_integer'; // = 0
  if (args.length === 1) return args[0].type;
  return widen(...args.map((x) => x.type.type));
}

export function add(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isBoxedTensor(x));
  if (hasTensors) return addTensors(xs[0].engine, xs);

  return new Terms(xs[0].engine, xs).asExpression();
}

export function addN(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (!xs.every((x) => x.isValid)) return xs[0].engine._fn('Add', xs);

  // Check if any operands are tensors
  const hasTensors = xs.some((x) => isBoxedTensor(x));
  if (hasTensors) {
    // Evaluate tensors numerically
    xs = xs.map((x) => (isBoxedTensor(x) ? x.evaluate() : x.N()));
    return addTensors(xs[0].engine, xs);
  }

  // Don't N() the number literals (fractions) to avoid losing precision
  xs = xs.map((x) => (isBoxedNumber(x) ? x.evaluate() : x.N()));
  return new Terms(xs[0].engine, xs).N();
}

/**
 * Add tensors element-wise, with scalar broadcasting support.
 * - Tensor + Tensor: element-wise addition (shapes must match)
 * - Scalar + Tensor: broadcast scalar to all elements
 */
function addTensors(
  ce: ComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Separate tensors and scalars
  const tensors: (BoxedExpression & TensorInterface)[] = [];
  const scalars: BoxedExpression[] = [];

  for (const op of ops) {
    const evaluated = op.evaluate();
    if (isBoxedTensor(evaluated)) {
      tensors.push(evaluated);
    } else {
      scalars.push(evaluated);
    }
  }

  // If no tensors after evaluation, fall back to regular addition
  if (tensors.length === 0) {
    return new Terms(ce, scalars).asExpression();
  }

  // Get the reference shape from the first tensor
  const referenceShape = tensors[0].shape;

  // Validate all tensors have the same shape
  for (let i = 1; i < tensors.length; i++) {
    const shape = tensors[i].shape;
    if (
      shape.length !== referenceShape.length ||
      !shape.every((dim, j) => dim === referenceShape[j])
    ) {
      return ce.error(
        'incompatible-dimensions',
        `${referenceShape.join('x')} vs ${shape.join('x')}`
      );
    }
  }

  // Compute scalar sum (to add to each element)
  let scalarSum: BoxedExpression = ce.Zero;
  for (const s of scalars) {
    scalarSum = scalarSum.add(s);
  }

  // For vectors (rank 1)
  if (referenceShape.length === 1) {
    const n = referenceShape[0];
    const result: BoxedExpression[] = [];
    for (let i = 0; i < n; i++) {
      let sum = scalarSum;
      for (const tensor of tensors) {
        // tensor.tensor.at() uses 1-based indexing for vectors
        const val = tensor.tensor.at(i + 1) ?? ce.Zero;
        sum = sum.add(ce.box(val));
      }
      result.push(sum.evaluate());
    }
    return ce.box(['List', ...result]);
  }

  // For matrices (rank 2)
  if (referenceShape.length === 2) {
    const [m, n] = referenceShape;
    const rows: BoxedExpression[] = [];
    for (let i = 0; i < m; i++) {
      const row: BoxedExpression[] = [];
      for (let j = 0; j < n; j++) {
        let sum = scalarSum;
        for (const tensor of tensors) {
          // tensor.tensor.at(row, col) uses 1-based indexing
          const val = tensor.tensor.at(i + 1, j + 1) ?? ce.Zero;
          sum = sum.add(ce.box(val));
        }
        row.push(sum.evaluate());
      }
      rows.push(ce.box(['List', ...row]));
    }
    return ce.box(['List', ...rows]);
  }

  // For higher-rank tensors, return unevaluated for now
  return ce._fn('Add', [...ops]);
}

//
// Terms class — represents a sum of terms with coefficients
//

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
      if (term.isNaN || (isBoxedSymbol(term) && term.symbol === 'Undefined')) {
        this.terms = [{ term: ce.NaN, coef: [] }];
        return;
      }

      const [coef, rest] = term.toNumericValue();
      if (coef.isPositiveInfinity) posInfinityCount += 1;
      else if (coef.isNegativeInfinity) negInfinityCount += 1;

      if (rest.is(1)) {
        if (!coef.isZero) numericValues.push(coef);
      } else this._add(coef, rest);
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
      this._add(numericValues[0], ce.One);
    } else if (numericValues.length > 0) {
      // We're doing an exact sum, we may have multiple terms: a
      // rational and a radical. We need to sum them separately.
      nvSum(ce, numericValues).forEach((x) => this._add(x, ce.One));
    }
  }

  private _add(coef: NumericValue, term: BoxedExpression): void {
    if (term.is(0) || coef.isZero) return;
    if (term.is(1)) {
      // We have a numeric value. Keep it in the terms,
      // so that "1+sqrt(3)" remains exact.
      const ce = this.engine;
      this.terms.push({ coef: [], term: ce.number(coef) });
      return;
    }

    if (isBoxedFunction(term) && term.operator === 'Add') {
      for (const x of term.ops) {
        const [c, t] = x.toNumericValue();
        this._add(coef.mul(c), t);
      }
      return;
    }

    if (isBoxedFunction(term) && term.operator === 'Negate') {
      this._add(coef.neg(), term.op1);
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
    console.assert(!isBoxedNumber(term) || term.is(1));
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
        if (isBoxedNumber(term)) {
          if (typeof term.numericValue === 'number')
            numericValues.push(ce._numericValue(term.numericValue));
          else numericValues.push(term.numericValue);
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
          const coefSum = canonicalAdd(
            ce,
            coefs.map((x) => ce.box(x))
          );
          if (term.is(1)) return coefSum;
          return ce._fn('Multiply', [coefSum, term].sort(order));
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
      ? (x) => new BigNumericValue(x, bignum)
      : (x) => new MachineNumericValue(x, makeExact);
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
      ? (x) => new BigNumericValue(x, bignum)
      : (x) => new MachineNumericValue(x, makeExact);
  const result = ExactNumericValue.sum(numericValues, factory, bignum);

  if (result.length === 0) return makeExact(0);
  if (result.length === 1) return result[0].N();

  return result.reduce((acc, x) => acc.add(x).N());
}
