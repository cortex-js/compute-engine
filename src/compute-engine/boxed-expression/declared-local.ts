/**
 * The block locals whose hoisted binding carries a DECLARED type
 * (`Declare(v, "list<real>")`, `let v: list<real>`). The declared type is
 * the contract:
 * - a second read of an assignment's value type must not widen it:
 *   `joinAssignmentEvidence` (`library/core.ts`) registers no evidence site
 *   for them;
 * - a use must not narrow a local declared `any`: `BoxedSymbol._infer()`
 *   does not write a narrower type on it, and the generic solver reads it
 *   as an operand typed `any`, not as a symbol whose type is still to be
 *   inferred (`actualOfOperand()`, `generic-instantiation.ts`).
 *
 * The hoisted binding is marked `inferred` (the `Declare` evaluate handler
 * upgrades it in place), so this set is what tells it from a local whose
 * type the program does not state.
 */
const DECLARED_LOCALS = new WeakSet<object>();

/** Record that the block-local binding `def` has a declared type. */
export function markDeclaredLocal(def: object): void {
  DECLARED_LOCALS.add(def);
}

/** Whether the block-local binding `def` has a declared type. */
export function isDeclaredLocal(def: object): boolean {
  return DECLARED_LOCALS.has(def);
}
