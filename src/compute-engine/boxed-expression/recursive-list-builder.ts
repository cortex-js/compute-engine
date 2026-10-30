import type { Expression } from '../types-expression.js';
import type { Type } from '../../common/type/types.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { errorValue } from './error-value.js';
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
  /** The head of the recursive arms: `Join`, or `ListJoin` for an arm
   * written as a list literal with a spread. The result is rebuilt with this
   * head, so that it has the same head as the result of the ordinary
   * evaluation of the definition. */
  head: 'Join' | 'ListJoin';
  /** The name the recursive calls are written with (`F` in `F(n + 1)`). An
   * error among the next arguments gets the frame of that call, as it does
   * when the call is evaluated as an ordinary application. */
  callee: string;
  /** The literal the plan was made from. A call boxed with the name
   * `callee` is a recursive call when it reaches this literal. */
  literal: Expression;
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
  // True when `expr` names or calls this literal. A function assigned to a
  // symbol with a value definition (the symbol is declared first) is the
  // value of that definition. A function assigned to a symbol with no
  // declaration gets an OPERATOR definition, which keeps the literal it
  // applies (`_lambdaLiteral`). Both are read at application time, so a
  // later assignment of another function to the symbol is seen.
  const isSelf = (expr: Expression): boolean =>
    (isFunction(expr) || isSymbol(expr)) &&
    (expr.valueDefinition?.value === literal ||
      expr.operatorDefinition?._lambdaLiteral === literal);
  // Only the direct call in a Join arm is lowered. A nested self-call in a
  // guard, an element, or a next argument needs its own continuation.
  const containsSelf = (expr: Expression): boolean => {
    if (isSelf(expr)) return true;
    return isFunction(expr) && expr.ops.some(containsSelf);
  };
  const eligible = (expr: Expression): boolean =>
    !containsSelf(expr) && expr.isPure;
  const clauses: Expression[] = [];
  let head: 'Join' | 'ListJoin' | undefined;
  let callee: string | undefined;
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
    // `[...prefix, ...F(n + 1)]` is canonically `ListJoin(prefix, F(n + 1))`;
    // an arm written with `Join` has the same shape. Both are lists here: the
    // prefix is a `List` literal and the call returns one of the base lists.
    if (
      !(isFunction(arm, 'Join') || isFunction(arm, 'ListJoin')) ||
      arm.nops !== 2
    )
      return undefined;
    // The recursive arms must all have the same head: the result is rebuilt
    // with one head (`finish` in `evaluateListRecursion`). A definition that
    // mixes `Join` and `ListJoin` arms is left to the ordinary evaluation.
    if (head !== undefined && head !== arm.operator) return undefined;
    head = isFunction(arm, 'Join') ? 'Join' : 'ListJoin';
    const [prefix, call] = arm.ops;
    if (!isFunction(prefix, 'List') || !eligible(prefix)) return undefined;
    if (
      !isFunction(call) ||
      !isSelf(call) ||
      call.nops !== literal.nops - 1 ||
      !call.ops.every(eligible)
    )
      return undefined;
    // The recursive calls must all use one name, for the error frame of a
    // failed next argument. Calls through different names are left to the
    // ordinary evaluation.
    if (callee !== undefined && callee !== call.operator) return undefined;
    callee = call.operator;
    clauses.push(ce._fn('Tuple', [ce.One, prefix, ce._fn('Tuple', call.ops)]));
  }
  return head !== undefined && callee !== undefined
    ? { step: ce._fn('Which', clauses), head, callee, literal }
    : undefined;
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
    // The head is the head of the recursive arms (`plan.head`), so that the
    // result has the head the ordinary evaluation gives.
    if (!tail.isValid) {
      for (let i = chunks.length - 1; i >= 0; i--)
        tail = ce.function(plan.head, [chunks[i], tail]).evaluate();
      return tail;
    }
    // Join folds literal lists once when they fit maxCollectionSize, and
    // otherwise keeps a flat lazy view (a `ListJoin` does the same). Do not
    // bypass that materialization cap with an unbounded array of elements.
    return ce.function(plan.head, [...chunks, tail]).evaluate();
  };
  let current = args;
  let iterations = 0;
  // Whether the next arguments are checked against the declared parameter
  // types (see below). `undefined` until the first recursive step.
  let checkArguments: boolean | undefined;
  for (;;) {
    checkDeadline(ce._deadlineFrame);
    if (++iterations > ce.iterationLimit)
      throw new CancellationError({
        cause: 'iteration-limit-exceeded',
        message: `Iteration limit of ${ce.iterationLimit} exceeded while evaluating ${plan.callee}()`,
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
      // A next argument that is an error is the value of the call, with the
      // frame of that call, as in an ordinary application of a function with
      // a typed signature (the `scalarConformance` step of
      // `applyFunctionLiteralWith`, `boxed-function.ts`).
      const failed = next.ops.findIndex((x) => isFunction(x, 'Error'));
      if (failed >= 0) {
        const err = errorValue(next.ops[failed], {
          operator: plan.callee,
          index: failed + 1,
        });
        if (err !== undefined) return finish(err);
      }
      const tail = invokeStep(next.ops);
      if (tail === undefined) return undefined;
      return finish(tail);
    }
    // The next arguments are checked against the declared parameter types
    // as the ordinary recursive call checks them. The call is boxed with its
    // name, and the boxing replaces an argument that the declared type
    // refuses with an `incompatible-type` error: with `F` declared
    // `(integer) -> list`, a next argument `1/2` is refused, as the direct
    // call `F(1/2)` is. `NaN` at a numeric parameter is accepted (a user
    // function with one clause accepts `NaN` there, `docs/ERROR-MODEL.md`,
    // "A user function accepts `NaN` at a numeric parameter — RULED
    // 2026-09-30"). The arguments are numeric literals here, so the static
    // type the boxing checks is the type of the value. Without this check
    // the loop ran the step on an argument that the recursive call refuses.
    // The check is made only when the name still reaches this literal and
    // its definition declares a parameter type that can refuse a number. A
    // signature inferred from the literal, or a declaration with no
    // signature (`function`), checks nothing, so the boxing (about four
    // times the cost of a step) is skipped for the rest of the loop.
    if (checkArguments !== false) {
      const call = ce.function(plan.callee, next.ops);
      checkArguments ??= declaresParameterTypes(call, plan.literal);
      if (checkArguments && isFunction(call)) {
        const failed = call.ops.findIndex((x) => isFunction(x, 'Error'));
        if (failed >= 0) {
          const err = errorValue(call.ops[failed], {
            operator: plan.callee,
            index: failed + 1,
          });
          if (err !== undefined) return finish(err);
        }
      }
    }
    current = next.ops;
  }
}

/**
 * True when `call` is a call of `literal` (through a value definition or an
 * operator definition) whose definition has a DECLARED signature with a
 * parameter type other than `unknown` or `any`: the boxing of such a call
 * can refuse an argument.
 */
function declaresParameterTypes(
  call: Expression,
  literal: Expression
): boolean {
  if (!isFunction(call)) return false;
  let signature: Type | undefined;
  const vdef = call.valueDefinition;
  const odef = call.operatorDefinition;
  if (vdef?.value === literal) {
    if (vdef.inferredType) return false;
    signature = vdef.type.type;
  } else if (odef?._lambdaLiteral === literal) {
    if (odef.inferredSignature) return false;
    signature = odef.signature.type;
  } else return false;
  if (typeof signature !== 'object' || signature.kind !== 'signature')
    return false;
  return [
    ...(signature.args ?? []),
    ...(signature.optArgs ?? []),
    ...(signature.variadicArg ? [signature.variadicArg] : []),
  ].some((arg) => arg.type !== 'unknown' && arg.type !== 'any');
}
