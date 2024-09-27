import type { BoxedExpression } from '../public.ts';

import { MAX_ITERATION } from '../numerics/numeric.ts';
import { fromRange, reduceCollection } from './collections.ts';

export type IndexingSet = {
  index: string | undefined;
  lower: number;
  upper: number;
  isFinite: boolean;
};

/**
 * IndexingSet is an expression describing an index variable
 * and a range of values for that variable.
 *
 * Note that when this function is called the indexing set is assumed to be canonical: 'Hold' has been handled, the indexing set is a tuple, and the bounds are canonical.
 *
 * This can take several valid forms:
 * - a symbol, e.g. `n`, the upper and lower bounds are assumed ot be infinity
 * - a tuple, e.g. `["Pair", "n", 1]` or `["Tuple", "n", 1, 10]` with one
 *   or two bounds
 *
 * The result is a normalized version that includes the index, the lower and
 * upper bounds of the range, and a flag indicating whether the range is finite.
 * @param indexingSet
 * @returns
 */
export function normalizeIndexingSet(
  indexingSet: BoxedExpression
): IndexingSet {
  console.assert(indexingSet?.operator === 'Tuple');

  let lower = 1;
  let upper = lower + MAX_ITERATION;
  let index: string | undefined = undefined;
  let isFinite = true;
  index = indexingSet.op1.symbol!;
  console.assert(index, 'Indexing set must have an index');
  lower = Math.floor(indexingSet.op2.re);
  if (isNaN(lower)) lower = 1;

  if (!Number.isFinite(lower)) isFinite = false;

  if (indexingSet.op3.symbol === 'Nothing' || indexingSet.op3.isInfinity) {
    isFinite = false;
  } else {
    if (!isNaN(indexingSet.op3.re))
      upper = Math.floor(indexingSet.op3.re ?? upper);
    if (!Number.isFinite(upper)) isFinite = false;
  }
  if (!isFinite && Number.isFinite(lower)) upper = lower + MAX_ITERATION;

  return { index, lower, upper, isFinite };
}

export function normalizeIndexingSets(
  ops: ReadonlyArray<BoxedExpression>
): IndexingSet[] {
  return ops.map((op) => normalizeIndexingSet(op));
}

export function indexingSetCartestianProduct(
  indexingSets: IndexingSet[]
): number[][] {
  console.assert(indexingSets.length > 0, 'Indexing sets must not be empty');

  //
  // Start with the first index
  //
  let { index, lower, upper, isFinite } = indexingSets[0];
  if (!isFinite) upper = lower + MAX_ITERATION;
  let result = fromRange(lower, upper).map((x) => [x]);

  // We had a single index, we're done
  if (indexingSets.length === 1) return result;

  //
  // We have multiple indexes
  //
  for (let i = 1; i < indexingSets.length; i++) {
    // eslint-disable-next-line prefer-const
    let { index, lower, upper, isFinite } = indexingSets[i];
    if (!isFinite) upper = lower + MAX_ITERATION;

    result = cartesianProduct(
      result.map((x) => x[0]),
      fromRange(lower, upper)
    );
  }
  return result;
}

/**
 * Calculates the cartesian product of two arrays.
 * ```ts
 * // Example usage
 * const array1 = [1, 2, 3];
 * const array2 = ['a', 'b', 'c'];
 * const result = cartesianProduct(array1, array2);
 * console.log(result);
 * // Output: [[1, 'a'], [1, 'b'], [1, 'c'], [2, 'a'], [2, 'b'], [2, 'c'], [3, 'a'], [3, 'b'], [3, 'c']]
 * ```
 * @param array1 - The first array.
 * @param array2 - The second array.
 * @returns The cartesian product as a 2D array.
 */
export function cartesianProduct(
  array1: number[],
  array2: number[]
): number[][] {
  return array1.flatMap((item1) => array2.map((item2) => [item1, item2]));
}

export function canonicalIndexingSet(
  expr: BoxedExpression
): BoxedExpression | undefined {
  const ce = expr.engine;
  let index: BoxedExpression;
  let upper: BoxedExpression | null = null;
  let lower: BoxedExpression | null = null;

  if (
    expr.operator === 'Tuple' ||
    expr.operator === 'Triple' ||
    expr.operator === 'Pair' ||
    expr.operator === 'Single'
  ) {
    index = expr.op1;
    lower = expr.ops![1]?.canonical ?? null;
    upper = expr.ops![2]?.canonical ?? null;
  } else index = expr;

  if (index.operator === 'Hold') index = index.op1;

  if (!index.symbol) return undefined;

  if (index.symbol && index.symbol !== 'Nothing')
    ce.declare(index.symbol, 'integer');

  if (upper && lower) return ce.tuple(index, lower, upper);
  if (upper) return ce.tuple(index, ce.One, upper);
  if (lower) return ce.tuple(index, lower);
  return ce.tuple(index);
}

export function canonicalBigop(
  operator: string,
  body: BoxedExpression,
  indexingSets: BoxedExpression[]
): BoxedExpression | null {
  const ce = body.engine;

  // Sum is a scoped function (to declare the indexes)
  ce.pushScope();

  body ??= ce.error('missing');

  // Note: we need to canonicalize the indexes before canonicalizing the body
  // since we need the index to be declared before we can bind it
  const indexes = indexingSets
    .map((x) => canonicalIndexingSet(x))
    .filter((x) => x !== undefined);

  const result = ce._fn(operator, [body.canonical, ...indexes]);

  ce.popScope();
  return result;
}

/**
 * Process an expression of the form
 * - ['Operator', body, ['Tuple', index1, lower, upper]]
 * - ['Operator', body, ['Tuple', index1, lower, upper], ['Tuple', index2, lower, upper], ...]
 * - ['Operator', body]
 * - ['Operator', collection]
 *
 * `fn()` is the processing done on each element
 */
/**
 * Apply the function `fn` to the body of a big operator, according to the
 * indexing sets.
 */
export function reduceBigOp<T>(
  body: BoxedExpression,
  indexes: ReadonlyArray<BoxedExpression>,
  fn: (acc: T, x: BoxedExpression) => T | null,
  initial: T
): T | undefined {
  // If the body is a collection, reduce it
  // i.e. Sum({1, 2, 3}) = 6
  if (body.isCollection) return reduceCollection(body, fn, initial);

  // If there are no indexes, the summation is a constant
  // i.e. Sum(3) = 3
  if (indexes.length === 0) return fn(initial, body) ?? undefined;

  //
  // We have one or more indexing sets, i.e. `["Tuple", index, lower, upper]`
  // Create a cartesian product of the indexing sets.
  //
  const ce = body.engine;
  const savedScope = ce.swapScope(body.scope);

  const indexingSets = normalizeIndexingSets(indexes);
  const cartesianArray = indexingSetCartestianProduct(indexingSets);

  //
  // Iterate over the cartesian product and evaluate the body
  //
  let result: T | undefined = initial;
  for (const element of cartesianArray) {
    indexingSets.forEach((x, i) => ce.assign(x.index!, element[i]));
    result = fn(result, body) ?? undefined;
    if (result === undefined) break;
  }

  // Unassign indexes once done because if left assigned to an integer value,
  // in double summations the .evaluate will assume the inner index
  // value = upper for example in the following code:
  // \\sum_{n=0}^{4}\\sum_{m=4}^{8}{n+m}`
  // If the indexes aren't unassigned, once the first pass is done,
  // every following pass will assume m is 8 for the m=4->8 iterations
  for (const indexingSet of indexingSets)
    ce.assign(indexingSet.index!, undefined);

  // Return to the original scope
  ce.swapScope(savedScope);

  return result ?? undefined;
}
