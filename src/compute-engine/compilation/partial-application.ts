import type { Expression, FunctionInterface } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import {
  functionLiteralBoundNames,
  isDestructuringParameter,
  optionalParameterDefault,
  optionalParameterTarget,
  requiredParameterCount,
} from '../boxed-expression/function-literal.js';
import { appliedLiteralTypedFromArguments } from './applied-literal-types.js';

/**
 * The compilation of a PARTIAL APPLICATION of a function literal: an
 * `Apply(Function(body, x₁, …, xₙ), a₁, …, aₖ)` with fewer arguments than the
 * literal needs.
 *
 * The interpreter CURRIES such an application (`makeLambda`, step 3,
 * `function-utils.ts`) when the literal has at least one parameter and the
 * call supplies fewer arguments than the FIXED parameters (the parameters
 * before a rest parameter, or all of them). Its value is the DEFERRED
 * residual `(_1, …, _m) ↦ Apply(f, a₁, …, aₖ, _1, …, _m)`, which applies the
 * original literal to all the arguments when the last one arrives. The body
 * is not evaluated at partial application, so a curried value equals the
 * full call. A residual applied to too few arguments is curried the same
 * way, so a chain of currying steps also equals the full call:
 * `Apply(Apply(Apply(F, 1), 0), ∞)` is `Apply(F, 1, 0, ∞)`.
 *
 * The compiled code is that call of the literal. A partial application
 * compiles when all of these hold (`partialApplicationRefusal` gives the
 * reason when one does not):
 *
 * - the literal is not GENERIC (the interpreter gives an error for it) and
 *   has no rest parameter;
 * - each supplied argument is a literal whose evaluated value is the literal
 *   itself in an exact and in a numeric evaluation (`isLiteralArgument`): a
 *   machine number or a string. The residual holds the
 *   EVALUATED argument, which under `.N()` is its approximation, and the
 *   interpreter maps a call over a collection argument, so a partial
 *   application with a list argument is a list of residuals.
 *
 * Two compile-time forms follow:
 *
 * - A partial application that is the CALLEE of an `Apply` is merged with the
 *   outer arguments into one call of the literal (`curriedApplication`):
 *   `Apply(Apply(f, 1), u)` is `Apply(f, 1, u)`, which is what the deferred
 *   residual does when it is applied. Each target compiles the merged call as
 *   an ordinary application, the shader targets included.
 * - A partial application whose value is a FUNCTION compiles to the deferred
 *   residual (`partialApplicationValue`) on a target that has function values,
 *   at the root of the compilation and as the value of an assignment to a
 *   block local, where every call of it supplies all its arguments; at any
 *   other position it declines (`partialApplicationValueDecline`).
 *   The residual reads each supplied argument when it is CALLED, and the
 *   interpreter reads it when the partial application is EVALUATED; a
 *   literal argument has the same value at both times. A shader target has
 *   no function values and declines (`partialApplicationDecline`).
 */

/**
 * The number of arguments that a call of `literal` must supply before the
 * call is saturated: the count of parameters before the first parameter with
 * a default value or the rest parameter, or the count of parameters
 * (`requiredParameterCount`).
 */
function fixedParameterCount(params: ReadonlyArray<Expression>): number {
  return requiredParameterCount(params);
}

/**
 * True when a call of the function literal `literal` with `count` arguments
 * supplies fewer arguments than the literal needs (see the rule above).
 */
function isUnderApplied(literal: Expression, count: number): boolean {
  if (!isFunction(literal, 'Function')) return false;
  if (literal.nops < 2) return false;
  return count < fixedParameterCount(literal.ops.slice(1));
}

/**
 * The reason why a partial application of `literal` to `args` does not
 * compile. Compiled code calls a function only with all its arguments: a
 * partial application, and a call of its value (currying,
 * `Apply(Apply(f, 1), u)`), decline. The interpreter keeps them (user
 * decision 2026-11-02, `docs/COMPILATION-MODEL.md`, "Function values").
 * The return type keeps `undefined`, the value of a partial application
 * that compiles, for the callers of this function.
 */
function partialApplicationRefusal(
  _literal: Expression,
  _args: ReadonlyArray<Expression>
): string | undefined {
  return (
    'a partial application or a curried call (a call with fewer arguments ' +
    'than the function has parameters, or a call of its value) is not ' +
    'compiled. Call the function with all its arguments, or evaluate instead.'
  );
}

/**
 * The literal and the arguments of `expr` when `expr` is a partial
 * application of a function literal, through any number of nested partial
 * applications (`Apply(Apply(f, 1), 2)` for a literal `f` with three
 * parameters gives `f` and `[1, 2]`), or `undefined`. The interpreter
 * curries `f` with `1`, then curries the residual with `2`, and the value
 * is the same as the partial application `Apply(f, 1, 2)`.
 */
function curriedLiteral(
  expr: Expression
): { literal: Expression; args: ReadonlyArray<Expression> } | undefined {
  if (!isFunction(expr, 'Apply') || expr.nops === 0) return undefined;
  let literal = expr.op1;
  let args = expr.ops.slice(1);
  const inner = curriedLiteral(literal);
  if (inner !== undefined) {
    literal = inner.literal;
    args = [...inner.args, ...args];
  }
  if (!isUnderApplied(literal, args.length)) return undefined;
  return { literal, args };
}

/**
 * The operands of one call of a function literal equivalent to the `Apply`
 * whose operands are `args`, when its callee is a partial application of a
 * literal: `[f, 1, u]` for `Apply(Apply(f, 1), u)`. `undefined` when the
 * callee is not such a partial application. The call can still supply too
 * few arguments (`[f, 1, u]` for `Apply(Apply(f, 1), u)` when `f` has
 * three parameters): it is then a partial application itself
 * (`isPartialApplication`).
 *
 * Throws (a decline) when the callee is a partial application that does not
 * compile (`partialApplicationRefusal`).
 */
export function curriedApplication(
  args: ReadonlyArray<Expression>
): ReadonlyArray<Expression> | undefined {
  const [callee, ...actuals] = args;
  if (callee === undefined) return undefined;
  const inner = curriedLiteral(callee);
  if (inner === undefined) return undefined;
  const reason = partialApplicationRefusal(inner.literal, inner.args);
  if (reason !== undefined)
    throw new Error(`Could not compile \`Apply\`: ${reason}`);
  return [inner.literal, ...inner.args, ...actuals];
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
 * The message of the decline of a partial application on a target that has
 * no function values (the shader targets). When the partial application does
 * not compile on any target, the message gives that reason
 * (`partialApplicationRefusal`); otherwise it says that the value is a
 * function, which such a target cannot hold.
 */
export function partialApplicationDecline(
  args: ReadonlyArray<Expression>,
  language: string
): string {
  const [literal, ...actuals] = args;
  const reason = partialApplicationRefusal(literal, actuals);
  if (reason !== undefined) return reason;
  const params = isFunction(literal) ? literal.nops - 1 : 0;
  return (
    `the function takes ${params} parameter(s) and ${actuals.length} ` +
    `argument(s) are supplied, so the value is a function of the remaining ` +
    `parameters (a partial application), and target '${language}' has no ` +
    `function values. A partial application compiles here only when it is ` +
    `applied to the remaining arguments.`
  );
}

/**
 * The message of the decline of a partial application whose value is a
 * function, at a position where the compilation does not build its residual
 * (see `rewritePartialApplications`): the reason why it does not compile at
 * all (`partialApplicationRefusal`), or the position.
 *
 * The residual is built only at the root of the compilation and as the
 * value of an assignment to a block local. There, the compiled code calls it
 * with all its arguments: the root is called by the host, and a call of a
 * block-local function with too few arguments declines. At any other
 * position (an `If` branch, an argument, a list element), a call can supply
 * fewer arguments than the residual has parameters, which the interpreter
 * curries again and the compiled call does not.
 */
export function partialApplicationValueDecline(
  args: ReadonlyArray<Expression>
): string {
  const [literal, ...actuals] = args;
  const reason = partialApplicationRefusal(literal, actuals);
  return (
    'Could not compile `Apply`: ' +
    (reason ??
      'the value of the partial application is a function, which compiles ' +
        'only at the root of the compilation or as the value of an ' +
        'assignment to a block local (not the last statement of its block), ' +
        'where every call of it supplies all its arguments.')
  );
}

/**
 * The function literal that is the value of the partial application whose
 * `Apply` operands are `args`, or `undefined` when `args` is not a partial
 * application of a function literal (`isPartialApplication`).
 *
 * The value is the interpreter's deferred residual
 * `(_1, …, _m) ↦ Apply(f, a₁, …, aₖ, _1, …, _m)`. Each fresh parameter keeps
 * the type annotation of the parameter it stands for, as in the
 * interpreter's residual. A fresh parameter that stands for a destructuring
 * parameter is a plain name, which `f` destructures.
 *
 * Throws (a decline) when the partial application does not compile
 * (`partialApplicationRefusal`).
 */
export function partialApplicationValue(
  args: ReadonlyArray<Expression>
): Expression | undefined {
  if (!isPartialApplication(args)) return undefined;
  const [literal, ...actuals] = args;
  if (!isFunction(literal, 'Function')) return undefined;
  const ce = literal.engine;
  const params = literal.ops.slice(1);
  const reason = partialApplicationRefusal(literal, actuals);
  if (reason !== undefined)
    throw new Error(`Could not compile \`Apply\`: ${reason}`);

  const taken = new Set<string>([
    ...literal.symbols,
    ...functionLiteralBoundNames(params),
    ...actuals.flatMap((a) => a.symbols),
  ]);
  const unapplied = params.slice(actuals.length);
  const fresh = unapplied.map((_, i) => {
    let name = `_${i + 1}`;
    let counter = 0;
    while (taken.has(name)) name = `_${i + 1}_${counter++}`;
    taken.add(name);
    return ce.symbol(name, { canonical: false });
  });
  // A parameter with a default value keeps it in the residual, so a call of
  // the residual that leaves it out reads the default, as the interpreter's
  // residual does.
  const residualParams = unapplied.map((written, i) => {
    const param = optionalParameterTarget(written);
    const p =
      isFunction(param, 'Typed') && !isDestructuringParameter(param)
        ? ce._fn('Typed', [fresh[i], param.op2], { canonical: false })
        : fresh[i];
    const d = optionalParameterDefault(written);
    return d === undefined
      ? p
      : ce._fn('Optional', [p, d], { canonical: false });
  });
  return ce.function('Function', [
    ce._fn('Apply', [literal, ...actuals, ...fresh], { canonical: false }),
    ...residualParams,
  ]);
}

/**
 * The value of `f()`, or `undefined` when `f` throws a decline. The pass
 * leaves a partial application that does not compile as it is, and the
 * `Apply` lowering of the target then declines it with the reason.
 */
function unlessDeclined<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

/**
 * `expr` with each partial application of a function literal that compiles
 * (see the conditions at the top of this file) replaced by an equivalent
 * shape that the targets compile:
 *
 * - an `Apply` whose callee is a partial application becomes one call of the
 *   literal (`curriedApplication`);
 * - a partial application on its own becomes its residual literal
 *   (`partialApplicationValue`). This is what lets a block local hold a
 *   partial application: the compilation of a
 *   block local that holds a function reads the `Function` literal assigned
 *   to it, and a partial application assigned to it was not one.
 *
 * Any other partial application is left as it is, and the `Apply` lowering
 * of the target declines it with the reason. So the pass itself never
 * declines.
 *
 * The pass also gives each bare parameter of a function literal applied by
 * `Apply` or `ApplyWhole` the type of its collection argument, when the
 * application binds that argument whole
 * (`appliedLiteralTypedFromArguments`): `Apply(d ↦ Sum(d), L)` with `L` of
 * type `list<integer>` compiles as `Apply((d: list<integer>) ↦ Sum(d), L)`.
 *
 * The registered shader targets do not run this pass: there, the residual
 * literal would be declined as a `Function`, with a message that does not
 * name the partial application. A direct target (`compile(expr, { target })`)
 * runs it, and receives the residual `Function` literal, which it compiles,
 * or declines, as any `Function` literal.
 *
 * A node that holds no partial application is returned as it is. A scoped
 * node (a `Block`, a `Function`) is rebuilt onto its own scope
 * (`scopeForRebuild`, `boxed-expression/binding-sites.ts`), as the
 * fixed-width unroll does (`fixed-width-unroll.ts`). A held operand
 * (`Hold`) is not visited.
 *
 * When `skipHeads` holds `Apply` (the caller of the compilation supplies its
 * own implementation of `Apply`), the pass does nothing: that implementation
 * receives the operands as written.
 */
export function rewritePartialApplications(
  expr: Expression,
  skipHeads?: ReadonlySet<string>
): Expression {
  if (skipHeads?.has('Apply')) return expr;
  // One memo per position: the same node can be rewritten at a value
  // position and left as it is at another.
  const memos: Record<Position, Map<Expression, Expression>> = {
    value: new Map(),
    statement: new Map(),
    other: new Map(),
  };
  const walk = (e: Expression, position: Position): Expression => {
    if (!isFunction(e) || e.operator === 'Hold') return e;
    const memo = memos[position];
    const known = memo.get(e);
    if (known !== undefined) return known;
    // The callee is merged before the operands are visited: the visit would
    // otherwise replace a partial application at the callee by its residual
    // literal, and the call would apply that literal instead of the original.
    const merged =
      e.operator === 'Apply'
        ? unlessDeclined(() => curriedApplication(e.ops))
        : undefined;
    // A callee that is a partial application whose merge declines is left
    // as it is, with its operands: rewriting the inner partial application
    // to its residual would hide it from the `Apply` lowering, which must
    // decline it with the reason.
    if (
      merged === undefined &&
      e.operator === 'Apply' &&
      e.nops > 0 &&
      curriedLiteral(e.op1) !== undefined
    ) {
      memo.set(e, e);
      return e;
    }
    let changed = merged !== undefined;
    let callOps = merged ?? e.ops;
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
    const ops = callOps.map((op, i) => {
      const t = walk(op, operandPosition(e, i, position));
      if (t !== op) changed = true;
      return t;
    });
    let result: Expression = e;
    if (e.operator === 'Apply') {
      const residual =
        position === 'value'
          ? unlessDeclined(() => partialApplicationValue(ops))
          : undefined;
      if (residual !== undefined) result = residual;
      else if (changed) result = rebuild(e, ops);
    } else if (changed) result = rebuild(e, ops);
    memo.set(e, result);
    return result;
  };
  return walk(expr, 'value');
}

/**
 * Where a node is, for `rewritePartialApplications`: at a VALUE position (the
 * root of the compilation, or the value of an `Assign` that is a statement of
 * a `Block` other than the last one), as a STATEMENT of a `Block`, or at any
 * other position.
 */
type Position = 'value' | 'statement' | 'other';

/** The position of the operand `i` of `parent`, which is at `position`. */
function operandPosition(
  parent: Expression & FunctionInterface,
  i: number,
  position: Position
): Position {
  if (parent.operator === 'Block')
    return i < parent.nops - 1 ? 'statement' : 'other';
  if (
    parent.operator === 'Assign' &&
    position === 'statement' &&
    i === 1 &&
    isSymbol(parent.op1)
  )
    return 'value';
  return 'other';
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
