/**
 * The registry of the `canonical` handlers that the standard library gives to
 * the eleven arithmetic operators whose canonical form `makeNumericFunction`
 * (`box.ts`) also computes by name: `Add`, `Multiply`, `Negate`, `Square`,
 * `Sqrt`, `Exp`, `Ln`, `Log`, `Power`, `Root` and `Divide`.
 *
 * Each handler is registered with the name of the operator whose canonical
 * form it computes, and with the fields of that operator's library
 * definition that canonicalization depends on (`NumericCanonicalProfile`).
 * A definition that holds one of these handlers, has the same name and has
 * the same profile is the library definition or a copy of it (the "spread
 * the definition, change `evaluate`" idiom of `ce.declare()`), so the code
 * that reads a definition can tell such a copy from a definition the user
 * wrote:
 *
 * - `_BoxedOperatorDefinition._update` keeps the handler only on such a
 *   copy. On any other definition (another name, or a changed signature,
 *   `lazy` flag or `associative`/`commutative`/`idempotent`/`involution`
 *   flag) it removes the handler, so that definition uses its own flags and
 *   the generic boxing route, as a definition the user wrote does;
 * - `_update` accepts a kept handler together with the
 *   `associative`/`commutative`/`idempotent`/`involution` flags, because the
 *   handler itself does the flattening and the ordering that those flags ask
 *   for (it refuses a user handler with these flags);
 * - `makeNumericFunction` keeps its by-name route for a redeclared copy,
 *   so the copy gives the stock canonical form;
 * - the runtime conformance check of the evaluate route treats a definition
 *   with one of these handlers as a definition without a `canonical` handler,
 *   as it did before the library gave these operators a handler.
 *
 * The registration is a property of the handler function, keyed by a GLOBAL
 * symbol (`Symbol.for`). Not a module-level `WeakMap`, and not a class to
 * test with `instanceof`: each bundle that includes the engine code (the
 * UMD bundles, a plugin bundle) has its own copy of this module, so a
 * `WeakMap` or a class of one bundle does not recognize the handlers of the
 * library definitions of another bundle (`ComputeEngine.getStandardLibrary()`
 * of bundle A given to an engine of bundle B). `Symbol.for` returns the same
 * symbol in every bundle.
 *
 * This module is a leaf (no imports), so any module can read it without a
 * dependency cycle.
 */

const NUMERIC_CANONICAL = Symbol.for('cortex-js.numericCanonical');

/**
 * What the canonical form of a library arithmetic operator depends on: its
 * name, and the fields of its library definition that the boxing code reads
 * before or instead of the `canonical` handler.
 */
export type NumericCanonicalProfile = {
  /** The operator whose canonical form the handler computes */
  readonly name: string;
  /** The signature of the library definition, as written in it. `undefined`
   * until the library definition is recorded
   * (`recordNumericCanonicalDefinitions`). */
  signature?: unknown;
  lazy: boolean;
  associative: boolean;
  commutative: boolean;
  idempotent: boolean;
  involution: boolean;
};

/** Record `handler` as the library `canonical` handler of `name`. */
export function registerNumericCanonicalHandler<T extends object>(
  name: string,
  handler: T
): T {
  const profile: NumericCanonicalProfile = {
    name,
    lazy: false,
    associative: false,
    commutative: false,
    idempotent: false,
    involution: false,
  };
  Object.defineProperty(handler, NUMERIC_CANONICAL, { value: profile });
  return handler;
}

/**
 * Record the fields of each library definition in `table` that holds a
 * registered handler in the profile of that handler. Called once on the
 * library tables, before any engine boxes them.
 */
export function recordNumericCanonicalDefinitions(
  table: Readonly<Record<string, unknown>>
): void {
  for (const def of Object.values(table)) {
    if (typeof def !== 'object' || def === null) continue;
    const d = def as Record<string, unknown>;
    const profile = numericCanonicalProfile(d.canonical);
    if (profile === undefined) continue;
    profile.signature = d.signature;
    profile.lazy = d.lazy === true;
    profile.associative = d.associative === true;
    profile.commutative = d.commutative === true;
    profile.idempotent = d.idempotent === true;
    profile.involution = d.involution === true;
  }
}

/** The profile `handler` was registered with, or `undefined` when `handler`
 * is not one of the library numeric `canonical` handlers. */
export function numericCanonicalProfile(
  handler: unknown
): NumericCanonicalProfile | undefined {
  if (typeof handler !== 'function') return undefined;
  const profile = (handler as unknown as Record<symbol, unknown>)[
    NUMERIC_CANONICAL
  ];
  if (typeof profile !== 'object' || profile === null) return undefined;
  return profile as NumericCanonicalProfile;
}

/** The operator name `handler` was registered for, or `undefined` when
 * `handler` is not one of the library numeric `canonical` handlers. */
export function numericCanonicalHandlerName(
  handler: unknown
): string | undefined {
  return numericCanonicalProfile(handler)?.name;
}
