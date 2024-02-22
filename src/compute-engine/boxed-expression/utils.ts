import { Decimal } from 'decimal.js';
import { Expression } from '../../math-json/math-json-format';
import { isNumberExpression, isNumberObject } from '../../math-json/utils';
import { bigint } from '../numerics/numeric-bigint';
import { BoxedExpression, IComputeEngine } from '../public';

export function isBoxedExpression(x: unknown): x is BoxedExpression {
  return typeof x === 'object' && x !== null && 'engine' in x;
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

export function isLatexString(s: unknown): s is string {
  if (typeof s === 'string') return s.startsWith('$') && s.endsWith('$');
  return false;
}

export function asLatexString(s: unknown): string | null {
  if (typeof s !== 'string') return null;

  if (s.startsWith('$$') && s.endsWith('$$')) return s.slice(2, -2);
  if (s.startsWith('$') && s.endsWith('$')) return s.slice(1, -1);

  return null;
}

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0; // | 0 to convert to 32-bit int

  return Math.abs(hash);
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
  if (typeof expr === 'number') return ce.bignum(expr);

  if (expr === null || expr === undefined) return null;

  if (!isNumberExpression(expr)) return null;

  const num = isNumberObject(expr) ? expr.num : expr;

  if (typeof num === 'number') return ce.bignum(num);
  if (typeof num !== 'string') return null;

  let s = num
    .toLowerCase()
    .replace(/[nd]$/, '')
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

export function asBigint(expr: BoxedExpression): bigint | null {
  const num = expr.numericValue;

  if (typeof num === 'number' && Number.isInteger(num)) return bigint(num);

  if (num instanceof Decimal && num.isInteger()) return bigint(num);

  return null;
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
// export function getLocalVariables(
//   expr: BoxedExpression,
//   result: Set<string>
// ): void {
//   const h = expr.head;
//   if (h !== 'Block') return;
//   for (const statement of expr.ops!)
//     if (statement.head === 'Declare') {
//       const id = statement.op1.symbol;
//       if (id) result.add(id);
//     }
// }
