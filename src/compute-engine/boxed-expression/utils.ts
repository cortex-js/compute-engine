import { MACHINE_PRECISION } from '../numerics/numeric';
import { BoxedExpression, IComputeEngine } from '../public';

export function isLatexString(s: unknown): s is string {
  if (typeof s === 'string') return s.startsWith('$') && s.endsWith('$');
  return false;
}

export function latexString(s: unknown): string | null {
  if (typeof s === 'string' && s.startsWith('$') && s.endsWith('$'))
    return s.slice(1, -1);

  return null;
}

/**
 * Return a multiple of the imaginary unit, e.g.
 * - 'ImaginaryUnit'
 * - ['Negate', 'ImaginaryUnit']
 * - ['Negate', ['Multiply', 3, 'ImaginaryUnit']]
 * - ['Multiply', 5, 'ImaginaryUnit']
 * - ['Multiply', 'ImaginaryUnit', 5]
 */
export function getImaginaryCoef(expr: BoxedExpression): number {
  if (expr.symbol === 'ImaginaryUnit') return 1;
  const z = expr.complexValue;
  if (z && z.re === 0) return z.im;
  if (expr.head === 'Negate') return -getImaginaryCoef(expr.op1);

  let f = 0;

  if (expr.head === 'Multiply' && expr.nops === 2) {
    let m: BoxedExpression | undefined;
    if (expr.op1.symbol === 'ImaginaryUnit') m = expr.op2;
    else if (expr.op2.symbol === 'ImaginaryUnit') m = expr.op1;

    if (m && m.isLiteral) f = m.asFloat ?? 0;
  }

  return f;
}

/**
 * Return the free symbols in the expression, recursively.
 * A variable, or free symbol,is a symbol that is not bound to a value.
 */
export function getVars(expr: BoxedExpression): string[] {
  if (expr.symbol) {
    const def = expr.symbolDefinition;
    return def?.constant ? [] : [expr.symbol];
  }

  if (!expr.ops && !expr.keys) return [];

  const result: string[] = [];

  if (expr.ops) for (const op of expr.ops) result.push(...getVars(op));

  if (expr.keys)
    for (const key of expr.keys) result.push(...getVars(expr.getKey(key)!));

  return result;
}

/**
 * For any numeric result, or when boxing numbers,
 * if `ce.useDecimal` is true, create them as Decimal number
 * if `ce.useDecimal` is false, create them as machine number
 */
export function useDecimal(ce: IComputeEngine) {
  return (
    ce.numericMode === 'decimal' ||
    (ce.numericMode === 'auto' && ce.precision > Math.floor(MACHINE_PRECISION))
  );
}

/** If result of a numeric evaluation is a complex number,
 * return `NaN` if `ce.useComplex` is false
 */

export function complexAllowed(ce: IComputeEngine) {
  return ce.numericMode === 'auto' || ce.numericMode === 'complex';
}

/**
 * Assert that `expr` is  in fact canonical.
 *
 * Called for example from within a `canonical` handler.
 *
 * To make an expression whose canonical status is unknown, canonical, call
 * `expr.canonical`.
 */
export function asCanonical(expr: BoxedExpression): BoxedExpression {
  expr.isCanonical = true;
  return expr;
}

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0; // | 0 to convert to 32-bit int

  return Math.abs(hash);
}

export function isDictionaryLike(expr: BoxedExpression): boolean {
  if (expr.keys) return true;
  const head = expr.head;
  if (
    typeof head === 'string' &&
    ['KeyValuePair', 'Pair', 'Tuple'].includes(head)
  )
    return true;
  return false;
}

export function getDictionaryLike(expr: BoxedExpression): {
  [key: string]: BoxedExpression;
} {
  const keys = expr.keys;
  if (keys) {
    const result: { [key: string]: BoxedExpression } = {};
    for (const key of keys) result[key] = expr.getKey(key)!;
    return result;
  }

  const head = expr.head;
  if (
    typeof head === 'string' &&
    ['KeyValuePair', 'Pair', 'Tuple'].includes(head)
  ) {
    const key = expr.op1.string ?? expr.op1.symbol;
    if (typeof key === 'string') return { [key]: expr.op2 };
  }
  // The dictionary argument can be a ["Dictionary"] expression, a ["KeyValuePair"] expression, a ["Pair"] expression or a ["Tuple"] expression.

  return {};
}

export function isListLike(expr: BoxedExpression): boolean {
  if (expr.head === 'List') return true;
  return false;
}

export function getListLike(expr: BoxedExpression): BoxedExpression[] {
  if (expr.head === 'List') return expr.ops!;
  return [];
}
