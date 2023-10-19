import { BoxedExpression } from './public';

export function isCollection(col: BoxedExpression): boolean {
  if (col.string !== null) return true;
  const def = col.functionDefinition;
  return def?.iterator !== undefined;
}

export function isFiniteCollection(col: BoxedExpression): boolean {
  const l = length(col);
  if (l === undefined) return false;
  return Number.isFinite(l);
}

export function isIndexableCollection(col: BoxedExpression): boolean {
  if (col.string !== null) return true;
  const def = col.functionDefinition;
  return def?.at !== undefined;
}

/**
 *
 * Iterate over all the elements of a collection. If not a collection,
 * return the expression.
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
 * @param col - A potential collection
 *
 * @returns
 */
export function* each(col: BoxedExpression): Generator<BoxedExpression> {
  const limit = col.engine.iterationLimit;
  const iter = iterator(col);
  if (!iter) {
    yield col;
    return;
  }
  // We've got an iterator, iterate over it
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

export function length(col: BoxedExpression): number | undefined {
  if (col.string !== null) return col.string.length;

  const def = col.functionDefinition;
  return def?.size?.(col);
}

/**
 * From an expression, create an iterator that can be used
 * to enumerate values.
 *
 * `expr` can be a collection, a function, an expression, a string.
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
  // Note that if there is an at() handler, there is always
  // at least a default iterator
  const def = expr.functionDefinition;
  if (def?.iterator) return def.iterator(expr);

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

/**
 * indexable(expr) return a JS function with one argument.
 *
 * Evaluate expr.
 * If expr is indexable function (def with at handler), return handler.
 * Otherwise, call makeLambda, then return function that set scope
 * with one arg, then evaluate result of makeLambda.
 */

// export function indexable(
//   expr: BoxedExpression
// ): ((index: number) => BoxedExpression | undefined) | undefined {
//   expr = expr.evaluate();

//   // If the function expression is indexable (it has an at() handler)
//   // return the at() handler, bound to this expression.
//   if (expr.functionDefinition?.at) {
//     const at = expr.functionDefinition.at;
//     return (index) => at(expr, index);
//   }

//   //
//   // String at
//   //
//   const s = expr.string;
//   if (s !== null) {
//     return (index) => {
//       const c = s.charAt(index);
//       if (c === undefined) return expr.engine.Nothing;
//       return expr.engine.string(c);
//     };
//   }

//   // Expressions that don't have an at() handler, have the
//   // argument applied to them.
//   const lambda = makeLambda(expr);
//   if (lambda) return (index) => lambda([expr.engine.number(index)]);

//   return undefined;
// }
