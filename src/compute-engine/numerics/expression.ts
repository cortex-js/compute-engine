import { Expression } from '../../math-json';
import { isNumberExpression, isNumberObject } from '../../math-json/utils';
import { bigint } from './numeric-bigint';
import { numberToString } from './strings';

export function bigintValue(
  expr: Expression | null | undefined
): bigint | null {
  if (typeof expr === 'number')
    return Number.isInteger(expr) ? BigInt(expr) : null;

  if (expr === null || expr === undefined) return null;

  if (!isNumberExpression(expr)) return null;

  const num = isNumberObject(expr) ? expr.num : expr;

  if (typeof num === 'number')
    return Number.isInteger(num) ? BigInt(num) : null;
  if (typeof num !== 'string') return null;

  const s = num
    .toLowerCase()
    .replace(/[nd]$/, '')
    .replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  if (s === 'nan') return null;
  if (s === 'infinity' || s === '+infinity') return null;
  if (s === '-infinity') return null;

  return bigint(s);
}

/** Output a shorthand if possible */
export function numberToExpression(num: number | bigint): Expression {
  if (typeof num === 'number') {
    if (isNaN(num)) return 'NaN';
    if (!Number.isFinite(num))
      return num < 0 ? 'NegativeInfinity' : 'PositiveInfinity';
    return num;
  }

  if (num >= Number.MIN_SAFE_INTEGER && num <= Number.MAX_SAFE_INTEGER)
    return Number(num);

  // Check if the string version is equal to the number
  const numStr = numberToString(num);
  if (Number(num).toString() === numStr) return Number(num);

  return { num: numStr };
}
