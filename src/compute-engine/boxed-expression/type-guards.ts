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

function isExpressionImpl(x: unknown): x is BoxedExpression {
  const boxed = x as { _kind?: unknown } | null | undefined;
  return (
    boxed !== null &&
    boxed !== undefined &&
    typeof boxed === 'object' &&
    '_kind' in boxed &&
    typeof boxed._kind === 'string'
  );
}

/** Preferred guard for runtime expressions. */
export function isExpression(x: unknown): x is BoxedExpression {
  return isExpressionImpl(x);
}

export function isNumber(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & NumberLiteralInterface {
  return expr?._kind === 'number';
}

export function isSymbol(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & SymbolInterface {
  return expr?._kind === 'symbol';
}

export function isFunction(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & FunctionInterface {
  return expr?._kind === 'function' || expr?._kind === 'tensor';
}

export function isString(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & StringInterface {
  return expr?._kind === 'string';
}

export function isTensor(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & TensorInterface {
  return expr?._kind === 'tensor';
}

/** @deprecated Use `isExpression()` instead. */
export function isBoxedExpression(x: unknown): x is BoxedExpression {
  return isExpressionImpl(x);
}

/** @deprecated Use `isNumber()` instead. */
export function isBoxedNumber(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & NumberLiteralInterface {
  return isNumber(expr);
}

/** @deprecated Use `isSymbol()` instead. */
export function isBoxedSymbol(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & SymbolInterface {
  return isSymbol(expr);
}

/** @deprecated Use `isFunction()` instead. */
export function isBoxedFunction(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & FunctionInterface {
  return isFunction(expr);
}

/** @deprecated Use `isString()` instead. */
export function isBoxedString(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & StringInterface {
  return isString(expr);
}

/** @deprecated Use `isTensor()` instead. */
export function isBoxedTensor(
  expr: BoxedExpression | null | undefined
): expr is BoxedExpression & TensorInterface {
  return isTensor(expr);
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
 * Get the symbol name if `expr` is a symbol expression, otherwise `undefined`.
 *
 * Convenience helper that combines `isSymbol()` with `.symbol` access
 * so callers can write `sym(expr) === 'Pi'` instead of the more verbose
 * `isSymbol(expr) && expr.symbol === 'Pi'`.
 */
export function sym(
  expr: BoxedExpression | null | undefined
): string | undefined {
  return expr !== null && expr !== undefined && expr._kind === 'symbol'
    ? (expr as BoxedExpression & SymbolInterface).symbol
    : undefined;
}
