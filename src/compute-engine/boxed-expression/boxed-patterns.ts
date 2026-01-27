import { _BoxedExpression } from './abstract-boxed-expression';
import type { BoxedSymbol } from './boxed-symbol';
import type { BoxedExpression } from '../global-types';

export function isWildcard(expr: BoxedExpression): expr is BoxedSymbol {
  return (
    expr.symbol?.startsWith('_') ??
    (expr.operator === 'Wildcard' ||
      expr.operator === 'WildcardSequence' ||
      expr.operator === 'WildcardOptionalSequence')
  );
}

/**
 * Return the string representing this wildcard, including any optional (one-character) name, or
 * `null` if not a wildcard expression.
 *
 * @export
 * @param expr
 * @returns
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
 *
 * <!--
 * @todo:
 * - Utilize moreso (e.g. ./match.ts)
 * - 'Wildcard' -> 'Universal', for clarity...?
 * -->
 *
 * @export
 * @param expr
 * @returns
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
