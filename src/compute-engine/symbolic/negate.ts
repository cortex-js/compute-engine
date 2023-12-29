import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { neg } from '../numerics/rationals';

import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { flattenOps, flattenSequence } from './flatten';
import { canonicalAdd } from '../library/arithmetic-add';

function negateLiteral(expr: BoxedExpression): BoxedExpression | null {
  // Applying negation is safe (doesn't introduce numeric errors)
  // even on floating point numbers
  let n = expr.numericValue;
  if (n === null) return null;

  if (typeof n === 'number') n = -n;
  else if (n instanceof Decimal) n = n.neg();
  else if (n instanceof Complex) n = n.neg();
  else if (Array.isArray(n)) n = neg(n);

  return expr.engine.number(n);
}

/**
 * Distribute `Negate` (multiply by -1) if expr is a number literal, an
 * addition or multiplication or another `Negate`.
 *
 * It is important to do all these to handle cases like
 * `-3x` -> ["Negate, ["Multiply", 3, "x"]] -> ["Multiply, -3, x]
 */
export function evalNegate(expr: BoxedExpression): BoxedExpression {
  // Negate(Negate(x)) -> x
  let sign = -1;
  while (expr.head === 'Negate') {
    expr = expr.op1;
    sign = -sign;
  }
  if (sign === 1) return expr;

  if (expr.numericValue !== null) return negateLiteral(expr)!;

  const ce = expr.engine;

  // Negate(Subtract(a, b)) -> Subtract(b, a)
  if (expr.head === 'Subtract') return ce.add(expr.op2, evalNegate(expr.op1));

  // Distribute over addition
  // Negate(Add(a, b)) -> Add(Negate(a), Negate(b))
  if (expr.head === 'Add') {
    let ops = expr.ops!.map((x) => evalNegate(x));
    return ce.add(...ops);
  }

  // Distribute over multiplication
  // Negate(Multiply(a, b)) -> Multiply(Negate(a), b)
  if (expr.head === 'Multiply') return negateProduct(ce, expr.ops!);

  // Distribute over division
  // Negate(Divide(a, b)) -> Divide(Negate(a), b)
  if (expr.head === 'Divide') return ce.div(evalNegate(expr.op1), expr.op2);

  return ce._fn('Negate', [expr]);
}

export function canonicalNegate(expr: BoxedExpression): BoxedExpression {
  // Negate(Negate(x)) -> x
  let sign = -1;
  while (expr.head === 'Negate') {
    expr = expr.op1;
    sign = -sign;
  }
  if (sign === 1) return expr;

  const ce = expr.engine;

  if (expr.head === 'Add') {
    let ops = expr.ops!.map((x) => canonicalNegate(x));
    return canonicalAdd(ce, flattenOps(flattenSequence(ops), 'Add'));
  }

  if (expr.numericValue !== null) return negateLiteral(expr)!;

  return ce._fn('Negate', [expr]);
}

// Given a list of terms in a product, find the "best" one to negate in
// order to negate the entire product:
// 1/ constants over symbols and expressions
// 2/ negative constants over positive ones
// 3/ `Negate` expressions
function negateProduct(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression {
  let result: BoxedExpression[] = [];
  let done = false;
  // If there is `Negate` as one of the args, remove it
  for (const arg of args) {
    if (!done && arg.head === 'Negate') {
      done = true;
      result.push(arg.op1);
    } else result.push(arg);
  }
  if (done) return ce.mul(...result);

  // else If there is a literal integer, negate it
  result = [];
  for (const arg of args) {
    if (done || arg.numericValue === null || !arg.isInteger) result.push(arg);
    else {
      done = true;
      result.push(canonicalNegate(arg));
    }
  }

  if (done) return ce.mul(...result);

  // else If there is a literal number, negate it
  result = [];
  for (const arg of args) {
    if (done || arg.numericValue === null || !arg.isNumber) result.push(arg);
    else {
      done = true;
      result.push(canonicalNegate(arg));
    }
  }
  if (done) return ce.mul(...result);

  return ce._fn('Negate', [ce._fn('Multiply', args)]);
}

export function processNegate(
  _ce: IComputeEngine,
  x: BoxedExpression,
  _mode: 'simplify' | 'evaluate' | 'N' = 'simplify'
): BoxedExpression {
  return canonicalNegate(x);
}
