import { _BoxedExpression } from './abstract-boxed-expression';
import type { BoxedSymbol } from './boxed-symbol';
import { BoxedExpression } from './public';

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
