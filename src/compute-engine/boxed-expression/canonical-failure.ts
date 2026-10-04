/**
 * The exception that a `canonical` handler threw, kept with the expression
 * that the engine boxed in place of the canonical one.
 *
 * When a `canonical` handler throws, `applyOperatorDefinition()` (`box.ts`)
 * logs the exception and returns the expression in a NON-canonical form. That
 * expression has no scope and no bindings. A caller that needs the canonical
 * form, and that cannot continue without it, reads the exception here and
 * throws it again, so that its own caller gets the original message and not
 * a later failure on the missing scope. The `Function` literal does this for
 * its body `Block` (`canonicalFunctionLiteralArguments()`,
 * `function-utils.ts`).
 *
 * The map holds the expression weakly: the record goes away with the
 * expression.
 */
const CANONICAL_FAILURES = new WeakMap<object, { error: unknown }>();

/** Keep `error`, the exception of a `canonical` handler, with `expr`, the
 * non-canonical expression boxed in place of the canonical one. */
export function recordCanonicalFailure(expr: object, error: unknown): void {
  CANONICAL_FAILURES.set(expr, { error });
}

/** The exception kept with `expr` by `recordCanonicalFailure()`, or
 * `undefined` when there is none. The value is in a record, so that a thrown
 * `undefined` is not confused with no exception. */
export function canonicalFailureOf(
  expr: object
): { error: unknown } | undefined {
  return CANONICAL_FAILURES.get(expr);
}
