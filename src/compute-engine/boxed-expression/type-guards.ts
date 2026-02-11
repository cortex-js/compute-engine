import type {
  Expression,
  DictionaryInterface,
  NumberLiteralInterface,
  SymbolInterface,
  FunctionInterface,
  StringInterface,
  TensorInterface,
  CollectionInterface,
  IndexedCollectionInterface,
} from '../global-types';

function isExpressionImpl(x: unknown): x is Expression {
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
export function isExpression(x: unknown): x is Expression {
  return isExpressionImpl(x);
}

export function isNumber(
  expr: Expression | null | undefined
): expr is Expression & NumberLiteralInterface {
  return expr?._kind === 'number';
}

export function isSymbol(
  expr: Expression | null | undefined
): expr is Expression & SymbolInterface {
  return expr?._kind === 'symbol';
}

export function isFunction(
  expr: Expression | null | undefined
): expr is Expression & FunctionInterface {
  return expr?._kind === 'function' || expr?._kind === 'tensor';
}

export function isString(
  expr: Expression | null | undefined
): expr is Expression & StringInterface {
  return expr?._kind === 'string';
}

export function isTensor(
  expr: Expression | null | undefined
): expr is Expression & TensorInterface {
  return expr?._kind === 'tensor';
}

/** @deprecated Use `isExpression()` instead. */
export function isBoxedExpression(x: unknown): x is Expression {
  return isExpressionImpl(x);
}

/** @deprecated Use `isNumber()` instead. */
export function isBoxedNumber(
  expr: Expression | null | undefined
): expr is Expression & NumberLiteralInterface {
  return isNumber(expr);
}

/** @deprecated Use `isSymbol()` instead. */
export function isBoxedSymbol(
  expr: Expression | null | undefined
): expr is Expression & SymbolInterface {
  return isSymbol(expr);
}

/** @deprecated Use `isFunction()` instead. */
export function isBoxedFunction(
  expr: Expression | null | undefined
): expr is Expression & FunctionInterface {
  return isFunction(expr);
}

/** @deprecated Use `isString()` instead. */
export function isBoxedString(
  expr: Expression | null | undefined
): expr is Expression & StringInterface {
  return isString(expr);
}

/** @deprecated Use `isTensor()` instead. */
export function isBoxedTensor(
  expr: Expression | null | undefined
): expr is Expression & TensorInterface {
  return isTensor(expr);
}

export function isDictionary(
  expr: Expression | null | undefined
): expr is Expression & DictionaryInterface {
  return expr?._kind === 'dictionary';
}

export function isCollection(
  expr: Expression | null | undefined
): expr is Expression & CollectionInterface {
  return expr?.isCollection === true;
}

export function isIndexedCollection(
  expr: Expression | null | undefined
): expr is Expression & IndexedCollectionInterface {
  return expr?.isIndexedCollection === true;
}

/**
 * Get the symbol name if `expr` is a symbol expression, otherwise `undefined`.
 *
 * Convenience helper that combines `isSymbol()` with `.symbol` access
 * so callers can write `sym(expr) === 'Pi'` instead of the more verbose
 * `isSymbol(expr) && expr.symbol === 'Pi'`.
 */
export function sym(expr: Expression | null | undefined): string | undefined {
  return expr !== null && expr !== undefined && expr._kind === 'symbol'
    ? (expr as Expression & SymbolInterface).symbol
    : undefined;
}
