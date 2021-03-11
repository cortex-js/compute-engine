import { Signal } from '../public';
import {
  REVERSED_ESCAPED_CHARS,
  HEX_DIGITS,
  isLinebreak,
  isInlineSpace,
} from './characters';
import { Parser, Result } from './parsers';
import { skipInlineSpaces, skipLinebreak } from './whitespace-parsers';

/** Parse an escape sequence such as `\n` or `\u0041`*/
export function parseEscapeSequence(parser: Parser): Result<string> {
  const start = parser.offset;
  let code = parser.at(start);
  // Is it a backslash?
  if (code !== 0x005c) return parser.failure();

  // Is is a common escape sequence? ("\b", "\n", etc...)
  const replacement = REVERSED_ESCAPED_CHARS.get(parser.at(parser.offset + 1));
  if (replacement !== undefined) {
    return parser.success(
      [start, start + 2],
      String.fromCodePoint(replacement)
    );
  }

  // It's a Unicode escape sequence: "\u0041", "\u{0041}"
  code = 0;
  let i = parser.offset + 1;
  const escapeChar = parser.at(i++);
  // Is it a "u"?
  if (escapeChar === 0x0075) {
    let invalidChar = false;
    let done = false;
    let codepointString = '';
    //  Is it a `{`
    if (parser.at(i) === 0x007b) {
      i += 1;
      // At least one and up to 8 hex digits
      while (!done && i < start + 11) {
        const c = parser.at(i++);
        codepointString += String.fromCodePoint(c);
        invalidChar = invalidChar || !HEX_DIGITS.has(c);
        if (!invalidChar) code = 16 * code + HEX_DIGITS.get(c);
        done = parser.at(i) === 0x007d; // "}"
      }
      if (done) i += 1;
    } else {
      // Exactly 4 hex digits
      while (!invalidChar && i <= parser.offset + 5) {
        const c = parser.at(i++);
        codepointString += String.fromCodePoint(c);
        invalidChar = !HEX_DIGITS.has(c);
        if (!invalidChar) code = 16 * code + HEX_DIGITS.get(c);
      }
      done = i <= parser.length;
    }
    if (invalidChar || !done) {
      return parser.error([start, i, start], '\ufffd', [
        'invalid-unicode-codepoint-string',
        codepointString,
      ]);
    }

    // Validate that the codepoint is a valid Unicode codepoint
    // - In the range of Unicode codepoints: [0..0x10ffff]
    // - Not in the Surrogate range (a surrogate codepoint is valid
    // as part of a UTF-16 encoding, but not as a standalone codepoint)
    // If not return `'\ufffd'`, the Unicode Replacement Character.
    if (code > 0x10ffff) {
      return parser.error([start, i, start], '\ufffd', [
        'invalid-unicode-codepoint-value',
        'U+' + ('00000' + code.toString(16)).slice(-8).toUpperCase(),
      ]);
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      return parser.error([start, i, start], '\ufffd', [
        'invalid-unicode-codepoint-value',
        'U+' + ('0000' + code.toString(16)).slice(-4).toUpperCase(),
      ]);
    }
    return parser.success([start, i], String.fromCodePoint(code));
  }

  // Some unrecognized escape sequence, i.e. `\z`. Return "z" and an error.
  return parser.error([start, i], String.fromCodePoint(escapeChar), [
    'invalid-escape-sequence',
    '\\' + String.fromCodePoint(escapeChar),
  ]);
}

/** A key string is a sequence of non-White_Space, non-Syntax characters */
export function parseKeyString(parser: Parser): Result<string> {
  // @todo
  return parser.failure();
}

/** A extended string is surrounded by `###"..."###` or `#"..."#` and
 * contains no escape sequence. Convenient for strings that contain lots
 * of characters that would otherwise need to be escaped: quotation marks,
 * backslash, etc...
 *
 */
export function parseExtendedString(parser: Parser): Result<string> {
  const start = parser.offset;
  // Not a hashtag? Bail.
  if (parser.at(start) !== 0x0023) return parser.failure();

  // Look for a sequence of '#'s
  let prefixLength = 0;
  let i = start;
  while (parser.at(i++) === 0x0023) prefixLength += 1;

  i -= 1;

  // Not a quote? We bail.
  if (parser.at(i++) !== 0x0022) return parser.failure();

  let value = '';
  let done = false;
  let found = false;
  do {
    const c = parser.at(i++);
    done = i >= parser.length || isLinebreak(c);
    if (c === 0x0022) {
      // We have a quote.
      // Do we have a string of '#'?
      let j = prefixLength;
      while (j > 0 && parser.at(i + j - 1) === 0x0023) j -= 1;
      found = j === 0;
      if (found) i += prefixLength;
    }
    if (!done && !found) value += String.fromCodePoint(c);
  } while (!done && !found);

  if (!found) {
    return parser.error([start, i], value, [
      'string-literal-closing-delimiter-expected',
      '#'.repeat(prefixLength) + '"',
    ]);
  }
  return parser.success([start, i], value);
}

/** At the `\` of a `\(...)` expression */
export function parseInterpolation<T>(
  parser: Parser,
  expression?: (parser: Parser) => Result<T>
): Result<T> {
  if (
    typeof expression !== 'function' ||
    parser.at(parser.offset) !== 0x005c ||
    parser.at(parser.offset + 1) !== 0x0028
  ) {
    return parser.failure();
  }

  const startExpr = parser.offset + 2;
  const expr = expression(parser.skipTo(startExpr));
  const errors = expr.kind === 'error' ? [...expr.errors] : [];

  // After the expression, we should have a closing parenthesis
  if (parser.at(parser.offset) !== 0x0029) {
    errors.push({
      severity: 'error',
      message: ['closing-bracket-expected', ')'],
      origin: { offset: startExpr },
    });
  }

  const value =
    expr.kind === 'error' || expr.kind === 'success' ? expr.value : undefined;

  if (errors.length > 0) {
    return parser.errors([startExpr, parser.offset + 1], value, errors);
  }
  if (expr.kind === 'failure' || expr.kind === 'ignore') {
    return parser.ignore([startExpr, parser.offset + 1]);
  }
  return parser.success([startExpr, parser.offset + 1], value);
}

/** A single line string is surrounded by quotation mark and may include escape sequences.
 *
 * @param expression - a function that parses an expression inside a `\()` escape sequence
 *
 */
export function parseSingleLineString<T>(
  parser: Parser,
  expression?: (parser: Parser) => Result<T>
): Result<(string | T)[]> {
  const start = parser.offset;
  // Not a quote? Bail.
  if (parser.at(start) !== 0x0022) return parser.failure();

  if (parser.at(start + 1) === 0x0022 && parser.at(start + 2) !== 0x0022) {
    // This is two quotes in a row, but not three.
    // It's the empty string!
    return parser.success([start, start + 2], ['']);
  }

  // Is this three quotes in a row?
  if (parser.at(start + 1) === 0x0022 && parser.at(start + 2) === 0x0022) {
    // It's not a single line string (might be a multiline string)
    return parser.failure();
  }

  // It **is** a single line string
  let done = false;
  let found = false;
  let i = start + 1;
  let errors: Signal[] = [];
  const values: (string | T)[] = [];
  let value = '';
  while (!done && !found && i < parser.length) {
    const c = parser.at(i);
    found = c === 0x0022;
    done = isLinebreak(c);
    if (c === 0x005c) {
      parser.skipTo(i);
      const interpolation = parseInterpolation(parser, expression);
      if (interpolation.kind !== 'failure') {
        i = interpolation.next;
        values.push(value);
        value = '';
        if (interpolation.kind === 'success') {
          values.push(interpolation.value);
        } else if (interpolation.kind === 'error') {
          values.push(interpolation.value);
          errors = [...errors, ...interpolation.errors];
        }
      } else {
        const escape = parseEscapeSequence(parser);
        i = escape.next;
        if (escape.kind === 'success') {
          value += escape.value;
        } else if (escape.kind === 'error') {
          value += String.fromCodePoint(c);
          errors = [...errors, ...escape.errors];
        }
      }
    } else {
      if (!done && !found) value += String.fromCodePoint(c);
      i += 1;
    }
  }

  if (value) {
    values.push(value);
    value = '';
  }

  if (!found) {
    if (
      values.length === 0 &&
      (i >= parser.length || isLinebreak(parser.at(i)))
    ) {
      // We have a quote at the end of a line, that's probably an end-quote
      // with a missing open-quote.
      errors.push({
        severity: 'error',
        message: ['string-literal-opening-delimiter-expected', '"'],
        origin: { offset: i - 1 },
      });
    } else {
      errors.push({
        severity: 'error',
        message: ['string-literal-closing-delimiter-expected', '"'],
        origin: { offset: i - 1 },
      });
    }
  }

  if (errors.length > 0) return parser.errors([start, i], values, errors);

  return parser.success([start, i], values);
}

/**
 * A multiline line string begins and end with a triple quotation mark """
 * It can span multiple lines and contain escape sequences.
 *
 * @param expression - a function that parses an expresion inside a `\()`
 * escape sequence
 *
 */
export function parseMultilineString<T>(
  parser: Parser,
  expression: (parser: Parser) => Result<T>
): Result<(string | T)[]> {
  const start = parser.offset;
  // Do we have three quotes in a row?
  if (
    parser.at(start) !== 0x0022 ||
    parser.at(start + 1) !== 0x0022 ||
    parser.at(start + 2) !== 0x0022
  ) {
    return parser.failure();
  }

  skipInlineSpaces(parser.skipTo(start + 3));

  if (!parser.atLinebreak()) {
    return parser.error(
      [start, parser.offset],
      [''],
      'multiline-string-expected'
    );
  }

  skipLinebreak(parser);

  // Iterate over each line...

  let done = false;
  let i = parser.offset;
  let errors: Signal[] = [];
  const lines: (string | T)[][] = [];
  let values: (string | T)[] = [];
  let value = '';
  while (!done && i < parser.length) {
    const c = parser.at(i);
    if (isLinebreak(c)) {
      // We got a new line.
      if (value) values.push(value);
      value = '';
      lines.push(values);
      values = [];
      skipLinebreak(parser.skipTo(i));
      i = parser.offset;
    } else {
      // We're on a line...
      done =
        c === 0x0022 &&
        parser.at(i + 1) === 0x0022 &&
        parser.at(i + 2) === 0x0022;
      if (c === 0x005c) {
        // We have an escape sequence...
        if (isLinebreak(parser.at(i + 1))) {
          // It's a `\\\n` sequence, just add them, we'll handle them later
          value += '\\\n';
          i += 2;
        } else {
          parser.skipTo(i);
          const interpolation = parseInterpolation(parser, expression);
          if (interpolation.kind !== 'failure') {
            i = interpolation.next;
            values.push(value);
            value = '';
            if (interpolation.kind === 'success') {
              values.push(interpolation.value);
            } else if (interpolation.kind === 'error') {
              values.push(interpolation.value);
              errors = [...errors, ...interpolation.errors];
            }
          } else {
            const escape = parseEscapeSequence(parser);
            i = escape.next;
            if (escape.kind === 'success') {
              value += escape.value;
            } else if (escape.kind === 'error') {
              value += String.fromCodePoint(c);
              errors = [...errors, ...escape.errors];
            }
          }
        }
      } else {
        if (!done) value += String.fromCodePoint(c);
        i += 1;
      }
    }
  }

  const prefix = value;
  if (prefix.length > 0) {
    // If there is a "prefix"...
    let validPrefix = true;
    for (const c of prefix) {
      if (!isInlineSpace(c.codePointAt(0))) validPrefix = false;
    }
    if (!validPrefix) {
      errors.push({
        severity: 'error',
        message: 'multiline-whitespace-expected',
        origin: { offset: i - 1 },
      });
    } else {
      // Remove the prefix from all the other lines
      for (const line of lines) {
        if (typeof line[0] === 'string' && line[0].startsWith(prefix)) {
          line[0] = line[0].slice(prefix.length);
        }
      }
    }
  }

  let result: (string | T)[] = [];

  for (let i = 0; i <= lines.length - 1; i++) {
    const line = lines[i];
    const lastItem = line[line.length - 1];
    if (
      typeof lastItem === 'string' &&
      lastItem[lastItem.length - 1] === '\\'
    ) {
      line[line.length - 1] = lastItem.slice(-1);
      result = [...result, ...line];
    } else if (i === lines.length - 1) {
      result = [...result, ...line];
    } else {
      result = [...result, ...line, '\n'];
    }
  }

  if (errors.length > 0) return parser.errors([start, i + 2], result, errors);

  return parser.success([start, i + 2], result);
}
