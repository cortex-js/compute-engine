import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types';

import {
  isNumber,
  isSymbol,
  isFunction,
} from '../boxed-expression/type-guards';

import { MAX_ITERATION } from '../numerics/numeric';
import { fromRange, reduceCollection } from './collections';
import { extractFiniteDomainWithReason } from './logic-analysis';

/**
 * EL-4: Convert known infinite integer sets to their equivalent Limits bounds.
 * Returns undefined if the set cannot be converted to a Limits form.
 *
 * Mappings:
 * - NonNegativeIntegers (ℕ₀) → [0, ∞)
 * - PositiveIntegers (ℤ⁺) → [1, ∞)
 * - NegativeIntegers (ℤ⁻) → Not supported (would need negative direction)
 * - Integers (ℤ) → Not supported (bidirectional)
 * - Other sets (Reals, Complexes, etc.) → Not supported (non-integer)
 */
export function convertInfiniteSetToLimits(
  domainSymbol: string
): { lower: number; upper: number; isFinite: false } | undefined {
  switch (domainSymbol) {
    case 'NonNegativeIntegers':
      // ℕ₀ = {0, 1, 2, 3, ...}
      return { lower: 0, upper: MAX_ITERATION, isFinite: false };
    case 'PositiveIntegers':
      // ℤ⁺ = {1, 2, 3, ...}
      return { lower: 1, upper: 1 + MAX_ITERATION, isFinite: false };
    default:
      // NegativeIntegers, Integers, Reals, Complexes, etc. cannot be
      // converted to a simple forward iteration
      return undefined;
  }
}

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
export function normalizeIndexingSet(indexingSet: Expression): IndexingSet {
  console.assert(indexingSet?.operator === 'Limits');
  console.assert(
    isFunction(indexingSet),
    'Indexing set must be a function expression'
  );

  let lower = 1;
  let upper = lower + MAX_ITERATION;
  let index: string | undefined = undefined;
  let isFinite = true;

  // We've asserted it's a function above; narrow the type
  const fn = indexingSet as Expression &
    import('../global-types').FunctionInterface;
  const op1 = fn.op1;
  index = isSymbol(op1) ? op1.symbol : undefined;
  console.assert(index !== undefined, 'Indexing set must have an index');
  lower = Math.floor(fn.op2.re);
  if (isNaN(lower)) lower = 1;

  if (!Number.isFinite(lower)) isFinite = false;

  const op3 = fn.op3;
  const op3Sym = isSymbol(op3) ? op3.symbol : undefined;
  if (op3Sym === 'Nothing' || op3.isInfinity) {
    isFinite = false;
  } else {
    if (!isNaN(op3.re)) upper = Math.floor(op3.re ?? upper);
    if (!Number.isFinite(upper)) isFinite = false;
  }
  if (!isFinite && Number.isFinite(lower)) upper = lower + MAX_ITERATION;

  return { index, lower, upper, isFinite };
}

export function normalizeIndexingSets(
  ops: ReadonlyArray<Expression>
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
  const { index: _index, lower, upper: upper0, isFinite } = indexingSets[0];
  const upper = !isFinite ? lower + MAX_ITERATION : upper0;
  let result = fromRange(lower, upper).map((x) => [x]);

  // We had a single index, we're done
  if (indexingSets.length === 1) return result;

  //
  // We have multiple indexes
  //
  for (let i = 1; i < indexingSets.length; i++) {
    const { index: _index2, lower, upper: upperI, isFinite } = indexingSets[i];
    const upper = !isFinite ? lower + MAX_ITERATION : upperI;

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
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine }
): Expression[] {
  const ce = options.engine;
  const result: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.operator === 'Range') {
      // ["Range", 1, 10]
      const rangeFn = op as Expression &
        import('../global-types').FunctionInterface;
      result.push(
        canonicalLimits([ce.Nothing, rangeFn.op1, rangeFn.op2], options) ??
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
      const fnOp = op as Expression &
        import('../global-types').FunctionInterface;
      result.push(canonicalLimits(fnOp.ops, options) ?? ce.error('missing'));
    } else if (isSymbol(op)) {
      // "x" or "1, 10"
      if (isNumber(ops[i + 1])) {
        if (isNumber(ops[i + 2])) {
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
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | null {
  if (ops.length === 1) {
    // ["Limits", "n"]
    // ["Limits", ["Hold", "n"]]
    // ["Limits", "10"] --> ???
    const op = ops[0];
    if (isSymbol(op)) return ce._fn('Limits', [op, ce.Nothing, ce.Nothing]);
    if (isFunction(op, 'Hold')) return canonicalLimits(op.ops, { engine: ce });

    // We didn't find a symbol, so we can't create a Limits expression
    return ce._fn('Limits', [ce.typeError('symbol', undefined, op)]);
  } else if (ops.length > 1) {
    let index: Expression = ce.Nothing;
    let lower: Expression | null = ce.Nothing;
    let upper: Expression | null = ops[1].canonical;
    if (ops.length === 2) {
      // ["Limits", "n", 10]
      // ["Limits", ["Hold", "n"], 10]]
      // ["Limits", 0, 10]
      if (isFunction(ops[0], 'Hold')) {
        index = ops[0].op1;
        upper = ops[1].canonical;
      } else if (isSymbol(ops[0])) {
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
    if (isFunction(index, 'Hold')) index = index.op1;

    if (!isSymbol(index)) index = ce.typeError('symbol', index.type, index);

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
 * Or, for Element expressions, preserve them in canonical form.
 *
 * Assume we are in the context of a big operator
 * (i.e. `pushScope()` has been called)
 */
export function canonicalIndexingSet(expr: Expression): Expression | undefined {
  const ce = expr.engine;
  let index: Expression;
  let upper: Expression | null = null;
  let lower: Expression | null = null;

  // Handle Element expressions - preserve them in canonical form
  // e.g., ["Element", "n", ["Set", 1, 2, 3]]
  // or with condition: ["Element", "n", ["Set", 1, 2, 3], ["Greater", "n", 0]]
  if (isFunction(expr, 'Element')) {
    const indexExpr = expr.op1;
    const collection = expr.op2;
    const condition = expr.op3; // Optional condition (EL-3)
    if (!isSymbol(indexExpr)) return undefined;
    if (indexExpr.symbol !== 'Nothing') ce.declare(indexExpr.symbol, 'integer');
    if (condition) {
      return ce.function('Element', [
        indexExpr.canonical,
        collection.canonical,
        condition.canonical,
      ]);
    }
    return ce.function('Element', [indexExpr.canonical, collection.canonical]);
  }

  // If this is already a canonical Limits expression, return it (after
  // canonicalizing its operands) so re-canonicalization paths (like `subs`)
  // preserve the bounds.
  if (isFunction(expr, 'Limits')) {
    // Explicitly declare the index BEFORE canonicalizing the bounds.
    // This ensures the index lands in the current (BigOp) scope even when
    // noAutoDeclare is set, so bounds like 'M' (which are free variables)
    // are correctly promoted to the parent scope via noAutoDeclare.
    const rawIndex = expr.op1;
    if (isSymbol(rawIndex) && rawIndex.symbol !== 'Nothing') {
      if (!ce.context.lexicalScope.bindings.has(rawIndex.symbol))
        ce.declare(rawIndex.symbol, 'integer');
    }
    const canonicalIndex = expr.op1.canonical;
    const canonicalLower = expr.op2?.canonical ?? ce.Nothing;
    const canonicalUpper = expr.op3?.canonical ?? ce.Nothing;
    if (!isSymbol(canonicalIndex))
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
    if (!isFunction(expr)) return undefined;
    index = expr.op1;
    lower = expr.ops[1]?.canonical ?? null;
    upper = expr.ops[2]?.canonical ?? null;
  } else index = expr;

  if (isFunction(index, 'Hold')) index = index.op1;

  if (!isSymbol(index)) return undefined;

  if (index.symbol !== 'Nothing' && !ce.context.lexicalScope.bindings.has(index.symbol))
    ce.declare(index.symbol, 'integer');

  if (upper && lower) return ce.function('Limits', [index, lower, upper]);
  if (upper) return ce.function('Limits', [index, ce.One, upper]);
  if (lower) return ce.function('Limits', [index, lower]);
  return ce.function('Limits', [index]);
}

export function canonicalBigop(
  bigOp: string,
  body: Expression,
  indexingSets: Expression[],
  scope: Scope | undefined
): Expression | null {
  const ce = body.engine;

  // Always ensure we have a concrete scope object so we can set noAutoDeclare
  // and pass it to ce._fn at the end (for localScope tracking).
  const bigOpScope: Scope =
    scope ?? { parent: ce.context.lexicalScope, bindings: new Map() };

  // Set noAutoDeclare so auto-declarations of free variables (M, x) in the
  // bounds and body are promoted to the enclosing scope instead of the BigOp
  // scope. Explicit ce.declare() calls (used for index variable declaration)
  // are not affected by noAutoDeclare — they always go to the target scope
  // passed in. canonicalIndexingSet now calls ce.declare(index, 'integer')
  // before canonicalizing bounds, so the index lands in BigOpScope correctly.
  bigOpScope.noAutoDeclare = true;

  // Push BigOp scope for both index and body canonicalization.
  // canonicalIndexingSet explicitly declares the index variable (k) in the
  // current (BigOp) scope before canonicalizing bounds, so k correctly lands
  // in BigOpScope even though noAutoDeclare is set.
  // Free variables in the bounds and body (M, x) are promoted to the enclosing
  // scope via noAutoDeclare. noAutoDeclare is always cleared in the finally
  // block so the scope behaves normally during evaluation (where ce.assign
  // needs to work).
  ce.pushScope(bigOpScope);
  let indexes: Expression[];
  try {
    // Canonicalize indexes first to declare the index variable before
    // canonicalizing the body (the body may reference the index).
    indexes = indexingSets.map(
      (x) => canonicalIndexingSet(x) ?? ce.error('missing')
    );
    body = body?.canonical ?? ce.error('missing');
  } finally {
    ce.popScope();
    bigOpScope.noAutoDeclare = false;
  }

  if (body.isCollection) {
    if (bigOp === 'Sum') return ce.box(['Reduce', body, 'Add', 0]);

    return ce.box(['Reduce', body, 'Multiply', 1]);
  }

  return ce._fn(bigOp, [body, ...indexes], { scope: bigOpScope });
}

/**
 * A special symbol used to signal that a BigOp could not be evaluated
 * because the domain is non-enumerable (e.g., infinite set, unknown symbol).
 * When this is returned, the Sum/Product should keep the expression symbolic
 * rather than returning NaN.
 */
export const NON_ENUMERABLE_DOMAIN = Symbol('non-enumerable-domain');

/**
 * Result type for reduceBigOp that includes reason for failure
 */
export type BigOpResult<T> =
  | { status: 'success'; value: T }
  | { status: 'non-enumerable'; reason: string; domain?: Expression }
  | { status: 'error'; reason: string };

/**
 * Process an expression of the form
 * - ['Operator', body, ['Tuple', index1, lower, upper]]
 * - ['Operator', body, ['Tuple', index1, lower, upper], ['Tuple', index2, lower, upper], ...]
 * - ['Operator', body, ['Element', index, collection]]
 * - ['Operator', body]
 * - ['Operator', collection]
 *
 * `fn()` is the processing done on each element
 * Apply the function `fn` to the body of a big operator, according to the
 * indexing sets.
 *
 * Returns either the reduced value, or `typeof NON_ENUMERABLE_DOMAIN` if the
 * domain cannot be enumerated (in which case the expression should remain symbolic).
 */
export function* reduceBigOp<T>(
  body: Expression,
  indexes: ReadonlyArray<Expression>,
  fn: (acc: T, x: Expression) => T | null,
  initial: T
): Generator<T | typeof NON_ENUMERABLE_DOMAIN | undefined> {
  // If the body is a collection, reduce it
  // i.e. Sum({1, 2, 3}) = 6
  if (body.isCollection)
    return yield* reduceCollection(body.evaluate(), fn, initial);

  // If there are no indexes, the summation is a constant
  // i.e. Sum(3) = 3
  if (indexes.length === 0) return fn(initial, body) ?? undefined;

  const ce = body.engine;

  // Check for Element-based indexing sets
  const elementSets = indexes.filter((x) => x.operator === 'Element');
  if (elementSets.length > 0) {
    // Handle Element-based indexing sets using extractFiniteDomainWithReason
    // Use the internal generator that returns detailed results
    const gen = reduceElementIndexingSets(body, indexes, fn, initial, true);

    // Properly iterate the generator to capture both yielded values and the return value
    let iterResult = gen.next();
    while (!iterResult.done) {
      const result = iterResult.value;
      // Yield intermediate results for progress tracking (skip object results)
      if (result !== undefined && typeof result !== 'object') {
        yield result;
      }
      iterResult = gen.next();
    }

    // The final return value is in iterResult.value when done is true
    const finalResult = iterResult.value;

    // Check the final result type
    if (
      finalResult &&
      typeof finalResult === 'object' &&
      'status' in finalResult
    ) {
      const typedResult = finalResult as ReduceElementResult<T>;
      if (typedResult.status === 'success') {
        return typedResult.value;
      }
      if (typedResult.status === 'non-enumerable') {
        // Signal that the domain is non-enumerable
        return NON_ENUMERABLE_DOMAIN;
      }
      // Error case - return undefined (will become NaN)
      return undefined;
    }

    return finalResult as T | undefined;
  }

  //
  // We have one or more Limits indexing sets, i.e. `["Limits", index, lower, upper]`
  // Create a cartesian product of the indexing sets.
  //
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

/**
 * Result type for reduceElementIndexingSets to distinguish between
 * successful evaluation, non-enumerable domains (keep symbolic), and errors.
 */
export type ReduceElementResult<T> =
  | { status: 'success'; value: T }
  | { status: 'non-enumerable'; reason: string; domain?: Expression }
  | { status: 'error'; reason: string };

/**
 * Handle Element-based indexing sets by extracting finite domains
 * and iterating over their values.
 *
 * Returns a detailed result to distinguish between:
 * - Success: domain was enumerated and reduced
 * - Non-enumerable: domain is valid but cannot be enumerated (keep expression symbolic)
 * - Error: invalid indexing expression
 */
function* reduceElementIndexingSets<T>(
  body: Expression,
  indexes: ReadonlyArray<Expression>,
  fn: (acc: T, x: Expression) => T | null,
  initial: T,
  returnReason = false
): Generator<T | ReduceElementResult<T> | undefined> {
  const ce = body.engine;

  // Separate Element and Limits indexing sets
  const elementDomains: Array<{ variable: string; values: Expression[] }> = [];
  const limitsSets: IndexingSet[] = [];

  for (const idx of indexes) {
    if (idx.operator === 'Element') {
      const domainResult = extractFiniteDomainWithReason(idx, ce);

      if (domainResult.status === 'error') {
        // Invalid indexing expression - return error
        if (returnReason) {
          return {
            status: 'error',
            reason: domainResult.reason,
          } as ReduceElementResult<T>;
        }
        return undefined;
      }

      if (domainResult.status === 'non-enumerable') {
        // EL-4: Check if this is a known infinite integer set that can be
        // converted to Limits form for iteration
        if (
          domainResult.reason === 'infinite-domain' &&
          domainResult.domain &&
          isSymbol(domainResult.domain)
        ) {
          const limits = convertInfiniteSetToLimits(domainResult.domain.symbol);
          if (limits) {
            // Convert to Limits and continue with iteration
            limitsSets.push({
              index: domainResult.variable,
              ...limits,
            });
            continue; // Process next index, don't return early
          }
        }

        // Domain exists but cannot be enumerated - keep expression symbolic
        if (returnReason) {
          return {
            status: 'non-enumerable',
            reason: domainResult.reason,
            domain: domainResult.domain,
          } as ReduceElementResult<T>;
        }
        return undefined;
      }

      // Success - domain was extracted
      elementDomains.push({
        variable: domainResult.variable,
        values: domainResult.values,
      });
    } else {
      limitsSets.push(normalizeIndexingSet(idx));
    }
  }

  // If we have mixed Element and Limits sets, we need to handle both
  if (limitsSets.length > 0) {
    // Mixed case: combine Element domains with Limits ranges
    // Convert Limits to a similar format
    for (const limits of limitsSets) {
      const values: Expression[] = [];
      for (let i = limits.lower; i <= limits.upper; i++) {
        values.push(ce.number(i));
      }
      elementDomains.push({ variable: limits.index!, values });
    }
  }

  // Generate Cartesian product indices
  const indices = elementDomains.map(() => 0);
  const lengths = elementDomains.map((d) => d.values.length);

  // Check for empty domains
  if (lengths.some((l) => l === 0)) {
    if (returnReason) {
      return { status: 'success', value: initial } as ReduceElementResult<T>;
    }
    return initial;
  }

  let result: T | undefined = initial;
  let counter = 0;

  while (true) {
    // Apply current combination of assignments
    for (let i = 0; i < elementDomains.length; i++) {
      ce.assign(
        elementDomains[i].variable,
        elementDomains[i].values[indices[i]]
      );
    }

    // Evaluate and accumulate
    result = fn(result, body) ?? undefined;
    counter++;
    if (counter % 1000 === 0) yield result;
    if (result === undefined) break;

    // Move to next combination
    let dim = elementDomains.length - 1;
    while (dim >= 0) {
      indices[dim]++;
      if (indices[dim] < lengths[dim]) break;
      indices[dim] = 0;
      dim--;
    }
    if (dim < 0) break; // Exhausted all combinations
  }

  if (returnReason) {
    return { status: 'success', value: result as T } as ReduceElementResult<T>;
  }
  return result ?? undefined;
}
