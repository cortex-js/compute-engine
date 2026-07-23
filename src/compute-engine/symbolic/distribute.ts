import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';

function distribute2(
  lhs: Expression,
  rhs: Expression,
  g: string,
  f: string
): Expression {
  const ce = lhs.engine;

  // Distributing over `g` (`Add`) must recombine the branches with `g`, not
  // with `f`: `(a + b)·c` is `a·c + b·c`. Recombining with `f` built
  // `(a·c)·(b·c)` — turning every sum into a product, so `Distribute` was
  // value-destroying on every input it acted on.
  if (isFunction(lhs, g))
    return ce.expr([g, ...lhs.ops.map((x) => distribute2(x, rhs, g, f))]);
  if (isFunction(rhs, g))
    return ce.expr([g, ...rhs.ops.map((x) => distribute2(lhs, x, g, f))]);

  return ce.expr([f, lhs, rhs]);
}

/**
 *
 */

export function distribute(
  expr: Expression,
  g = 'Add',
  f = 'Multiply'
): Expression {
  if (expr.operator !== f || !isFunction(expr)) return expr;
  const ops = expr.ops;
  if (ops.length < 2) return expr;

  // The fold already yields the fully distributed expression; it does not need
  // to be wrapped in a single-operand `g`.
  return ops.slice(1).reduce((acc, v) => distribute2(acc, v, g, f), ops[0]);
}
