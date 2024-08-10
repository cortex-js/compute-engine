import { BoxedDomain, BoxedExpression, IComputeEngine } from '../public';
import { bignumPreferred, getImaginaryFactor } from '../boxed-expression/utils';
import { MAX_SYMBOLIC_TERMS } from '../numerics/numeric';
import { widen } from '../boxed-expression/boxed-domain';
import { sortAdd } from '../boxed-expression/order';
import { each, isCollection, isIndexableCollection } from '../collection-utils';
import { add } from '../boxed-expression/terms';

import {
  MultiIndexingSet,
  SingleIndexingSet,
  normalizeIndexingSet,
  cartesianProduct,
  range,
} from './utils';
import { asBignum } from '../boxed-expression/numerics';
import { flatten } from '../symbolic/flatten';

/** The canonical form of `Add`:
 * - removes `0`
 * - capture complex numbers (`a + ib` or `ai + b`)
 * - sort the terms
 * - arguments are canonicalized, result is canonical
 * */
export function canonicalAdd(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Make canonical, flatten, and lift nested expressions
  ops = flatten(ops, 'Add');

  // Remove literal 0
  ops = ops.filter((x) => x.numericValue === null || !x.isZero);

  if (ops.length === 0) return ce.Zero;
  if (ops.length === 1 && !isIndexableCollection(ops[0])) return ops[0];

  //
  // Is this a  complex number, i.e. `a + ib` or `ai + b`?
  //
  if (ops.length === 2) {
    let im: number | undefined = 0;

    // Is the second term an imaginary number?
    im = getImaginaryFactor(ops[1])?.re ?? 0;
    if (im !== 0) {
      const re = ops[0].bignumRe ?? ops[0].re;
      if (re !== undefined)
        return ce.number(ce._numericValue({ decimal: re, im }));
    } else {
      // Is the first term an imaginary number?
      im = getImaginaryFactor(ops[0])?.re ?? 0;
      if (im !== 0) {
        const re = ops[1].bignumRe ?? ops[1].re;
        if (re !== undefined)
          return ce.number(ce._numericValue({ decimal: re, im }));
      }
    }
  }

  if (ops.length === 1) return ops[0];

  // Commutative, sort
  return ce._fn('Add', sortAdd(ops));
}

export function domainAdd(
  _ce: IComputeEngine,
  args: (undefined | BoxedDomain)[]
): BoxedDomain | null | undefined {
  let dom: BoxedDomain | null | undefined = null;
  for (const arg of args) {
    if (!arg?.isNumeric) return null;
    dom = widen(dom, arg);
  }
  return dom;
}

export function canonicalSummation(
  ce: IComputeEngine,
  body: BoxedExpression,
  indexingSet: BoxedExpression | undefined
): BoxedExpression | null {
  // Sum is a scoped function (to declare the index)
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
    multiIndex.forEach((element) => bodyAndIndex.push(element));
    result = ce._fn('Sum', bodyAndIndex);
  } else {
    const singleIndex = SingleIndexingSet(indexingSet);
    result = singleIndex
      ? ce._fn('Sum', [body.canonical, singleIndex])
      : ce._fn('Sum', [body.canonical]);
  }

  ce.popScope();
  return result;
}

export function evalSummation(
  ce: IComputeEngine,
  summationEquation: ReadonlyArray<BoxedExpression>,
  mode: 'simplify' | 'N' | 'evaluate'
): BoxedExpression | undefined {
  const expr = summationEquation[0];
  let indexingSet: BoxedExpression[] = [];
  if (summationEquation) {
    indexingSet = [];
    for (let i = 1; i < summationEquation.length; i++)
      indexingSet.push(summationEquation[i]);
  }
  let result: BoxedExpression | undefined | null = null;

  if (indexingSet?.length === 0 || isCollection(expr)) {
    // The body is a collection, e.g. Sum({1, 2, 3})
    const body =
      mode === 'simplify'
        ? expr.simplify()
        : expr.evaluate({ numericMode: mode === 'N' });

    if (bignumPreferred(ce)) {
      let sum = ce.bignum(0);
      for (const x of each(body)) {
        const term = asBignum(x);
        if (term === null) {
          result = undefined;
          break;
        }
        if (term.isFinite() === false) {
          sum = term;
          break;
        }
        sum = sum.add(term);
      }
      if (result === null) result = ce.number(sum);
    } else {
      let sum = 0;
      for (const x of each(body)) {
        const term = x.re;
        if (term === undefined) {
          result = undefined;
          break;
        }
        if (!Number.isFinite(term)) {
          sum = term;
          break;
        }
        sum += term;
      }
      if (result === null) result = ce.number(sum);
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

    // Declare the index and set its holdUntil to simplify:
    // when evaluating below we sometimes use 'simplify',
    // but in that case we want the value of the index to
    // be substituted, not keep the index name
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

    if (mode === 'simplify' && upper - lower >= MAX_SYMBOLIC_TERMS)
      return undefined;

    if (mode === 'evaluate' && upper - lower >= MAX_SYMBOLIC_TERMS) mode = 'N';

    if (mode === 'simplify') {
      const terms: BoxedExpression[] = [];
      for (let i = lower; i <= upper; i++) {
        ce.assign(index, i);
        terms.push(fn.simplify());
      }
      result = add(...terms).simplify();
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
      terms.push(fn.evaluate());
    }
    result = add(...terms).evaluate();
  }

  for (let i = 0; i < indexArray.length; i++) {
    // unassign indexes once done because if left assigned to an integer value,
    // in double summations the .evaluate will assume the inner index value = upper
    // for example in the following code latex: \\sum_{n=0}^{4}\\sum_{m=4}^{8}{n+m}`
    // if the indexes aren't unassigned, once the first pass is done, every following pass
    // will assume m is 8 for the m=4->8 iterations
    ce.assign(indexArray[i], undefined);
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
      //     result = ce.mul(ce.number(upper - lower + 1), n);

      //   // If the term is not a function of the index, but it is not pure,
      //   // fall through to the general case
      // }

      //
      // Finite series. Evaluate each term and add them up
      //
      if (result === null && isFinite) {
        if (bignumPreferred(ce)) {
          let sum = ce.bignum(0);
          for (let i = lower; i <= upper; i++) {
            ce.assign(index, i);
            const term = asBignum(fn.N());
            if (term === null) {
              result = undefined;
              break;
            }
            if (term.isFinite() === false) {
              sum = term;
              break;
            }
            sum = sum.add(term);
          }
          if (result === null) result = ce.number(sum);
        } else {
          // Machine precision
          const precision = ce.precision;
          ce.precision = 'machine';
          let sum = 0;
          for (let i = lower; i <= upper; i++) {
            ce.assign(index, i);
            const term = fn.N().re;
            if (term === undefined) {
              result = undefined;
              break;
            }
            if (!Number.isFinite(term)) {
              sum = term;
              break;
            }
            sum += term;
          }
          ce.precision = precision;
          if (result === null) result = ce.number(sum);
        }
      } else if (result === null) {
        //
        // Infinite series.
        //

        // First, check for divergence
        ce.assign(index, 1000);
        const nMax = fn.N();
        ce.assign(index, 999);
        const nMaxMinusOne = fn.N();

        const ratio = nMax.div(nMaxMinusOne).re;
        if (
          ratio !== undefined &&
          Number.isFinite(ratio) &&
          Math.abs(ratio) > 1
        ) {
          result = ce.PositiveInfinity;
        } else {
          // Potentially converging series.
          // Evaluate as a machine number (it's an approximation to infinity, so
          // no point in calculating with high precision), and check for convergence
          let sum = 0;
          const precision = ce.precision;
          ce.precision = 'machine';
          for (let i = lower; i <= upper; i++) {
            ce.assign(index, i);
            const term = fn.N().re;
            if (term === undefined) {
              result = undefined;
              break;
            }
            // Converged (or diverged), early exit
            if (Math.abs(term) < Number.EPSILON || !Number.isFinite(term))
              break;
            sum += term;
          }
          ce.precision = precision;
          if (result === null) result = ce.number(sum);
        }
      }
    }
  }

  ce.popScope();

  return result ?? undefined;
}
