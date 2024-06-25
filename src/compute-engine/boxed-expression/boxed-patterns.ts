import { _BoxedExpression } from './abstract-boxed-expression';
import type { BoxedSymbol } from './boxed-symbol';
import { BoxedExpression } from './public';

export function isWildcard(expr: BoxedExpression): expr is BoxedSymbol {
  return (
    expr.symbol?.startsWith('_') ??
    (expr.head === 'Wildcard' ||
      expr.head === 'WildcardSequence' ||
      expr.head === 'WildcardOptionalSequence')
  );
}

export function wildcardName(expr: BoxedExpression): string | null {
  if (expr.symbol?.startsWith('_')) return expr.symbol;

  if (expr.nops === 1) {
    const arg = expr.op1;
    if (expr.head === 'Wildcard') return `_${arg}`;
    if (expr.head === 'WildcardSequence') return `__${arg}`;
    if (expr.head === 'WildcardOptionalSequence') return `___${arg}`;
  }

  if (expr.head === 'Wildcard') return '_';
  if (expr.head === 'WildcardSequence') return '__';
  if (expr.head === 'WildcardOptionalSequence') return '___';

  return null;
}
