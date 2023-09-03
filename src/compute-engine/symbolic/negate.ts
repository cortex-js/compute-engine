import { Complex } from 'complex.js';
import Decimal from 'decimal.js';
import { neg } from '../numerics/rationals';

import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { flattenOps } from './flatten';

function negateLiteral(
  expr: BoxedExpression,
  metadata?: Metadata
): BoxedExpression | null {
  // Applying negation is safe (doesn't introduce numeric errors)
  // even on floating point numbers
  let n = expr.numericValue;
  if (n === null) return null;

  if (typeof n === 'number') n = -n;
  else if (n instanceof Decimal) n = n.neg();
  else if (n instanceof Complex) n = n.neg();
  else if (Array.isArray(n)) n = neg(n);

  return expr.engine.number(n, { metadata });
}

/**
 * Distribute `Negate` (multiply by -1) if expr is a number literal, an
 * addition or multiplication or another `Negate`.
 *
 * It is important to do all these to handle cases like
 * `-3x` -> ["Negate, ["Multiply", 3, "x"]] -> ["Multiply, -3, x]
 */
export function canonicalNegate(
  expr: BoxedExpression,
  metadata?: Metadata
): BoxedExpression {
  // Negate(Negate(x)) -> x
  if (expr.head === 'Negate') return expr.op1;

  if (expr.numericValue !== null) return negateLiteral(expr, metadata)!;

  // Distribute over addition
  // Negate(Add(a, b)) -> Add(Negate(a), Negate(b))
  if (expr.head === 'Add') {
    let ops = expr.ops!.map((x) => canonicalNegate(x));
    ops = flattenOps(ops, 'Add');
    return expr.engine.add(ops, metadata);
  }

  // Distribute over multiplication
  // Negate(Multiply(a, b)) -> Multiply(Negate(a), b)
  if (expr.head === 'Multiply') {
    return negateProduct(expr.engine, expr.ops!);
  }

  // Distribute over division
  // Negate(Divide(a, b)) -> Divide(Negate(a), b)
  if (expr.head === 'Divide')
    return expr.engine._fn('Divide', [canonicalNegate(expr.op1), expr.op2]);

  // 'Subtract' is canonicalized into `Add`, so don't have to worry about it
  console.assert(expr.head !== 'Subtract');

  return expr.engine._fn('Negate', [expr], metadata);
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
  if (done) return ce.mul(result);

  // else If there is a literal integer, negate it
  result = [];
  for (const arg of args) {
    if (done || arg.numericValue === null || !arg.isInteger) result.push(arg);
    else {
      done = true;
      result.push(canonicalNegate(arg));
    }
  }

  if (done) return ce.mul(result);

  // else If there is a literal number, negate it
  result = [];
  for (const arg of args) {
    if (done || arg.numericValue === null || !arg.isNumber) result.push(arg);
    else {
      done = true;
      result.push(canonicalNegate(arg));
    }
  }
  if (done) return ce.mul(result);

  return ce._fn('Negate', [ce._fn('Multiply', args)]);
}

export function processNegate(
  _ce: IComputeEngine,
  x: BoxedExpression,
  _mode: 'simplify' | 'evaluate' | 'N' = 'simplify'
): BoxedExpression {
  return canonicalNegate(x);
}
