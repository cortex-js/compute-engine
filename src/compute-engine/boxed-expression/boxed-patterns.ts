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
 * @todo: Utilize (e.g. ./match.ts)
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
        if (expr.startsWith('___')) return 'Sequence';
        return 'OptionalSequence';
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
