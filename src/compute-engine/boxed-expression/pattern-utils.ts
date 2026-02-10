/**
 * Leaf module for wildcard pattern utility functions.
 *
 * These are extracted from boxed-patterns.ts to break circular dependencies:
 * boxed-tensor.ts and match.ts need these functions, but boxed-patterns.ts
 * has dependencies that create cycles through boxed-symbol.ts.
 */

import type { BoxedExpression } from '../global-types';
import { isFunction, isSymbol } from './type-guards';

/**
 * Check if an expression is a wildcard (universal, sequence, or optional sequence).
 *
 * @param expr - The expression to check
 * @returns `true` if the expression is any type of wildcard
 */
export function isWildcard(expr: BoxedExpression): boolean {
  return (
    (isSymbol(expr) && expr.symbol.startsWith('_')) ||
    expr.operator === 'Wildcard' ||
    expr.operator === 'WildcardSequence' ||
    expr.operator === 'WildcardOptionalSequence'
  );
}

/**
 * Get the string representation of a wildcard expression.
 *
 * Returns the wildcard symbol including its name (if any):
 * - `'_'` for anonymous universal wildcard
 * - `'_a'` for named universal wildcard
 * - `'__'` for anonymous sequence wildcard
 * - `'__args'` for named sequence wildcard
 * - `'___'` for anonymous optional sequence wildcard
 * - `'___rest'` for named optional sequence wildcard
 *
 * @param expr - The expression to get the wildcard name from
 * @returns The wildcard string, or `null` if not a wildcard
 */
export function wildcardName(expr: BoxedExpression): string | null {
  if (isSymbol(expr) && expr.symbol.startsWith('_')) return expr.symbol;

  if (isFunction(expr) && expr.nops === 1) {
    const arg = expr.op1;
    if (expr.operator === 'Wildcard') return `_${arg}`;
    if (expr.operator === 'WildcardSequence') return `__${arg}`;
    if (expr.operator === 'WildcardOptionalSequence') return `___${arg}`;
  }

  if (expr.operator === 'Wildcard') return '_';
  if (expr.operator === 'WildcardSequence') return '__';
  if (expr.operator === 'WildcardOptionalSequence') return '___';

  return null;
}

/**
 * Determine the type of wildcard.
 *
 * @param expr - A BoxedExpression or wildcard symbol string
 * @returns
 * - `'Wildcard'` - Universal wildcard (`_` or `_name`), matches exactly one element
 * - `'Sequence'` - Sequence wildcard (`__` or `__name`), matches one or more elements
 * - `'OptionalSequence'` - Optional sequence (`___` or `___name`), matches zero or more elements
 * - `null` - Not a wildcard
 */
export function wildcardType(
  expr: BoxedExpression | string
): 'Wildcard' | 'Sequence' | 'OptionalSequence' | null {
  if (typeof expr === 'string') {
    if (expr.startsWith('_')) {
      if (expr.startsWith('__')) {
        if (expr.startsWith('___')) return 'OptionalSequence';
        return 'Sequence';
      }
      return 'Wildcard';
    }
    return null;
  }

  if (isSymbol(expr)) {
    const symbol = expr.symbol;
    if (!symbol.startsWith('_')) return null;
    if (!symbol.startsWith('__')) return 'Wildcard';
    return symbol.startsWith('___') ? 'OptionalSequence' : 'Sequence';
  }

  if (isFunction(expr)) {
    if (expr.operator === 'Wildcard') return 'Wildcard';
    if (expr.operator === 'WildcardSequence') return 'Sequence';
    if (expr.operator === 'WildcardOptionalSequence') return 'OptionalSequence';
  }

  return null;
}
