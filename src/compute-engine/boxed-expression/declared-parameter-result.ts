import type { Type } from '../../common/type/types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import type { Expression, IComputeEngine } from '../global-types.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import { functionResult, returnTypeText } from '../../common/type/utils.js';
import { isFunction, isSymbol } from './type-guards.js';
import { scopeChainDeclarationCount } from '../scope-declaration-count.js';

/**
 * The scope the function literal `literal` was defined in: the parent of the
 * local scope of its body, which holds its parameters. `undefined` when the
 * body has no local scope, as for a literal built in structural form: its
 * home is then unknown, and no result under the declared parameter types is
 * computed for it (boxing it in the reader's scope would let that scope
 * decide what its free names mean).
 */
function homeScopeOf(literal: Expression) {
  if (!isFunction(literal, 'Function')) return undefined;
  return literal.ops[0].localScope?.parent ?? undefined;
}

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
  const home = homeScopeOf(literal);
  if (home === undefined) return undefined;
  let result: Type | undefined;
  try {
    // The literal is boxed again in the scope it was defined in, so its free
    // names resolve as they do in the stored literal, whatever scope the
    // signature is read from: read from inside another function's body, a
    // parameter of that function with the same name as a free name of this
    // one would otherwise capture it.
    const typed = ce._inScope(home, () =>
      ce.box(['Function', literal.ops[0].json, ...stamped])
    );
    result = functionResult(typed.type.type);
  } catch {
    return undefined;
  }
  return result === undefined || result === 'unknown' ? undefined : result;
}

/**
 * The key of a memo of `resultUnderDeclaredParameters` for the function
 * literal `literal`: the engine versions and counts that move when the
 * result can change. The result depends on the types and values of the
 * symbols the body reads, resolved from the scope the literal was defined
 * in. So the key moves with:
 * - a value write (`_semanticVersion`);
 * - an assumption, a redefinition or a signature inference (`_worldVersion`);
 * - a retype of a symbol, a declaration that shadows a function, and any
 *   other change of a function (`_definitionVersion`). A narrowing of a
 *   symbol by a use
 *   (`inference-settled`) is not counted: it is frequent, and it can only
 *   leave a cached result wider than it could be, never wrong;
 * - a declaration in the literal's home scope or one of its ancestors
 *   (`scopeChainDeclarationCount`): assigning an undeclared `b` declares it
 *   in the global scope, and `x ↦ b + x` then reads it. A declaration in the
 *   home scope of a function the body CALLS, outside this chain, is not
 *   counted unless it shadows a function: a callee defined in another
 *   scope, whose result changes because a new scalar is declared there,
 *   can leave this result wider or narrower than a fresh derivation until
 *   another counter moves (all functions of a Tycho document share one
 *   scope, so this does not arise there);
 * - whether the assumptions are hidden (the low bit of `_cacheGeneration()`).
 * Each memo records this key AFTER its computation, so the events of the
 * computation itself are part of it.
 *
 * It is deliberately NOT the cache generation, the `any` axis, which every
 * declaration moves, in any scope. Computing the result boxes the function
 * literal, which declares its parameters in a scope of its own, so a
 * generation read BEFORE the computation never matched the one stored: the
 * memo never hit, every read re-boxed the body, and the body read the
 * signatures of the declared functions it calls, each re-boxed in turn. A
 * Tycho document with nested declared functions (a Voronoï pattern: `P`
 * calls `S` twice, `S` calls `H`, `V` calls `P` nine times) spent 75 s
 * registering its definitions, 1 s before. Reading the generation AFTER the
 * computation is not enough either: the boxing of an outer function (`V`)
 * declares its own parameters between two reads of an inner one (`P`), and
 * one document still took more than 200 s.
 *
 * Nor is it the `callable` axis, which a declaration of a parameter that may
 * hold a function (an `unknown` parameter) also moves. With `k` declared
 * `(unknown, T) -> unknown` and `w` declared `(T, unknown) -> unknown`,
 * re-boxing `k` moved the axis and invalidated `w`'s memo, and re-boxing `w`
 * invalidated `k`'s: typing `sin(cos(k(x,y) + w(x,y)))` took 10 s (Tycho's
 * `plasma-effect` document hit its 5 s budget and dropped a definition).
 */
export function declaredResultMemoKey(
  ce: IComputeEngine,
  literal: Expression
): string {
  // A literal with no home scope has no result under the declared
  // parameter types (`resultUnderDeclaredParameters`), so no scope's
  // declarations can change it.
  const home = homeScopeOf(literal);
  return `${ce._semanticVersion}:${ce._worldVersion}:${
    ce._definitionVersion
  }:${scopeChainDeclarationCount(home)}:${ce._cacheGeneration() & 1}`;
}

/** `t` with its result replaced by `result`, when `t` is a signature. */
export function withSignatureResult(t: Type, result: Type): Type {
  return typeof t === 'object' && t.kind === 'signature' ? { ...t, result } : t;
}
