import { DIGITS, HEX_DIGITS } from './characters.ts';
import { Parser, Result } from './parsers.ts';

// @todo: the numeric parsers should return strings rather than
// number to better support big numbers

export function parseExponent(
  parser: Parser,
  prefix: 'e' | 'p'
): Result<number> {
  const result = new Result<number>(parser);
  const start = parser.offset;
  let i = start;
  if (i >= parser.length) return result.failure();
  if (prefix === 'p') {
    if (parser.get(i) !== 0x0070 && parser.get(i) !== 0x0050)
      return result.failure();
  } else {
    // Prefix 'e' or 'E'
    if (parser.get(i) !== 0x0065 && parser.get(i) !== 0x0045)
      return result.failure();
  }
  i += 1;

  let sign = 1;
  // Is it the minus sign (-)
  if (parser.get(i) === 0x002d) {
    i++;
    sign = -1;
  } else if (parser.get(i) === 0x002b) {
    // It's the plus sign (+)
    i++;
  }

  if (parser.offset !== i && !DIGITS.has(parser.get(i))) {
    // There was a '+' or '-' followed by a non-digit
    parser.skipTo(i);
    return result.error(0, 'exponent-expected');
  }

  let value = 0;
  while (DIGITS.has(parser.get(i))) {
    value = value * 10 + DIGITS.get(parser.get(i++))!;
  }

  parser.skipTo(i);
  return result.success(sign * value);
}

export function applyExponent(
  parser: Parser,
  start: number,
  value: number
): Result<number> {
  const result = new Result<number>(parser);
  let exp = parseExponent(parser, 'e');
  if (exp.isSuccess) {
    // Note: using "Math.pow" loses some accuracy, i.e.:
    // `0.1e-4 = 0.000009999999999999999`
    // Instead, use the JavaScript parsing function
    // result = result * Math.pow(10, exp.value);
    value = Number.parseFloat(value.toString() + 'e' + exp.value!.toString());
  } else if (exp.isFailure) {
    exp = parseExponent(parser, 'p');
    if (exp.isSuccess) {
      value = value * Math.pow(2, exp.value!);
    }
  }
  if (exp.isSuccess || exp.isFailure) return result.success(value);

  return result.error(value, 'exponent-expected');
}

export function parseBinaryNumber(parser: Parser): Result<number> {
  const result = new Result<number>(parser);
  const start = parser.offset;
  let i = start;

  // `0b` prefix
  if (parser.get(i++) !== 0x0030 || parser.get(i++) !== 0x0062) {
    return result.failure();
  }

  // Whole part
  let value = 0;
  let done = false;
  while (!done && i < parser.length) {
    const c = HEX_DIGITS.get(parser.get(i++));
    if (c === 0) {
      value = value << 1;
    } else if (c === 1) {
      value = (value << 1) + 1;
    } else if (parser.get(i - 1) === 0x005f) {
      // It's an underscore, skip it
    } else {
      done = true;
      i -= 1;
    }
  }

  // Fractional part. Check for '.'
  if (parser.get(i) === 0x002e) {
    i += 1;
    let frac = 0.5;
    let fracPart = 0;
    done = false;
    while (!done && i < parser.length) {
      const c = HEX_DIGITS.get(parser.get(i++));
      if (c === 0) {
        frac = frac / 2;
      } else if (c === 1) {
        fracPart += frac;
        frac = frac / 2;
      } else if (parser.get(i - 1) === 0x005f) {
        // It's an underscore, skip it
      } else {
        done = true;
        i -= 1;
      }
    }
    value += fracPart;
  }

  // Exponent
  parser.skipTo(i);
  return applyExponent(parser, start, value);
}

export function parseHexadecimalNumber(parser: Parser): Result<number> {
  const result = new Result<number>(parser);
  const start = parser.offset;
  let i = start;

  // `0x` prefix
  if (parser.get(i++) !== 0x0030 || parser.get(i++) !== 0x0078) {
    return result.failure();
  }

  // Whole part
  let value = 0;
  let done = false;
  while (!done && i < parser.length) {
    const c = parser.get(i++);
    if (HEX_DIGITS.has(c)) {
      value = value * 16 + HEX_DIGITS.get(c)!;
    } else if (c !== 0x005f) {
      // If it's neither a digit nor a "_" separator, we're done
      done = true;
      i -= 1;
    }
  }

  // Fractional part
  if (parser.get(i++) === 0x002e) {
    let frac = 0.0625; // 1/16
    done = false;
    let fracPart = 0;
    while (!done && i < parser.length) {
      const c = parser.get(i++);
      if (HEX_DIGITS.has(c)) {
        fracPart += frac * HEX_DIGITS.get(c)!;
        frac = frac / 16;
      } else if (c !== 0x005f) {
        // If it's neither a digit nor a "_" separator, we're done
        done = true;
        i -= 1;
      } else {
        parser.skipTo(i);
        return result.error(value + fracPart, 'hexadecimal-number-expected');
      }
    }
    value += fracPart;
  }

  // Exponent
  parser.skipTo(i);
  return applyExponent(parser, start, value);
}

export function parseFloatingPointNumber(parser: Parser): Result<number> {
  const result = new Result<number>(parser);
  const start = parser.offset;
  if (!DIGITS.has(parser.get(start))) return result.failure();

  let i = start;

  // Whole part
  let value = 0;
  let done = false;
  while (!done && i < parser.length) {
    const c = parser.get(i++);
    if (DIGITS.has(c)) {
      value = value * 10 + DIGITS.get(c)!;
    } else if (c !== 0x005f) {
      // If it's neither a digit nor a "_" separator, we're done
      done = true;
      i -= 1;
    }
  }

  // Fractional part
  if (parser.get(i) === 0x002e) {
    i += 1;
    let frac = 0.1; // 1/10
    done = false;
    let fracPart = 0;
    while (!done && i < parser.length) {
      const c = parser.get(i++);
      if (DIGITS.has(c)) {
        fracPart += frac * DIGITS.get(c)!;
        frac = frac / 10;
      } else if (c !== 0x005f) {
        // If it's neither a digit nor a "_" separator, we're done
        done = true;
        i -= 1;
      } else {
        parser.skipTo(i);
        return result.error(value + fracPart, 'decimal-number-expected');
      }
    }
    value += fracPart;
  }

  // Exponent
  parser.skipTo(i);
  return applyExponent(parser, start, value);
}

export function parseNumber(parser: Parser): Result<number> {
  // Note: the order of the parsing matters.
  // Parse the numbers with a `0` prefix first (`0b`, `0x`)
  // then parse floating point number last.
  // Otherwise "0" is ambiguous.
  let result = parseBinaryNumber(parser);
  if (result.isFailure) result = parseHexadecimalNumber(parser);
  if (result.isFailure) result = parseFloatingPointNumber(parser);

  return result;
}

export function parseSignedNumber(parser: Parser): Result<number> {
  const result = new Result<number>(parser);
  const start = parser.offset;
  let i = start;
  // Is it the minus sign (-)
  let sign = 1;
  if (parser.get(i) === 0x002d) {
    i++;
    sign = -1;
  } else if (parser.get(i) === 0x002b) {
    // It's the plus sign (+)
    i++;
  }
  parser.skipTo(i);

  const numResult = parseNumber(parser);
  if (numResult.isSuccess) return result.success(sign * numResult.value!);
  if (numResult.isError) {
    return result.errorFrom(numResult, sign * numResult.value!);
  }
  return result.failure();
}
