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

/** The bindings for which `isFirstValue()` was called. */
const FIRST_VALUE_SEEN = new WeakSet<object>();
/** The bindings whose first value had the type `unknown` when
 * `isFirstValue()` was called for it. */
const UNKNOWN_FIRST_VALUES = new WeakSet<object>();
/** The bindings that `markOpenLocal()` recorded. */
const OPEN_LOCALS = new WeakSet<object>();

/**
 * Whether this is the first call for the block local `target`. The first
 * value that the canonicalization of a block records for a local is its
 * declaration (`Declare(q, "unknown", t)` or a first `Assign(q, t)`).
 * `valueIsUnknown` tells whether the type of that value is `unknown` now
 * (`hasUnknownFirstValue()`).
 */
export function isFirstValue(target: object, valueIsUnknown: boolean): boolean {
  if (FIRST_VALUE_SEEN.has(target)) return false;
  FIRST_VALUE_SEEN.add(target);
  if (valueIsUnknown) UNKNOWN_FIRST_VALUES.add(target);
  return true;
}

/**
 * Whether the first value of the block local `target` had the type
 * `unknown` when it was canonicalized. A later assignment to such a local
 * is not checked against the type of the local (`assignment-type-mismatch`):
 * the local can hold a value of any type.
 */
export function hasUnknownFirstValue(target: object): boolean {
  return UNKNOWN_FIRST_VALUES.has(target);
}

/**
 * Record that the first value of the block local `target` has the type
 * `unknown` when the types of the block are settled. The local is then
 * OPEN: its type is `unknown`, and a later assignment does not narrow it
 * (`isOpenLocal()`). Without this, the join ignores the first value (a
 * value of type `unknown` is no evidence) and the type of the local is the
 * type of the later values only: after `q := t` and `q := [2, 3]` in a
 * branch, `q` was typed `vector<integer^2>`, although it holds the scalar
 * `t` when the branch does not run.
 */
export function markOpenLocal(target: object): void {
  OPEN_LOCALS.add(target);
}

/** Whether `markOpenLocal()` recorded the block local `target`. */
export function isOpenLocal(target: object): boolean {
  return OPEN_LOCALS.has(target);
}

/**
 * For each block scope, the binding that the canonicalization of the block
 * made for each of its locals, by name. The first run of the block removes
 * these bindings from the scope (`sweepCanonicalizationBindings`,
 * `library/control-structures.ts`), and each run makes its own bindings,
 * which stay in the scope after the run. The type of the canonical binding
 * is the static type of the local: the join of the types of its initializer
 * and of every assignment to it in the block (`joinAssignmentEvidence`,
 * `library/core.ts`).
 *
 * The `Declare` handler reads it (`canonicalLocalType()`) to give the
 * binding of a run the static type of the local, not the type of the value
 * of the run. The block scope is shared by every copy of the block (a copy
 * made by `subs()` keeps the scope), and the compiler reads the type of a
 * local from the binding in that scope (`localComplexDefault`,
 * `compilation/compile-complexness.ts`). If the binding of a run took the
 * type of its value, then with `x: real` and
 * `e = Block(Declare(k, "unknown", Sqrt(x)), k + 1)`, a run of
 * `e.subs({x: 4})` would give `k` the type `integer`, and the compiled code
 * of `e` in the mode `complex` would put `k` on the real lane and give `NaN`
 * at `x = -4`, where the interpreter gives `1 + 2i`.
 */
const CANONICAL_LOCALS = new WeakMap<object, Map<string, object>>();

/**
 * Record that `def` is the binding that the canonicalization of the block
 * with the scope `scope` made for the name `name`.
 */
export function recordCanonicalLocal(
  scope: object,
  name: string,
  def: object
): void {
  let byName = CANONICAL_LOCALS.get(scope);
  if (byName === undefined) {
    byName = new Map();
    CANONICAL_LOCALS.set(scope, byName);
  }
  byName.set(name, def);
}

/**
 * The binding that `recordCanonicalLocal()` recorded for `name` in the
 * block scope `scope`, or `undefined`.
 */
export function canonicalLocalOf(
  scope: object,
  name: string
): object | undefined {
  return CANONICAL_LOCALS.get(scope)?.get(name);
}
