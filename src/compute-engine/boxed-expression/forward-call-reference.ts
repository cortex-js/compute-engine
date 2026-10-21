import type { BoxedDefinition, BoxedValueDefinition } from '../global-types.js';

// An unresolved call head is a name to resolve later, not a lexical function
// value. Parameter adoption removes this provenance from the shared binding.
const references = new WeakSet<BoxedValueDefinition>();
export function markForwardCallReference(def: BoxedDefinition): void {
  if ('value' in def) references.add(def.value);
}
export function clearForwardCallReference(def: BoxedDefinition): void {
  if ('value' in def) references.delete(def.value);
}
export function isForwardCallReference(def: BoxedValueDefinition): boolean {
  return references.has(def) && def.value === undefined;
}
