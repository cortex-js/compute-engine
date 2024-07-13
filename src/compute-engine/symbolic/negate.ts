import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import { neg } from '../numerics/rationals';

import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { order } from '../boxed-expression/order';

/**
 * Distribute `Negate` (multiply by -1) if expr is a number literal, an
 * addition or multiplication or another `Negate`.
 *
 * It is important to do all these to handle cases like
 * `-3x` -> ["Negate, ["Multiply", 3, "x"]] -> ["Multiply, -3, x]
 */
export function negate(expr: BoxedExpression): BoxedExpression {
  // Negate(Negate(x)) -> x
  let sign = -1;
  while (expr.head === 'Negate') {
    expr = expr.op1;
    sign = -sign;
  }
  if (sign === 1) return expr;

  if (expr.numericValue !== null) return expr.neg();

  const ce = expr.engine;

  // Negate(Subtract(a, b)) -> Subtract(b, a)
  if (expr.head === 'Subtract') return ce.add(expr.op2, negate(expr.op1));

  // Distribute over addition
  // Negate(Add(a, b)) -> Add(Negate(a), Negate(b))
  if (expr.head === 'Add') {
    const ops = expr.ops!.map((x) => negate(x));
    return ce.add(...ops);
  }

  // Distribute over multiplication
  // Negate(Multiply(a, b)) -> Multiply(Negate(a), b)
  if (expr.head === 'Multiply') return negateProduct(ce, expr.ops!);

  // Distribute over division
  // Negate(Divide(a, b)) -> Divide(Negate(a), b)
  if (expr.head === 'Divide') return ce.div(negate(expr.op1), expr.op2);

  return ce._fn('Negate', [expr]);
}

// Given a list of terms in a product, find the "best" one to negate in
// order to negate the entire product:
// 1/ constants over symbols and expressions
// 2/ negative constants over positive ones
// 3/ `Negate` expressions
export function negateProduct(
  ce: IComputeEngine,
  args: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  let result: BoxedExpression[] = [];

  // Look for an argument that can be negated. We do multiple passes to
  // give priority as follow:
  // 1/ Negate
  // 2/ Literal integers
  // 3/ Literal numbers

  let done = false;
  // If there is `Negate` as one of the args, remove it
  for (const arg of args) {
    if (!done && arg.head === 'Negate') {
      done = true;
      if (!arg.op1.isOne) result.push(arg.op1);
    } else result.push(arg);
  }

  // else If there is a literal integer, negate it
  if (!done) {
    result = [];
    for (const arg of args) {
      if (done || (arg.numericValue === null && !arg.isInteger))
        result.push(arg);
      else {
        done = true;
        if (!arg.isNegativeOne) result.push(arg.neg());
      }
    }
  }
  if (done) return ce._fn('Multiply', result);

  // else If there is a literal number, negate it
  if (!done) {
    result = [];
    for (const arg of args) {
      if (done || arg.numericValue === null || !arg.isNumber) result.push(arg);
      else {
        done = true;
        if (!arg.isNegativeOne) result.push(arg.neg());
      }
    }
  }

  if (done) return ce._fn('Multiply', result);

  return ce._fn('Negate', [ce._fn('Multiply', [...args].sort(order))]);
}
