import {
  isIdentifierContinueProhibited,
  isIdentifierStartProhibited,
  isBreak,
  isLinebreak,
} from './characters.ts';
import { Parser, Result } from './parsers.ts';
import { parseEscapeSequence } from './string-parsers.ts';

export function parseIdentifier(parser: Parser): Result<string> {
  const result = parseVerbatimIdentifier(parser);
  if (!result.isFailure) return result;

  //
  // A non-verbatim identifier
  //
  const start = parser.offset;
  let code = parser.get(start);
  if (isIdentifierStartProhibited(code) || isBreak(code)) {
    return result.failure();
  }

  let done = false;
  let i = start;
  let id = '';
  while (!done && i < parser.length) {
    code = parser.get(i);
    done = isBreak(code) || isIdentifierContinueProhibited(code);
    if (!done) {
      const s = String.fromCodePoint(code);
      id += s;
      i += s.length;
    }
  }
  if (id.length === 0) return result.failure();
  parser.skipTo(i);
  return result.success(id);
}

/** A verbatim identifier is enclosed in backticks and can
 * include characters that are otherwise invalid (such as `+`).
 * It can also include escape sequences.
 */
export function parseVerbatimIdentifier(parser: Parser): Result<string> {
  const result = new Result<string>(parser);

  // Is it a backtick?
  if (parser.get(parser.offset) !== 0x0060) return result.failure();

  let done = false;
  let invalidChar = false;
  let i = parser.offset + 1; // Skip the initial backtick
  let id = '';
  let atLinebreak = false;
  while (!done && !atLinebreak && i < parser.length) {
    const code = parser.get(i);
    atLinebreak = isLinebreak(code);
    done = code === 0x0060; // GRAVE ACCENT = backtick
    if (!done) {
      if (code === 0x005c) {
        // Escape sequence
        parser.skipTo(i);
        const escSequence = parseEscapeSequence(parser);
        if (escSequence.isSuccess) id += escSequence.value;
        i = parser.offset;
      } else {
        invalidChar = invalidChar || isIdentifierContinueProhibited(code);
        const s = String.fromCodePoint(code);
        id += s;
        i += s.length;
      }
    }
  }
  if (!done) {
    parser.skipTo(i);
    // We reached the end of the line, or end of the source,
    // or found an invalid char without finding the closing '`'
    return result.errorAt(
      'Missing',
      ['unbalanced-verbatim-symbol', id],
      result.start
    );
  }
  parser.skipTo(i + 1);
  if (id.length === 0) {
    return result.errorAt('Missing', 'empty-verbatim-symbol', result.start);
  }
  if (invalidChar || isIdentifierStartProhibited(id.charCodeAt(0))) {
    return result.errorAt('Missing', ['invalid-symbol-name', id], result.start);
  }
  return result.success(id);
}
