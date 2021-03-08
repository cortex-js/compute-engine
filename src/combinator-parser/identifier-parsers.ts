import {
  REVERSED_ESCAPED_CHARS,
  HEX_DIGITS,
  isIdentifierContinueProhibited,
  isIdentifierStartProhibited,
  isBreak,
} from './characters';
import { ParserState, Result } from './parsers';

/** Parse an escape sequence such as `\n` or `\u0041`*/
export function parseEscapeSequence(parser: ParserState): Result<string> {
  let code = parser.at(parser.offset);
  // Is it a backslash?
  if (code !== 0x005c) return parser.failure();

  // Is is a common escape sequence? ("\b", "\n", etc...)
  const replacement = REVERSED_ESCAPED_CHARS.get(parser.at(parser.offset + 1));
  if (replacement !== undefined) {
    return parser.success(parser.offset + 2, String.fromCodePoint(replacement));
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
      while (!done && !invalidChar && i < parser.offset + 8) {
        const c = parser.at(i++);
        codepointString += String.fromCodePoint(c);
        invalidChar = !HEX_DIGITS.has(c);
        if (!invalidChar) code = 16 * code + HEX_DIGITS.get(c);
        done = parser.at(i) !== 0x007d; // "}"
      }
    } else {
      // Exactly 4 hex digits
      while (!invalidChar && i <= parser.offset + 5) {
        codepointString += String.fromCodePoint(parser.at(i));
        invalidChar = !HEX_DIGITS.has(parser.at(i));
        if (!invalidChar) {
          code = 16 * code + HEX_DIGITS.get(parser.at(i));
        }
      }
      done = i < parser.length;
    }
    if (invalidChar || !done) {
      return parser.error(i, '\ufffd', [
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
      return parser.error(i, '\ufffd', [
        'invalid-unicode-codepoint',
        'U+' + ('00000' + code.toString(16)).slice(8),
      ]);
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      return parser.error(i, '\ufffd', [
        'invalid-unicode-codepoint',
        'U+' + ('0000' + code.toString(16)).slice(4),
      ]);
    }
    return parser.success(i, String.fromCodePoint(code));
  }

  // Some unrecognized escape sequence, i.e. `\z`. Return "z" and an error.
  return parser.error(i, String.fromCodePoint(escapeChar), [
    'invalid-escape-sequence',
    '\\' + String.fromCodePoint(escapeChar),
  ]);
}

/** A key string is a sequence of non-White_Space, non-Syntax characters */
export function parseKeyString(parser: ParserState): Result<string> {
  // @todo
  return parser.failure();
}

/** A extended string is surrounded by `###"..."###` or `#"..."#` and
 * contains no escape sequence. Convenient for strings that contain lots
 * of characters that would otherwise need to be escaped: quotation marks,
 * backslash, etc...
 *
 */
export function parseExtendedString(parser: ParserState): Result<string> {
  // @todo
  return parser.failure();
}

/** A single line string is surrounded by quotation mark and may include escape sequences.
 *
 * @param expression - a function that parses an expresion inside a `\()` escape sequence
 *
 */
export function parseSingleLineString(
  parser: ParserState,
  expression: (parser: ParserState) => Result
): Result<string> {
  // @todo
  return parser.failure();
}

/** A multiline line string begins and end with a triple quotation mark """
 * It can span multiple lines and contain escape sequences.
 *
 * @param expression - a function that parses an expresion inside a `\()` escape sequence
 *
 */
export function parseMultilineString(
  parser: ParserState,
  expression: (parser: ParserState) => Result
): Result<string> {
  // @todo
  return parser.failure();
}

export function parseVerbatimIdentifier(parser: ParserState): Result<string> {
  //
  // A verbatim identifier
  //
  const start = parser.offset;

  // Is it a backtick?
  if (parser.at(parser.offset) !== 0x0060) return parser.failure();
  let done = false;
  let invalidChar = false;
  let i = parser.offset + 1; // Skip the initial backtick
  let id = '';
  while (!done && !invalidChar && i < parser.length) {
    const code = parser.at(i);
    done = code === 0x0060; // GRAVE ACCENT = backtick
    if (code === 0x005c) {
      // Escape sequence
      parser.skipTo(i);
      const escSequence = parseEscapeSequence(parser);
      if (escSequence.kind === 'success') id += escSequence.value;
      i = escSequence.next;
    } else {
      invalidChar = isIdentifierContinueProhibited(code);
      if (!done) {
        const s = String.fromCharCode(code);
        id += s;
        i += s.length;
      }
    }
  }

  parser.skipTo(start);
  if (!done) {
    // We reached the end of the line, or end of the source,
    // or found an invalid char without finding the closing '`'
    return parser.error(i, id ?? 'Missing', ['unbalanced-verbatim-symbol', id]);
  }
  if (id.length === 0) {
    return parser.error(i + 1, 'Missing', 'empty-verbatim-symbol');
  }
  if (invalidChar || isIdentifierStartProhibited(id.charCodeAt(0))) {
    return parser.error(i + 1, 'Missing', ['invalid-symbol-name', id]);
  }
  return parser.success(i + 1, id);
}

export function parseIdentifier(parser: ParserState): Result<string> {
  const result = parseVerbatimIdentifier(parser);
  if (result.kind !== 'failure') return result;

  //
  // A non-verbatim identifier
  //
  let code = parser.at(parser.offset);
  if (isIdentifierStartProhibited(code) || isBreak(code)) {
    return parser.failure('symbol-expected');
  }

  let done = false;
  let i = parser.offset;
  let id = '';
  while (!done && i < parser.length) {
    code = parser.at(i);
    done = isBreak(code) || isIdentifierContinueProhibited(code);
    if (!done) {
      const s = String.fromCharCode(code);
      id += s;
      i += s.length;
    }
  }
  if (id.length === 0) return parser.failure('symbol-expected');
  return parser.success(i, id);
}
