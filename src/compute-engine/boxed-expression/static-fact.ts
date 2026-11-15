import type { Expression } from '../global-types.js';
import {
  isFunction,
  isSymbol,
  resolvedValueDefinition,
} from './type-guards.js';
import { withHiddenValues } from './hidden-values.js';

/**
 * `pred(x)`, read from what an assignment cannot change: the declared types
 * and the assumptions of the variables of `x`, not the values they hold. A
 * canonical rewrite that decides a form from such a fact (an integer
 * exponent, a base that is not negative) stays right after a later
 * assignment (CE-1280, D16 of `docs/plans/2026-11-11-bound-once-spec.md`).
 *
 * A variable that is not a constant and has a stored value is read with
 * that value hidden (the value shield, under a cache key of its own, so no
 * type or sign cached from the value is served). A variable whose type was
 * inferred, and a constant whose value reads a variable, give no answer:
 * `undefined`. A name that was free when it was boxed is read through the
 * definition it resolves to. A shield only takes knowledge away, so an
 * undecided plain read is the answer, with no walk.
 */
export function staticFact(
  x: Expression,
  pred: (x: Expression) => boolean | undefined
): boolean | undefined {
  const plain = pred(x);
  if (plain === undefined) return undefined;
  const held: object[] = [];
  if (!collectHeld(x, held)) return undefined;
  if (held.length === 0) return plain;
  return withHiddenValues(held, () =>
    x.engine._withValueShieldKey(() => pred(x))
  );
}

/** True when `pred(x)` is true from what an assignment cannot change. A
 * plain read that is not true costs nothing more: a shield only takes
 * knowledge away. */
export function staticallyTrue(
  x: Expression,
  pred: (x: Expression) => boolean | undefined
): boolean {
  return pred(x) === true && staticFact(x, pred) === true;
}

/** Push the definitions of the variables of `x` that hold a stored value
 * and are not constants. False when one of them gives no fact: a type
 * inferred (an inferred type widens at the next assignment, and is no
 * promise), or a constant whose value has unknowns. */
function collectHeld(x: Expression, held: object[]): boolean {
  if (isSymbol(x)) {
    const def = resolvedValueDefinition(x);
    if (!def) return true;
    // The stored value only: no value computed again from the declaration,
    // no assumed value (`_presentValue`, `boxed-value-definition.ts`).
    const stored = (def as { _presentValue?: Expression })._presentValue;
    if (def.isConstant) return !stored || !readsVariable(stored);
    // `declaredType`: the type with no assumption merged in.
    if (def.inferredType && !def.declaredType.isUnknown) return false;
    if (stored !== undefined) held.push(def);
    return true;
  }
  return !isFunction(x) || x.ops.every((op) => collectHeld(op, held));
}

/** True when `x` reads a variable: a symbol whose definition is not a
 * constant. */
function readsVariable(x: Expression): boolean {
  if (isSymbol(x)) {
    const def = resolvedValueDefinition(x);
    return def !== undefined && !def.isConstant;
  }
  return isFunction(x) && x.ops.some(readsVariable);
}
