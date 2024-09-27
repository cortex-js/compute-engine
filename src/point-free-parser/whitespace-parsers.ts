import { codePointLength, isWhitespace } from './characters.ts';
import { Parser, Result } from './parsers.ts';

export function skipInlineSpaces(parser: Parser): void {
  let i = parser.offset;
  let c: number;
  do {
    c = parser.get(i++);
  } while (c === 0x0020 || c === 0x0009);
  parser.skipTo(i - 1);
}

// export function parseNewline(state: ParserState): Result<void> {
//   let i = state.offset;
//   const c = state.source[i++];
//   if (c === '\r' || c === '\u2028' || c === '\u2029') {
//     return success(state, i);
//   }
//   if (c === '\n') {
//     if (state.source[i] === '\r') return success(state, i + 2);
//     return success(state, i);
//   }
//   return failure(state);
// }

/**
 * Skip all characters until a linebreak
 */
export function skipUntilLinebreak(parser: Parser): void {
  let found = false;
  let i = parser.offset;
  while (!found && i < parser.length) {
    const c = parser.get(i++);
    if (c === 0x000d || c === 0x2028 || c === 0x2029) {
      found = true;
    }
    if (c === 0x000a) {
      if (parser.get(i) === 0x000d) {
        i += 1;
      }
      found = true;
    }
  }
  parser.skipTo(i);
}

/**
 * If we are on a linebreak, skip it
 */
export function skipLinebreak(parser: Parser): void {
  const c = parser.get(parser.offset);
  if (c === 0x000d || c === 0x2028 || c === 0x2029) {
    parser.skipTo(parser.offset + 1);
    return;
  }
  if (c === 0x000a) {
    if (parser.get(parser.offset + 1) === 0x000d) {
      parser.skipTo(parser.offset + 2);
    } else {
      parser.skipTo(parser.offset + 1);
    }
  }
}

/**
 * Whitespace includes space, tab, mathematical space, and comments.
 */
export function parseWhitespace(parser: Parser): Result<boolean> {
  let done = false;
  const result = new Result(parser);
  let i = parser.offset;
  while (!done && i < parser.length) {
    const offset = parser.offset;
    while (!done) {
      const c = parser.get(i);
      done = !isWhitespace(c);
      if (!done) i += codePointLength(c);
    }
    result.copyDiagnostics(parseLineComment(parser.skipTo(i)));
    result.copyDiagnostics(parseBlockComment(parser));
    if (result.isError) return result;
    done = offset === parser.offset;
    i = parser.offset;
  }
  parser.skipTo(i);
  return result.ignore();
}

export function parseLineComment(parser: Parser): Result<boolean> {
  const result = new Result<boolean>(parser);
  // Check for "//"
  if (
    parser.get(parser.offset) === 0x002f &&
    parser.get(parser.offset + 1) === 0x002f
  ) {
    skipUntilLinebreak(parser);
  }
  // @todo: warning for trailing whitespace
  return result.ignore();
}

export function parseBlockComment(parser: Parser): Result<boolean> {
  // `/*` prefix
  const result = new Result<boolean>(parser);
  let i = parser.offset;
  if (parser.get(i) !== 0x002f || parser.get(i + 1) !== 0x002a) {
    return result.failure();
  }
  i += 2;
  let level = 1;
  while (level > 0 && i < parser.length) {
    const c = parser.get(i);
    if (c === 0x002f && parser.get(i + 1) === 0x002a) {
      level += 1;
      i += 2;
    } else if (c === 0x002a && parser.get(i + 1) === 0x002f) {
      level -= 1;
      i += 2;
    } else {
      i += codePointLength(c);
    }
  }
  if (level > 0) {
    parser.skipTo(parser.offset + i);
    return result.errorAt(null, 'end-of-comment-expected', result.start);
  }
  return result.ignoreUntil(i);
}

export function parseShebang(parser: Parser): Result<boolean> {
  // Are the first two characters "#" and "!"?
  const result = new Result<boolean>(parser);
  if (
    parser.offset !== 0 ||
    parser.get(0) !== 0x0023 ||
    parser.get(1) !== 0x0021
  ) {
    return result.failure();
  }
  skipUntilLinebreak(parser);
  return result.success(true);
}
