import type { Expression } from '../global-types';
import { isFunction } from '../boxed-expression/type-guards';

function distribute2(
  lhs: Expression,
  rhs: Expression,
  g: string,
  f: string
): Expression {
  const ce = lhs.engine;

  if (lhs.operator === g && isFunction(lhs))
    return ce.box([f, ...lhs.ops.map((x) => distribute2(x, rhs, g, f))]);
  if (rhs.operator === g && isFunction(rhs))
    return ce.box([f, ...rhs.ops.map((x) => distribute2(lhs, x, g, f))]);

  return ce.box([f, lhs, rhs]);
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

  return expr.engine.box([
    g,
    ops.slice(1).reduce((acc, v) => distribute2(acc, v, g, f), ops[0]),
  ]);
}
