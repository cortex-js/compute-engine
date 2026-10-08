import type { Expression, EvaluateOptions } from '../global-types.js';
import { isFunction } from './type-guards.js';
import { isOperatorDef } from './definition-guards.js';

/**
 * Await the ASYNCHRONOUS-ONLY descendants of a lazy operator's held operands
 * before its synchronous handler runs — for an operator that demands every
 * held operand (the caller, in `boxed-function.ts`, keeps a selecting,
 * scoping or quoting operator away from this pass).
 *
 * A lazy operator's handler receives its operands unevaluated and evaluates
 * them itself, synchronously: a comparison compares `op.evaluate()`.
 * `evaluate()` cannot run an operator that has only an `evaluateAsync`
 * handler — a user-declared asynchronous operator — so such a descendant
 * stayed unevaluated inside the held operand, and
 * `Less(15, AsyncOnly(2)).evaluateAsync()` answered `15 < AsyncOnly(2)`. The
 * asynchronous route calls this first: every asynchronous-only application
 * inside a held operand is awaited, in operand order, and the operand is
 * rebuilt with the values in place, so the handler finds them already
 * evaluated. A node with no such descendant is returned as it is (the same
 * object) and its operand list is not copied, so a walk that changes nothing
 * costs the visit and no allocation.
 *
 * A node whose operator SELECTS among its held operands (`If`, `Which`, a
 * short-circuit connective) is not entered — its unselected arm must not
 * run — but it is awaited WHOLE through its own asynchronous handler, which
 * honors the selection, so an asynchronous-only application in the arm it
 * does take is still awaited; a selecting operator without an asynchronous
 * handler is left as it is. Two kinds of node are not entered at all: a
 * SCOPED operator (`Sum`, a comprehension, a function literal, a block),
 * which owns the evaluation of its body, where a bound index may still be
 * free; and an operator that QUOTES its operand, which holds it as data. An
 * asynchronous-only application under either stays for that operator to
 * handle. One exception: a `ReleaseHold` whose operand is a `Hold` evaluates
 * the held expression, so when that expression holds an asynchronous-only
 * application, the `ReleaseHold` is awaited whole.
 */
export async function awaitAsyncOnlyDescendants(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): Promise<ReadonlyArray<Expression>> {
  const result = await awaitAsyncOnlyInEach(ops, options);
  return result ?? ops;
}

/** The operands with their asynchronous-only descendants awaited, or
 * `undefined` when none changed (no copy is made then). */
async function awaitAsyncOnlyInEach(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression[] | undefined> {
  let result: Expression[] | undefined;
  for (let i = 0; i < ops.length; i++) {
    const awaited = await awaitAsyncOnlyIn(ops[i], options);
    if (awaited !== ops[i] && result === undefined) result = ops.slice(0, i);
    if (result !== undefined) result.push(awaited);
  }
  return result;
}

async function awaitAsyncOnlyIn(
  x: Expression,
  options: Partial<EvaluateOptions> | undefined
): Promise<Expression> {
  if (!isFunction(x)) return x;
  const def = x.operatorDefinition;
  if (def !== undefined) {
    if (def.evaluateAsync !== undefined && def.evaluate === undefined)
      return x.evaluateAsync(options);
    if (def.selectsOperands)
      return def.evaluateAsync !== undefined ? x.evaluateAsync(options) : x;
    if (def.scoped || def.holdClass === 'quote') return x;
  }
  // `ReleaseHold(Hold(y))` evaluates `y`, which the walk does not enter
  // (`Hold` quotes it). When `y` holds an asynchronous-only application,
  // the `ReleaseHold` is awaited whole through its asynchronous handler.
  if (
    x.operator === 'ReleaseHold' &&
    isFunction(x.op1, 'Hold') &&
    containsAsyncOnly(x.op1.op1, true)
  )
    return x.evaluateAsync(options);
  const ops = await awaitAsyncOnlyInEach(x.ops, options);
  if (ops === undefined) return x;
  // A value-safe rebuild: the values stand where the applications stood, as
  // they would after the handler evaluated the operand itself.
  return x.engine.function(x.operator, ops);
}

/**
 * Whether `x` contains an application of an ASYNCHRONOUS-ONLY operator (one
 * with an `evaluateAsync` handler and no `evaluate` handler), at any depth
 * except under an operator that QUOTES its operand, which holds it as data.
 * One quoted operand is looked into: the operand of a `Hold` that is the
 * operand of a `ReleaseHold`, because the `ReleaseHold` evaluates it.
 * An engine that has never declared such an operator answers `false` at
 * once. The scoped operators that own the evaluation of their body (`Sum`,
 * `Product`, `Block`) ask this before taking their asynchronous per-term
 * route, so the synchronous fold stays the common path.
 */
export function hasAsyncOnlyApplication(x: Expression): boolean {
  if (!x.engine._hasAsyncOnlyOperator) return false;
  return containsAsyncOnly(x);
}

/**
 * `held` is `true` inside the operand of a released `Hold`. That operand is
 * not bound, so its applications carry no operator definition: the
 * definition is then looked up by name in the current scope.
 */
function containsAsyncOnly(x: Expression, held = false): boolean {
  if (!isFunction(x)) return false;
  let def = x.operatorDefinition;
  if (def === undefined && held) {
    const binding = x.engine.lookupDefinition(x.operator);
    if (isOperatorDef(binding)) def = binding.operator;
  }
  if (def !== undefined) {
    if (def.evaluateAsync !== undefined && def.evaluate === undefined)
      return true;
    if (def.holdClass === 'quote') return false;
  }
  // `ReleaseHold(Hold(y))` evaluates `y`, so an asynchronous-only
  // application in `y` must be found. Else a `Sum` with the term
  // `ReleaseHold(Hold(f(k)))` takes its synchronous fold, which cannot run
  // `f`, and keeps `f(1) + f(2) + …` unevaluated.
  if (x.operator === 'ReleaseHold' && isFunction(x.op1, 'Hold'))
    return containsAsyncOnly(x.op1.op1, true);
  return x.ops.some((op) => containsAsyncOnly(op, held));
}
