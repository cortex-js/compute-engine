import { BoxedExpression } from '../public';
import { canonicalNegate } from './negate';

/**
 * Distribute lhs over rhs
 */
export function distribute1(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  g = 'Add'
): BoxedExpression {
  const ce = lhs.engine;
  if (g === 'Add') {
    if (lhs.head === 'Negate' && rhs.head === 'Negate')
      return distribute1(lhs.op1, rhs.op1);

    if (lhs.head === 'Negate')
      return canonicalNegate(distribute1(lhs.op1, rhs)).simplify();
    if (rhs.head === 'Negate')
      return canonicalNegate(distribute1(lhs, rhs.op1)).simplify();
  }

  if (lhs.head === g)
    return ce
      .fn(
        g,
        lhs.ops!.map((x) => distribute1(x, rhs))
      )
      .simplify();
  if (rhs.head === g)
    return ce
      .fn(
        g,
        rhs.ops!.map((x) => distribute1(lhs, x))
      )
      .simplify();

  return ce.mul([lhs, rhs]);
}

function distribute2(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  g: string,
  f: string
): BoxedExpression {
  const ce = lhs.engine;

  if (lhs.head === g)
    return ce.fn(
      f,
      lhs.ops!.map((x) => distribute2(x, rhs, g, f))
    );
  if (rhs.head === g)
    return ce.fn(
      f,
      rhs.ops!.map((x) => distribute2(lhs, x, g, f))
    );

  return ce.fn(f, [lhs, rhs]);
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

  return expr.engine.box([
    g,
    expr.ops!.reduce((acc, v) => distribute2(acc, v, g, f), expr.engine._ONE),
  ]).canonical;
}
