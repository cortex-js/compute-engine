import type { BoxedValueDefinition, Expression } from '../global-types.js';
import { isDictionary, isFunction, isString, isSymbol } from './type-guards.js';

// Reads of a field of a CONSTANT dictionary. They are in a module of their
// own, with no dependency on the boxing code, because both the boxing of a
// call (`field-callee.ts`) and the type of a call (`boxed-function.ts`) use
// them.

/** The `Function` literal that `callee` reads, when `callee` is a canonical
 * `Field(⟨symbol⟩, ⟨string⟩)` whose receiver is bound to a CONSTANT whose
 * value is a dictionary, and the field holds a `Function` literal. Else
 * `undefined`.
 *
 * A positional call through such a field keeps its `Field` callee
 * (`resolveFieldCallee`), but its value is the value of the literal applied
 * to the arguments, which maps over a collection argument. The type of
 * `Apply` reads this literal in place of the `Field`, so that the call is
 * typed as the same call of the inline literal: `lib.D([1, 2])` with a field
 * `D` that holds `(x: real) ↦ 7` is typed as a list, as its value `[7, 7]`
 * is. */
export function constantFieldLiteral(
  callee: Expression
): Expression | undefined {
  if (!isFunction(callee, 'Field') || callee.nops !== 2) return undefined;
  const [base, member] = callee.ops;
  if (!isSymbol(base) || !isString(member)) return undefined;
  const def = base.valueDefinition;
  if (def === undefined) return undefined;
  const stored = constantFieldValue(def, member.string);
  return stored !== undefined && isFunction(stored, 'Function')
    ? stored
    : undefined;
}

/** The value stored in the field `member` of a CONSTANT receiver whose value
 * is a dictionary (or a record, which is a dictionary value), or `undefined`.
 * An `object` value is not read: its fields can be changed even when the
 * binding that holds it cannot. */
export function constantFieldValue(
  def: BoxedValueDefinition,
  member: string
): Expression | undefined {
  if (!def.isConstant) return undefined;
  const value = def.value;
  if (!isDictionary(value)) return undefined;
  return value.get(member);
}
