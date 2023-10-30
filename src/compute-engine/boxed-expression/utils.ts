import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';
import { Expression } from '../../math-json/math-json-format';
import { isNumberExpression, isNumberObject } from '../../math-json/utils';
import { asFloat } from '../numerics/numeric';
import { bigint } from '../numerics/numeric-bigint';
import { BoxedExpression, IComputeEngine } from '../public';

export function isLatexString(s: unknown): s is string {
  if (typeof s === 'string') return s.startsWith('$') && s.endsWith('$');
  return false;
}

export function latexString(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  if (s.startsWith('$$') && s.endsWith('$$')) return s.slice(2, -2);
  if (s.startsWith('$') && s.endsWith('$')) return s.slice(1, -1);

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

export function getSymbols(expr: BoxedExpression, result: Set<string>): void {
  if (expr.symbol) {
    result.add(expr.symbol);
    return;
  }

  if (expr.head && typeof expr.head !== 'string') getSymbols(expr.head, result);

  if (expr.ops) for (const op of expr.ops) getSymbols(op, result);

  if (expr.keys)
    for (const key of expr.keys) getSymbols(expr.getKey(key)!, result);
}

/**
 * Return the unknowns in the expression, recursively.
 *
 * An unknown is an identifier (symbol or function) that is not bound
 * to a value.
 *
 */
export function getUnknowns(expr: BoxedExpression, result: Set<string>): void {
  if (expr.symbol) {
    const def = expr.engine.lookupSymbol(expr.symbol);
    if (def && def.value !== undefined) return;

    const fnDef = expr.engine.lookupFunction(expr.symbol);
    if (fnDef && (fnDef.signature.evaluate || fnDef.signature.N)) return;

    result.add(expr.symbol);
    return;
  }

  if (expr.head && typeof expr.head !== 'string')
    getUnknowns(expr.head, result);

  if (expr.ops) for (const op of expr.ops) getUnknowns(op, result);

  if (expr.keys)
    for (const key of expr.keys) getUnknowns(expr.getKey(key)!, result);
}

/**
 * Return the free variables (non local variable) in the expression,
 * recursively.
 *
 * A free variable is an identifier that is not an argument to a function,
 * or a local variable.
 *
 */
export function getFreeVariables(
  expr: BoxedExpression,
  result: Set<string>
): void {
  // @todo: need to check for '["Block"]' which may contain ["Declare"] expressions and exclude those

  if (expr.head === 'Block') {
  }

  if (expr.symbol) {
    const def = expr.engine.lookupSymbol(expr.symbol);
    if (def && def.value !== undefined) return;

    const fnDef = expr.engine.lookupFunction(expr.symbol);
    if (fnDef && (fnDef.signature.evaluate || fnDef.signature.N)) return;

    result.add(expr.symbol);
    return;
  }

  if (expr.head && typeof expr.head !== 'string')
    getFreeVariables(expr.head, result);

  if (expr.ops) for (const op of expr.ops) getFreeVariables(op, result);

  if (expr.keys)
    for (const key of expr.keys) getFreeVariables(expr.getKey(key)!, result);
}

/** Return the local variables in the expression.
 *
 * A local variable is an identifier that is declared with a `Declare`
 * expression in a `Block` expression.
 *
 * Note that the canonical form of a `Block` expression will hoist all
 * `Declare` expressions to the top of the block. `Assign` expressions
 * of undeclared variables will also have a matching `Declare` expressions
 * hoisted.
 *
 */
export function getLocalVariables(
  expr: BoxedExpression,
  result: Set<string>
): void {
  const h = expr.head;
  if (h !== 'Block') return;
  for (const statement of expr.ops!)
    if (statement.head === 'Declare') {
      const id = statement.op1.symbol;
      if (id) result.add(id);
    }
}

export function getSubexpressions(
  expr: BoxedExpression,
  head: string
): BoxedExpression[] {
  const result = !head || expr.head === head ? [expr] : [];
  if (expr.ops) {
    for (const op of expr.ops) result.push(...getSubexpressions(op, head));
  } else if (expr.keys) {
    for (const op of expr.keys)
      result.push(...getSubexpressions(expr.getKey(op)!, head));
  }
  return result;
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

  if (isNumberExpression(expr)) {
    const num = isNumberObject(expr) ? expr.num : expr;
    let s = num
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

export function bigintValue(
  ce: IComputeEngine,
  expr: Expression | null | undefined
): bigint | null {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === 'number')
    return Number.isInteger(expr) ? bigint(expr) : null;

  if (isNumberExpression(expr)) {
    const num = isNumberObject(expr) ? expr.num.toString() : expr;
    let s = num
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

    if (s === 'nan') return null;
    if (s === 'infinity' || s === '+infinity') return null;
    if (s === '-infinity') return null;
    if (s.includes('.')) return null;
    return bigint(s);
  }

  return null;
}

export function asBigint(expr: BoxedExpression): bigint | null {
  const num = expr.numericValue;

  if (num === null) return null;

  if (typeof num === 'number' && Number.isInteger(num)) return bigint(num);

  if (num instanceof Decimal && num.isInteger()) return bigint(num);

  return null;
}
