import type { Expression } from '../global-types.js';
import { rewriteAngularUnit } from './angular-unit.js';

/** Resolve a derivative without changing the caller's declarations. */
export function derivativeClosedForm(
  operator: 'D' | 'Derivative' | 'ND',
  args: ReadonlyArray<Expression>
): Expression | undefined {
  const ce = args[0]?.engine;
  if (ce === undefined) return undefined;
  ce.pushScope();
  try {
    const node = ce.function(operator, args as Expression[]);
    if (!node.isPure) return undefined;
    const value = node.evaluate();
    if (!value.isValid || value.isSame(node)) return undefined;
    if (
      ['D', 'Derivative', 'ND'].some((h) => value.getSubexpressions(h).length)
    )
      return undefined;
    // Differentiation uses the engine's angular convention; emitted kernels
    // use radians, including for the new trigonometric nodes in this result.
    return rewriteAngularUnit(value);
  } catch {
    return undefined;
  } finally {
    ce.popScope();
  }
}
