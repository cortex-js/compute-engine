import type { Type } from '../../common/type/types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type { Expression, IComputeEngine } from '../global-types.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { functionResult, returnTypeText } from '../../common/type/utils.js';
import { isFunction, isSymbol } from './type-guards.js';

/**
 * The result type of the function literal `literal` with the parameter types
 * of `declared` stamped on its parameters, scalars included, when `declared`
 * is a ground signature whose result is the placeholder `unknown`.
 * `undefined` when there is nothing to add: `declared` is not such a
 * signature, no parameter takes a declared type, or the result is still
 * `unknown`.
 *
 * The host that declares the parameter types promises them, so the result
 * the body has under them is the accurate return type to report:
 * `(real | signed_infinity | nan) -> unknown` assigned `t ↦ t + 1` reports
 * `-> nan | real | signed_infinity`, not the `-> number` the literal gives
 * with its parameter read as `unknown` (user decision 2026-09-26: the host
 * gives the types of what it constructs, CE gives narrow types for the
 * values it returns).
 *
 * The literal itself is not changed. It is stored without the scalar
 * parameter types, because stamping one re-canonicalizes the body and
 * changes how a tuple argument broadcasts through `x ↦ 2x`
 * (`ascribeDeclaredParameterTypes` in `engine-declarations.ts`). So this
 * result is computed when the signature is read, from the stored literal,
 * and never stored: it then follows a later change of a symbol the body
 * reads, and a checkpoint restore.
 *
 * A parameter is stamped with the rules of `ascribeDeclaredParameterTypes`,
 * scalars included: a plain symbol parameter whose declared type is not
 * `unknown`, `any` or `broadcastable<T>` (a declaration-level contract,
 * not a parameter type). An already typed parameter keeps its own type.
 */
export function resultUnderDeclaredParameters(
  ce: IComputeEngine,
  literal: Expression,
  declared: Type
): Type | undefined {
  if (
    !isFunction(literal, 'Function') ||
    typeof declared !== 'object' ||
    declared.kind !== 'signature' ||
    declared.result !== 'unknown' ||
    isPolymorphicType(declared)
  )
    return undefined;
  const args = declared.args ?? [];
  const params = literal.ops.slice(1);
  if (params.length !== args.length) return undefined;
  let changed = false;
  const stamped = params.map((p, i): MathJsonExpression => {
    const t = args[i].type;
    if (!isSymbol(p) || t === 'unknown' || t === 'any') return p.json;
    if (typeof t === 'object' && t.kind === 'broadcastable') return p.json;
    changed = true;
    return ['Typed', p.json, `'${returnTypeText(t)}'`] as MathJsonExpression;
  });
  if (!changed) return undefined;
  let result: Type | undefined;
  try {
    const typed = ce.box(['Function', literal.ops[0].json, ...stamped]);
    result = functionResult(typed.type.type);
  } catch {
    return undefined;
  }
  return result === undefined || result === 'unknown' ? undefined : result;
}

/** `t` with its result replaced by `result`, when `t` is a signature. */
export function withSignatureResult(t: Type, result: Type): Type {
  return typeof t === 'object' && t.kind === 'signature' ? { ...t, result } : t;
}
