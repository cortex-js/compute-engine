import type {
  BoxedExpression,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isBoxedNumber, isBoxedFunction } from './type-guards';
import { addOrder, order } from './order';

export function canonicalNegate(expr: BoxedExpression): BoxedExpression {
  // Negate(Negate(x)) -> x
  let sign = -1;
  while (isBoxedFunction(expr) && expr.operator === 'Negate') {
    expr = expr.op1;
    sign = -sign;
  }
  if (sign === 1) return expr;

  if (isBoxedNumber(expr)) return expr.neg();

  return expr.engine._fn('Negate', [expr]);
}

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
  while (isBoxedFunction(expr) && expr.operator === 'Negate') {
    expr = expr.op1;
    sign = -sign;
  }
  if (sign === 1) return expr;

  if (isBoxedNumber(expr)) return expr.neg();

  const ce = expr.engine;

  if (isBoxedFunction(expr)) {
    // Negate(Subtract(a, b)) -> Subtract(b, a)
    if (expr.operator === 'Subtract') return expr.op2.sub(expr.op1);

    // Distribute over addition
    // Negate(Add(a, b)) -> Add(Negate(a), Negate(b))
    if (expr.operator === 'Add') {
      const negated = expr.ops.map((x) => negate(x));
      return ce._fn('Add', [...negated].sort(addOrder));
    }

    // Distribute over multiplication
    // Negate(Multiply(a, b)) -> Multiply(Negate(a), b)
    if (expr.operator === 'Multiply') return negateProduct(ce, expr.ops);

    // Distribute over division
    // Negate(Divide(a, b)) -> Divide(Negate(a), b)
    if (expr.operator === 'Divide') return negate(expr.op1).div(expr.op2);
  }

  return ce._fn('Negate', [expr]);
}

// Given a list of terms in a product, find the "best" one to negate in
// order to negate the entire product:
// 1/ constants over symbols and expressions
// 2/ negative constants over positive ones
// 3/ `Negate` expressions
export function negateProduct(
  ce: ComputeEngine,
  args: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  if (args.length === 0) return ce.NegativeOne;
  if (args.length === 1) return negate(args[0]);

  let result: BoxedExpression[] = [];

  // Look for an argument that can be negated. We do multiple passes to
  // give priority as follow:
  // 1/ Negate
  // 2/ Literal integers
  // 3/ Literal numbers

  let done = false;
  // If there is `Negate` as one of the args, remove it
  for (const arg of args) {
    if (!done && isBoxedFunction(arg) && arg.operator === 'Negate') {
      done = true;
      if (!arg.op1.is(1)) result.push(arg.op1);
    } else result.push(arg);
  }

  // else If there is a literal integer, negate it
  if (!done) {
    result = [];
    for (const arg of args) {
      if (done || (!isBoxedNumber(arg) && !arg.isInteger))
        result.push(arg);
      else {
        done = true;
        if (!arg.is(-1)) result.push(arg.neg());
      }
    }
  }
  if (done) return ce._fn('Multiply', result.sort(order));

  // else If there is a literal number, negate it
  if (!done) {
    result = [];
    for (const arg of args) {
      if (done || !isBoxedNumber(arg) || !arg.isNumber)
        result.push(arg);
      else {
        done = true;
        if (!arg.is(-1)) result.push(arg.neg());
      }
    }
  }

  if (done) return ce._fn('Multiply', result.sort(order));

  return ce._fn('Negate', [ce._fn('Multiply', [...args].sort(order))]);
}
