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
 *   system scope, where the standard library is installed;
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
  return current !== undefined && current !== library;
}
