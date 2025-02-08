import { CancellationError } from '../common/interruptible';
import type { BoxedExpression } from './public';
import type { CollectionHandlers } from './types';

/** If a collection has fewer than this many elements, eagerly evaluate it.
 *
 * For example, evaluate the Union of two sets with 10 elements each will
 * result in a set with 20 elements.
 *
 * If the sum of the sizes of the two sets is greater than `MAX_SIZE_EAGER_COLLECTION`, the result is a Union expression
 *
 */
export const MAX_SIZE_EAGER_COLLECTION = 100;

export function isFiniteCollection(col: BoxedExpression): boolean {
  const l = length(col);
  if (l === undefined) return false;
  return Number.isFinite(l);
}

export function isIndexableCollection(col: BoxedExpression): boolean {
  col = resolve(col);

  // Is it a string literal or a symbol with a string value?
  if (col.string !== null) return true;

  // Is it an expression with a at() handler? (or a symbol with a value that has an at() handler)
  return col.functionDefinition?.collection?.at !== undefined;
}

export function isFiniteIndexableCollection(col: BoxedExpression): boolean {
  col = resolve(col);

  if (col.string !== null) return true;
  const def = col.functionDefinition;
  if (!def) return false;
  return (
    def.collection?.at !== undefined &&
    Number.isFinite(def.collection?.size?.(col) ?? Infinity)
  );
}

/**
 *
 * Iterate over all the elements of a collection. If not a collection,
 * return the expression.
 *
 * The `col` argument is either a collection literal, or a symbol
 * whose value is a collection literal.
 *
 * Even infinite collections are iterable. Use `isFiniteCollection()`
 * to check if the collection is finite.
 *
 * The collection can have one of the following forms:
 * - `["Range"]`, `["Interval"]`, `["Linspace"]` expressions
 * - `["List"]` and `["Set"]` expressions
 * - `["Tuple"]`, `["Pair"]`, `["Pair"]`, `["Triple"]` expressions
 * - `["Sequence"]` expressions
 * ... and more
 *
 * In general, `each` is easier to use than `iterator`, but they do the same
 * thing.
 *
 * @param col - A potential collection
 *
 * @returns
 */
export function* each(col: BoxedExpression): Generator<BoxedExpression> {
  const iter = iterator(col);
  if (!iter) {
    yield col;
    return;
  }

  // We've got an iterator, iterate over it
  const limit = col.engine.iterationLimit;
  let i = 0;
  while (true) {
    const { done, value } = iter.next();
    if (done) return;
    if (i++ > limit)
      throw new CancellationError({ cause: 'iteration-limit-exceeded' });

    yield value;
  }
}

/**
 *
 * The `col` argument is either a collection literal, or a symbol
 * whose value is a collection literal.
 *
 * @returns
 */
export function length(col: BoxedExpression): number | undefined {
  col = resolve(col);
  const s = col.string;
  if (s !== null) return s.length;

  return col.functionDefinition?.collection?.size?.(col);
}

/**
 * From an expression, create an iterator that can be used
 * to enumerate values.
 *
 * `expr` should be a collection expression, or a string, or a symbol whose
 * value is a collection expression or a string.
 *
 * - ["Range", 5]
 * - ["List", 1, 2, 3]
 * - "'hello world'"
 *
 */
export function iterator(
  expr: BoxedExpression
): Iterator<BoxedExpression> | undefined {
  // Is it a function expression with a definition that includes an iterator?
  // e.g. ["Range", 5]
  // or a symbol whose value is a function expression with an iterator?
  expr = resolve(expr);
  const def = expr.functionDefinition;

  // Note that if there is an at() handler, there is always
  // at least a default iterator so we could just check for the at handler
  if (def?.collection?.iterator) return def.collection.iterator(expr);

  //
  // String iterator
  //
  const s = expr.string;
  if (s !== null) {
    if (s.length === 0)
      return { next: () => ({ done: true, value: undefined }) };
    let i = 0;
    return {
      next: () => ({
        value: expr.engine.string(s.charAt(i++)),
        done: i > s.length,
      }),
    };
  }

  return undefined;
}

export function repeat(
  value: BoxedExpression,
  count?: number
): Iterator<BoxedExpression> {
  if (typeof count === 'number') {
    if (count < 0) count = 0;
    return {
      next() {
        if (count === 0) return { done: true, value: undefined };
        count!--;
        return { done: false, value };
      },
    };
  }
  // Infinite iterator
  return {
    next() {
      return { done: false, value };
    },
  };
}

/**
 *
 * @param expr
 * @param index 1-based index
 * @returns
 */

export function at(
  expr: BoxedExpression,
  index: number
): BoxedExpression | undefined {
  expr = resolve(expr);

  const def = expr.functionDefinition?.collection;
  if (def?.at) return def.at(expr, index);

  const s = expr.string;
  if (s) {
    if (index < 1) return expr.engine.string(s.charAt(s.length + index));
    return expr.engine.string(s.charAt(index - 1));
  }

  return undefined;
}

export function defaultCollectionHandlers(
  def: undefined | Partial<CollectionHandlers>
): Partial<CollectionHandlers> | undefined {
  if (!def) return undefined;

  const result: Partial<CollectionHandlers> = {};

  // A collection should have at least a contains and size handler
  // If it has any of the other handlers, but not these two, throw
  // an error.
  if (!def.contains || !def.size)
    throw new Error(
      'A collection must have at least a "contains" and "size" handler'
    );

  if (def.contains) result.contains = def.contains;
  if (def.size) result.size = def.size;

  if (def.at) result.at = def.at;
  if (def.iterator) result.iterator = def.iterator;
  if (def.keys) result.keys = def.keys;
  if (def.indexOf) result.indexOf = def.indexOf;
  if (def.subsetOf) result.subsetOf = def.subsetOf;

  let iterator = result.iterator;

  if (result.at && !iterator) {
    // Fallback iterator handler.
    iterator = (expr: BoxedExpression, start = 1, count = -1) => {
      const at = def.at!;
      let i = start;
      return {
        next() {
          if (count >= 0 && i >= start + count)
            return { done: true, value: undefined };
          const result = at(expr, i);
          if (result === undefined) return { done: true, value: undefined };
          i++;
          return { done: false, value: result };
        },
      };
    };
    result.iterator = iterator;
  }

  if (!result.indexOf) {
    // Fallback indexOf handler.
    result.indexOf = (expr: BoxedExpression, target: BoxedExpression) => {
      let i = 1;
      const iter = iterator!(expr);
      let result = iter.next();
      while (!result.done) {
        if (target.isSame(result.value)) return i;
        i++;
        result = iter.next();
      }
      return undefined;
    };
  }

  return {
    contains: def.contains,
    size: def.size,
    at: def.at,
    iterator: iterator,
    keys: def.keys,
    indexOf: def.indexOf,
    subsetOf: def.subsetOf,
  } as CollectionHandlers;
}

// If expr is a symbol, resolve it to its value
function resolve(expr: BoxedExpression): BoxedExpression {
  if (expr.symbolDefinition) {
    if (expr.symbolDefinition.holdUntil === 'never')
      return expr.symbolDefinition.value ?? expr;
  }
  return expr;
}

export function zip(
  items: ReadonlyArray<BoxedExpression>
): Iterator<BoxedExpression[]> {
  items = items.map((x) => resolve(x));

  // Get iterators for each item
  // If an item is not a collection, repeat it
  const iterators = items.map((x) => iterator(x) ?? repeat(x));

  // Get the length of the shortest collection
  // const shortest = Math.min(...items.map((x) => length(x) ?? 1));

  // Return an iterator that zips the items
  return {
    next() {
      const values = iterators.map((x) => x.next());
      if (values.some((x) => x.done)) return { done: true, value: undefined };
      return { done: false, value: values.map((x) => x.value) };
    },
  };
}
