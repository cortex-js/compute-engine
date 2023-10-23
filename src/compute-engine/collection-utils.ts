import { BoxedExpression } from './public';

export function isCollection(col: BoxedExpression): boolean {
  if (col.string !== null) return true;
  if ((col.symbolDefinition?.value?.string ?? null) !== null) return true;
  const def =
    col.functionDefinition ?? col.symbolDefinition?.value?.functionDefinition;
  return def?.iterator !== undefined;
}

export function isFiniteCollection(col: BoxedExpression): boolean {
  const l = length(col);
  if (l === undefined) return false;
  return Number.isFinite(l);
}

export function isIndexableCollection(col: BoxedExpression): boolean {
  if (col.string !== null) return true;
  if ((col.symbolDefinition?.value?.string ?? null) !== null) return true;
  const def =
    col.functionDefinition ?? col.symbolDefinition?.value?.functionDefinition;
  return def?.at !== undefined;
}

export function isFiniteIndexableCollection(col: BoxedExpression): boolean {
  if (col.string !== null) return true;
  if ((col.symbolDefinition?.value?.string ?? null) !== null) return true;
  const def =
    col.functionDefinition ?? col.symbolDefinition?.value?.functionDefinition;
  if (!def) return false;
  return def.at !== undefined && Number.isFinite(def.size?.(col) ?? Infinity);
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
  return def?.size?.(col);
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
function iterator(
  expr: BoxedExpression
): Iterator<BoxedExpression> | undefined {
  // Is it a function expresson with a definition that includes an iterator?
  // e.g. ["Range", 5]
  // or a symbol whose value is a function expression with an iterator?
  const def =
    expr.functionDefinition ?? expr.symbolDefinition?.value?.functionDefinition;

  // Note that if there is an at() handler, there is always
  // at least a default iterator so we could just check for the at handler
  if (def?.iterator) return def.iterator(expr);

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

  if (def?.at) return def.at(expr, index);

  const s = expr.string;
  if (s) {
    if (index < 1) return expr.engine.string(s.charAt(s.length + index));
    return expr.engine.string(s.charAt(index - 1));
  }

  return undefined;
}
