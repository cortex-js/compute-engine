import type { BoxedOperatorDefinition } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { resolveTypeAlias } from '../../common/type/utils.js';

// This module imports no module that evaluates or boxes an expression, so
// that a module that `boxed-function.ts` imports (`async-only-descendants.ts`)
// can read the callback parameters of an operator without an import cycle.

/** The result of {@link callbackSlots} for each definition, with the
 * `_writeVersion` of the definition when it was computed. A definition can
 * change in place (a signature write, an update, a snapshot restore), and
 * each change increases its `_writeVersion`, so a different version means
 * that the result must be computed again. */
const CALLBACK_SLOTS = new WeakMap<
  BoxedOperatorDefinition,
  { version: number; slots: readonly number[] }
>();

/**
 * The positions of the callback parameters of a lazy operator: the required
 * and optional parameters whose type is a signature, or a union of
 * signatures (`predicate: (T) -> boolean` of `Filter`, `mapping: (T) -> U` of
 * `Map`). These are the lazy collection operators (`Any`, `Filter`, `Map`,
 * `Reduce`, `MaxBy`, ...).
 *
 * A parameter typed with the bare type `function` is not a callback
 * parameter here: the operators that have one (`Integrate`, `Limit`, `ND`,
 * `Pipe`, `Rule`, ...) can read the operand as an expression, or bind a
 * symbol of that name. An operator that selects among its operands
 * (`selectsOperands`) or inspects errors (`inspectsErrors`) has no callback
 * parameter here either: it decides itself what an error operand gives.
 */
export function callbackSlots(def: BoxedOperatorDefinition): readonly number[] {
  const cached = CALLBACK_SLOTS.get(def);
  if (cached !== undefined && cached.version === def._writeVersion)
    return cached.slots;
  const found: number[] = [];
  const sig = def.signature.type;
  if (
    def.lazy === true &&
    !def.selectsOperands &&
    !def.inspectsErrors &&
    typeof sig !== 'string' &&
    sig.kind === 'signature'
  ) {
    const params = [...(sig.args ?? []), ...(sig.optArgs ?? [])];
    params.forEach((p, i) => {
      if (isSignatureParam(p.type)) found.push(i);
    });
  }
  CALLBACK_SLOTS.set(def, { version: def._writeVersion, slots: found });
  return found;
}

/** True when the parameter type `t` is a signature, or a union whose every
 * member is a signature. */
function isSignatureParam(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') return false;
  if (r.kind === 'signature') return true;
  return r.kind === 'union' && r.types.every((a) => isSignatureParam(a));
}
