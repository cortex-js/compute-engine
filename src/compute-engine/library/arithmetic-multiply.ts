import { BoxedExpression, IComputeEngine } from '../public';

import { MAX_SYMBOLIC_TERMS } from '../numerics/numeric';
import { bignumPreferred } from '../boxed-expression/utils';
import {
  MultiIndexingSet,
  SingleIndexingSet,
  normalizeIndexingSet,
  cartesianProduct,
  range,
} from './utils';
import { each, isCollection } from '../collection-utils';

import { asBignum, asFloat } from '../boxed-expression/numerics';
import { Product } from '../symbolic/product';
import { expandProducts } from '../symbolic/expand';
import { flatten } from '../symbolic/flatten';
import { negateProduct } from '../symbolic/negate';
import { order } from '../boxed-expression/order';

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
    indexingSet.ops[0]?.operator === 'Delimiter'
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

export function evalProduct(
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
      result = mul(...terms);
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
    result = mul(...terms);
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
        const precision = ce.precision;
        ce.precision = 'machine';
        for (let i = lower; i <= upper; i++) {
          ce.assign({ [index]: i });
          const term = asFloat(fn.N());
          if (term === null || !Number.isFinite(term)) {
            result = term !== null ? ce.number(term) : undefined;
            break;
          }
          product *= term;
        }
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

        const ratio = asFloat(nMax.div(nMaxMinusOne).N());
        if (ratio !== null && Number.isFinite(ratio) && Math.abs(ratio) > 1) {
          result = ce.PositiveInfinity;
        } else {
          // Potentially converging series.
          // Evaluate as a machine number (it's an approximation to infinity, so
          // no point in calculating with high precision), and check for convergence
          let product = 1;
          const precision = ce.precision;
          ce.precision = 'machine';
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

/** The canonical form of `Multiply`:
 * - remove `1` anb `-1`
 * - simplify the signs:
 *    - i.e. `-y \times -x` -> `x \times y`
 *    - `2 \times -x` -> `-2 \times x`
 * - arguments are sorted
 * - complex numbers promoted (['Multiply', 2, 'ImaginaryUnit'] -> 2i)
 *
 * The ops may not be canonical, the result is canonical.
 */
export function canonicalMultiply(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Make canonical, flatten, and lift nested expressions
  ops = flatten(ops, 'Multiply');

  if (ops.length === 1) return ops[0];

  const xs: BoxedExpression[] = [];
  let sign = 1;
  let num: number | undefined = undefined;
  let imaginaryCount = 0;
  for (const op of ops) {
    if (op.isZero) return ce.Zero;
    if (op.isOne) continue;
    if (op.isNegativeOne) {
      sign = -sign;
      continue;
    }
    if (op.operator === 'Negate') {
      sign = -sign;
      xs.push(op.op1);
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
      xs.push(op.neg());
      continue;
    }
    if (op.symbol === 'ImaginaryUnit') {
      imaginaryCount++;
      continue;
    }
    xs.push(op);
  }

  // See if we had a complex number
  if (imaginaryCount > 0) {
    if (imaginaryCount % 2 === 0) {
      // Even number of imaginary units
      sign = -sign;
    } else {
      // Odd number of imaginary units
      xs.push(ce.number(ce.complex(0, sign * (num ?? 1))));
      sign = 1;
      num = undefined;
    }
  }

  if (typeof num === 'number') {
    xs.push(ce.number(sign * num));
    sign = 1;
  }

  if (sign < 0) {
    if (xs.length === 0) return ce.NegativeOne;
    if (xs.length === 1) return xs[0].neg();
    return negateProduct(ce, xs);
  }

  if (xs.length === 0) return ce.One;
  if (xs.length === 1) return xs[0];
  return ce._fn('Multiply', [...xs].sort(order));
}

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

export function mul(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  if (xs.length === 1) return xs[0];

  const ce = xs[0].engine;

  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    xs = exp.ops!;
  }

  return new Product(ce, xs).asExpression();
}

export function mulN(...xs: ReadonlyArray<BoxedExpression>): BoxedExpression {
  console.assert(xs.length > 0);
  const ce = xs[0].engine;

  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    xs = exp.ops!;
  }

  return new Product(ce, xs).asExpression('N');
}
