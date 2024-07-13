import { BoxedExpression, IComputeEngine } from '../public';

import { MAX_SYMBOLIC_TERMS } from '../numerics/numeric';
import { bignumPreferred } from '../boxed-expression/utils';
import { negateProduct } from '../symbolic/negate';
import { Product } from '../symbolic/product';
import { isOne, isZero, neg } from '../numerics/rationals';
import { apply2N } from '../symbolic/utils';
import {
  MultiIndexingSet,
  SingleIndexingSet,
  normalizeIndexingSet,
  cartesianProduct,
  range,
} from './utils';
import { each, isCollection } from '../collection-utils';
import { order } from '../boxed-expression/order';

import { square } from './arithmetic-power';
import {
  asBignum,
  asFloat,
  asRational,
  mul,
} from '../boxed-expression/numerics';

/** The canonical form of `Multiply`:
 * - remove `1`
 * - simplify the signs:
 *    - i.e. `-y \times -x` -> `x \times y`
 *    - `2 \times -x` -> `-2 \times x`
 * - arguments are sorted
 * - complex numbers promoted (['Multiply', 2, 'ImaginaryUnit'] -> 2i)
 *
 * The ops must be canonical, the result is canonical.
 */
export function canonicalMultiply(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  console.assert(ops.every((x) => x.isCanonical));

  if (ops.length === 0) return ce.One;
  if (ops.length === 1) return ops[0];

  const result: BoxedExpression[] = [];
  let sign = 1;
  let num: number | undefined = undefined;
  let imaginaryCount = 0;
  for (const op of ops) {
    if (op.isOne) continue;
    if (op.isNegativeOne) {
      sign = -sign;
      continue;
    }
    if (op.head === 'Negate') {
      sign = -sign;
      result.push(op.op1);
      continue;
    }
    // Capture the first machine literal, to potentially use as a imaginary coef
    if (num === undefined && typeof op.numericValue === 'number') {
      num = op.numericValue;
      if (num < 0) {
        sign = -sign;
        num = -num;
      }
      continue;
    }
    if (op.numericValue !== null && op.isNegative) {
      sign = -sign;
      result.push(op.neg());
      continue;
    }
    if (op.symbol === 'ImaginaryUnit') {
      imaginaryCount++;
      continue;
    }
    result.push(op);
  }

  // See if we had a complex number
  if (imaginaryCount > 0) {
    if (imaginaryCount % 2 === 0) {
      // Even number of imaginary units
      sign = -sign;
    } else {
      // Odd number of imaginary units
      result.push(ce.number(ce.complex(0, sign * (num ?? 1))));
      sign = 1;
      num = undefined;
    }
  }

  if (typeof num === 'number') {
    result.push(ce.number(sign * num));
    sign = 1;
  }

  if (sign < 0) {
    if (result.length === 0) return ce.NegativeOne;
    if (result.length === 1) return result[0].neg();
    return negateProduct(ce, [...result].sort(order));
  }

  if (result.length === 0) return ce.One;
  if (result.length === 1) return result[0];
  return ce._fn('Multiply', [...result].sort(order));
}

export function simplifyMultiply(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  console.assert(ops.every((x) => x.head !== 'Multiply'));
  const product = new Product(ce);
  for (let op of ops) {
    op = op.simplify();
    if (op.isNaN || op.symbol === 'Undefined') return ce.NaN;
    product.mul(op);
  }

  return product.asExpression();
}

export function evalMultiply(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>,
  mode: 'N' | 'evaluate' = 'evaluate'
): BoxedExpression {
  // @fixme: review caller. In some cases, call distribute. Maybe should be done here. Also call evaluate() and N() multiple times. (but, incorrectly, not when length is 1)
  if (ops.length === 1) return ops[0];

  //
  // @fastpath
  //
  if (mode === 'N') {
    ops = ops.map((x) => x.N());
    if (
      (ce.numericMode === 'machine' || ce.numericMode === 'auto') &&
      ops.every((x) => typeof x.numericValue === 'number')
    ) {
      let prod = 1;
      for (const op of ops) prod *= op.numericValue as number;
      return ce.number(prod);
    }
  }

  //
  // First pass: looking for early exits
  //
  // @fixme: don't need to do this loop and special case for 'N' mode
  for (const op of ops) {
    if (op.isNaN || op.symbol === 'Undefined') return ce.NaN;
    if (op.numericValue !== null && !op.isExact) mode = 'N';
  }
  console.assert(ops.every((x) => x.head !== 'Multiply'));

  if (mode === 'N') ops = ops.map((x) => x.N());
  else ops = ops.map((x) => x.evaluate());

  //
  // Second pass
  //

  return new Product(ce, ops).asExpression(mode);
}

/**
 * Multiply op1 by op2. Distribute if one of the argument is a small integer
 * and the other is an addition.
 *
 * The result is canonical
 *
 * @todo: check if op1 or op2 (or both) are 'Divide' or `Power(_, -1)`
 *
 */
function multiply2(
  op1: BoxedExpression,
  op2: BoxedExpression
): BoxedExpression {
  console.assert(op1.isCanonical);
  console.assert(op2.isCanonical);
  const ce = op1.engine;

  if (op1.symbol === 'ImaginaryUnit') {
    const f = asFloat(op2);
    if (f !== null) return ce.number(ce.complex(0, f));
  }
  if (op2.symbol === 'ImaginaryUnit') {
    const f = asFloat(op1);
    if (f !== null) return ce.number(ce.complex(0, f));
  }
  if (op1.numericValue !== null && op2.numericValue !== null) {
    const f1 = asFloat(op1);
    const f2 = asFloat(op2);
    if (f1 !== null && ce.isComplex(op2))
      return ce.number(ce.complex(f1 * op2.re, f1 * op2.im));
    if (f2 !== null && ce.isComplex(op1))
      return ce.number(ce.complex(f2 * op1.re, f2 * op1.im));
  }

  if (
    op1.numericValue !== null &&
    op2.numericValue !== null &&
    op1.isInteger &&
    op2.isInteger
  ) {
    return (
      apply2N(
        op1,
        op2,
        (a, b) => a * b,
        (a, b) => a.mul(b)
      ) ?? ce.NaN
    );
  }
  if (
    op1.isNaN ||
    op2.isNaN ||
    op1.symbol === 'Undefined' ||
    op2.symbol === 'Undefined'
  )
    return ce.NaN;
  if (op1.symbol === 'Nothing') return op2;
  if (op2.symbol === 'Nothing') return op1;
  if (op1.numericValue !== null) {
    if (op1.isOne) return op2;
    if (op1.isNegativeOne) return op2.neg();
  }
  if (op2.numericValue !== null) {
    if (op2.isOne) return op1;
    if (op2.isNegativeOne) return op1.neg();
  }
  let sign = 1;
  let [t, c] = op1.numericValue !== null ? [op1, op2] : [op2, op1];

  console.assert(t.head !== 'Subtract');
  if (t.head === 'Negate') {
    t = t.op1;
    sign = -sign;
  }

  if (c.numericValue !== null) {
    const r = asRational(c);
    if (r) {
      if (isOne(r)) return t;
      if (isZero(r)) return ce.Zero;
      if (t.head === 'Add') {
        if (sign < 0) c = c.neg();
        return ce.add(...t.ops!.map((x) => multiply2(c, x)));
      }

      const tr = asRational(t);
      if (tr) {
        const p = mul(r, tr);
        return ce.number(sign < 0 ? neg(p) : p);
      }
      if (sign < 0) return ce._fn('Multiply', [c.neg(), t]);
      return ce._fn('Multiply', [c, t]);
    }
  }

  if (c.hash === t.hash && c.isSame(t)) return square(ce, c);

  const product = new Product(ce, [c, t]).asExpression();
  return sign > 0 ? product : product.neg();
}

// Canonical form of `["Product"]` (`\prod`) expressions.
export function canonicalProduct(
  ce: IComputeEngine,
  body: BoxedExpression | undefined,
  indexingSet: BoxedExpression | undefined
): BoxedExpression | null {
  // Product is a scoped function (to declare the index)
  ce.pushScope();

  body ??= ce.error('missing');
  let result: BoxedExpression | undefined = undefined;

  if (
    indexingSet &&
    indexingSet.ops &&
    indexingSet.ops[0]?.head === 'Delimiter'
  ) {
    const multiIndex = MultiIndexingSet(indexingSet);
    if (!multiIndex) return null;
    const bodyAndIndex = [body.canonical];
    multiIndex.forEach((element) => {
      bodyAndIndex.push(element);
    });
    result = ce._fn('Product', bodyAndIndex);
  } else {
    const singleIndex = SingleIndexingSet(indexingSet);
    result = singleIndex
      ? ce._fn('Product', [body.canonical, singleIndex])
      : ce._fn('Product', [body.canonical]);
  }

  ce.popScope();
  return result;
}

export function evalMultiplication(
  ce: IComputeEngine,
  summationEquation: ReadonlyArray<BoxedExpression>,
  mode: 'simplify' | 'N' | 'evaluate'
): BoxedExpression | undefined {
  const expr = summationEquation[0];
  let indexingSet: BoxedExpression[] = [];
  if (summationEquation) {
    indexingSet = [];
    for (let i = 1; i < summationEquation.length; i++) {
      indexingSet.push(summationEquation[i]);
    }
  }
  let result: BoxedExpression | undefined | null = null;

  if (indexingSet?.length === 0 || isCollection(expr)) {
    const body =
      mode === 'simplify'
        ? expr.simplify()
        : expr.evaluate({ numericMode: mode === 'N' });

    // The body is a collection, e.g. Product({1, 2, 3})
    if (bignumPreferred(ce)) {
      let product = ce.bignum(1);
      for (const x of each(body)) {
        const term = asBignum(x);
        if (term === null) {
          result = undefined;
          break;
        }
        if (term.isFinite() === false) {
          product = term;
          break;
        }
        product = product.mul(term);
      }
      if (result === null) result = ce.number(product);
    } else {
      let product = 1;
      for (const x of each(body)) {
        const term = asFloat(x);
        if (term === null) {
          result = undefined;
          break;
        }
        if (term === null || !Number.isFinite(term)) {
          product = term;
          break;
        }
        product *= term;
      }
      if (result === null) result = ce.number(product);
    }
    return result ?? undefined;
  }

  const fn = expr;
  ce.pushScope();

  const indexArray: string[] = [];
  const lowerArray: number[] = [];
  const upperArray: number[] = [];
  const isFiniteArray: boolean[] = [];
  indexingSet.forEach((indexingSetElement) => {
    const [index, lower, upper, isFinite] = normalizeIndexingSet(
      indexingSetElement.evaluate()
    );
    if (!index) return undefined;

    ce.declare(index, { holdUntil: 'simplify', domain: 'Numbers' });

    indexArray.push(index);
    lowerArray.push(lower);
    upperArray.push(upper);
    isFiniteArray.push(isFinite);
  });

  fn.bind();

  for (let i = 0; i < indexArray.length; i++) {
    const index = indexArray[i];
    const lower = lowerArray[i];
    const upper = upperArray[i];
    const isFinite = isFiniteArray[i];
    if (lower >= upper) return undefined;

    if (mode !== 'N' && (lower >= upper || upper - lower >= MAX_SYMBOLIC_TERMS))
      return undefined;

    if (mode === 'simplify') {
      const terms: BoxedExpression[] = [];
      for (let i = lower; i <= upper; i++) {
        ce.assign({ [index]: i });
        terms.push(fn.simplify()); // @fixme: call evaluate() instead
      }
      result = ce.evalMul(...terms).simplify();
    }
  }

  // create cartesian product of ranges
  let cartesianArray: number[][] = [];
  if (indexArray.length > 1) {
    for (let i = 0; i < indexArray.length - 1; i++) {
      if (cartesianArray.length === 0) {
        cartesianArray = cartesianProduct(
          range(lowerArray[i], upperArray[i]),
          range(lowerArray[i + 1], upperArray[i + 1])
        );
      } else {
        cartesianArray = cartesianProduct(
          cartesianArray.map((x) => x[0]),
          range(lowerArray[i + 1], upperArray[i + 1])
        );
      }
    }
  } else {
    cartesianArray = range(lowerArray[0], upperArray[0]).map((x) => [x]);
  }

  if (mode === 'evaluate') {
    const terms: BoxedExpression[] = [];
    for (const element of cartesianArray) {
      const index = indexArray.map((x, i) => {
        ce.assign(x, element[i]);
        return x;
      });
      //ce.assign({ [index]: i });
      terms.push(fn.evaluate());
    }
    result = ce.evalMul(...terms).evaluate(); // @fixme: no need to call evaluate()
  }

  if (mode === 'N') {
    for (let i = 0; i < indexArray.length; i++) {
      const index = indexArray[i];
      const lower = lowerArray[i];
      const upper = upperArray[i];
      const isFinite = isFiniteArray[i];
      // if (result === null && !fn.scope) {
      //   //
      //   // The term is not a function of the index
      //   //

      //   const n = fn.N();
      //   if (!isFinite) {
      //     if (n.isZero) result = ce._ZERO;
      //     else if (n.isPositive) result = ce._POSITIVE_INFINITY;
      //     else result = ce._NEGATIVE_INFINITY;
      //   }
      //   if (result === null && fn.isPure)
      //     result = ce.pow(n, ce.number(upper - lower + 1));

      //   // If the term is not a function of the index, but it is not pure,
      //   // fall through to the general case
      // }

      //
      // Finite series. Evaluate each term and multiply them
      //
      if (result === null && isFinite) {
        if (bignumPreferred(ce)) {
          let product = ce.bignum(1);
          for (let i = lower; i <= upper; i++) {
            ce.assign({ [index]: i });
            const term = asBignum(fn.N());
            if (term === null || term.isFinite() === false) {
              result = term !== null ? ce.number(term) : undefined;
              break;
            }
            product = product.mul(term);
          }
          if (result === null) result = ce.number(product);
        }

        // Machine precision
        let product = 1;
        const numericMode = ce.numericMode;
        const precision = ce.precision;
        ce.numericMode = 'machine';
        for (let i = lower; i <= upper; i++) {
          ce.assign({ [index]: i });
          const term = asFloat(fn.N());
          if (term === null || !Number.isFinite(term)) {
            result = term !== null ? ce.number(term) : undefined;
            break;
          }
          product *= term;
        }
        ce.numericMode = numericMode;
        ce.precision = precision;

        if (result === null) result = ce.number(product);
      }

      if (result === null) {
        //
        // Infinite series.
        //

        // First, check for divergence
        ce.assign({ [index]: 1000 });
        const nMax = fn.N();
        ce.assign({ [index]: 999 });
        const nMaxMinusOne = fn.N();

        const ratio = asFloat(ce.div(nMax, nMaxMinusOne).N());
        if (ratio !== null && Number.isFinite(ratio) && Math.abs(ratio) > 1) {
          result = ce.PositiveInfinity;
        } else {
          // Potentially converging series.
          // Evaluate as a machine number (it's an approximation to infinity, so
          // no point in calculating with high precision), and check for convergence
          let product = 1;
          const numericMode = ce.numericMode;
          const precision = ce.precision;
          ce.numericMode = 'machine';
          for (let i = lower; i <= upper; i++) {
            ce.assign({ [index]: i });
            const term = asFloat(fn.N());
            if (term === null) {
              result = undefined;
              break;
            }
            // Converged (or diverged), early exit
            if (Math.abs(1 - term) < Number.EPSILON || !Number.isFinite(term))
              break;
            product *= term;
          }
          if (result === null) result = ce.number(product);
          ce.numericMode = numericMode;
          ce.precision = precision;
        }
      }
    }
  }

  for (let i = 0; i < indexArray.length; i++) {
    // unassign indexes once done because if left assigned to an integer value,
    // the .evaluate will assume the inner index value = upper in the following pass
    ce.assign(indexArray[i], undefined);
  }

  ce.popScope();

  return result ?? undefined;
}
