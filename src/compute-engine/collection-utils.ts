import { asFloat } from './numerics/numeric';
import { BoxedExpression } from './public';

/**
 *
 * Iterate over all the expressions in an expression tree.
 *
 * Some expressions are not iterated because they are evaluated
 * to an "elementary" collection, for example "Fill".
 *
 * Some expressions are infinite and not iterable, for example
 * "Repeat", "Cycle", ...
 *
 * @param col
 *
 * @returns
 */
export function* iterable(
  col: BoxedExpression,
  exclude?: string[]
): Generator<BoxedExpression> {
  const ce = col.engine;
  const h = col.head;

  if (typeof h === 'string' && exclude?.includes(h)) {
    yield col;
    return;
  }

  const iter = iterator(col);
  if (iter) {
    let i = 0;
    while (true) {
      const { done, value } = iter.next();
      if (done) return;
      if (i++ > ce.iterationLimit) {
        yield ce.error('iteration-limit-exceeded');
        return;
      }
      yield value;
    }
  }

  // if (h === 'Range') {
  //   let lower = asFloat(col.op1);
  //   if (lower === null) return;
  //   let upper = asFloat(col.op2);
  //   if (upper === null) {
  //     upper = lower;
  //     lower = 1;
  //   }

  //   if (!isFinite(lower) || !isFinite(upper)) return;

  //   if (lower > upper) {
  //     const step = asFloat(col.op3 ?? -1) ?? -1;
  //     if (step >= 0) return;
  //     for (let i = lower; i <= upper; i += step) yield ce.number(i);
  //     return;
  //   }

  //   const step = asFloat(col.op3 ?? 1) ?? 1;
  //   if (step <= 0) return;
  //   for (let i = lower; i <= upper; i += step) yield ce.number(i);
  //   return;
  // }

  // if (h === 'Linspace') {
  //   let start = asFloat(col.op1);
  //   if (start === null) return;
  //   let stop = asFloat(col.op2);
  //   if (stop === null) {
  //     stop = start;
  //     start = 0;
  //   }
  //   const num = asFloat(col.op3) ?? 50;
  //   if (!Number.isInteger(num)) return;
  //   if (num <= 0) return;

  //   if (!isFinite(stop) || !isFinite(start)) return;

  //   const step = (stop - start) / (num - 1);

  //   for (let i = start; i <= stop; i += step) yield ce.number(i);
  //   return;
  // }

  // // Sequence are automatically flattended
  // if (h === 'Sequence') {
  //   for (const x of col.ops!) {
  //     if (x.head === 'Sequence') yield* each(x.ops!);
  //     else yield x;
  //   }
  //   return;
  // }

  // if (
  //   typeof h === 'string' &&
  //   /^(List|Set|Tuple|Single|Pair|Triple)$/.test(h)
  // ) {
  //   for (const x of col.ops!) yield x;
  //   return;
  // }

  yield col;
}

/**
 * Iterate over all the expressions in an expression tree with
 * the following form:
 * - `["Range"]`, `["Interval"]`, `["Linspace"]` expressions
 * - `["List"]` and `["Set"]` expressions
 * - `["Tuple"]`, `["Pair"]`, `["Pair"]`, `["Triple"]` expressions
 * - `["Sequence"]` expressions
 *
 * @param exclude a list of expression heads to exclude from the
 *  recursive iteration. They are instead retured as is.
 *
 *
 */
export function* each(
  ops: BoxedExpression[],
  exclude?: string[]
): Generator<BoxedExpression> {
  if (ops.length === 0) return;

  for (const op of ops) for (const val of iterable(op, exclude)) yield val;
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
