import type { Expression } from '../types-expression.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import {
  CancellationError,
  checkDeadline,
} from '../../common/interruptible.js';

/**
 * A private, per-application execution plan for a list-producing recursion.
 * Its step returns either Tuple(0, baseList) or Tuple(1, prefix, nextArgs).
 * The source literal is never changed or stored in this representation.
 */
export interface ListRecursionPlan {
  step: Expression;
}

/**
 * Recognize a Which whose arms either return a list or prepend a list to a
 * direct call of this literal. The original guards and next-argument
 * expressions are retained: no range, machine-number conversion, or inferred
 * termination condition is introduced. Different steps, base lists, guards,
 * and multiple numeric parameters all use the same execution loop.
 *
 * Run this at application time. A referenced function may have changed since
 * assignment, so both its effects and the recursive binding must be checked
 * again. Only pure pieces can be lowered: evaluating intermediate results in
 * separate frames must not change an observable effect or a dependency.
 */
export function listRecursionPlan(
  literal: Expression
): ListRecursionPlan | undefined {
  if (!isFunction(literal, 'Function') || literal.nops < 2) return undefined;
  if (!literal.ops.slice(1).every((p) => isSymbol(p))) return undefined;
  const block = literal.op1;
  if (!isFunction(block, 'Block') || block.nops !== 1) return undefined;
  let body = block.op1;
  if (isFunction(body, 'Typed')) body = body.op1;
  if (!isFunction(body, 'Which') || body.nops % 2 !== 0) return undefined;

  const ce = literal.engine;
  // Only the direct call in a Join arm is lowered. A nested self-call in a
  // guard, an element, or a next argument needs its own continuation.
  const containsSelf = (expr: Expression): boolean => {
    if (
      (isFunction(expr) || isSymbol(expr)) &&
      expr.valueDefinition?.value === literal
    )
      return true;
    return isFunction(expr) && expr.ops.some(containsSelf);
  };
  const eligible = (expr: Expression): boolean =>
    !containsSelf(expr) && expr.isPure;
  const clauses: Expression[] = [];
  let recursive = false;
  for (let i = 0; i < body.nops; i += 2) {
    const guard = body.ops[i];
    const arm = body.ops[i + 1];
    if (!eligible(guard)) return undefined;
    clauses.push(guard);
    if (isFunction(arm, 'List')) {
      if (!eligible(arm)) return undefined;
      clauses.push(ce._fn('Tuple', [ce.Zero, arm]));
      continue;
    }
    if (!isFunction(arm, 'Join') || arm.nops !== 2) return undefined;
    const [prefix, call] = arm.ops;
    if (!isFunction(prefix, 'List') || !eligible(prefix)) return undefined;
    if (
      !isFunction(call) ||
      call.valueDefinition?.value !== literal ||
      call.nops !== literal.nops - 1 ||
      !call.ops.every(eligible)
    )
      return undefined;
    recursive = true;
    clauses.push(ce._fn('Tuple', [ce.One, prefix, ce._fn('Tuple', call.ops)]));
  }
  return recursive ? { step: ce._fn('Which', clauses) } : undefined;
}

/**
 * Execute each step through the normal call-frame machinery, then discard
 * that frame before the next step. Prefix elements are collected once, so
 * neither JavaScript stack depth nor repeated copying grows with the list.
 * Iteration and deadline limits still bound a definition with no base case.
 */
export function evaluateListRecursion(
  plan: ListRecursionPlan,
  args: ReadonlyArray<Expression>,
  invokeStep: (
    args: ReadonlyArray<Expression>,
    step?: Expression
  ) => Expression | undefined
): Expression | undefined {
  const ce = plan.step.engine;
  const chunks: Expression[] = [];
  const finish = (tail: Expression): Expression => {
    if (chunks.length === 0) return tail;
    // An invalid result freezes the original binary Join boundaries. Keep
    // those boundaries so diagnostics have the same enclosing expression.
    if (!tail.isValid) {
      for (let i = chunks.length - 1; i >= 0; i--)
        tail = ce.function('Join', [chunks[i], tail]).evaluate();
      return tail;
    }
    // Join folds literal lists once when they fit maxCollectionSize, and
    // otherwise keeps a flat lazy view. Do not bypass that materialization
    // cap with an unbounded array of elements.
    return ce.function('Join', [...chunks, tail]).evaluate();
  };
  let current = args;
  let iterations = 0;
  for (;;) {
    checkDeadline(ce._deadlineFrame);
    if (++iterations > ce.iterationLimit)
      throw new CancellationError({
        cause: 'iteration-limit-exceeded',
        message: 'Iteration limit exceeded while evaluating list recursion',
      });
    const result = invokeStep(current, plan.step);
    if (
      !isFunction(result, 'Tuple') ||
      !isNumber(result.op1) ||
      (result.op1.re !== 0 && result.op1.re !== 1)
    ) {
      // An undecided or elementwise guard needs the ordinary Which result.
      // All lowered pieces are pure, so retrying this step repeats no effects.
      const tail = invokeStep(current);
      if (tail === undefined) return undefined;
      return finish(tail);
    }
    const chunk = result.op2;
    if (!isFunction(chunk, 'List')) return undefined;
    if (!chunk.isValid) {
      const tail = invokeStep(current);
      return tail === undefined ? undefined : finish(tail);
    }
    if (result.op1.re === 0) return finish(chunk);
    chunks.push(chunk);
    const next = result.ops[2];
    if (!isFunction(next, 'Tuple')) return undefined;
    // The existing symbolic-recursion policy must continue to own calls
    // whose arguments are not numeric literals, including partial results.
    if (!next.ops.every(isNumber)) {
      const tail = invokeStep(next.ops);
      if (tail === undefined) return undefined;
      return finish(tail);
    }
    current = next.ops;
  }
}
