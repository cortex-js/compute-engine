import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { Expression } from '../../math-json/math-json-format';
import { isNumberObject } from '../../math-json/utils';
import { asFloat } from '../numerics/numeric';
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
export function getImaginaryCoef(expr: BoxedExpression): number | null {
  if (expr.symbol === 'ImaginaryUnit') return 1;

  const z = expr.numericValue;
  if (z !== null && z instanceof Complex && z.re === 0) return z.im;

  if (expr.head === 'Negate') {
    const v = getImaginaryCoef(expr.op1);
    if (v === null) return null;
    return -v;
  }

  if (expr.head === 'Multiply' && expr.nops === 2) {
    if (expr.op1.symbol === 'ImaginaryUnit') return asFloat(expr.op2);
    if (expr.op2.symbol === 'ImaginaryUnit') return asFloat(expr.op1);
  }

  return 0;
}

/**
 * Return the free symbols in the expression, recursively.
 * A variable, or free symbol, is a symbol that is not bound to a value.
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

export function getSymbols(
  expr: BoxedExpression,
  set: Set<string>
): Set<string> {
  if (expr.symbol) {
    set.add(expr.symbol);
    return set;
  }

  if (!expr.ops && !expr.keys) return set;

  if (expr.ops) for (const op of expr.ops) getSymbols(op, set);

  if (expr.keys)
    for (const key of expr.keys) getSymbols(expr.getKey(key)!, set);

  return set;
}

export function getSubexpressions(
  expr: BoxedExpression,
  head: string
): BoxedExpression[] {
  if (expr.ops) {
    const result = !head || expr.head === head ? [expr] : [];
    for (const op of expr.ops) result.push(...getSubexpressions(op, head));
  } else if (expr.keys) {
    const result = !head || expr.head === head ? [expr] : [];
    for (const op of expr.keys)
      result.push(...getSubexpressions(expr.getKey(op)!, head));
    return result;
  }
  if (!head || expr.head === head) return [expr];
  return [];
}

/**
 * For any numeric result, if `bignumPreferred()` is true, calculate using
 * bignums. If `bignumPreferred()` is false, calculate using machine numbers
 */
export function bignumPreferred(ce: IComputeEngine) {
  return ce.numericMode === 'bignum' || ce.numericMode === 'auto';
}

/** When result of a numeric evaluation is a complex number,
 * return `NaN` if not `complexallowed()`
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

/**
 * If `expr` is a number, return it as a Decimal (it might be
 * in the machine value range or not). Use `isInMachineRange()` to check.
 *
 * Use this instead of `machineValue()` when possible, as `machineValue` will
 * truncate bignums to machine numbers
 */
export function bignumValue(
  ce: IComputeEngine,
  expr: Expression | null | undefined
): Decimal | null {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === 'number') return ce.bignum(expr);

  if (isNumberObject(expr)) {
    let s = expr.num
      .toLowerCase()
      .replace(/[nd]$/g, '')
      .replace(/[\u0009-\u000d\u0020\u00a0]/g, '');
    if (/\([0-9]+\)/.test(s)) {
      const [_, body, repeat, trail] = s.match(/(.+)\(([0-9]+)\)(.*)$/) ?? [];
      s =
        body +
        repeat.repeat(Math.ceil(ce.precision / repeat.length)) +
        (trail ?? '');
    }

    if (s === 'nan') return ce.bignum('NaN');
    if (s === 'infinity' || s === '+infinity') return ce.bignum('+Infinity');
    if (s === '-infinity') return ce.bignum('-Infinity');

    return ce.bignum(s);
  }

  return null;
}
