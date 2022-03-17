import { BoxedExpression } from '../public';

/**
 * Flatten the arguments.
 * If `expr` was canonical, the result it canonical.
 */
export function flatten(expr: BoxedExpression, head: string): BoxedExpression {
  if (!expr.ops || expr.head !== head) return expr;

  const tail = flattenOps(expr.ops, head);
  if (!tail) return expr;

  return expr.engine.fn(head, tail);
}

export function flattenOps(
  ops: BoxedExpression[],
  head: string
): BoxedExpression[] | null {
  const result: BoxedExpression[] = [];
  for (const arg of ops) {
    if (!arg.ops || arg.head !== head) result.push(arg);
    else {
      // ["f", a, ["f", b, c]] -> ["f", a, b, c]
      // or ["f", ["f", a]] -> ["f", a]
      result.push(...(flattenOps(arg.ops, head) ?? arg.ops));
    }
  }

  // If number of arguments didn't change, we didn't flatten
  if (result.length === ops.length) return null;

  return result;
}
