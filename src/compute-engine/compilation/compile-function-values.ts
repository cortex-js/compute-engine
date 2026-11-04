// The forms of function values that compiled code does not compile.
//
// Compiled code calls a function only when the callee is a defined
// function, a declared function with a value, or a function literal at the
// call site; the callbacks of `Map`, `Filter`, `Sort`, `Fold` and `Reduce`
// compile when they are such a callee. A function value passed as an
// argument to a user function or to `Apply`, a function returned by a call,
// and a parameter declared with a function type decline. The interpreter
// keeps first-class functions (user decision 2026-11-02, options page 5,
// option B; the rule and its table are in `docs/COMPILATION-MODEL.md`,
// "Function values"). A partial application and a curried call decline in
// `partial-application.ts`, and a block-local function that is assigned
// more than one value declines in `compile-user-functions.ts`.

import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import type { Type } from '../../common/type/types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterType,
  requiredParameterCount,
} from '../boxed-expression/function-literal.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import {
  blockLocalFunction,
  userFunctionLiteral,
} from './compile-assignment-checks.js';

/** True when `t` is a function type: `function` or a signature. */
function isFunctionValueType(t: Type | undefined): boolean {
  if (t === undefined) return false;
  const r = resolveTypeAlias(t);
  return r === 'function' || (typeof r === 'object' && r.kind === 'signature');
}

/** True when the value of `op` is a function: its static type is a function
 * type, or it names a block-local function (whose type is inferred from its
 * uses). */
function isFunctionValue(
  op: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (isSymbol(op) && blockLocalFunction(op.symbol, target) !== undefined)
    return true;
  return isFunctionValueType(op.type.type);
}

/** True when `expr` is a call of a user function: a function defined in the
 * engine (`userFunctionLiteral()`) or a block-local function. */
function isUserFunctionCall(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isFunction(expr)) return false;
  const h = expr.operator;
  return (
    blockLocalFunction(h, target) !== undefined ||
    userFunctionLiteral(expr.engine, h) !== undefined
  );
}

/** True when `expr` is a call of a user function with fewer arguments than
 * the required parameters of its literal: the parameters before the first
 * parameter with a default or the rest parameter, or all of them
 * (`requiredParameterCount()`). A call that leaves out only defaulted
 * arguments is a full call. */
function fewerArgumentsThanParameters(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isFunction(expr)) return false;
  const h = expr.operator;
  // `null`: a local of the block hides the name (a rebound or lexical
  // local), so a global function of the same name is not the callee.
  const local = blockLocalFunction(h, target);
  if (local === null) return false;
  const literal = local ?? userFunctionLiteral(expr.engine, h);
  if (literal === undefined) return false;
  return expr.nops < requiredParameterCount(literal.ops.slice(1));
}

/**
 * Throw a decline when the node `expr` is a form of function value that
 * compiled code does not compile:
 *
 * - a function literal with a parameter declared with a function type
 *   (`(g: function) ↦ g(1)`);
 * - a call of a user function, or an `Apply`, with an argument whose value
 *   is a function (`h(x ↦ x)`): the function would reach the body through
 *   a parameter;
 * - a call of a user function, or an `Apply` that is not a partial
 *   application, whose value is a function (`mk(1)` with
 *   `mk = a ↦ (x ↦ x + a)`);
 * - an operand that names a block-local function assigned more than once
 *   (`CompileTarget.reboundFunctions`), such as the callback of
 *   `Map(k, L)`: its value is a function value stored in a local, known
 *   only at run time. The target of an `Assign` or a `Declare` is not such
 *   an operand. A call of such a function declines in
 *   `tryCompileLocalFunctionCall()`.
 *
 * The callee of an `Apply` is not an argument: a function literal, a
 * derivative or the name of a defined function is called there.
 */
export function assertNoFunctionValue(
  expr: Expression,
  target: CompileTarget<Expression>
): void {
  if (!isFunction(expr)) return;
  if (target.reboundFunctions !== undefined) {
    // The target of an `Assign` or a `Declare` is not checked; its value is.
    const operands =
      expr.operator === 'Assign' || expr.operator === 'Declare'
        ? expr.ops.slice(1)
        : expr.ops;
    const stored = operands.find(
      (op) => isSymbol(op) && target.reboundFunctions!.has(op.symbol)
    );
    if (stored !== undefined)
      throw new Error(
        `Could not compile \`${expr.toString()}\`: the block-local function ` +
          `\`${stored.toString()}\` is assigned more than once or inside a ` +
          `nested statement, so its value is a function value known only at ` +
          `run time, which compiled code does not pass. Declare the function ` +
          `once with its value, or evaluate instead.`
      );
  }
  if (expr.operator === 'Function') {
    const param = expr.ops
      .slice(1)
      .find((p) => isFunctionValueType(functionLiteralParameterType(p)));
    if (param !== undefined)
      throw new Error(
        `Could not compile the function literal \`${expr.toString()}\`: the ` +
          `parameter \`${param.toString()}\` is declared with a function ` +
          `type, and compiled code does not pass a function value through a ` +
          `parameter. Call the function directly in the body, or evaluate ` +
          `instead.`
      );
    return;
  }
  const isApply = expr.operator === 'Apply';
  if (!isApply && !isUserFunctionCall(expr, target)) return;
  const args = isApply ? expr.ops.slice(1) : expr.ops;
  const fn = args.find((a) => isFunctionValue(a, target));
  if (fn !== undefined)
    throw new Error(
      `Could not compile \`${expr.toString()}\`: the argument ` +
        `\`${fn.toString()}\` is a function, and compiled code does not pass ` +
        `a function value through a parameter. Call the function directly, ` +
        `or evaluate instead.`
    );
  // An `Apply` whose callee is a function literal with too few arguments is
  // a partial application, which the `Apply` lowering declines with its own
  // reason (`partial-application.ts`).
  if (
    isApply &&
    isFunction(expr.ops[0], 'Function') &&
    expr.nops - 1 < requiredParameterCount(expr.ops[0].ops.slice(1))
  )
    return;
  // A call of a user function with fewer arguments than the required
  // parameters of its literal is also a partial application: the arity
  // check of the call declines it with a reason that names the argument
  // count (`checkUserCallArity()`, and the block-local branch of
  // `tryCompileLocalFunctionCall()`).
  if (!isApply && fewerArgumentsThanParameters(expr, target)) return;
  if (isFunctionValueType(expr.type.type))
    throw new Error(
      `Could not compile \`${expr.toString()}\`: its value is a function, ` +
        `and compiled code does not return a function from a call. Call the ` +
        `function with all its arguments, or evaluate instead.`
    );
}
