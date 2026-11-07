import type { Expression, FunctionInterface } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import { requiredParameterCount } from '../boxed-expression/function-literal.js';
import { appliedLiteralTypedFromArguments } from './applied-literal-types.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';

/** Whether a call supplies fewer arguments than the literal requires. */
function isUnderApplied(literal: Expression, count: number): boolean {
  return (
    isFunction(literal, 'Function') &&
    count < requiredParameterCount(literal.ops.slice(1))
  );
}

/** Compiled calls need a visible callee and all its required arguments. */
const PARTIAL_APPLICATION_REFUSAL =
  'a partial application or a curried call (a call with fewer arguments ' +
  'than the function has parameters, or a call of its value) is not ' +
  'compiled. Call the function with all its arguments, or evaluate instead.';

/**
 * The original callee and supplied argument count of an incomplete call,
 * including a chain of incomplete calls. Recognition does not construct a
 * residual function: every target declines it.
 */
function curriedLiteral(
  expr: Expression
): { literal: Expression; count: number } | undefined {
  if (!isFunction(expr, 'Apply') || expr.nops === 0) return undefined;
  let literal = expr.op1;
  let count = expr.nops - 1;
  const inner = curriedLiteral(literal);
  if (inner !== undefined) {
    literal = inner.literal;
    count += inner.count;
  }
  if (!isUnderApplied(literal, count)) return undefined;
  return { literal, count };
}

/** Decline a call whose callee is a partial application. */
export function assertNoCurriedApplication(
  args: ReadonlyArray<Expression>
): void {
  const callee = args[0];
  if (callee !== undefined && curriedLiteral(callee) !== undefined)
    throw new Error(
      `Could not compile \`Apply\`: ${PARTIAL_APPLICATION_REFUSAL}`
    );
}

/**
 * True when the `Apply` whose operands are `args` (a callee and its
 * arguments) is a call of a function literal with fewer arguments than the
 * literal needs.
 */
export function isPartialApplication(args: ReadonlyArray<Expression>): boolean {
  const [literal, ...actuals] = args;
  return literal !== undefined && isUnderApplied(literal, actuals.length);
}

/**
 * Decline an `Apply` whose callee is not a function value. The canonical
 * form of `D(x ↦ sin(n·x), x)` is `D(sin(n·x), x)`, a number, and the
 * compiled call `(n * Math.cos(n * x))(1)` throws "is not a function" when
 * it runs. The interpreter reads such a callee as a function of its free
 * variables, which compiled code does not do. The callee is a function value
 * when its static type is a function type; a callee of type `unknown` or
 * `any` also declines, because its shape is not settled at compile time.
 * `head` is the operator named in the reason (`Apply` or `ApplyWhole`).
 */
export function assertCalleeIsFunction(
  args: ReadonlyArray<Expression>,
  head = 'Apply'
): void {
  const callee = args[0];
  if (callee === undefined) return;
  const t = callee.type.type;
  if (t !== 'never' && isSubtype(t, 'function')) return;
  // A type that can hold a function value (`unknown`, `any`, a union with a
  // function member) leaves the shape of the callee to the run time. A
  // callee whose type has no function value (`number`) is a value that the
  // interpreter reads as a function of its free variables.
  const why = couldMatch(t, 'function')
    ? `The callee can be a value that is not a function, and compiled code ` +
      `settles the shape of a value at compile time.`
    : `The interpreter reads such a callee as a function of its free ` +
      `variables, and compiled code does not.`;
  throw new Error(
    `Could not compile \`${head}\`: the callee has the type ` +
      `\`${callee.type.toString()}\`, which is not a function type. ${why}`
  );
}

/** The refusal is shared by every target, including targets with closures. */
export function partialApplicationDecline(): string {
  return PARTIAL_APPLICATION_REFUSAL;
}

export function partialApplicationValueDecline(): string {
  return `Could not compile \`Apply\`: ${PARTIAL_APPLICATION_REFUSAL}`;
}

/** Leave the original literal intact when argument typing cannot rebuild it. */
function unlessDeclined<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

/**
 * Give bare parameters the types of collection arguments that an applied
 * literal binds whole. Partial and curried applications stay unchanged so
 * the target reports their decline. Held operands and caller-defined Apply
 * implementations also stay unchanged.
 */
export function rewritePartialApplications(
  expr: Expression,
  skipHeads?: ReadonlySet<string>
): Expression {
  if (skipHeads?.has('Apply')) return expr;
  const memo = new Map<Expression, Expression>();
  const walk = (e: Expression): Expression => {
    if (!isFunction(e) || e.operator === 'Hold') return e;
    const known = memo.get(e);
    if (known !== undefined) return known;
    // Do not rewrite a callee that must be diagnosed as a curried call.
    if (
      e.operator === 'Apply' &&
      e.nops > 0 &&
      curriedLiteral(e.op1) !== undefined
    ) {
      memo.set(e, e);
      return e;
    }
    let changed = false;
    let callOps = e.ops;
    // A function literal applied to all its arguments gets the types of its
    // collection arguments on its bare parameters
    // (`appliedLiteralTypedFromArguments`). This is done before the
    // operands are visited, so the visit sees the body canonicalized with
    // the typed parameters.
    // A head that the caller overrides receives its operands as written.
    if (
      (e.operator === 'Apply' || e.operator === 'ApplyWhole') &&
      skipHeads?.has(e.operator) !== true
    ) {
      const typed = unlessDeclined(() =>
        appliedLiteralTypedFromArguments(callOps, {
          whole: e.operator === 'ApplyWhole',
        })
      );
      if (typed !== undefined) {
        callOps = [typed, ...callOps.slice(1)];
        changed = true;
      }
    }
    const ops = callOps.map((op) => {
      const t = walk(op);
      if (t !== op) changed = true;
      return t;
    });
    const result = changed ? rebuild(e, ops) : e;
    memo.set(e, result);
    return result;
  };
  return walk(expr);
}

/** `expr` rebuilt with new operands, onto its own scope when it owns one. */
function rebuild(
  expr: Expression & FunctionInterface,
  ops: ReadonlyArray<Expression>
): Expression {
  const ce = expr.engine;
  const scope = expr.localScope;
  if (scope === undefined) return ce.function(expr.operator, ops);
  return ce.function(expr.operator, ops, {
    scope: scopeForRebuild(scope, ce, expr.operator, ops),
  });
}
