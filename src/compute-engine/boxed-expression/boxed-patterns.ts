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

import type { BoxedExpression } from '../global-types';

import { isWildcard, wildcardName, wildcardType } from './pattern-utils';
import { isBoxedFunction } from './type-guards';

// Re-export wildcard utilities from leaf module (no circular deps)
export { isWildcard, wildcardName, wildcardType };

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
  if (!isBoxedFunction(pattern)) return;

  for (let i = 0; i < pattern.ops.length - 1; i++) {
    const current = pattern.ops[i];
    const next = pattern.ops[i + 1];

    if (!isWildcard(current)) continue;

    const currentType = wildcardType(current);
    if (currentType !== 'Sequence' && currentType !== 'OptionalSequence')
      continue;

    if (!isWildcard(next)) continue;

    const nextType = wildcardType(next);
    // Only flag consecutive multi-element wildcards (Sequence or OptionalSequence)
    // Universal Wildcard (_) is allowed as it provides an anchor point
    if (nextType === 'Sequence' || nextType === 'OptionalSequence') {
      const currentDesc =
        currentType === 'Sequence' ? 'sequence' : 'optional sequence';
      const nextDesc =
        nextType === 'Sequence' ? 'sequence' : 'optional sequence';
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
