/**
 * Whether a user binding shadows a standard-library name.
 *
 * A user binding shadows a library name, whichever spelling the name has
 * (user decision 2026-09-27; `src/epsil/docs/naming.md`, "User names and
 * shadowing"): `function Square(x) { x + 100 }` makes `Square(3)` call that
 * function, and a parameter named `Sqrt` is the argument inside its body.
 * Code that treats a head by its NAME rather than by its definition — the
 * canonical short path that folds `Square(3)` to `9`, a compilation target's
 * built-in lowering of `Sin` to `Math.sin` — must ask this first, or it
 * answers the library operator's value instead of the user's.
 *
 * A name the library does not define (no binding in the outermost, system,
 * scope) is never shadowed: a user function `Tick` shadows nothing. A
 * library name is shadowed when:
 *
 * - the definition the current scope resolves it to is not the one in the
 *   system scope, where the standard library is installed. This includes a
 *   definition of a library loaded with `ce.loadLibrary()`, which goes in
 *   the global scope;
 * - it is a parameter of a function body being canonicalized
 *   (`_isShadowedParameter`): the parameter is declared lazily, on its first
 *   reference, so the lookup can still find the library definition while the
 *   body is boxed;
 * - a caller-supplied library (the constructor's `libraries` option)
 *   defines it: such a library installs into the SAME system scope as the
 *   standard one, so the scope comparison cannot see it, and
 *   `_customLibraryOperators` records the names it replaced. Pass
 *   `customLibrary: false` to leave these out: a compilation target reads
 *   the custom definition's own lowering, so for the compiler a custom
 *   library is not a shadow.
 *
 * A definition installed by `ce.declare(name, patch, { extend: true })` from
 * the library definition is not a shadow when the patch, and every earlier
 * extension in its chain, kept the library's `evaluate`, `canonical`,
 * `compile` and `derivative`: the code that reads the library by name reads
 * exactly these parts, so it still gives the right answer
 * (`markLibraryExtension()`).
 *
 * For the same reason, a copy of the library definition is not a shadow
 * when it holds the library's own `evaluate`, `canonical`, `compile` and
 * `derivative` handlers, and the library's `lazy`, `broadcastable` and
 * `evaluateAsync` (`keepsLibraryOperator()`). A copy that replaces one of
 * the handlers is a shadow: the interpreter would compute something other
 * than the library rule. A copy that changes `lazy` or `broadcastable`
 * changes how the arguments are evaluated or compiled, and a copy with
 * another `evaluateAsync` computes another value under
 * `evaluateAsync()`, so these are shadows too. The same flags are required
 * of an extension. Only the definition of the same name in the system scope
 * is compared, so a copy declared under another name is never the library
 * operator.
 *
 * This module is a leaf: it takes the engine through the few members it
 * reads, so the boxing code and the compiler can both import it.
 */
export function shadowsLibraryName(
  ce: {
    lookupDefinition(name: string): unknown;
    readonly contextStack: ReadonlyArray<{
      readonly lexicalScope: {
        readonly bindings: { get(name: string): unknown };
      };
    }>;
    readonly _customLibraryOperators: ReadonlySet<string>;
    _isShadowedParameter(name: string): boolean;
  },
  name: string,
  options?: { customLibrary?: boolean }
): boolean {
  const library = ce.contextStack[0]?.lexicalScope.bindings.get(name);
  if (library === undefined) return false;
  if (options?.customLibrary !== false && ce._customLibraryOperators.has(name))
    return true;
  if (ce._isShadowedParameter(name)) return true;
  const current = ce.lookupDefinition(name);
  if (current === undefined || current === library) return false;
  const operator = (current as { operator?: object }).operator;
  const libraryOperator = (library as { operator?: object }).operator;
  if (operator === undefined || libraryOperator === undefined) return true;
  if (LIBRARY_EXTENSIONS.get(operator) === libraryOperator)
    return !keepsLibraryFlags(operator, libraryOperator);
  return !keepsLibraryOperator(operator, libraryOperator);
}

/**
 * The handlers of an operator definition that the code which reads the
 * library operator by name depends on: the canonical folds, the derivative
 * rules and the compiled lowering give the library result, so they are
 * correct for a definition only when it computes what the library computes.
 */
const LIBRARY_HANDLERS = [
  'evaluate',
  'canonical',
  'compile',
  'derivative',
] as const;

/**
 * True when the operator definition `operator` holds the same `evaluate`,
 * `canonical`, `compile` and `derivative` handlers as the library operator
 * definition `libraryOperator` (the same function objects, or both absent),
 * and the same `lazy`, `broadcastable` and `evaluateAsync`
 * (`keepsLibraryFlags()`). This is the case of a copy of the library
 * definition, `ce.declare('Sqrt', { ...ce.lookupDefinition('Sqrt').operator
 * })`, and of a copy that changes only other fields, such as `description`
 * (user decision 2026-10-01). Such a copy is not a shadow.
 *
 * The handlers are compared by object identity. A copy built from the
 * definitions of another engine bundle (a plugin bundle re-bundles the
 * engine code, so its library handlers are other function objects) is a
 * user definition.
 */
export function keepsLibraryOperator(
  operator: object,
  libraryOperator: object
): boolean {
  const current = operator as Record<string, unknown>;
  const library = libraryOperator as Record<string, unknown>;
  return (
    LIBRARY_HANDLERS.every((key) => current[key] === library[key]) &&
    keepsLibraryFlags(operator, libraryOperator)
  );
}

/**
 * True when `operator` has the same `lazy` and `broadcastable` flags as the
 * library operator definition `libraryOperator`, and the same
 * `evaluateAsync` handler (the same function object, or both absent).
 * `lazy` decides whether the arguments are evaluated before the handler
 * sees them, `broadcastable` whether the operator is applied element by
 * element to a collection argument (by the interpreter and by the compiled
 * code), and `evaluateAsync` computes the value under `evaluateAsync()`. A
 * definition that changes one of these does not compute what the library
 * operator computes. The flags are compared as booleans, the values the
 * boxed definition reports (an absent flag is `false`).
 */
function keepsLibraryFlags(operator: object, libraryOperator: object): boolean {
  const current = operator as Record<string, unknown>;
  const library = libraryOperator as Record<string, unknown>;
  return (
    !!current.lazy === !!library.lazy &&
    !!current.broadcastable === !!library.broadcastable &&
    current.evaluateAsync === library.evaluateAsync
  );
}

/**
 * For an operator definition built by `ce.declare(name, patch,
 * { extend: true })`, the system-scope (library) operator definition that it
 * extends, directly or through earlier extensions. Only an extension that
 * kept the library's `evaluate`, `canonical`, `compile` and `derivative` is
 * recorded. A weak map, so that a definition that is no longer bound can be
 * collected, and so that no field is added to the definition object (a spread
 * of the definition does not copy the mark).
 */
const LIBRARY_EXTENSIONS = new WeakMap<object, object>();

/** Record that `extension` extends the library operator definition
 * `libraryOperator` (see {@link shadowsLibraryName}). */
export function markLibraryExtension(
  extension: object,
  libraryOperator: object
): void {
  LIBRARY_EXTENSIONS.set(extension, libraryOperator);
}

/** The library operator definition that `operator` extends, if it is an
 * extension recorded by {@link markLibraryExtension}. */
export function extendedLibraryOperator(operator: object): object | undefined {
  return LIBRARY_EXTENSIONS.get(operator);
}
