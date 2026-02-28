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
import type { NumericValue } from '../numeric-value/types';

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
  expr: Expression | null | undefined,
  name?: string
): expr is Expression & SymbolInterface {
  return (
    expr?._kind === 'symbol' &&
    (name === undefined ||
      (expr as Expression & SymbolInterface).symbol === name)
  );
}

export function isFunction(
  expr: Expression | null | undefined,
  operator?: string
): expr is Expression & FunctionInterface {
  return (
    (expr?._kind === 'function' || expr?._kind === 'tensor') &&
    (operator === undefined || expr!.operator === operator)
  );
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
 * Return the numeric value if `expr` is a number literal, otherwise `undefined`.
 *
 * Convenience helper that combines `isNumber()` with `.numericValue` access.
 */
export function numericValue(
  expr: Expression | null | undefined
): number | NumericValue | undefined {
  return isNumber(expr) ? expr.numericValue : undefined;
}

/**
 * Get the symbol name if `expr` is a symbol expression, otherwise `undefined`.
 *
 * Convenience helper that combines `isSymbol()` with `.symbol` access
 * so callers can write `sym(expr) === 'Pi'` instead of
 * `isSymbol(expr, 'Pi')`.
 */
export function sym(expr: Expression | null | undefined): string | undefined {
  return expr?._kind === 'symbol'
    ? (expr as Expression & SymbolInterface).symbol
    : undefined;
}
