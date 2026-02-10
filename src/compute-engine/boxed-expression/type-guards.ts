import type {
  BoxedExpression,
  DictionaryInterface,
  NumberLiteralInterface,
  SymbolInterface,
  FunctionInterface,
  StringInterface,
  TensorInterface,
  CollectionInterface,
  IndexedCollectionInterface,
} from '../global-types';

export function isBoxedExpression(x: unknown): x is BoxedExpression {
  const boxed = x as { _kind?: unknown } | null | undefined;
  return (
    boxed !== null &&
    boxed !== undefined &&
    typeof boxed === 'object' &&
    '_kind' in boxed &&
    typeof boxed._kind === 'string'
  );
}

export function isBoxedNumber(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & NumberLiteralInterface {
  return expr?._kind === 'number';
}

export function isBoxedSymbol(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & SymbolInterface {
  return expr?._kind === 'symbol';
}

export function isBoxedFunction(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & FunctionInterface {
  return expr?._kind === 'function' || expr?._kind === 'tensor';
}

export function isBoxedString(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & StringInterface {
  return expr?._kind === 'string';
}

export function isBoxedTensor(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & TensorInterface {
  return expr?._kind === 'tensor';
}

export function isDictionary(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & DictionaryInterface {
  return expr?._kind === 'dictionary';
}

export function isCollection(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & CollectionInterface {
  return expr?.isCollection === true;
}

export function isIndexedCollection(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & IndexedCollectionInterface {
  return expr?.isIndexedCollection === true;
}

/**
 * Get the symbol name if `expr` is a boxed symbol, otherwise `undefined`.
 *
 * Convenience helper that combines `isBoxedSymbol()` with `.symbol` access
 * so callers can write `sym(expr) === 'Pi'` instead of the more verbose
 * `isBoxedSymbol(expr) && expr.symbol === 'Pi'`.
 */
export function sym(
  expr: BoxedExpression | null | undefined
): string | undefined {
  return expr !== null && expr !== undefined && expr._kind === 'symbol'
    ? (expr as BoxedExpression & SymbolInterface).symbol
    : undefined;
}
