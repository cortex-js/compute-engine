import type { MathJsonExpression } from '../../math-json.js';
import { isNumberExpression, isNumberObject } from '../../math-json/utils.js';
import { bigint } from './bigint.js';
import { numberToString } from './strings.js';

export function bigintValue(
  expr: MathJsonExpression | null | undefined
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
  if (/^(infinity|\+infinity|oo|\+oo|-infinity|-oo)$/.test(s)) return null;

  return bigint(s);
}

/** Output a shorthand if possible */
export function numberToExpression(
  num: number | bigint,
  fractionalDigits?: string | number
): MathJsonExpression {
  if (typeof num === 'number') {
    if (isNaN(num)) return 'NaN';
    if (!Number.isFinite(num))
      return num < 0 ? 'NegativeInfinity' : 'PositiveInfinity';

    if (typeof fractionalDigits === 'number')
      return { num: num.toFixed(fractionalDigits) };

    return num;
  }

  if (num >= Number.MIN_SAFE_INTEGER && num <= Number.MAX_SAFE_INTEGER)
    return Number(num);

  // Only use the machine-number shorthand when the float is *exactly* equal to
  // the integer. A string-display comparison is unsound: e.g.
  // `Number(10n ** 23n).toString() === '1e+23'` is true because
  // `Number.prototype.toString()` returns the shortest uniquely-identifying
  // decimal, yet the float ≠ 10^23. Emitting that float as a JSON number would
  // corrupt the value on reconstruction. `BigInt(n)` of an integral float is
  // its exact value, so equality guarantees losslessness.
  const n = Number(num);
  if (Number.isFinite(n) && BigInt(n) === num) return n;

  return { num: numberToString(num) };
}
