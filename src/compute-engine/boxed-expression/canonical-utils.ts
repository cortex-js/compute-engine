import type {
  BoxedExpression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types';

/**
 * Ensure all expressions in the array are in canonical form
 */
export function canonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<BoxedExpression>,
  scope?: Scope
): ReadonlyArray<BoxedExpression> {
  // Avoid memory allocation if possible
  if (xs.every((x) => x.isCanonical)) return xs;

  return xs.map((x) => ce.box(x, { scope }));
}
