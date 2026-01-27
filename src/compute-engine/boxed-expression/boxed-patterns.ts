/**
 * # Pattern Matching Wildcards
 *
 * Patterns can contain wildcards that match parts of expressions. There are
 * three types of wildcards:
 *
 * ## Universal Wildcard (`_` or `_name`)
 * Matches exactly **one** expression element.
 *
 * - `_` - Anonymous wildcard (matches one element, not captured)
 * - `_a`, `_x`, `_foo` - Named wildcard (matches one element, captured in substitution)
 *
 * **Examples:**
 * - Pattern `['Add', '_a', 1]` matches `['Add', 'x', 1]` with `{_a: 'x'}`
 * - Pattern `['Add', '_', '_']` matches any binary Add expression
 *
 * ## Sequence Wildcard (`__` or `__name`)
 * Matches **one or more** expression elements.
 *
 * - `__` - Anonymous sequence (matches 1+ elements, not captured)
 * - `__a`, `__args` - Named sequence (matches 1+ elements, captured as array)
 *
 * **Examples:**
 * - Pattern `['Add', '__a']` matches `['Add', 1, 2, 3]` with `{__a: [1, 2, 3]}`
 * - Pattern `['f', '__args']` captures all arguments of function f
 *
 * ## Optional Sequence Wildcard (`___` or `___name`)
 * Matches **zero or more** expression elements.
 *
 * - `___` - Anonymous optional sequence (matches 0+ elements, not captured)
 * - `___a`, `___rest` - Named optional sequence (matches 0+ elements, captured)
 *
 * **Examples:**
 * - Pattern `['Add', 1, '___rest']` matches `['Add', 1]` with `{___rest: []}`
 * - Pattern `['Add', 1, '___rest']` matches `['Add', 1, 2, 3]` with `{___rest: [2, 3]}`
 *
 * ## Validation Rules
 *
 * Consecutive multi-element wildcards (`__` or `___`) are **invalid** because
 * there's no way to determine where one ends and the next begins:
 *
 * - **Invalid:** `['Add', '__a', '__b']` - How to split elements between `__a` and `__b`?
 * - **Invalid:** `['Add', '___a', '___b']` - Same ambiguity
 * - **Invalid:** `['Add', '__a', '___b']` - Same ambiguity
 *
 * However, multi-element wildcards followed by universal wildcards are **valid**
 * because the single-element wildcard provides an anchor point:
 *
 * - **Valid:** `['Add', '__a', '_b']` - `_b` matches last element, `__a` gets the rest
 * - **Valid:** `['Add', '___a', '_b', '___c']` - `_b` anchors the middle
 *
 * Use `validatePattern()` to check patterns for these invalid combinations.
 *
 * @module boxed-patterns
 */

import { _BoxedExpression } from './abstract-boxed-expression';
import type { BoxedSymbol } from './boxed-symbol';
import type { BoxedExpression } from '../global-types';

/**
 * Check if an expression is a wildcard (universal, sequence, or optional sequence).
 *
 * @param expr - The expression to check
 * @returns `true` if the expression is any type of wildcard
 */
export function isWildcard(expr: BoxedExpression): expr is BoxedSymbol {
  return (
    expr.symbol?.startsWith('_') ??
    (expr.operator === 'Wildcard' ||
      expr.operator === 'WildcardSequence' ||
      expr.operator === 'WildcardOptionalSequence')
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
  if (expr.symbol?.startsWith('_')) return expr.symbol;

  if (expr.nops === 1) {
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

  if (expr.symbol !== null) {
    const symbol = expr.symbol!;
    if (!symbol.startsWith('_')) return null;
    if (!symbol.startsWith('__')) return 'Wildcard';
    return symbol.startsWith('___') ? 'OptionalSequence' : 'Sequence';
  }

  if (expr.isFunctionExpression) {
    if (expr.operator === 'Wildcard') return 'Wildcard';
    if (expr.operator === 'WildcardSequence') return 'Sequence';
    if (expr.operator === 'WildcardOptionalSequence') return 'OptionalSequence';
  }

  return null;
}

/**
 * Validate a pattern for invalid wildcard combinations.
 *
 * Throws an error if the pattern contains consecutive multi-element wildcards:
 * - Sequence (`__`) followed by Sequence (`__`) or OptionalSequence (`___`)
 * - OptionalSequence (`___`) followed by Sequence (`__`) or OptionalSequence (`___`)
 *
 * These patterns are ambiguous because there's no delimiter to determine where
 * one sequence ends and the next begins.
 *
 * Sequence or OptionalSequence followed by universal Wildcard (`_`) is allowed
 * because the single-element wildcard provides an anchor point.
 *
 * @param pattern - The pattern to validate
 * @throws Error if the pattern contains invalid wildcard combinations
 */
export function validatePattern(pattern: BoxedExpression): void {
  if (!pattern.ops) return;

  for (let i = 0; i < pattern.ops.length - 1; i++) {
    const current = pattern.ops[i];
    const next = pattern.ops[i + 1];

    if (!isWildcard(current)) continue;

    const currentType = wildcardType(current);
    if (currentType !== 'Sequence' && currentType !== 'OptionalSequence') continue;

    if (!isWildcard(next)) continue;

    const nextType = wildcardType(next);
    // Only flag consecutive multi-element wildcards (Sequence or OptionalSequence)
    // Universal Wildcard (_) is allowed as it provides an anchor point
    if (nextType === 'Sequence' || nextType === 'OptionalSequence') {
      const currentDesc = currentType === 'Sequence' ? 'sequence' : 'optional sequence';
      const nextDesc = nextType === 'Sequence' ? 'sequence' : 'optional sequence';
      throw new Error(
        `Invalid pattern: ${currentDesc} wildcard '${wildcardName(current)}' ` +
        `cannot be followed by ${nextDesc} wildcard '${wildcardName(next)}'`
      );
    }
  }

  // Recursively validate nested patterns
  for (const op of pattern.ops) {
    validatePattern(op);
  }
}
