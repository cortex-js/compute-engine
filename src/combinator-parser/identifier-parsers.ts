import {
  isIdentifierContinueProhibited,
  isIdentifierStartProhibited,
  isBreak,
  isLinebreak,
} from './characters';
import { Parser, Result } from './parsers';
import { parseEscapeSequence } from './string-parsers';

/** A verbatim identifier is enclosed in backticks and can
 * include characters that are otherwise invalid (such as `+`).
 * It can also include escape sequences.
 */
export function parseVerbatimIdentifier(parser: Parser): Result<string> {
  const start = parser.offset;

  // Is it a backtick?
  if (parser.at(parser.offset) !== 0x0060) return parser.failure();
  let done = false;
  let invalidChar = false;
  let i = parser.offset + 1; // Skip the initial backtick
  let id = '';
  let atLinebreak = false;
  while (!done && !atLinebreak && i < parser.length) {
    const code = parser.at(i);
    atLinebreak = isLinebreak(code);
    done = code === 0x0060; // GRAVE ACCENT = backtick
    if (!done) {
      if (code === 0x005c) {
        // Escape sequence
        parser.skipTo(i);
        const escSequence = parseEscapeSequence(parser);
        if (escSequence.kind === 'success') id += escSequence.value;
        i = escSequence.next;
      } else {
        invalidChar = invalidChar || isIdentifierContinueProhibited(code);
        const s = String.fromCodePoint(code);
        id += s;
        i += s.length;
      }
    }
  }

  if (!done) {
    // We reached the end of the line, or end of the source,
    // or found an invalid char without finding the closing '`'
    return parser.error([start, i, start], id ?? 'Missing', [
      'unbalanced-verbatim-symbol',
      id,
    ]);
  }
  if (id.length === 0) {
    return parser.error(
      [start, i + 1, start],
      'Missing',
      'empty-verbatim-symbol'
    );
  }
  if (invalidChar || isIdentifierStartProhibited(id.charCodeAt(0))) {
    return parser.error([start, i + 1], 'Missing', ['invalid-symbol-name', id]);
  }
  return parser.success([start, i + 1], id);
}

export function parseIdentifier(parser: Parser): Result<string> {
  const result = parseVerbatimIdentifier(parser);
  if (result.kind !== 'failure') return result;

  //
  // A non-verbatim identifier
  //
  const start = parser.offset;
  let code = parser.at(start);
  if (isIdentifierStartProhibited(code) || isBreak(code)) {
    return parser.failure('symbol-expected');
  }

  let done = false;
  let i = start;
  let id = '';
  while (!done && i < parser.length) {
    code = parser.at(i);
    done = isBreak(code) || isIdentifierContinueProhibited(code);
    if (!done) {
      const s = String.fromCodePoint(code);
      id += s;
      i += s.length;
    }
  }
  if (id.length === 0) return parser.failure('symbol-expected');
  return parser.success([start, i], id);
}
