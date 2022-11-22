import { BoxedExpression } from '../public';

/**
 * Flatten the arguments.
 * If `expr` was canonical, the result it canonical.
 */
export function flatten(expr: BoxedExpression, head: string): BoxedExpression {
  if (!expr.ops || expr.head !== head) return expr;
  if (expr.ops.every((x) => !x.ops || x.head !== head)) return expr;

  const tail: BoxedExpression[] = [];
  for (const arg of expr.ops) {
    if (!arg.ops || arg.head !== head) tail.push(arg);
    else {
      // ["f", a, ["f", b, c]] -> ["f", a, b, c]
      // or ["f", ["f", a]] -> ["f", a]
      tail.push(...flattenOps(arg.ops, head));
    }
  }

  return expr.engine.fn(head, tail);
}

export function flattenOps(
  ops: BoxedExpression[],
  head: string
): BoxedExpression[] {
  if (!head) return ops;
  // Bypass memory allocation for the common case where there is nothing to flatten
  if (ops.every((x) => !x.ops || x.head !== head)) return ops;

  const result: BoxedExpression[] = [];
  for (const arg of ops) {
    if (!arg.ops || arg.head !== head) result.push(arg);
    else {
      // ["f", a, ["f", b, c]] -> ["f", a, b, c]
      // or ["f", ["f", a]] -> ["f", a]
      result.push(...flattenOps(arg.ops, head));
    }
  }

  // If number of arguments didn't change, we didn't flatten
  console.assert(result.length !== ops.length); // @todo check below may not be necessary
  if (result.length === ops.length) return ops;

  return result;
}

export function flattenSequence(xs: BoxedExpression[]): BoxedExpression[] {
  // Bypass memory allocation for the common case where there are no sequences
  if (xs.every((x) => x.head !== 'Sequence')) return xs;

  const ys: BoxedExpression[] = [];
  for (const x of xs) {
    if (x.isValid && x.head === 'Sequence') {
      if (x.ops) ys.push(...x.ops);
    } else ys.push(x);
  }
  return ys;
}

export function canonical(xs: BoxedExpression[]): BoxedExpression[] {
  // Avoid memory allocation if possible
  return xs.every((x) => x.isCanonical) ? xs : xs.map((x) => x.canonical);
}
