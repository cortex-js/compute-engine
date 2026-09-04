import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isNumber, isFunction } from './type-guards.js';
import { sortAddTerms, sortProductOperands } from './order.js';
import {
  couldBeNumericTuple,
  hasAccessibleComponents,
} from '../collection-utils.js';

/**
 * Negate a literal tuple (a point/vector in ℝⁿ, or a Desmos-style point-list
 * such as `([1,2], [3,4])` whose components are lists) component-wise.
 * Returns `undefined` when `expr` is not a tuple, or is a tuple whose
 * components are not directly accessible (a tuple-typed symbol), so the
 * caller keeps it symbolic.
 *
 * The gate is `couldBeNumericTuple` — every component type could be numeric,
 * numeric collections and nested tuples included, with transparent type
 * aliases unfolded — the same admission the `Divide` scaling arm and its
 * type handler use. The stricter `isNumericTuple` (every component a scalar
 * number) excluded a tuple of lists, so `(-1)·P` scaled such a point-list
 * component-wise while `-P` stayed an inert `Negate`, and the `Add` fold
 * could then not cancel `P - P`. The bare structural `isTuple` is too WIDE
 * here: this function calls the raw `.neg()` method on each component, and
 * on a provably non-numeric component (a string) that method answers `NaN`
 * with no diagnostic — a tuple that fails the could-be-numeric test must
 * stay symbolic instead.
 *
 * The recursion terminates: a component's own `.neg()` returns an inert
 * `Negate` when it cannot distribute (for example a `Range` with symbolic
 * bounds), instead of calling back into this function.
 *
 * A nested tuple component is negated through `negated`, a memo by node
 * identity for one top-level call, before falling back to its `.neg()`. A
 * boxed expression is a DAG — a tuple built from one sub-tuple referenced
 * twice holds the same object twice — and rebuilding each occurrence
 * separately produced one new node per PATH: `t = Tuple(t, t)` nested 26
 * times is 27 nodes, and negating it exhausted the heap building 2^26
 * tuples. With the memo the result shares its components as the input did.
 */
function negateTupleComponents(
  expr: Expression,
  negated: Map<Expression, Expression> = new Map()
): Expression | undefined {
  // The memo is read before the gates: an entry exists only for a node that
  // passed them, and the could-be-numeric gate walks the node's type, which
  // is not free for a component reached through many paths.
  const cached = negated.get(expr);
  if (cached !== undefined) return cached;
  if (
    !couldBeNumericTuple(expr) ||
    !hasAccessibleComponents(expr) ||
    !isFunction(expr)
  )
    return undefined;
  const result = expr.engine.tuple(
    ...expr.ops.map((op) => negateTupleComponents(op, negated) ?? op.neg())
  );
  negated.set(expr, result);
  return result;
}

export function canonicalNegate(expr: Expression): Expression {
  // Negate(Negate(x)) -> x
  let sign = -1;
  while (isFunction(expr, 'Negate')) {
    expr = expr.op1;
    sign = -sign;
  }
  if (sign === 1) return expr;

  if (isNumber(expr)) return expr.neg();

  // A tuple (point/vector) negates component-wise.
  const negatedTuple = negateTupleComponents(expr);
  if (negatedTuple !== undefined) return negatedTuple;

  return expr.engine._fn('Negate', [expr]);
}

/**
 * Distribute `Negate` (multiply by -1) if expr is a number literal, an
 * addition or multiplication or another `Negate`.
 *
 * It is important to do all these to handle cases like
 * `-3x` -> ["Negate, ["Multiply", 3, "x"]] -> ["Multiply, -3, x]
 */
export function negate(expr: Expression): Expression {
  // Negate(Negate(x)) -> x
  let sign = -1;
  while (isFunction(expr, 'Negate')) {
    expr = expr.op1;
    sign = -sign;
  }
  if (sign === 1) return expr;

  if (isNumber(expr)) return expr.neg();

  const ce = expr.engine;

  // A tuple (point/vector) negates component-wise.
  const negatedTuple = negateTupleComponents(expr);
  if (negatedTuple !== undefined) return negatedTuple;

  if (isFunction(expr)) {
    // Negate(Subtract(a, b)) -> Subtract(b, a)
    if (expr.operator === 'Subtract') return expr.op2.sub(expr.op1);

    // Distribute over addition
    // Negate(Add(a, b)) -> Add(Negate(a), Negate(b))
    if (expr.operator === 'Add') {
      const negated = expr.ops.map((x) => negate(x));
      return ce._fn('Add', sortAddTerms(negated));
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
  args: ReadonlyArray<Expression>
): Expression {
  if (args.length === 0) return ce.NegativeOne;
  if (args.length === 1) return negate(args[0]);

  let result: Expression[] = [];

  // Look for an argument that can be negated. We do multiple passes to
  // give priority as follow:
  // 1/ Negate
  // 2/ Literal integers
  // 3/ Literal numbers

  let done = false;
  // If there is `Negate` as one of the args, remove it
  for (const arg of args) {
    if (!done && isFunction(arg, 'Negate')) {
      done = true;
      if (!arg.op1.isSame(1)) result.push(arg.op1);
    } else result.push(arg);
  }

  // else If there is a literal integer, negate it
  if (!done) {
    result = [];
    for (const arg of args) {
      // Skip anything that isn't an integer literal, so a non-integer number
      // is left for the next pass. (The condition was `!isNumber && !isInteger`,
      // which matched non-integer numbers here and left pass 3 dead.)
      if (done || !(isNumber(arg) && arg.isInteger)) result.push(arg);
      else {
        done = true;
        if (!arg.isSame(-1)) result.push(arg.neg());
      }
    }
  }
  if (done) return ce._fn('Multiply', sortProductOperands(result));

  // else If there is a literal number, negate it
  if (!done) {
    result = [];
    for (const arg of args) {
      if (done || !isNumber(arg) || !arg.isNumber) result.push(arg);
      else {
        done = true;
        if (!arg.isSame(-1)) result.push(arg.neg());
      }
    }
  }

  if (done) return ce._fn('Multiply', sortProductOperands(result));

  return ce._fn('Negate', [ce._fn('Multiply', sortProductOperands([...args]))]);
}
