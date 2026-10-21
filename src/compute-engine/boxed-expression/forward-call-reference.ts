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

// The value definitions that `ce.parse()` declares for the facts that its
// `resolveSymbol` callback gave (the type of a name, not its value), each
// with the scope that holds it. That scope belongs to the parsed expression,
// and its parent is the scope of the `parse()` call. A fact states a type;
// it does not define the name, so a call of the name reads the definition
// that the parent chain holds when the call is evaluated
// (`callableBindingInContext`, `binders.ts`).
const externalFacts = new WeakMap<BoxedValueDefinition, Scope>();
export function markExternalFact(def: BoxedDefinition, scope: Scope): void {
  if ('value' in def) externalFacts.set(def.value, scope);
}
export function externalFactScope(
  def: BoxedValueDefinition
): Scope | undefined {
  return def.value === undefined ? externalFacts.get(def) : undefined;
}

// The empty value definitions that `ce.undeclare()` puts in the binding
// records it removes, each with the scope the record was removed from. An
// expression boxed before the call holds such a record. A call of it reads
// the definition that this scope, or a scope that encloses it, holds when
// the call is evaluated (`callableBindingInContext`, `binders.ts`).
const retiredBindings = new WeakMap<BoxedValueDefinition, Scope>();
export function markRetiredBinding(def: BoxedDefinition, scope: Scope): void {
  if ('value' in def) retiredBindings.set(def.value, scope);
}
export function retiredBindingScope(
  def: BoxedValueDefinition
): Scope | undefined {
  return def.value === undefined ? retiredBindings.get(def) : undefined;
}
