/**
 * Provenance registry for the shadows created by `devolveUnappliedOperator`
 * (`validate.ts`).
 *
 * The un-applied-operator repair declares a shadow binding for a bare
 * single-uppercase-letter symbol bound to a standard-library operator (`N`,
 * `D`) used where a value is required. A LATER operand of the same expression
 * may still carry the stale operator binding, so the repair has to recognize
 * the shadow it just created and rebind to it. Recognizing "any value
 * definition in a non-root scope" instead was a soundness hole: every
 * user-declared single-uppercase symbol (`ce.declare('V', 'tuple<…>')`) then
 * took that branch and skipped its declared-type check at call boundaries.
 *
 * This module has no imports on purpose: both `validate.ts` and `overload.ts`
 * consult it, and `validate.ts` already imports `overload.ts` (so the registry
 * cannot live in either).
 */

/** The tagged definition objects created by the devolve repair. */
const DEVOLVED_SHADOWS = new WeakSet<object>();

/** Record `def` as a binding created by the devolve repair. */
export function markDevolvedShadow(def: object): void {
  DEVOLVED_SHADOWS.add(def);
}

/** Whether `def` was created by the devolve repair. */
export function isDevolvedShadow(def: object | undefined): boolean {
  return def !== undefined && DEVOLVED_SHADOWS.has(def);
}
