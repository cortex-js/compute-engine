import { Complex } from 'complex.js';
import Decimal from 'decimal.js';

import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { flattenOps } from './flatten';

function negateLiteral(
  expr: BoxedExpression,
  metadata?: Metadata
): BoxedExpression | null {
  // Applying negation is safe (doesn't introduce numeric errors)
  // even on floating point numbers
  if (!expr.isLiteral) return null;

  let n: number | Decimal | Complex | [number, number] | undefined;
  if (expr.machineValue !== null) n = -expr.machineValue;
  if (expr.bignumValue) n = expr.bignumValue.neg();
  if (expr.complexValue) n = expr.complexValue.neg();
  const [numer, denom] = expr.rationalValue;
  if (numer !== null && denom !== null) n = [-numer, denom];

  if (n !== undefined) return expr.engine.number(n, metadata);

  return null;
}

/**
 * Distribute `Negate` (multiply by -1) if expr is a number literal, an
 * addition or another `Negate`.
 *
 * This is appropriate to call during a `canonical` chain.
 *
 * For more thorough distribution (including multiplication), see `distributeNegate`,
 * applicable  during a `simplify` or `evaluate` chain.
 */
export function canonicalNegate(
  expr: BoxedExpression,
  metadata?: Metadata
): BoxedExpression {
  // Negate(Negate(x)) -> x
  if (expr.head === 'Negate') return expr.op1;
  if (expr.isLiteral) return negateLiteral(expr, metadata)!;

  // Distribute over addition
  // Negate(Add(a, b)) -> Add(Negate(a), Negate(b))
  if (expr.head === 'Add') {
    let ops = expr.ops!.map((x) => canonicalNegate(x));
    ops = flattenOps(ops, 'Add') ?? ops;
    return expr.engine.add(ops, metadata);
  }

  // 'Subtract' is canonicalized into `Add`, so don't have to worry about it
  console.assert(expr.head !== 'Subtract');

  return expr.engine._fn('Negate', [expr], metadata);
}

/**
 * Return the additive opposite of the expression.
 *
 * Applies to `Add`, `Multiply`, `Negate` and number literals.
 *
 * If none can be produced (the expression is a symbol for example),
 * return `null`.
 *
 * Call during a `simplify` or `evaluate` chain. Use `caonnicalNegate`  during a
 * `canonical` chain.
 */
function distributeNegate(expr: BoxedExpression): BoxedExpression {
  if (expr.head === 'Negate') return expr.op1;
  if (expr.isLiteral) return negateLiteral(expr)!;

  const ce = expr.engine;

  // Distribute over addition
  // Negate(Add(a, b)) -> Add(Negate(a), Negate(b))
  if (expr.head === 'Add') {
    let ops = expr.ops!.map((x) => distributeNegate(x));
    ops = flattenOps(ops, 'Add') ?? ops;
    return ce.add(ops);
  }

  // Distribute over multiplication
  // Negate(Multiply(a, b)) -> Multiply(Negate(a), b)
  if (expr.head === 'Multiply') {
    return negateProduct(ce, expr.ops!);
  }

  // Distribute over division
  // Negate(Divide(a, b)) -> Divide(Negate(a), b)
  if (expr.head === 'Divide')
    return ce.divide(distributeNegate(expr.op1), expr.op2);

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
  if (done) return ce.mul(result);

  // else If there is a literal integer, negate it
  result = [];
  for (const arg of args) {
    if (done || !arg.isLiteral || !arg.isInteger) result.push(arg);
    else {
      done = true;
      result.push(distributeNegate(arg));
    }
  }

  if (done) return ce.mul(result);

  // else If there is a literal number, negate it
  result = [];
  for (const arg of args) {
    if (done || !arg.isLiteral || !arg.isNumber) result.push(arg);
    else {
      done = true;
      result.push(distributeNegate(arg));
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
  return distributeNegate(x);
}
