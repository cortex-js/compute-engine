/**
 * A hook that the value definition of a symbol calls when it stores a value
 * (`boxed-value-definition.ts`). `residue-class.ts` installs the function
 * that records an engine in which a symbol value holds a residue class
 * (`noteResidueClassValue()`). The hook is a separate module with no
 * imports, so that the value definition does not import `residue-class.ts`,
 * which would make a cycle of imports through `numerics.ts`.
 */

let hook: ((ce: object, value: unknown) => void) | undefined;

/** Install the function that `noteSymbolValue()` calls. */
export function setSymbolValueHook(
  f: (ce: object, value: unknown) => void
): void {
  hook = f;
}

/** A symbol of `ce` now has the value `value`. */
export function noteSymbolValue(ce: object, value: unknown): void {
  hook?.(ce, value);
}
