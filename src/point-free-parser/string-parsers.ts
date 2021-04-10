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
  const result = new Result<string>(parser);
  // Is it a backslash?
  if (parser.get(parser.offset) !== 0x005c) return result.failure();

  const start = parser.offset;

  // Is is a common escape sequence? ("\b", "\n", etc...)
  const replacement = REVERSED_ESCAPED_CHARS.get(parser.get(start + 1));
  if (replacement !== undefined) {
    parser.skipTo(start + 2);
    return result.success(String.fromCodePoint(replacement));
  }

  // Is i a Unicode escape sequence: "\u0041", "\u{0041}"
  let i = start + 1;
  const escapeChar = parser.get(i++);

  // Is it a "u"?
  if (escapeChar !== 0x0075) {
    parser.skipTo(i);
    // Some unrecognized escape sequence, i.e. `\z`. Return "z" and an error.
    return result.errorAt(
      String.fromCodePoint(escapeChar),
      ['invalid-escape-sequence', '\\' + String.fromCodePoint(escapeChar)],
      start
    );
  }

  let code = 0;
  let invalidChar = false;
  let done = false;
  let codepointString = '';
  //  Is it a `{`
  if (parser.get(i) === 0x007b) {
    i += 1;
    // At least one and up to 8 hex digits
    while (!done && i < start + 11) {
      const c = parser.get(i++);
      codepointString += String.fromCodePoint(c);
      invalidChar = invalidChar || !HEX_DIGITS.has(c);
      if (!invalidChar) code = 16 * code + HEX_DIGITS.get(c);
      done = parser.get(i) === 0x007d; // "}"
    }
    if (done) i += 1;
  } else {
    // Exactly 4 hex digits
    while (!invalidChar && i <= parser.offset + 5) {
      const c = parser.get(i++);
      codepointString += String.fromCodePoint(c);
      invalidChar = !HEX_DIGITS.has(c);
      if (!invalidChar) code = 16 * code + HEX_DIGITS.get(c);
    }
    done = i <= parser.length;
  }
  parser.skipTo(i);
  if (invalidChar || !done) {
    return result.errorAt(
      '\ufffd',
      ['invalid-unicode-codepoint-string', codepointString],
      start
    );
  }

  // Validate that the codepoint is a Unicode scalar value:
  // - In the range of Unicode codepoints: [0..0x10ffff]
  // - Not in the Surrogate range (a surrogate codepoint is valid
  // as part of a UTF-16 encoding, but not as a standalone codepoint)
  // If not return `'\ufffd'`, the Unicode Replacement Character.
  if (code > 0x10ffff) {
    return result.errorAt(
      '\ufffd',
      [
        'invalid-unicode-codepoint-value',
        'U+' + ('00000' + code.toString(16)).slice(-8).toUpperCase(),
      ],
      start
    );
  }
  if (code >= 0xd800 && code <= 0xdfff) {
    return result.errorAt(
      '\ufffd',
      [
        'invalid-unicode-codepoint-value',
        'U+' + ('0000' + code.toString(16)).slice(-4).toUpperCase(),
      ],
      start
    );
  }
  return result.success(String.fromCodePoint(code));
}

/** A key string is a sequence of non-White_Space, non-Syntax characters */
export function parseKeyString(parser: Parser): Result<string> {
  // @todo
  const result = new Result<string>(parser);
  return result.failure();
}

/** An extended string is surrounded by `###"..."###` or `#"..."#` and
 * contains no escape sequence. Convenient for strings that contain lots
 * of characters that would otherwise need to be escaped: quotation marks,
 * backslash, etc...
 *
 */
export function parseExtendedString(parser: Parser): Result<string> {
  const start = parser.offset;
  const result = new Result<string>(parser);

  // Not a hashtag? Bail.
  if (parser.get(start) !== 0x0023) return result.failure();

  // Look for a sequence of '#'s
  let prefixLength = 0;
  let i = start;
  while (parser.get(i++) === 0x0023) prefixLength += 1;

  i -= 1;

  // Not a quote? We bail.
  if (parser.get(i++) !== 0x0022) return result.failure();

  let value = '';
  let done = false;
  let found = false;
  do {
    const c = parser.get(i++);
    done = i >= parser.length || isLinebreak(c);
    if (c === 0x0022) {
      // We have a quote.
      // Do we have a string of '#'?
      let j = prefixLength;
      while (j > 0 && parser.get(i + j - 1) === 0x0023) j -= 1;
      found = j === 0;
      if (found) i += prefixLength;
    }
    if (!done && !found) value += String.fromCodePoint(c);
  } while (!done && !found);

  parser.skipTo(i);
  if (!found) {
    return result.error(value, [
      'string-literal-closing-delimiter-expected',
      '#'.repeat(prefixLength) + '"',
    ]);
  }
  return result.success(value);
}

/** At the `\` of a `\(...)` expression */
export function parseInterpolation<IR>(
  parser: Parser,
  expression?: string | ((parser: Parser) => Result<IR>)
): Result<IR> {
  const result = new Result<IR>(parser);
  if (
    expression === undefined ||
    parser.get(parser.offset) !== 0x005c ||
    parser.get(parser.offset + 1) !== 0x0028
  ) {
    return result.failure();
  }

  const startExpr = parser.offset + 2;
  const expr = parser.parse(expression, startExpr);
  result.copyDiagnostics(expr);

  // After the expression, we should have a closing parenthesis
  if (parser.get(parser.offset) !== 0x0029) {
    return result.error(expr.value, ['closing-bracket-expected', ')']);
  }
  parser.skipTo(parser.offset + 1);

  result.value = expr.value;
  return result;
}

/** A single line string is surrounded by quotation mark and may include escape sequences.
 *
 * @param expression - a function that parses an expression inside a `\()` escape sequence
 *
 */
export function parseSingleLineString<T>(
  parser: Parser,
  expression?: string | ((parser: Parser) => Result<T>)
): Result<(string | T)[]> {
  const result = new Result<(string | T)[]>(parser);
  const start = parser.offset;
  // Not a quote? Bail.
  if (parser.get(start) !== 0x0022) return result.failure();

  if (parser.get(start + 1) === 0x0022 && parser.get(start + 2) !== 0x0022) {
    // This is two quotes in a row, but not three.
    // It's the empty string!
    parser.skipTo(parser.offset + 2);
    return result.success(['']);
  }

  // Is this three quotes in a row?
  if (parser.get(start + 1) === 0x0022 && parser.get(start + 2) === 0x0022) {
    // It's not a single line string (might be a multiline string)
    return result.failure();
  }

  // It **is** a single line string
  let done = false;
  let found = false;
  parser.skipTo(start + 1);
  const values: (string | T)[] = [];
  let value = '';
  while (!done && !found && !parser.atEnd()) {
    const c = parser.get(parser.offset);
    found = c === 0x0022;
    done = isLinebreak(c);
    if (c === 0x005c) {
      const interpolation = parseInterpolation(parser, expression);
      if (!interpolation.isFailure) {
        values.push(value);
        value = '';
        result.copyDiagnostics(interpolation);
        values.push(interpolation.value);
      } else {
        const escape = parseEscapeSequence(parser);
        result.copyDiagnostics(escape);
        if (escape.isSuccess) {
          value += escape.value;
        } else if (escape.isError) {
          value += '\\' + escape.value;
        }
      }
    } else {
      if (!done && !found) value += String.fromCodePoint(c);
      parser.skipTo(parser.offset + 1);
    }
  }

  if (value) {
    values.push(value);
    value = '';
  }

  if (!found) {
    if (values.length === 0 && (parser.atEnd() || parser.atLinebreak())) {
      // We have a quote at the end of a line, that's probably an end-quote
      // with a missing open-quote.
      return result.error(
        [''],
        ['string-literal-opening-delimiter-expected', '"']
      );
    } else {
      return result.error(values, [
        'string-literal-closing-delimiter-expected',
        '"',
      ]);
    }
  }

  result.success(values);
  return result;
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
  expression: string // (parser: Parser) => Result<T>
): Result<(string | T)[]> {
  const result = new Result<(string | T)[]>(parser);
  const start = parser.offset;
  // Do we have three quotes in a row?
  if (
    parser.get(start) !== 0x0022 ||
    parser.get(start + 1) !== 0x0022 ||
    parser.get(start + 2) !== 0x0022
  ) {
    return result.failure();
  }

  skipInlineSpaces(parser.skipTo(start + 3));

  if (!parser.atLinebreak()) {
    return result.error([''], 'multiline-string-expected');
  }

  skipLinebreak(parser);

  // Iterate over each line...

  let done = false;
  let i = parser.offset;
  const lines: (string | T)[][] = [];
  let values: (string | T)[] = [];
  let value: string | T = '';
  while (!done && i < parser.length) {
    const c = parser.get(i);
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
        parser.get(i + 1) === 0x0022 &&
        parser.get(i + 2) === 0x0022;
      if (c === 0x005c) {
        // We have an escape sequence...
        if (isLinebreak(parser.get(i + 1))) {
          // It's a `\\\n` sequence, just add them, we'll handle them later
          value += '\\\n';
          i += 2;
        } else {
          parser.skipTo(i);
          const interpolation = parseInterpolation<T>(parser, expression);
          if (!interpolation.isFailure) {
            i = parser.offset;
            values.push(value);
            value = '';
            result.copyDiagnostics(interpolation);
            values.push(interpolation.value);
          } else {
            const escape = parseEscapeSequence(parser);
            i = parser.offset;
            if (escape.isSuccess) {
              value += escape.value;
            } else if (escape.isError) {
              value += String.fromCodePoint(c);
              result.copyDiagnostics(escape);
            }
          }
        }
      } else {
        if (!done) value += String.fromCodePoint(c);
        i += 1;
      }
    }
  }
  parser.skipTo(i + 2);

  const prefix = value;
  let validPrefix = true;
  if (prefix.length > 0) {
    // If there is a "prefix"...
    for (const c of prefix) {
      if (!isInlineSpace(c.codePointAt(0))) validPrefix = false;
    }
    if (validPrefix) {
      // Remove the prefix from all the other lines
      // @todo: the lines *must* start with the prefix
      for (const line of lines) {
        if (typeof line[0] === 'string' && line[0].startsWith(prefix)) {
          line[0] = line[0].slice(prefix.length);
        }
      }
    }
  }

  let resultValue: (string | T)[] = [];

  for (let i = 0; i <= lines.length - 1; i++) {
    const line = lines[i];
    const lastItem = line[line.length - 1];
    if (
      typeof lastItem === 'string' &&
      lastItem[lastItem.length - 1] === '\\'
    ) {
      line[line.length - 1] = lastItem.slice(-1);
      resultValue = [...resultValue, ...line];
    } else if (i === lines.length - 1) {
      resultValue = [...resultValue, ...line];
    } else {
      resultValue = [...resultValue, ...line, '\n'];
    }
  }

  if (!validPrefix) {
    return result.error(resultValue, 'multiline-whitespace-expected');
  }

  result.value = resultValue;
  return result;
}
