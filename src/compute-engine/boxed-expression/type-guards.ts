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
} from '../global-types.js';
import type { NumericValue } from '../numeric-value/types.js';

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

/**
 * True when a value is an absence MARKER — the `Missing` symbol or a `NaN`
 * number — regardless of provenance (I6). This is the value-level test the
 * missing-value runtime gate and chained-`At` absorption use
 * (`docs/plans/2026-07-22-missing-value-typing-design.md`).
 */
export function isAbsentValue(expr: Expression | null | undefined): boolean {
  return isSymbol(expr, 'Missing') || (isNumber(expr) && expr.isNaN === true);
}

export function isFunction(
  expr: Expression | null | undefined,
  operator?: string
): expr is Expression & FunctionInterface {
  return (
    expr?._kind === 'function' &&
    (operator === undefined || expr!.operator === operator)
  );
}

export function isString(
  expr: Expression | null | undefined
): expr is Expression & StringInterface {
  return expr?._kind === 'string';
}

/**
 * The unified tensor guard (§D4.1): a genuine tensor VALUE — a canonical
 * `List` `BoxedFunction` whose (generation-cached) honest type carries a
 * shape claim (`dimensions`). Because the `List` type handler and this guard
 * share one predicate, `isTensor`, `.shape`, `.rank` and `.type` can never
 * disagree. NOT for hot dispatch paths (reads `.type` on first access) —
 * those use `candidateShape` (`tensor-view.ts`).
 */
export function isTensor(
  expr: Expression | null | undefined
): expr is Expression & TensorInterface {
  if (!isFunction(expr, 'List')) return false;
  const t = expr.type.type;
  return (
    typeof t !== 'string' && t.kind === 'list' && t.dimensions !== undefined
  );
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
 * Ellipsis fold barrier predicate.
 *
 * Returns `true` if `expr` is a continuation operand: either the bare
 * `ContinuationPlaceholder` symbol, or a `Negate` whose single operand is it
 * (as produced by parsing `… - \dots`, i.e. a subtraction-spelled ellipsis).
 *
 * An `Add`/`Multiply` carrying such an operand is a notational object (e.g.
 * `1 - 2 + 4 - \dots`) and must be left inert — no folding of the surrounding
 * samples, source order preserved. All fold-barrier sites use this predicate.
 */
export function isContinuationOperand(
  expr: Expression | null | undefined
): boolean {
  if (isSymbol(expr, 'ContinuationPlaceholder')) return true;
  if (isFunction(expr, 'Negate')) {
    const fn = expr as Expression & FunctionInterface;
    return fn.nops === 1 && isSymbol(fn.ops[0], 'ContinuationPlaceholder');
  }
  return false;
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
