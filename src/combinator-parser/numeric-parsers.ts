import { DIGITS, HEX_DIGITS } from './characters';
import { Parser, Result } from './parsers';

// @todo: the numeric parsers should return strings rather than
// number to better support big numbers

export function parseExponent(
  parser: Parser,
  prefix: 'e' | 'p'
): Result<number> {
  const start = parser.offset;
  let i = start;
  if (i >= parser.length) return parser.failure();
  if (prefix === 'p') {
    if (parser.at(i) !== 0x0070 && parser.at(i) !== 0x0050)
      return parser.failure();
  } else {
    // Prefix 'e' or 'E'
    if (parser.at(i) !== 0x0065 && parser.at(i) !== 0x0045)
      return parser.failure();
  }
  i += 1;

  let sign = 1;
  // Is it the minus sign (-)
  if (parser.at(i) === 0x002d) {
    i++;
    sign = -1;
  } else if (parser.at(i) === 0x002b) {
    // It's the plus sign (+)
    i++;
  }

  if (parser.offset !== i && !DIGITS.has(parser.at(i))) {
    // There was a '+' or '-' followed by a non-digit
    return parser.error([start, i], 0, 'exponent-expected');
  }

  let result = 0;
  while (DIGITS.has(parser.at(i))) {
    result = result * 10 + DIGITS.get(parser.at(i++));
  }

  return parser.success([start, i], sign * result);
}

export function applyExponent(
  parser: Parser,
  start: number,
  value: number
): Result<number> {
  let exp = parseExponent(parser, 'e');
  if (exp.kind === 'success') {
    // Note: using "Math.pow" loses some accuracy, i.e.:
    // `0.1e-4 = 0.000009999999999999999`
    // Instead, use the Javascript parsing function
    // result = result * Math.pow(10, exp.value);
    value = Number.parseFloat(value.toString() + 'e' + exp.value.toString());
  } else if (exp.kind === 'failure') {
    exp = parseExponent(parser, 'p');
    if (exp.kind === 'success') {
      value = value * Math.pow(2, exp.value);
    }
  }
  const end = parser.offset;
  if (exp.kind === 'success' || exp.kind === 'failure') {
    return parser.success([start, end], value);
  }
  return parser.error([start, end], value, 'exponent-expected');
}

export function parseBinaryNumber(parser: Parser): Result<number> {
  const start = parser.offset;
  let i = start;

  // `0b` prefix
  if (parser.at(i++) !== 0x0030 || parser.at(i++) !== 0x0062)
    return parser.failure();

  // Whole part
  let result = 0;
  let done = false;
  while (!done && i < parser.length) {
    const c = HEX_DIGITS.get(parser.at(i++));
    if (c === 0) {
      result = result << 1;
    } else if (c === 1) {
      result = (result << 1) + 1;
    } else if (parser.at(i - 1) === 0x005f) {
      // It's an underscore, skip it
    } else {
      done = true;
      i -= 1;
    }
  }

  // Fractional part. Check for '.'
  if (parser.at(i) === 0x002e) {
    i += 1;
    let frac = 0.5;
    let fracPart = 0;
    done = false;
    while (!done && i < parser.length) {
      const c = HEX_DIGITS.get(parser.at(i++));
      if (c === 0) {
        frac = frac / 2;
      } else if (c === 1) {
        fracPart += frac;
        frac = frac / 2;
      } else if (parser.at(i - 1) === 0x005f) {
        // It's an underscore, skip it
      } else {
        done = true;
        i -= 1;
      }
    }
    result += fracPart;
  }

  // Exponent
  parser.skipTo(i);
  return applyExponent(parser, start, result);
}

export function parseHexadecimalNumber(parser: Parser): Result<number> {
  const start = parser.offset;
  let i = start;

  // `0x` prefix
  if (parser.at(i++) !== 0x0030 || parser.at(i++) !== 0x0078) {
    return parser.failure();
  }

  // Whole part
  let result = 0;
  let done = false;
  while (!done && i < parser.length) {
    const c = parser.at(i++);
    if (HEX_DIGITS.has(c)) {
      result = result * 16 + HEX_DIGITS.get(c);
    } else if (c !== 0x005f) {
      // If it's neither a digit nor a "_" separator, we're done
      done = true;
      i -= 1;
    }
  }

  // Fractional part
  if (parser.at(i++) === 0x002e) {
    let frac = 0.0625; // 1/16
    done = false;
    let fracPart = 0;
    while (!done && i < parser.length) {
      const c = parser.at(i++);
      if (HEX_DIGITS.has(c)) {
        fracPart += frac * HEX_DIGITS.get(c);
        frac = frac / 16;
      } else if (c !== 0x005f) {
        // If it's neither a digit nor a "_" separator, we're done
        done = true;
        i -= 1;
      } else {
        return parser.error(
          [start, i],
          result + fracPart,
          'hexadecimal-number-expected'
        );
      }
    }
    result += fracPart;
  }

  // Exponent
  parser.skipTo(i);
  return applyExponent(parser, start, result);
}

export function parseFloatingPointNumber(parser: Parser): Result<number> {
  const start = parser.offset;
  if (!DIGITS.has(parser.at(start))) return parser.failure();

  let i = start;

  // Whole part
  let result = 0;
  let done = false;
  while (!done && i < parser.length) {
    const c = parser.at(i++);
    if (DIGITS.has(c)) {
      result = result * 10 + DIGITS.get(c);
    } else if (c !== 0x005f) {
      // If it's neither a digit nor a "_" separator, we're done
      done = true;
      i -= 1;
    }
  }

  // Fractional part
  if (parser.at(i) === 0x002e) {
    i += 1;
    let frac = 0.1; // 1/10
    done = false;
    let fracPart = 0;
    while (!done && i < parser.length) {
      const c = parser.at(i++);
      if (DIGITS.has(c)) {
        fracPart += frac * DIGITS.get(c);
        frac = frac / 10;
      } else if (c !== 0x005f) {
        // If it's neither a digit nor a "_" separator, we're done
        done = true;
        i -= 1;
      } else {
        return parser.error(
          [start, i],
          result + fracPart,
          'decimal-number-expected'
        );
      }
    }
    result += fracPart;
  }

  // Exponent
  parser.skipTo(i);
  return applyExponent(parser, start, result);
}

export function parseNumber(parser: Parser): Result<number> {
  // Note: the order of the parsing matters.
  // Parse the numbers with a `0` prefix first (`0b`, `0x`)
  // then parse floating point number last.
  // Otherwise "0" is ambiguous.
  let result = parseBinaryNumber(parser);
  if (result.kind === 'failure') result = parseHexadecimalNumber(parser);
  if (result.kind === 'failure') result = parseFloatingPointNumber(parser);

  return result;
}

export function parseSignedNumber(parser: Parser): Result<number> {
  const start = parser.offset;
  let i = start;
  // Is it the minus sign (-)
  let sign = 1;
  if (parser.at(i) === 0x002d) {
    i++;
    sign = -1;
  } else if (parser.at(i) === 0x002b) {
    // It's the plus sign (+)
    i++;
  }
  parser.skipTo(i);
  const result = parseNumber(parser);

  if (result.kind === 'success') {
    return parser.success([start, result.next], sign * result.value);
  }
  if (result.kind === 'error') {
    return parser.errors(
      [start, result.next],
      sign * result.value,
      result.errors
    );
  }

  parser.skipTo(start);
  return parser.failure();
}
