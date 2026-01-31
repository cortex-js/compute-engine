/**
 * Utilities for declarative sequence definitions.
 *
 * This module provides functions to create subscriptEvaluate handlers
 * from sequence definitions (base cases + recurrence relation).
 */

import type {
  BoxedExpression,
  ComputeEngine,
  SequenceDefinition,
} from './global-types';

/**
 * Create a subscriptEvaluate handler from a sequence definition.
 *
 * The handler evaluates expressions like `F_{10}` by:
 * 1. Checking base cases first
 * 2. Looking up memoized values
 * 3. Recursively evaluating the recurrence relation
 */
export function createSequenceHandler(
  ce: ComputeEngine,
  _name: string,
  def: SequenceDefinition
): (
  subscript: BoxedExpression,
  options: { engine: ComputeEngine; numericApproximation?: boolean }
) => BoxedExpression | undefined {
  const variable = def.variable ?? 'n';
  const memoize = def.memoize ?? true;
  const memo = memoize ? new Map<number, BoxedExpression>() : null;
  const domain = def.domain ?? {};

  // Parse recurrence if string
  const recurrence =
    typeof def.recurrence === 'string'
      ? ce.parse(def.recurrence)
      : def.recurrence;

  // Box base cases
  const base = new Map<number, BoxedExpression>();
  for (const [k, v] of Object.entries(def.base)) {
    const index = Number(k);
    base.set(index, typeof v === 'number' ? ce.number(v) : v);
  }

  return (subscript, { engine, numericApproximation }) => {
    const n = subscript.re;

    // Must be an integer
    if (!Number.isInteger(n)) return undefined;

    // Check domain constraints
    if (domain.min !== undefined && n < domain.min) return undefined;
    if (domain.max !== undefined && n > domain.max) return undefined;

    // Check base cases
    if (base.has(n)) return base.get(n)!;

    // Check memo
    if (memo?.has(n)) return memo.get(n)!;

    // Evaluate recurrence by substituting n
    const substituted = recurrence.subs({ [variable]: engine.number(n) });
    const result = numericApproximation
      ? substituted.N()
      : substituted.evaluate();

    // Memoize valid numeric results
    if (memo && result.isNumberLiteral) {
      memo.set(n, result);
    }

    return result.isNumberLiteral ? result : undefined;
  };
}

/**
 * Validate a sequence definition.
 */
export function validateSequenceDefinition(
  ce: ComputeEngine,
  name: string,
  def: SequenceDefinition
): { valid: boolean; error?: string } {
  // Must have base cases
  if (!def.base || Object.keys(def.base).length === 0) {
    return {
      valid: false,
      error: `Sequence "${name}" requires at least one base case`,
    };
  }

  // Must have recurrence
  if (!def.recurrence) {
    return {
      valid: false,
      error: `Sequence "${name}" requires a recurrence relation`,
    };
  }

  // Parse recurrence to check validity
  const recurrence =
    typeof def.recurrence === 'string'
      ? ce.parse(def.recurrence)
      : def.recurrence;

  if (!recurrence.isValid) {
    return {
      valid: false,
      error: `Invalid recurrence for "${name}": expression contains errors`,
    };
  }

  return { valid: true };
}
