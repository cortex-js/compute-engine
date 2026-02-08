import type { BoxedExpression } from '../global-types';
import { isBoxedFunction } from '../boxed-expression/type-guards';

function distribute2(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  g: string,
  f: string
): BoxedExpression {
  const ce = lhs.engine;

  if (lhs.operator === g && isBoxedFunction(lhs))
    return ce.box([f, ...lhs.ops.map((x) => distribute2(x, rhs, g, f))]);
  if (rhs.operator === g && isBoxedFunction(rhs))
    return ce.box([f, ...rhs.ops.map((x) => distribute2(lhs, x, g, f))]);

  return ce.box([f, lhs, rhs]);
}

/**
 *
 */

export function distribute(
  expr: BoxedExpression,
  g = 'Add',
  f = 'Multiply'
): BoxedExpression {
  if (expr.operator !== f || !isBoxedFunction(expr)) return expr;
  const ops = expr.ops;
  if (ops.length < 2) return expr;

  return expr.engine.box([
    g,
    ops.slice(1).reduce((acc, v) => distribute2(acc, v, g, f), ops[0]),
  ]);
}
