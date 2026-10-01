import type { Type } from '../../common/type/types.js';
import { resolveTypeReference } from '../../common/type/subtype.js';
import type {
  BoxedValueDefinition,
  Expression,
  ExpressionInput,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';
import { lookup, lookupApplicable } from '../function-utils.js';
import { isOperatorDef, isValueDef } from './utils.js';
import { isDictionary, isFunction, isSymbol } from './type-guards.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { qualifiedFieldParts } from './named-arguments.js';

/**
 * A call through a field of a record or a dictionary: `bob.S(3, factor: 5)`
 * in Epsil, which canonicalizes to `Apply(Field(bob, "S"), 3, factor: 5)`,
 * and the same `Apply(Field(…), …)` written directly on the `ce.box()` or
 * `ce.function()` routes.
 *
 * `Apply` is normally excluded from named-argument matching: its first
 * operand IS the callee, and a callee that is an arbitrary expression has no
 * parameter names that can be known while the call is made canonical. For a
 * `Field` callee two facts can make them known, and this function finds them:
 *
 * 1. **The receiver is a constant.** When the receiver is a symbol declared
 *    with `isConstant: true` whose value is a dictionary (a record value is a
 *    dictionary too), the field's value can never change, so reading it here
 *    is safe. (The rule that a canonical fold reads number literals only
 *    exists because a reassignment would make a folded result out of date. A
 *    constant cannot be reassigned.) Two field values are resolved:
 *    - a symbol that names an operator: the result is `kind: 'operator'`, and
 *      the caller replaces the whole call with the direct call
 *      `bob_S(3, factor: 5)`, BEFORE any argument is made canonical. The call
 *      then gets everything a direct call gets: named arguments, `lazy`
 *      (held arguments), the static argument checks, its result type and
 *      compilation.
 *    - a `Function` literal: the result is `kind: 'literal'`, and the caller
 *      replaces the callee with the literal. The names are then matched by
 *      the inline-literal rule, as for `((x) => x + 1)(x: 5)`.
 * 2. **The receiver's type is a record whose field has a signature.** When
 *    the call has a named argument and the receiver symbol's type is
 *    `record{S: (x: number, factor: number?) -> number}`, the names are
 *    matched against that signature (`kind: 'signature'`). The call stays
 *    `Apply(Field(bob, "S"), …)` with the arguments in declaration order. The
 *    receiver may hold another value later: the type is a contract that every
 *    value assigned to it satisfies, so the match never depends on the value
 *    held now. A signature TYPE has no `lazy` flag, so on this route the
 *    arguments are always evaluated.
 *
 * Anything else returns `undefined`, and the call is made canonical as
 * before: a named argument then reports `argument-names-unavailable`. This
 * includes a receiver that is not constant and whose type does not give the
 * field's parameter names (a `dictionary<function>`), and a `Field` whose
 * receiver is not a symbol.
 *
 * Design decision of 2026-10-01 (GitHub issue #390); the rule text is in
 * `docs/TYPE_SYSTEM_ROADMAP.md`, Appendix C, sub-ruling R4.
 */
export type FieldCallee =
  | { kind: 'operator'; name: string }
  | { kind: 'literal'; literal: Expression }
  | { kind: 'signature'; signature: Type };

export function resolveFieldCallee(
  ce: ComputeEngine,
  callee: ExpressionInput | undefined,
  scope: Scope,
  named: boolean
): FieldCallee | undefined {
  const parts = qualifiedFieldParts(callee);
  if (parts === undefined) return undefined;
  const receiver = receiverDefinition(ce, callee!, parts.base, scope);
  if (receiver === undefined) return undefined;

  const stored = constantFieldValue(receiver, parts.member);
  if (stored !== undefined) {
    if (isFunction(stored, 'Function'))
      return { kind: 'literal', literal: stored };
    if (isSymbol(stored)) {
      // The direct call is boxed by NAME, so the name must denote, here, the
      // operator the stored symbol denotes. A local binding of the same name
      // (a function parameter called `bob_S`, say) would make the direct call
      // reach something else: the rewrite is then not made.
      const def = lookupApplicable(stored.symbol, scope, ce);
      if (
        def !== undefined &&
        isOperatorDef(def) &&
        (stored.operatorDefinition === undefined ||
          stored.operatorDefinition === def.operator)
      )
        return { kind: 'operator', name: stored.symbol };
    }
  }

  // Without a named argument there is nothing to match: the call is made
  // canonical as before.
  if (!named) return undefined;
  const signature = recordFieldSignature(receiver.type.type, parts.member);
  return signature === undefined ? undefined : { kind: 'signature', signature };
}

/** The value definition of the receiver symbol `name` of the `Field` callee.
 *
 * An already-boxed callee whose receiver is a bound symbol gives its own
 * binding: that is the binding the expression denotes. Otherwise the name is
 * looked up in `scope`. A name that is a parameter of the construct being made
 * canonical (`(bob) => bob.S(…)`) may not be declared yet, and the walk up the
 * scope chain would then find an outer `bob` of the same name: its own binding
 * is used when it has one, and else no definition is returned. */
function receiverDefinition(
  ce: ComputeEngine,
  callee: ExpressionInput,
  name: string,
  scope: Scope
): BoxedValueDefinition | undefined {
  if (callee instanceof _BoxedExpression) {
    const base = callee.ops?.[0];
    if (isSymbol(base) && base.valueDefinition !== undefined)
      return base.valueDefinition;
  }
  const def = ce._isShadowedParameter(name)
    ? ce._shadowedParameterDef(name)
    : lookup(name, scope);
  return def !== undefined && isValueDef(def) ? def.value : undefined;
}

/** The value stored in the field `member` of a CONSTANT receiver whose value
 * is a dictionary (or a record, which is a dictionary value), or `undefined`.
 * An `object` value is not read: its fields can be changed even when the
 * binding that holds it cannot. */
function constantFieldValue(
  def: BoxedValueDefinition,
  member: string
): Expression | undefined {
  if (!def.isConstant) return undefined;
  const value = def.value;
  if (!isDictionary(value)) return undefined;
  return value.get(member);
}

/** The type of the field `member` that a record type declares, when it is a
 * function signature or an overload set (an intersection of signatures), or
 * `undefined`. A type alias or a nominal reference is followed to its body. A
 * dictionary type, a union, or a field that is not a function gives no
 * parameter names. */
function recordFieldSignature(t: Type, member: string): Type | undefined {
  const record = resolveTypeReference(t);
  if (record === undefined || typeof record === 'string') return undefined;
  if (record.kind !== 'record') return undefined;
  const field = record.elements[member];
  if (field === undefined) return undefined;
  const fieldType = resolveTypeReference(field);
  if (fieldType === undefined || typeof fieldType === 'string')
    return undefined;
  if (fieldType.kind !== 'signature' && fieldType.kind !== 'intersection')
    return undefined;
  // A signature that names none of its parameters (the type inferred for an
  // unannotated function, `(unknown, unknown) -> number`) gives no names to
  // match: the call reports `argument-names-unavailable`, as it did before,
  // rather than `argument-name-unknown` for every name written.
  const arms = fieldType.kind === 'signature' ? [fieldType] : fieldType.types;
  const named = arms.some(
    (arm) =>
      typeof arm === 'object' &&
      arm.kind === 'signature' &&
      [...(arm.args ?? []), ...(arm.optArgs ?? [])].some(
        (a) => a.name !== undefined
      )
  );
  return named ? fieldType : undefined;
}
