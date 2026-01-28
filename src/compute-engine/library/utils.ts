import type { BoxedExpression, ComputeEngine, Scope } from '../global-types';

import { MAX_ITERATION } from '../numerics/numeric';
import { fromRange, reduceCollection } from './collections';

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
  console.assert(indexingSet?.operator === 'Limits');

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

export function indexingSetCartesianProduct(
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

/** Given a sequence of arguments, return an array of Limits:
 *
 * - ["Range", 1, 10] -> ["Limits", "Unknown", 1, 10]
 * - 1, 10 -> ["Limits", "Nothing", 1, 10]
 * - [Tuple, "x", 1, 10] -> ["Limits", "x", 1, 10]
 *
 */
export function canonicalLimitsSequence(
  ops: ReadonlyArray<BoxedExpression>,
  options: { engine: ComputeEngine }
): BoxedExpression[] {
  const ce = options.engine;
  const result: BoxedExpression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.operator === 'Range') {
      // ["Range", 1, 10]
      result.push(
        canonicalLimits([ce.Nothing, op.op1, op.op2], options) ??
          ce.error('missing')
      );
    } else if (
      op.operator &&
      ['Limits', 'Tuple', 'Triple', 'Pair', 'Single', 'Hold'].includes(
        op.operator
      )
    ) {
      // ["Tuple", "n", 1, 10]
      // ["Limits", "n", 1, 10]
      // ["Hold", "x"]
      result.push(canonicalLimits(op.ops!, options) ?? ce.error('missing'));
    } else if (op.symbol) {
      // "x" or "1, 10"
      if (ops[i + 1]?.isNumberLiteral) {
        if (ops[i + 2]?.isNumberLiteral) {
          // "n", 1, 10
          result.push(
            canonicalLimits([op, ops[i + 1], ops[i + 2]], options) ??
              ce.error('missing')
          );
          i += 2;
        } else {
          // "n", 10
          result.push(
            canonicalLimits([op, ops[i + 1]], options) ?? ce.error('missing')
          );
          i += 1;
        }
      } else {
        // "x"
        result.push(canonicalLimits([op], options) ?? ce.error('missing'));
      }
    }
  }

  return result;
}

export function canonicalLimits(
  ops: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | null {
  if (ops.length === 1) {
    // ["Limits", "n"]
    // ["Limits", ["Hold", "n"]]
    // ["Limits", "10"] --> ???
    const op = ops[0];
    if (op.symbol) return ce._fn('Limits', [op, ce.Nothing, ce.Nothing]);
    if (op.operator === 'Hold') return canonicalLimits(op.ops!, { engine: ce });

    // We didn't find a symbol, so we can't create a Limits expression
    return ce._fn('Limits', [ce.typeError('symbol', undefined, op)]);
  } else if (ops.length > 1) {
    let index: BoxedExpression = ce.Nothing;
    let lower: BoxedExpression | null = ce.Nothing;
    let upper: BoxedExpression | null = ops[1].canonical;
    if (ops.length === 2) {
      // ["Limits", "n", 10]
      // ["Limits", ["Hold", "n"], 10]]
      // ["Limits", 0, 10]
      if (ops[0].operator === 'Hold') {
        index = ops[0].op1;
        upper = ops[1].canonical;
      } else if (ops[0].symbol) {
        index = ops[0];
        upper = ops[1].canonical;
      } else {
        index = ce.Nothing;
        lower = ops[0].canonical;
        upper = ops[1].canonical;
      }
    } else if (ops.length === 3) {
      index = ops[0] ?? ce.Nothing;
      lower = ops[1]?.canonical ?? ce.Nothing;
      upper = ops[2]?.canonical ?? ce.Nothing;
    }
    if (index.operator === 'Hold') index = index.op1;

    if (!index.symbol) index = ce.typeError('symbol', index.type, index);

    return ce._fn('Limits', [index, lower, upper]);
  }
  return null;
}

/** Return a limit/indexing set in canonical form as a `Limits` expression
 * with:
 * - `index` (a symbol), `Nothing` if none is present
 * - `lower` (a number), `Nothing` if none is present
 * - `upper` (a number), `Nothing` if none is present
 *
 * Assume we are in the context of a big operator
 * (i.e. `pushScope()` has been called)
 */
export function canonicalIndexingSet(
  expr: BoxedExpression
): BoxedExpression | undefined {
  const ce = expr.engine;
  let index: BoxedExpression;
  let upper: BoxedExpression | null = null;
  let lower: BoxedExpression | null = null;

  // If this is already a canonical Limits expression, return it (after
  // canonicalizing its operands) so re-canonicalization paths (like `subs`)
  // preserve the bounds.
  if (expr.operator === 'Limits') {
    const canonicalIndex = expr.op1.canonical;
    const canonicalLower = expr.op2?.canonical ?? ce.Nothing;
    const canonicalUpper = expr.op3?.canonical ?? ce.Nothing;
    if (!canonicalIndex.symbol)
      return ce.function('Limits', [
        ce.typeError('symbol', undefined, canonicalIndex),
      ]);
    return ce.function('Limits', [
      canonicalIndex,
      canonicalLower,
      canonicalUpper,
    ]);
  }

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

  if (upper && lower) return ce.function('Limits', [index, lower, upper]);
  if (upper) return ce.function('Limits', [index, ce.One, upper]);
  if (lower) return ce.function('Limits', [index, lower]);
  return ce.function('Limits', [index]);
}

export function canonicalBigop(
  bigOp: string,
  body: BoxedExpression,
  indexingSets: BoxedExpression[],
  scope: Scope | undefined
): BoxedExpression | null {
  const ce = body.engine;

  // Sum is a scoped function (to declare the indexes)
  ce.pushScope(scope);

  // Note: we need to canonicalize the indexes before canonicalizing the body
  // since we need the indexes to be declared before we can bind them
  const indexes = indexingSets.map(
    (x) => canonicalIndexingSet(x) ?? ce.error('missing')
  );

  body = body?.canonical ?? ce.error('missing');

  ce.popScope();

  if (body.isCollection) {
    if (bigOp === 'Sum') return ce.box(['Reduce', body, 'Add', 0]);

    return ce.box(['Reduce', body, 'Multiply', 1]);
  }

  return ce._fn(bigOp, [body, ...indexes], { scope });
}

/**
 * Process an expression of the form
 * - ['Operator', body, ['Tuple', index1, lower, upper]]
 * - ['Operator', body, ['Tuple', index1, lower, upper], ['Tuple', index2, lower, upper], ...]
 * - ['Operator', body]
 * - ['Operator', collection]
 *
 * `fn()` is the processing done on each element
 * Apply the function `fn` to the body of a big operator, according to the
 * indexing sets.
 */
export function* reduceBigOp<T>(
  body: BoxedExpression,
  indexes: ReadonlyArray<BoxedExpression>,
  fn: (acc: T, x: BoxedExpression) => T | null,
  initial: T
): Generator<T | undefined> {
  // If the body is a collection, reduce it
  // i.e. Sum({1, 2, 3}) = 6
  if (body.isCollection)
    return yield* reduceCollection(body.evaluate(), fn, initial);

  // If there are no indexes, the summation is a constant
  // i.e. Sum(3) = 3
  if (indexes.length === 0) return fn(initial, body) ?? undefined;

  //
  // We have one or more indexing sets, i.e. `["Tuple", index, lower, upper]`
  // Create a cartesian product of the indexing sets.
  //
  const ce = body.engine;

  const indexingSets = normalizeIndexingSets(indexes);

  // @todo: special case when there is only one index

  const cartesianArray = indexingSetCartesianProduct(indexingSets);

  //
  // Iterate over the cartesian product and evaluate the body
  //
  let result: T | undefined = initial;
  let counter = 0;
  for (const element of cartesianArray) {
    indexingSets.forEach((x, i) => ce.assign(x.index!, element[i]));
    result = fn(result, body) ?? undefined;
    counter += 1;
    if (counter % 1000 === 0) yield result;
    if (result === undefined) break;
  }

  return result ?? undefined;
}
