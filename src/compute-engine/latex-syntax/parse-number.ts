/**
 * Number parsing extracted from the _Parser class for modularity.
 *
 * All functions take a `Parser` interface and a `NumberFormatTokens` config
 * that holds the pre-tokenized formatting strings from ParseLatexOptions.
 */

import type { Expression } from '../../math-json/types';
import type { LatexToken, Parser } from './types';
import { SMALL_INTEGER } from '../numerics/numeric';

/**
 * Pre-tokenized formatting strings used during number parsing.
 * Created once in the _Parser constructor from ParseLatexOptions.
 */
export interface NumberFormatTokens {
  decimalSeparatorTokens: LatexToken[];
  wholeDigitGroupSeparatorTokens: LatexToken[];
  fractionalDigitGroupSeparatorTokens: LatexToken[];
  exponentProductTokens: LatexToken[];
  beginExponentMarkerTokens: LatexToken[];
  endExponentMarkerTokens: LatexToken[];
  truncationMarkerTokens: LatexToken[];
}

/** If the next token matches a `-` sign, return '-', otherwise return '+' */
function parseOptionalSign(parser: Parser): string {
  let isNegative = !!parser.matchAny(['-', '\u2212']);
  while (parser.matchAny(['+', '\ufe62']) || parser.skipSpace())
    if (parser.matchAny(['-', '\u2212'])) isNegative = !isNegative;

  return isNegative ? '-' : '+';
}

/**
 * Parse a sequence of decimal digits. The `part` indicates which
 * grouping separator should be expected.
 */
function parseDecimalDigits(
  parser: Parser,
  fmt: NumberFormatTokens,
  part: 'none' | 'whole' | 'fraction' = 'whole'
): string {
  const result: string[] = [];
  let done = false;
  while (!done) {
    while (/^[0-9]$/.test(parser.peek)) {
      result.push(parser.nextToken());
      parser.skipVisualSpace();
    }

    done = true;
    const group =
      part === 'whole'
        ? fmt.wholeDigitGroupSeparatorTokens
        : fmt.fractionalDigitGroupSeparatorTokens;
    if (part !== 'none' && group.length > 0) {
      const savedIndex = parser.index;
      parser.skipVisualSpace();
      if (parser.matchAll(group)) {
        parser.skipVisualSpace();
        // Are there more digits after a group separator
        if (/^[0-9]$/.test(parser.peek)) done = false;
        else parser.index = savedIndex;
      }
    }
  }
  return result.join('');
}

/**
 * Parse a signed integer. The `part` argument is used to determine
 * what grouping separator should be expected.
 */
function parseSignedInteger(
  parser: Parser,
  fmt: NumberFormatTokens,
  part: 'whole' | 'fraction' | 'none'
): string {
  const start = parser.index;

  const sign = parseOptionalSign(parser);
  const result = parseDecimalDigits(parser, fmt, part);
  if (result) return sign === '-' ? '-' + result : result;

  parser.index = start;
  return '';
}

/** Parse an exponent part (e.g. `e5`, `\times 10^{-3}`, `\%`). */
function parseExponent(parser: Parser, fmt: NumberFormatTokens): string {
  const start = parser.index;

  parser.skipVisualSpace();

  if (parser.matchAny(['e', 'E'])) {
    // The exponent does not contain grouping markers. See
    // https://physics.nist.gov/cuu/Units/checklist.html  #16
    const exponent = parseSignedInteger(parser, fmt, 'none');
    if (exponent) return exponent;
  }

  parser.index = start;
  if (parser.match('\\times')) {
    parser.skipVisualSpace();
    if (parser.matchAll(['1', '0'])) {
      parser.skipVisualSpace();
      if (parser.match('^')) {
        parser.skipVisualSpace();
        // Is it a single digit exponent, i.e. `\times 10^5`
        if (/^[0-9]$/.test(parser.peek)) return parser.nextToken();

        if (parser.match('<{>')) {
          // Multi digit exponent,i.e. `\times 10^{10}` or `\times 10^{-5}`
          parser.skipVisualSpace();
          // Note: usually don't have group markers, but since we're inside
          // a `{}` there can't be ambiguity, so we're lenient
          const exponent = parseSignedInteger(parser, fmt, 'whole');
          parser.skipVisualSpace();
          if (exponent && parser.match('<}>')) return exponent;
        }
      }
    }
  }

  parser.index = start;
  // `%` is a synonym for `e-2`. See // https://physics.nist.gov/cuu/Units/checklist.html  #10
  parser.skipVisualSpace();
  if (parser.match('\\%')) return `-2`;

  parser.index = start;
  if (parser.matchAll(fmt.exponentProductTokens)) {
    parser.skipVisualSpace();
    if (parser.matchAll(fmt.beginExponentMarkerTokens)) {
      parser.skipVisualSpace();
      const exponent = parseSignedInteger(parser, fmt, 'none');
      parser.skipVisualSpace();
      if (exponent && parser.matchAll(fmt.endExponentMarkerTokens))
        return exponent;
    }
  }

  parser.index = start;
  return '';
}

/** Check if the next tokens look like a digit with a dot over it (`\overset{.}{d}`). */
function dotOverDigit(parser: Parser): string | null {
  // Check if the next tokens is \overset with a dot and a digit
  const start = parser.index;
  if (parser.matchAll([`\\overset`, '<{>'])) {
    if (parser.match('.') || parser.match('\\cdots')) {
      if (parser.matchAll([`<}>`, '<{>'])) {
        const digit = parser.nextToken();
        if (digit && /^\d$/.test(digit)) {
          if (parser.match('<}>')) {
            return digit;
          }
        }
      }
    }
  }
  parser.index = start;
  return null;
}

/** Check if upcoming tokens might represent repeating digits notation. */
function mayBeRepeatingDigits(parser: Parser): boolean {
  const peek = parser.peek;
  if (peek === '\\overline') return true;
  if (peek === '\\overset') return true;
  if (peek === '\\wideparent' || peek === '\\overarc') return true;
  if (peek === '(') return true;
  if (peek === '\\left') return true;

  return false;
}

/** Parse repeating decimal notation (parentheses, vinculum, arc, dots). */
export function parseRepeatingDecimal(
  parser: Parser,
  fmt: NumberFormatTokens
): string {
  const start = parser.index;
  const format = parser.options.repeatingDecimal;

  let repeatingDecimals = '';
  if ((format === 'auto' || format === 'parentheses') && parser.match('(')) {
    repeatingDecimals = parseDecimalDigits(parser, fmt, 'fraction');
    if (repeatingDecimals && parser.match(')')) return `(${repeatingDecimals})`;
    parser.index = start;
    return '';
  }

  parser.index = start;
  if (
    (format === 'auto' || format === 'parentheses') &&
    parser.matchAll([`\\left`, '('])
  ) {
    repeatingDecimals = parseDecimalDigits(parser, fmt, 'fraction');
    if (repeatingDecimals && parser.matchAll([`\\right`, ')']))
      return `(${repeatingDecimals})`;
    parser.index = start;
    return '';
  }

  parser.index = start;
  if (
    (format === 'auto' || format === 'vinculum') &&
    parser.matchAll([`\\overline`, '<{>'])
  ) {
    repeatingDecimals = parseDecimalDigits(parser, fmt, 'fraction');
    if (repeatingDecimals && parser.match('<}>'))
      return `(${repeatingDecimals})`;
    parser.index = start;
    return '';
  }

  parser.index = start;
  if (
    (format === 'auto' || format === 'arc') &&
    (parser.matchAll([`\\wideparen`, '<{>']) ||
      parser.matchAll([`\\overarc`, '<{>']))
  ) {
    repeatingDecimals = parseDecimalDigits(parser, fmt, 'fraction');
    if (repeatingDecimals && parser.match('<}>'))
      return `(${repeatingDecimals})`;
    parser.index = start;
    return '';
  }

  parser.index = start;
  if (format === 'auto' || format === 'dots') {
    const first = dotOverDigit(parser);
    if (first !== null) {
      repeatingDecimals = parseDecimalDigits(parser, fmt, 'fraction');

      // Is there a single digit, i.e. `1.\overset{.}{3}`
      if (!repeatingDecimals) return `(${first})`;

      // If there are repeating decimals, we should have a final digit
      const last = dotOverDigit(parser);
      if (last !== null) {
        return `(${first}${repeatingDecimals}${last})`;
      }
    }
  }

  parser.index = start;
  return '';
}

/**
 * If n is a small number, use a shorthand (i.e. a JS number). Otherwise,
 * use a {num: n} object.
 *
 * For zero, always use a {num} object to avoid confusion with null/undefined.
 */
function numberExpression(n: number): Expression {
  if (n === 0) return { num: '0' };
  if (Number.isInteger(n) && Math.abs(n) < SMALL_INTEGER) return n;
  return { num: n.toString() };
}

/**
 * Parse a number, with an optional sign, exponent, decimal marker,
 * repeating decimals, etc.
 */
export function parseNumber(
  parser: Parser,
  fmt: NumberFormatTokens
): Expression | null {
  // If we don't parse numbers, we'll return them as individual tokens
  const parseNumbersOption = parser.options.parseNumbers as unknown;
  if (parseNumbersOption === false || parseNumbersOption === 'never')
    return null;

  const start = parser.index;

  parser.skipVisualSpace();

  // Parse a '+' or '-' sign
  let sign = +1;
  while (parser.peek === '-' || parser.peek === '+') {
    if (parser.match('-')) sign = -sign;
    else parser.match('+');
    parser.skipVisualSpace();
  }

  let wholePart = '';
  let fractionalPart = '';

  // Does the number start with the decimal marker? i.e. `.5`
  let startsWithdecimalSeparator = false;

  if (parser.match('.') || parser.matchAll(fmt.decimalSeparatorTokens)) {
    const peek = parser.peek;
    // We have a number if followed by a digit, or a repeating digit marker
    if (/^[\d]$/.test(peek) || mayBeRepeatingDigits(parser)) {
      startsWithdecimalSeparator = true;
      wholePart = '0';
    }
  } else wholePart = parseDecimalDigits(parser, fmt, 'whole');

  if (!wholePart) {
    parser.index = start;
    return null;
  }

  const fractionalIndex = parser.index;
  let hasFractionalPart = false;
  if (
    startsWithdecimalSeparator ||
    parser.match('.') ||
    parser.matchAll(fmt.decimalSeparatorTokens)
  ) {
    fractionalPart = parseDecimalDigits(parser, fmt, 'fraction');
    hasFractionalPart = true;
  }

  let hasRepeatingPart = false;
  if (hasFractionalPart) {
    const repeat = parseRepeatingDecimal(parser, fmt);
    if (repeat) {
      fractionalPart += repeat;
      hasRepeatingPart = true;
    }
    if (
      parser.match('\\ldots') ||
      parser.matchAll(fmt.truncationMarkerTokens)
    ) {
      // We got a truncation marker, just ignore it.
    }
  }

  if (hasFractionalPart && !fractionalPart) {
    // There was a '.', but an empty fractional part and no repeating part.
    // The '.' may be part of something else, i.e. '1..2'
    // so backtrack
    parser.index = fractionalIndex;
    if (wholePart.length < 10)
      return numberExpression(sign * parseInt(wholePart, 10));
    return { num: sign < 0 ? '-' + wholePart : wholePart };
  }

  const exponent = parseExponent(parser, fmt);

  // If we have a small-ish whole number, use a shortcut for the number
  if (!hasFractionalPart && !exponent && wholePart.length < 10)
    return numberExpression(sign * parseInt(wholePart, 10));

  // If we prefer to parse numbers as rationals, and there is no repeating part
  // we can return a rational number
  if (!hasRepeatingPart && parser.options.parseNumbers === 'rational') {
    // Check if the whole part exceeds MAX_SAFE_INTEGER
    // Use BigInt arithmetic to preserve precision for large integers
    const isLargeInteger =
      wholePart.length > 16 ||
      (wholePart.length === 16 && wholePart > '9007199254740991');

    if (!fractionalPart) {
      if (isLargeInteger) {
        // Use { num: string } format to preserve precision
        const numStr = sign < 0 ? '-' + wholePart : wholePart;
        if (exponent)
          return ['Multiply', { num: numStr }, ['Power', 10, exponent]];
        return { num: numStr };
      }
      const whole = parseInt(wholePart, 10);
      if (exponent) return ['Multiply', sign * whole, ['Power', 10, exponent]];
      return numberExpression(sign * whole);
    }

    // Has fractional part - need to compute rational
    const n = fractionalPart.length;

    // Check if the numerator calculation might overflow
    // Numerator = whole * 10^n + fraction, which has roughly wholePart.length + n digits
    const numeratorDigits = wholePart.length + n;
    if (numeratorDigits > 15) {
      // Use BigInt arithmetic to preserve precision
      const wholeBig = BigInt(wholePart);
      const fractionBig = BigInt(fractionalPart);
      const denominatorBig = BigInt(10) ** BigInt(n);
      const numeratorBig = wholeBig * denominatorBig + fractionBig;
      const signedNumerator = sign < 0 ? -numeratorBig : numeratorBig;

      if (exponent) {
        return [
          'Multiply',
          [
            'Rational',
            { num: signedNumerator.toString() },
            Number(denominatorBig),
          ],
          ['Power', 10, exponent],
        ];
      }
      return [
        'Rational',
        { num: signedNumerator.toString() },
        Number(denominatorBig),
      ];
    }

    const whole = parseInt(wholePart, 10);
    const fraction = parseInt(fractionalPart, 10);

    // Calculate numerator and denominator
    const numerator = whole * 10 ** n + fraction;
    const denominator = 10 ** n;

    if (exponent) {
      return [
        'Multiply',
        ['Rational', sign * numerator, denominator],
        ['Power', 10, exponent],
      ];
    }
    return ['Rational', sign * numerator, denominator];
  }

  return {
    num:
      (sign < 0 ? '-' : '') +
      wholePart +
      (hasFractionalPart ? '.' + fractionalPart : '') +
      (exponent ? 'e' + exponent : ''),
  };
}
