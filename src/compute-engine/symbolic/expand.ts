import { asSmallInteger } from '../numerics/numeric';
import { BoxedExpression } from '../public';
import { canonicalNegate } from './negate';

/**
 * Return the expansion of ['Multiply', lhs, rhs]
 * - lhs = 'a + b', rhs = '2'
 *      ->  '2a + 2b'
 * - lhs = 'a + b', rhs = 'a + c'
 *      -> 'a^2 + ac + ab + bc'
 */
export function expand2(
  lhs: BoxedExpression,
  rhs: BoxedExpression
): BoxedExpression {
  const ce = lhs.engine;
  if (lhs.head === 'Negate' && rhs.head === 'Negate')
    return expand2(lhs.op1, rhs.op1);

  if (lhs.head === 'Negate') return canonicalNegate(expand2(lhs.op1, rhs));
  if (rhs.head === 'Negate') return canonicalNegate(expand2(lhs, rhs.op1));

  if (lhs.head === 'Add') return ce.add(lhs.ops!.map((x) => expand2(x, rhs)));
  if (rhs.head === 'Add') return ce.add(rhs.ops!.map((x) => expand2(lhs, x)));

  return ce.mul([lhs, rhs]);
}

export function expandN(expr: BoxedExpression, n: number): BoxedExpression {
  // if (n === 1) return expr;
  // if (n === 2) return expand2(expr, expr);
  // let e = expr;
  // while (n > 1) {
  //   e = expand2(e, expr);
  //   n -= 1;
  // }
  // return e;

  if (n === 1) return expr;

  const x2 = expand2(expr, expr);

  if (n === 2) return x2;

  if (n % 2 === 0) return expandN(x2, n / 2);

  const x = expandN(x2, Math.round(n / 2) - 1);
  return expand2(x, expr);
}

export function expand(expr: BoxedExpression): BoxedExpression {
  expr = expr.simplify();

  if (expr.head === 'Multiply') {
    if (expr.nops === 2) return expand2(expr.op1, expr.op2);
    return expr.ops!.reduce((acc, v) => expand2(acc, v), expr.engine._ONE);
  }

  if (expr.head === 'Power') {
    const op1head = expr.op1.head;

    if (op1head === 'Multiply') {
      return expr.engine.mul(
        expr.op1.ops!.map((x) => expr.engine.power(x, expr.op2))
      );
    }

    if (op1head === 'Negate') {
      const n = asSmallInteger(expr.op2);
      if (n !== null && n > 0) {
        if (n % 2 === 0) return expr.engine.power(expr.op1.op1, expr.op2);
        return expr.engine.negate(expr.engine.power(expr.op1.op1, expr.op2));
      }
    }

    if (op1head === 'Add') {
      const n = asSmallInteger(expr.op2);
      if (n !== null) {
        if (n > 0) return expandN(expr.op1, n).simplify();
        return expr.engine.inverse(expandN(expr.op1, -n).simplify());
      }
    }
  }

  return expr;
}
