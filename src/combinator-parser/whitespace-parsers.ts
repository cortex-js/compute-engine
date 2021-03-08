import { codePointLength, isWhitespace } from './characters';
import { Ignore, Error, ParserState, skipUntilNewline } from './parsers';

/**
 * Whitespace includes space, tab, mathematical space, and comments.
 */
export function parseWhitespace(parser: ParserState): Ignore | Error {
  let done = false;
  const start = parser.offset;
  let i = start;
  while (!done && i < parser.length) {
    while (!done) {
      const c = parser.at(i);
      done = !isWhitespace(c);
      if (!done) i += codePointLength(c);
    }
    let result: Ignore | Error = parseLineComment(parser.skipTo(i));
    result = parseBlockComment(parser.skipTo(result.next));
    if (result.kind === 'error') return result;
    done = parser.offset === result.next;
    parser.skipTo(result.next);
  }
  const end = parser.offset;
  return parser.skipTo(start).ignore(end);
}

export function parseLineComment(parser: ParserState): Ignore {
  const start = parser.offset;
  // Check for "//"
  if (parser.at(start) === 0x002f && parser.at(start + 1) === 0x002f) {
    skipUntilNewline(parser);
  }
  const end = parser.offset;
  return parser.skipTo(start).ignore(end);
}

export function parseBlockComment(parser: ParserState): Ignore | Error {
  // `/*` prefix
  let i = parser.offset;
  if (parser.at(i) !== 0x002f || parser.at(i + 1) !== 0x002a) {
    return parser.ignore(parser.offset);
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
      parser.offset + i,
      undefined,
      'end-of-comment-expected'
    );
  }
  return parser.ignore(i);
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
