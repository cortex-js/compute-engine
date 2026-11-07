import type { Expression, RuleStep } from '../global-types.js';

/**
 * The function that gives the closed form of a `Sum` or a `Product` for
 * `simplify()`, or `undefined` before the library registers it. The closed
 * forms are those of the exact `evaluate()` (`bigOpClosedForm()` in
 * `library/utils.ts`). They are in the library, and `symbolic/` does not
 * import from `library/`, so the library registers the function when it
 * loads.
 */
let closedFormHook: ((x: Expression) => Expression | undefined) | undefined;

/** Register the function that gives the closed form of a `Sum` or a
 * `Product` for `simplify()`. Called once by the arithmetic library. */
export function registerBigOpClosedForm(
  f: (x: Expression) => Expression | undefined
): void {
  closedFormHook = f;
}

/**
 * The simplification step that replaces the `Sum` or `Product` `x` with its
 * closed form, or `undefined` when no closed form applies. The step is
 * exempt from the cost comparison of `simplify()` (`purpose: 'transform'`):
 * a closed form is preferred to the sum or product even when it is larger.
 */
export function bigOpClosedFormStep(x: Expression): RuleStep | undefined {
  const value = closedFormHook?.(x);
  if (value === undefined) return undefined;
  const kind = x.operator === 'Sum' ? 'sum' : 'product';
  return { value, because: `closed form of a ${kind}`, purpose: 'transform' };
}
