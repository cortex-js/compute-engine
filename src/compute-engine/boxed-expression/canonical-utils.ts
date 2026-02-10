import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types';

/**
 * Ensure all expressions in the array are in canonical form
 */
export function canonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  scope?: Scope
): ReadonlyArray<Expression> {
  // Avoid memory allocation if possible
  if (xs.every((x) => x.isCanonical)) return xs;

  return xs.map((x) => ce.box(x, { scope }));
}
