/**
 * Built-in operator names used as **callbacks** — the provenance and arity
 * predicates shared by the two halves of the feature:
 *
 * - emission (`base-compiler.ts`): a bare built-in operator symbol in value
 *   position (`Map(Sin, xs)`, `CountIf(xs, IsPrime)`) is eta-expanded at its
 *   REQUIRED arity into `(p) ↦ Sin(p)` and emitted through the same
 *   shared-local machinery user functions use, instead of falling through to
 *   a dangling `_.Sin` that throws `_f is not a function` at run time. A
 *   built-in that cannot be expanded at all (variadic, zero-required) fails
 *   closed at COMPILE time instead;
 * - analysis (`cse.ts`): such an operand is no longer an OPAQUE callable, so
 *   an enclosing `Sum(Map(Sin, xs))` can be a CSE candidate.
 *
 * The two must agree: an operand that cannot be eta-expanded must never
 * become CSE-eligible, so {@link isPureBuiltinCallback} is defined in terms
 * of {@link builtinCallbackArity} — the exact predicate emission uses.
 *
 * This module is a leaf: it imports only types and the definition guard, so
 * both `base-compiler.ts` and `cse.ts` can depend on it without disturbing
 * the `base-compiler` → `cse` dependency direction.
 */

import type {
  BoxedDefinition,
  BoxedOperatorDefinition,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';

/**
 * The SYSTEM-scope binding offered for `name`, or `undefined` when the engine
 * offers none.
 *
 * A CALLER-supplied library passed to the constructor's `libraries` option is
 * installed in the system scope too (bootstrap runs between
 * `pushScope('system')` and `pushScope('global')`), so scope identity alone
 * would misclassify a caller-authored definition as engine-authored. The
 * provenance recorded at bootstrap (`engine._customLibraryOperators`)
 * overrides the scope test. The set is fixed once the engine is constructed.
 */
export function systemScopeBinding(
  engine: ComputeEngine,
  name: string
): BoxedDefinition | undefined {
  if (engine._customLibraryOperators.has(name)) return undefined;
  return engine.contextStack[0]?.lexicalScope.bindings.get(name) as
    | BoxedDefinition
    | undefined;
}

/**
 * The operator definition `name` resolves to, but only when it IS the
 * engine-authored built-in — the system-scope binding by OBJECT IDENTITY.
 * A user definition SHADOWING a built-in name (`ce.assign('Sin', …)` in any
 * non-system scope) resolves to the user record, is not identity-equal to the
 * system binding, and answers `undefined` here — it takes the user-function
 * route instead.
 */
export function builtinOperatorDefinition(
  engine: ComputeEngine,
  name: string
): BoxedOperatorDefinition | undefined {
  const def = engine.lookupDefinition(name);
  if (def === undefined || !isOperatorDef(def)) return undefined;
  if (def !== systemScopeBinding(engine, name)) return undefined;
  return def.operator;
}

/**
 * The arity to eta-expand built-in `name` at — its `n ≥ 1` REQUIRED
 * parameters — or `undefined` when `name` is not an eta-expandable built-in.
 *
 * An OPTIONAL tail does not disqualify: calling the operator with only its
 * required arguments is a valid application (the optionals default), which is
 * exactly what a callback site does — `Map(Ln, xs)` applies `Ln` unary — so
 * the unary wrapper `(p) ↦ Ln(p)` is semantically exact.
 *
 * A VARIADIC tail (`Add`, `Less`) or a zero-required signature (`Random`,
 * `Max`) still has no single wrapper arity, and DECLINES: emission then fails
 * closed rather than emitting a broken artifact, and the CSE side keeps such
 * an operand opaque.
 */
export function builtinCallbackArity(
  engine: ComputeEngine,
  name: string
): number | undefined {
  const opDef = builtinOperatorDefinition(engine, name);
  if (opDef === undefined) return undefined;
  const t = opDef.signature?.type;
  if (t === undefined || typeof t === 'string' || t.kind !== 'signature')
    return undefined;
  const n = t.args?.length ?? 0;
  if (n < 1) return undefined;
  if (t.variadicArg !== undefined) return undefined;
  return n;
}

/**
 * May a bare occurrence of built-in `name` in VALUE position be REFUSED when
 * it does not eta-expand, rather than falling through to a free-symbol read?
 *
 * True for an engine-authored operator name — an un-expandable one there
 * (`Map(Random, xs)`) would otherwise emit `_.Random` and throw
 * `_f is not a function` at run time.
 *
 * False for a single-uppercase-letter name (`D`, `N`): the engine's own
 * prose-style fallback (`devolveUnappliedOperator`,
 * `boxed-expression/validate.ts`, same `/^[A-Z]$/` shape) reads exactly those
 * as VARIABLES when they appear un-applied among numeric operands — the `D`
 * of `\int D x^2 dx` is a coefficient the caller supplies at run time, not a
 * broken callback. Refusing them would contradict that convention.
 *
 * That exemption is about the VALUE position only. A callback OPERAND is
 * applied, so the convention does not hold there and the refusal is made
 * position-aware at the callback splice instead
 * (`BaseCompiler.assertBuiltinCallbackUsable`).
 */
export function isRefusableBuiltinCallback(
  engine: ComputeEngine,
  name: string
): boolean {
  if (/^[A-Z]$/.test(name)) return false;
  return builtinOperatorDefinition(engine, name) !== undefined;
}

/**
 * Is `name` a PURE built-in operator usable as a merged-across callback?
 * The CSE admission predicate (§5.2): the same provenance and arity gate
 * emission applies, plus the effects-model purity flag — a `Random`-family
 * callback must stay opaque so repeated occurrences never merge.
 *
 * Deliberately expressed through {@link builtinCallbackArity}: an operand
 * that emission cannot eta-expand must not become CSE-eligible.
 */
export function isPureBuiltinCallback(
  engine: ComputeEngine,
  name: string
): boolean {
  if (builtinCallbackArity(engine, name) === undefined) return false;
  return builtinOperatorDefinition(engine, name)?.pure === true;
}
