/**
 * The engines in which an operator definition of `Add` or `Multiply` without
 * the `commutative` flag was made, in any scope. For example
 * `ce.declare('Add', { commutative: false }, { extend: true })`, or a
 * declaration of `Multiply` in a nested scope.
 *
 * `sortOperands()` (`order.ts`) uses this set to skip a scope lookup on
 * every canonical `Add` and `Multiply`: for an engine that is not in the set,
 * the visible definitions of `Add` and `Multiply` are commutative, and the
 * library orderings apply. For an engine that is in the set, it looks up the
 * visible definition.
 *
 * An engine is never removed from the set. When the scope of such a
 * definition is popped, or when a checkpoint restore puts back the earlier
 * definition, the lookup gives the correct definition again, so the set only
 * has to show that a lookup can be necessary. It does not have to follow the
 * scopes or the checkpoints.
 *
 * This module has no imports, so that the operator definition and the
 * ordering code can both import it without a circular dependency.
 */
const enginesWithOrderedArithmetic = new WeakSet<object>();

/** Record a new or updated operator definition. Only a definition of `Add`
 * or `Multiply` without the `commutative` flag changes the record. */
export function noteArithmeticDefinition(
  engine: object,
  name: string,
  commutative: boolean
): void {
  if (!commutative && (name === 'Add' || name === 'Multiply'))
    enginesWithOrderedArithmetic.add(engine);
}

/** True if a definition of `Add` or `Multiply` without the `commutative`
 * flag was ever made in this engine, so the visible definition must be
 * looked up before the operands are sorted. */
export function mayHaveOrderedArithmetic(engine: object): boolean {
  return enginesWithOrderedArithmetic.has(engine);
}
