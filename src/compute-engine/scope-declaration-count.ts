/**
 * A count of the declarations made in each scope.
 *
 * The result a declared function reports under its declared parameter types
 * (`resultUnderDeclaredParameters`, `boxed-expression/declared-parameter-result.ts`)
 * reads the symbols its body names, resolved from the scope where the
 * function was defined. A new declaration in that scope, or in one of its
 * ancestors, can change what a name resolves to: assigning `b := 1.5` to an
 * undeclared `b` declares it in the global scope, and `x ↦ b + x` then reads
 * a `real`. A declaration anywhere else cannot, and there are many of those:
 * every function literal declares its parameters in a scope of its own. So
 * the memo of that result keys on the declarations made in the scopes of one
 * chain (`scopeChainDeclarationCount`), not on the engine-wide cache
 * generation, which every declaration moves.
 *
 * The counts are kept outside the scope objects, in a `WeakMap`, so a scope
 * that is discarded takes its count with it.
 */

const counts = new WeakMap<object, number>();

/** Record one declaration in `scope`. */
export function noteScopeDeclaration(scope: object): void {
  counts.set(scope, (counts.get(scope) ?? 0) + 1);
}

/**
 * The number of declarations made in `scope` and in each of its ancestors.
 * The counts only increase, so the sum changes whenever one of them does.
 */
export function scopeChainDeclarationCount(
  scope: { parent: unknown } | null | undefined
): number {
  let total = 0;
  let s = scope;
  while (s) {
    total += counts.get(s) ?? 0;
    s = s.parent as { parent: unknown } | null | undefined;
  }
  return total;
}
