import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isSymbol } from './type-guards.js';

/**
 * Producer-side chokepoint for a conditional value (conditional-values design,
 * decision 7). Resolves a *decidable* guard against evaluation + the assumption
 * store:
 *   - guard evaluates to `True`  → the bare `value` (guard discharged);
 *   - guard evaluates to `False` → `null` (the caller prunes / declines — the
 *     solution-set pruning contract, decision 8);
 *   - otherwise (undecidable)    → `When(value, guard)`, retained until the
 *     guard becomes decidable.
 *
 * A single chokepoint enforces "emit `When` only when genuinely undecidable" in
 * one place. Every `When`-producer (Solve validity conditions, Sum/Integrate
 * convergence conditions) routes through here, so decidable guards keep the
 * pre-conditional behavior exactly.
 */
export function conditionalValue(
  ce: ComputeEngine,
  value: Expression,
  guard: Expression
): Expression | null {
  const g = guard.evaluate();
  if (isSymbol(g, 'True')) return value;
  if (isSymbol(g, 'False')) return null;
  return ce.function('When', [value, g]);
}
