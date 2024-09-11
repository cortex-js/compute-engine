import type { BoxedExpression, CollectionHandlers } from './public';

/** If a collection has fewer than this many elements, eagerly evaluate it.
 *
 * For example, evaluate the Union of two sets with 10 elements each will
 * result in a set with 20 elements.
 *
 * If the sum of the sizes of the two sets is greater than `MAX_SIZE_EAGER_COLLECTION`, the result is a Union expression
 *
 */
export const MAX_SIZE_EAGER_COLLECTION = 100;

// export function isCollection(col: BoxedExpression): boolean {
//   if (col.string !== null) return true;
//   if ((col.symbolDefinition?.value?.string ?? null) !== null) return true;
//   const def =
//     col.functionDefinition ?? col.symbolDefinition?.value?.functionDefinition;
//   return def?.iterator !== undefined;
// }

export function isFiniteCollection(col: BoxedExpression): boolean {
  const l = length(col);
  if (l === undefined) return false;
  return Number.isFinite(l);
}

export function isIndexableCollection(col: BoxedExpression): boolean {
  // Is it a string literal?
  if (col.string !== null) return true;
  // Is it a syumbol with a string value?
  if ((col.symbolDefinition?.value?.string ?? null) !== null) return true;

  // Is it an expression with a at() handler?
  const def =
    col.functionDefinition ?? col.symbolDefinition?.value?.functionDefinition;
  return def?.collection?.at !== undefined;
}

export function isFiniteIndexableCollection(col: BoxedExpression): boolean {
  if (col.string !== null) return true;
  if ((col.symbolDefinition?.value?.string ?? null) !== null) return true;
  const def =
    col.functionDefinition ?? col.symbolDefinition?.value?.functionDefinition;
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
    if (i++ > limit) {
      yield col.engine.error('iteration-limit-exceeded');
      return;
    }
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
  const s = col.string ?? col.symbolDefinition?.value?.string ?? null;
  if (s !== null) return s.length;

  const def =
    col.functionDefinition ?? col.symbolDefinition?.value?.functionDefinition;
  return def?.collection?.size?.(col);
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
  // Is it a function expresson with a definition that includes an iterator?
  // e.g. ["Range", 5]
  // or a symbol whose value is a function expression with an iterator?
  const def =
    expr.functionDefinition ?? expr.symbolDefinition?.value?.functionDefinition;

  // Note that if there is an at() handler, there is always
  // at least a default iterator so we could just check for the at handler
  if (def?.collection?.iterator) return def.collection.iterator(expr);

  //
  // String iterator
  //
  const s = expr.string ?? expr.symbolDefinition?.value?.string ?? null;
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
  const def =
    expr.functionDefinition ?? expr.symbolDefinition?.value?.functionDefinition;

  if (def?.collection?.at) return def.collection.at(expr, index);

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

  let result: Partial<CollectionHandlers> = {};

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
        if (target.isEqual(result.value)) return i;
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
