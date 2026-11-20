import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { rewriteAngularUnit } from '../symbolic/angular-unit.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';

/** The number of nested `Derivative` residues that a closed form can hold
 * (see `derivativeClosedForm()`). */
const MAX_RESIDUE_DEPTH = 4;

/** Resolve a derivative without changing the caller's declarations.
 * `options` is passed to the angular-unit rewrite of the result
 * (`rewriteAngularUnit()`): the interval target asks for exact factors.
 *
 * A result can hold the `Derivative` of another function, as the evaluation
 * of `Derivative` lifts it into the function literal: for `F := t ↦ f′(t)`
 * with `f` a function literal, the derivative of `F` holds
 * `Apply(Derivative(f, 2), t)`. Such a residue is accepted when it is the
 * derivative of a symbol other than the function of a `Derivative` request
 * and has a closed form itself: the lowering compiles its application from
 * that closed form. A residue of `D` or `ND`, or one with no closed form,
 * gives no closed form. */
export function derivativeClosedForm(
  operator: 'D' | 'Derivative' | 'ND',
  args: ReadonlyArray<Expression>,
  options?: { exactFactors?: boolean },
  depth = MAX_RESIDUE_DEPTH
): Expression | undefined {
  const ce = args[0]?.engine;
  if (ce === undefined) return undefined;
  ce.pushScope();
  try {
    const node = ce.function(operator, args as Expression[]);
    if (!node.isPure) return undefined;
    const value = node.evaluate();
    if (!value.isValid || value.isSame(node)) return undefined;
    if (['D', 'ND'].some((h) => value.getSubexpressions(h).length))
      return undefined;
    const own = operator === 'Derivative' ? args[0] : undefined;
    const checked: Expression[] = [];
    for (const d of value.getSubexpressions('Derivative')) {
      if (checked.some((x) => x.isSame(d))) continue;
      checked.push(d);
      if (
        depth === 0 ||
        !isFunction(d) ||
        !isSymbol(d.op1) ||
        (own !== undefined && d.op1.isSame(own)) ||
        derivativeClosedForm('Derivative', d.ops, options, depth - 1) ===
          undefined
      )
        return undefined;
    }
    // Differentiation uses the engine's angular convention; emitted kernels
    // use radians, including for the new trigonometric nodes in this result.
    return rewriteAngularUnit(value, options);
  } catch (e) {
    // A caller's timeout, an abort or an iteration limit propagates; only an
    // ordinary evaluation error means "no closed form".
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return undefined;
  } finally {
    ce.popScope();
  }
}
