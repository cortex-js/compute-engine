import { codePointLength, isWhitespace } from './characters';
import { Ignore, Error, Parser, Failure } from './parsers';

export function skipInlineSpaces(parser: Parser): void {
  let i = parser.offset;
  let c: number;
  do {
    c = parser.at(i++);
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

/** Skip all characters until a linebreak */
export function skipUntilLinebreak(parser: Parser): void {
  let found = false;
  let i = parser.offset;
  while (!found && i < parser.length) {
    const c = parser.at(i++);
    if (c === 0x000d || c === 0x2028 || c === 0x2029) {
      found = true;
    }
    if (c === 0x000a) {
      if (parser.at(i) === 0x000d) {
        i += 1;
      }
      found = true;
    }
  }
  parser.skipTo(i);
}

/** If we are on a linebreak, skip it */
export function skipLinebreak(parser: Parser): void {
  const c = parser.at(parser.offset);
  if (c === 0x000d || c === 0x2028 || c === 0x2029) {
    parser.skipTo(parser.offset + 1);
    return;
  }
  if (c === 0x000a) {
    if (parser.at(parser.offset + 1) === 0x000d) {
      parser.skipTo(parser.offset + 2);
    } else {
      parser.skipTo(parser.offset + 1);
    }
  }
}

/**
 * Whitespace includes space, tab, mathematical space, and comments.
 */
export function parseWhitespace(parser: Parser): Ignore | Error {
  let done = false;
  const start = parser.offset;
  let i = start;
  while (!done && i < parser.length) {
    const offset = parser.offset;
    while (!done) {
      const c = parser.at(i);
      done = !isWhitespace(c);
      if (!done) i += codePointLength(c);
    }
    let result: Ignore | Error | Failure = parseLineComment(parser.skipTo(i));
    result = parseBlockComment(parser);
    if (result.kind === 'error') return result;
    done = offset === result.next;
    i = result.next;
  }
  return parser.ignore([start, i]);
}

export function parseLineComment(parser: Parser): Ignore {
  const start = parser.offset;
  // Check for "//"
  if (parser.at(start) === 0x002f && parser.at(start + 1) === 0x002f) {
    skipUntilLinebreak(parser);
  }
  return parser.ignore([start, parser.offset]);
}

export function parseBlockComment(parser: Parser): Ignore | Error | Failure {
  // `/*` prefix
  const start = parser.offset;
  let i = start;
  if (parser.at(i) !== 0x002f || parser.at(i + 1) !== 0x002a) {
    return parser.failure();
  }
  i += 2;
  let level = 1;
  while (level > 0 && i < parser.length) {
    const c = parser.at(i);
    if (c === 0x002f && parser.at(i + 1) === 0x002a) {
      level += 1;
      i += 2;
    } else if (c === 0x002a && parser.at(i + 1) === 0x002f) {
      level -= 1;
      i += 2;
    } else {
      i += codePointLength(c);
    }
  }
  if (level > 0) {
    return parser.error(
      [start, parser.offset + i, start],
      undefined,
      'end-of-comment-expected'
    );
  }
  return parser.ignore([start, i]);
}

export function parseShebang(parser: Parser): Ignore | Failure {
  // Are the first two characters "#" and "!"?
  if (
    parser.offset !== 0 ||
    parser.at(0) !== 0x0023 ||
    parser.at(1) !== 0x0021
  ) {
    return parser.failure();
  }
  skipUntilLinebreak(parser);
  return parser.ignore([0, parser.offset - 1]);
}

/**
 * Parse 0 or more combinations of line comments and block comments,
 * optionally separated by whitespace.
 */
// export function parseMaybeComments(initialState: ParserState): Result<void> {
//   let done = false;
//   const state = skipWhitespace(initialState);
//   let result = parseLineComment(state);
//   if (result.kind === 'failure') result = parseBlockComment(state);
//   while (!done) {
//     result = parseLineComment(result.state);
//     if (result.kind === 'failure') result = parseBlockComment(result.state);

//     done =
//       result.kind !== 'success' ||
//       result.state.offset > initialState.source.length;
//   }
//   if (!result) success(initialState, result.state.offset);
//   return success(
//     initialState,
//     skipWhitespace(nextAt(state, result.state.offset)).offset
//   );
// }
