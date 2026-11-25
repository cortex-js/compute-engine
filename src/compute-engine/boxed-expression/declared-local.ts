import type { Type } from '../../common/type/types.js';
import {
  beforeDefinitionWrite,
  registerDefinitionSideTable,
} from './definition-restore-point.js';

/** Sequence locals whose types cannot be narrowed by a use. */
const DECLARED_LOCALS = new WeakSet<object>();

/** Record that the block-local binding `def` has a declared type. */
export function markDeclaredLocal(def: object): void {
  DECLARED_LOCALS.add(def);
}

/** Whether the block-local binding `def` has a declared type. */
export function isDeclaredLocal(def: object): boolean {
  return DECLARED_LOCALS.has(def);
}

/**
 * The block locals that hold one function literal for the whole block, and
 * the signature of that literal once its `Declare` is canonical.
 *
 * Such a local has one `let` with a function literal as its value and no
 * type (`let h = (x, y) => x - y`), and no `Assign` of the block writes it.
 * Its type is `function` (`initializeLocalContract()`), which gives no
 * parameter names. Because no statement gives it another function, a named
 * call of it (`h(y: 2, x: 10)`) is matched against the parameter names of the
 * literal (`valueCalleeSignature()`). The value of the map is `undefined`
 * until the `Declare` is canonical. A restore point puts an entry back with
 * its definition.
 */
const SINGLE_FUNCTION_LOCALS = new WeakMap<object, Type | undefined>();
registerDefinitionSideTable(SINGLE_FUNCTION_LOCALS);

/** Record that the block local `def` holds one function literal for the
 * whole block (see `SINGLE_FUNCTION_LOCALS`). */
export function markSingleFunctionLocal(def: object): void {
  beforeDefinitionWrite(def);
  SINGLE_FUNCTION_LOCALS.set(def, undefined);
}

/** Record `signature`, the type of the function literal of the local `def`,
 * when `markSingleFunctionLocal()` marked `def`. */
export function recordSingleFunctionSignature(
  def: object,
  signature: Type
): void {
  if (!SINGLE_FUNCTION_LOCALS.has(def)) return;
  beforeDefinitionWrite(def);
  SINGLE_FUNCTION_LOCALS.set(def, signature);
}

/** The signature that `recordSingleFunctionSignature()` recorded for `def`,
 * or `undefined`. */
export function singleFunctionSignature(def: object): Type | undefined {
  return SINGLE_FUNCTION_LOCALS.get(def);
}

/**
 * The value definitions with which the engine binds a local: a function
 * argument, a captured index of a closure, or the value of a `Declare`
 * statement that is not subject to the default-`!scope` ceiling.
 *
 * `ce.declare(id, { value: literal })` refuses a function literal that writes
 * outside itself and states no effects (`docs/EFFECTS-MODEL.md`, "Scope is
 * opt-in"), because a host or a program names that definition. A local is not
 * such a definition: an argument can be a writer closure, and a closure can
 * change a local of its enclosing block. The scope of the declaration does not
 * show which case applies, because a host can also declare in a nested scope.
 * So the engine marks the definition object that it passes to `ce.declare()`.
 * A weak set keeps no definition alive.
 */
const LOCAL_BINDING_DEFINITIONS = new WeakSet<object>();

/** Record that `def` binds a local, and return it: the declaration of `def`
 * does not enforce the default-`!scope` ceiling. */
export function markLocalBinding<T extends object>(def: T): T {
  LOCAL_BINDING_DEFINITIONS.add(def);
  return def;
}

/** Whether `def` was given to `markLocalBinding()`. */
export function isLocalBinding(def: object): boolean {
  return LOCAL_BINDING_DEFINITIONS.has(def);
}

/** The bindings that `markAssignedLocal()` recorded. */
const ASSIGNED_LOCALS = new WeakSet<object>();
registerDefinitionSideTable(ASSIGNED_LOCALS);

/** Record that an `Assign` writes the binding `target`: an `Assign` to
 * the name was canonicalized against it, at any depth of the block that
 * declares it (a loop body, a nested function). */
export function markAssignedLocal(target: object): void {
  beforeDefinitionWrite(target);
  ASSIGNED_LOCALS.add(target);
}

/** Whether `markAssignedLocal()` recorded `target`. */
export function isAssignedLocal(target: object): boolean {
  return ASSIGNED_LOCALS.has(target);
}
