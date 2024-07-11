import { asMachineInteger } from '../boxed-expression/numerics';
import { checkDomain } from '../boxed-expression/validate';
import { MAX_ITERATION } from '../numerics/numeric';
import { BoxedExpression } from '../public';

/**
 * Assume the caller has setup a scope. The index
 * variable will be declared in that scope.
 *
 * @param indexingSet

 * IndexingSet is an expression describing an index variable
 * and a range of values for that variable.
 * 
 * The MultiIndexingSet function takes an expression of the form
 * \sum_{i=1,j=1}^{10,10} x and returns an array of expressions
 * ["Sum","x",["Triple","i",1,10],["Triple","j",1,10]
 */

export function MultiIndexingSet(
  indexingSet: BoxedExpression | undefined
): ReadonlyArray<BoxedExpression> | undefined {
  if (!indexingSet) return undefined;
  const ce = indexingSet.engine;
  const indexes: BoxedExpression[] = [];
  const hasSuperSequence = true ? indexingSet.ops?.length == 3 : false;

  const subSequence = indexingSet.ops![0].ops![0].ops;
  const sequenceLength = subSequence?.length ?? 0;
  let superSequence: ReadonlyArray<BoxedExpression> | null = null;
  if (hasSuperSequence) {
    superSequence = indexingSet.ops![2].ops![0].ops;
    // check that the sequence lengths are the same in the sub and super scripts
    if (subSequence?.length != superSequence?.length) {
      return undefined;
    }
  }
  // iterate through seuqences and call subscriptAgnosticIndexingSet
  for (let i = 0; i < sequenceLength; i++) {
    // this for loop separates any sequences of element in the sub and super script
    // and put them into a proper indexing set
    // e.g. \sum_{i=1,j=1}^{10,10} x -> ["Sum","x",["Triple","i",1,10],["Triple","j",1,10]
    let canonicalizedIndex: BoxedExpression | undefined = undefined;
    let index: BoxedExpression;
    let lower: BoxedExpression | null = null;
    let upper: BoxedExpression | null = null;

    index = subSequence![i].canonical;
    if (subSequence) {
      if (subSequence[i].head === 'Equal') {
        index = subSequence[i].op1.canonical;
        lower = subSequence[i].op2.canonical;
      }
    }
    if (superSequence) {
      upper = superSequence[i].canonical;
    }

    if (upper && lower)
      canonicalizedIndex = SingleIndexingSet(ce.tuple([index, lower, upper]));
    else if (upper)
      canonicalizedIndex = SingleIndexingSet(ce.tuple([index, ce.One, upper]));
    else if (lower)
      canonicalizedIndex = SingleIndexingSet(ce.tuple([index, lower]));
    else canonicalizedIndex = SingleIndexingSet(index);

    if (canonicalizedIndex) indexes.push(canonicalizedIndex);
  }

  return indexes;
}

/**
 * Assume the caller has setup a scope. The index
 * variable will be declared in that scope.
 *
 * @param indexingSet

 * IndexingSet is an expression describing an index variable
 * and a range of values for that variable.
 * 
 * The SingleIndexingSet function takes an expression of the form
 * \sum_{i=1}^{10} x and returns an array of expressions
 * ["Sum","x",["Triple","i",1,10]
 */

export function SingleIndexingSet(
  indexingSet: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!indexingSet) return undefined;
  const ce = indexingSet.engine;
  let index: BoxedExpression | null = null;
  let lower: BoxedExpression | null = null;
  let upper: BoxedExpression | null = null;
  if (
    indexingSet.head !== 'Tuple' &&
    indexingSet.head !== 'Triple' &&
    indexingSet.head !== 'Pair' &&
    indexingSet.head !== 'Single'
  ) {
    index = indexingSet;
  } else {
    // Don't canonicalize the index. Canonicalization has the
    // side effect of declaring the symbol, here we're using
    // it to do a local declaration
    index = indexingSet.ops![0] ?? null;
    lower = indexingSet.ops![1]?.canonical ?? null;
    upper = indexingSet.ops![2]?.canonical ?? null;
  }
  if (index.head === 'Hold') index = index.op1;

  if (index.symbol) {
    ce.declare(index.symbol, { domain: 'Integers' });
    index.bind();
  }

  // The range bounds, if present, should be integers numbers
  if (lower && lower.isFinite) lower = checkDomain(ce, lower, 'Integers');
  if (upper && upper.isFinite) upper = checkDomain(ce, upper, 'Integers');

  if (lower && upper) return ce.tuple([index, lower, upper]);
  if (upper) return ce.tuple([index, ce.One, upper]);
  if (lower) return ce.tuple([index, lower]);

  return index;
}

/**
 * IndexingSet is an expression describing an index variable
 * and a range of values for that variable.
 *
 * This can take several valid forms:
 * - a symbol, e.g. `n`, the upper and lower bounds are assumed ot be infinity
 * - a tuple, e.g. `["Pair", "n", 1]` or `["Tuple", "n", 1, 10]` with one or two bounds
 *
 * The result is a normalized version that includes the
 * index, the lower and upper bounds of the range, and
 * a flag indicating whether the range is finite.
 * @param limits
 * @returns
 */
export function normalizeIndexingSet(
  limits: BoxedExpression | undefined
): [
  index: string | undefined,
  lower: number,
  upper: number,
  isFinite: boolean,
] {
  let lower = 1;
  let upper = lower + MAX_ITERATION;
  let index: string | undefined = undefined;
  let isFinite = true;
  if (
    limits &&
    (limits.head === 'Tuple' ||
      limits.head === 'Triple' ||
      limits.head === 'Pair' ||
      limits.head === 'Single')
  ) {
    index =
      (limits.op1.head === 'Hold'
        ? limits.op1.op1.symbol
        : limits.op1.symbol) ?? 'Nothing';
    lower = asMachineInteger(limits.op2) ?? 1;

    if (!Number.isFinite(lower)) isFinite = false;

    if (limits.op3.symbol === 'Nothing' || limits.op3.isInfinity) {
      isFinite = false;
    } else {
      const u = asMachineInteger(limits.op3);
      if (u === null) isFinite = false;
      else {
        upper = u;
        if (!Number.isFinite(upper)) isFinite = false;
      }
    }
    if (!isFinite && Number.isFinite(lower)) upper = lower + MAX_ITERATION;
  } else if (limits) {
    // Assume we only have an index, no bounds
    index =
      (limits.head === 'Hold' ? limits.op1.symbol : limits.symbol) ?? 'Nothing';
    lower = 1;
    upper = lower + MAX_ITERATION;
  }
  return [index, lower, upper, isFinite];
}

export function cartesianProduct(
  array1: number[],
  array2: number[]
): number[][] {
  return array1.flatMap((item1) => array2.map((item2) => [item1, item2]));
}

export function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
