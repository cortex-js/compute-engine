import { codePointLength, isWhitespace } from './characters';
import { Ignore, Error, ParserState, Failure } from './parsers';

export function skipInlineSpaces(state: ParserState): void {
  let i = state.offset;
  let done = false;
  while (!done) {
    const c = state.at(i);
    done = c !== 0x0020 && c !== 0x0009;
    if (!done) i += 1; // if not done, length of c === 1
  }
  state.skipTo(i);
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

export function skipUntilNewline(state: ParserState): void {
  let found = false;
  let i = state.offset;
  while (!found && i <= state.length) {
    const c = state.at(i++);
    if (c === 0x000d || c === 0x2028 || c === 0x2029) {
      found = true;
    }
    if (c === 0x000a) {
      if (state.at(i) === 0x00d) {
        i += 1;
      }
      found = true;
    }
  }
  state.skipTo(i);
}

/**
 * Whitespace includes space, tab, mathematical space, and comments.
 */
export function parseWhitespace(parser: ParserState): Ignore | Error {
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
    result = parseBlockComment(parser.skipTo(result.next));
    if (result.kind === 'error') return result;
    done = offset === result.next;
    i = result.next;
  }
  return parser.ignore([start, i]);
}

export function parseLineComment(parser: ParserState): Ignore {
  const start = parser.offset;
  // Check for "//"
  if (parser.at(start) === 0x002f && parser.at(start + 1) === 0x002f) {
    skipUntilNewline(parser);
  }
  return parser.ignore([start, parser.offset]);
}

export function parseBlockComment(
  parser: ParserState
): Ignore | Error | Failure {
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
