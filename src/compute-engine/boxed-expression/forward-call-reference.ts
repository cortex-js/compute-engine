import type {
  BoxedDefinition,
  BoxedValueDefinition,
  Scope,
} from '../global-types.js';

// An unresolved call head is a name to resolve later, not a lexical function
// value. Parameter adoption removes this provenance from the shared binding.
const references = new WeakMap<BoxedValueDefinition, Scope>();
export function markForwardCallReference(
  def: BoxedDefinition,
  scope: Scope
): void {
  if ('value' in def) references.set(def.value, scope);
}
export function clearForwardCallReference(def: BoxedDefinition): void {
  if ('value' in def) references.delete(def.value);
}
export function isForwardCallReference(def: BoxedValueDefinition): boolean {
  return references.has(def) && def.value === undefined;
}

export function forwardCallScope(def: BoxedValueDefinition): Scope | undefined {
  return isForwardCallReference(def) ? references.get(def) : undefined;
}
