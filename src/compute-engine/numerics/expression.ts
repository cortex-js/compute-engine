import type { MathJsonExpression } from '../../math-json.js';
import { isNumberExpression, isNumberObject } from '../../math-json/utils.js';
import { bigint } from './bigint.js';
import { numberToString, withFractionPart } from './strings.js';

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

  // An integer past the safe integers is always a `{num}` string, even when a
  // double holds it exactly (`2^127`): a JSON number there boxes as a FLOAT,
  // since only a safe-integer double is boxed as an exact integer, so the
  // shorthand would lose the exactness on reconstruction.
  return { num: numberToString(num) };
}

/**
 * Serialize the float (inexact) value `num` to MathJSON. An integer-valued
 * float in the safe-integer range is written `{ num: "2.0" }`, not as the
 * JSON number `2`: a safe-integer JSON number is read back as an exact
 * integer, and the fraction part keeps the value a float. Any other JSON
 * number (`1.5`, `1e+30`) is read back as a float, and is kept.
 */
export function floatToExpression(num: number): MathJsonExpression {
  const json = numberToExpression(num);
  if (typeof json === 'number' && Number.isSafeInteger(json))
    return { num: withFractionPart(numberToString(json)) };
  return json;
}

/**
 * True if the MathJSON number `json` is read back as a float: a JSON number
 * that is not a safe integer (`1.5`, `1e+30`), or a number string with a
 * fraction part or a negative exponent (`"2.0"`, `"1e-800"`). A safe-integer
 * JSON number and a number string without either (`"2"`, `"1e+800"`) are
 * read back as exact integers.
 */
export function isFloatSpelling(json: MathJsonExpression): boolean {
  if (typeof json === 'number')
    return Number.isFinite(json) && !Number.isSafeInteger(json);
  let s: unknown = json;
  if (typeof json === 'object' && json !== null && 'num' in json) s = json.num;
  if (typeof s !== 'string') return false;
  return /^[+-]?[0-9]/.test(s) && (s.includes('.') || /[eE]-/.test(s));
}

/**
 * The MathJSON of a float (inexact) complex number, from the MathJSON of its
 * parts spelled as they would be for an exact value. A `Complex` with one
 * part read back as a float is read back as a float, so the parts are kept
 * when one of them is spelled as a float (`["Complex", 0, -1.1]`).
 * Otherwise every part is written with a fraction part
 * (`["Complex", {num: "2.0"}, {num: "3.0"}]`), so that the value is read back
 * as a float.
 */
export function floatComplexToExpression(
  parts: MathJsonExpression[]
): MathJsonExpression {
  if (parts.some(isFloatSpelling)) return ['Complex', ...parts];
  return ['Complex', ...parts.map(withFloatSpelling)];
}

/** Give the MathJSON number `json` a fraction part if it has none */
function withFloatSpelling(json: MathJsonExpression): MathJsonExpression {
  if (typeof json === 'number')
    return Number.isSafeInteger(json)
      ? { num: withFractionPart(numberToString(json)) }
      : json;
  if (typeof json === 'string') return withFractionPart(json);
  if (typeof json === 'object' && json !== null && 'num' in json)
    return { ...json, num: withFractionPart(json.num) };
  return json;
}
