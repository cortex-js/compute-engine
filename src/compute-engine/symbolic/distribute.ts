import { BoxedExpression } from '../public';

function distribute2(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  g: string,
  f: string
): BoxedExpression {
  const ce = lhs.engine;

  if (lhs.head === g)
    return ce.box([f, ...lhs.ops!.map((x) => distribute2(x, rhs, g, f))]);
  if (rhs.head === g)
    return ce.box([f, ...rhs.ops!.map((x) => distribute2(lhs, x, g, f))]);

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
  if (expr.head !== f) return expr;
  const ops = expr.ops;
  if (!ops || ops.length < 2) return expr;

  return expr.engine.box([
    g,
    ops.slice(1).reduce((acc, v) => distribute2(acc, v, g, f), ops[0]),
  ]);
}
