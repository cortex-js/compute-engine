import { Signal, SignalCode, SignalMessage } from '../public';
import { codePointLength, REVERSE_FANCY_UNICODE } from './characters';
import {
  ParserState,
  ParsingError,
  Result,
  Success,
  Error,
  Failure,
  Ignore,
  skipUntilString,
} from './parsers';
import { parseWhitespace } from './whitespace-parsers';

export type Combinator<T = any> = (state: ParserState) => Result<T>;

function normalize(
  value: number | string | RegExp | Combinator<string>
): Combinator<string> {
  if (typeof value === 'number') return codepoint(value);

  if (typeof value === 'string') return literal(value);

  if (value instanceof RegExp) return regex(value);

  return value;
}

/**
 * Apply a function to one or more results.
 *
 * Similar to an _action_ with YACC/Bison.
 *
 * Compute the semantic value of the whole construct from the semantic
 * values of its parts.
 */
export function map<T = string, U = T>(
  f: (result: T) => U,
  ...results: Result<T>[]
): Result<U>[] {
  return results.map((x) => {
    if (x.kind === 'failure' || x.kind === 'ignore') return x;
    return { ...x, value: f(x.value) };
  });
}

/** Combine one or more results into a single result. */
export function reduce<T = string, U = T>(
  parser: ParserState,
  f: (...results: T[]) => U,
  ...results: Result<T>[]
): Result<U> {
  const values: T[] = [];
  const ignores: Ignore[] = [];
  const failures: Failure[] = [];
  let errors: Signal[] = [];
  let maxOffset: number;
  let minOffset: number;

  // Group all the results by kind.
  for (const result of results) {
    if (!maxOffset) {
      maxOffset = result.next;
    } else if (result.next > maxOffset) {
      maxOffset = result.next;
    }
    if (!minOffset) {
      minOffset = result.next;
    } else if (result.next < minOffset) {
      minOffset = result.next;
    }

    if (result.kind === 'success') {
      if (result.start < minOffset) minOffset = result.start;
      values.push(result.value);
    } else if (result.kind === 'error') {
      values.push(result.value);
      errors = [...errors, ...result.errors];
    } else if (result.kind === 'ignore') {
      ignores.push(result);
    } else if (result.kind === 'failure') {
      failures.push(result);
    }
  }

  // Check if we've failed to capture any values.
  // That should be a very rare case...
  if (values.length === 0) {
    if (failures.length > 0) {
      // There's at least one failure...
      return failures[0];
    }
    // It's all ignores...
    console.assert(parser.offset !== minOffset);
    return parser.ignore([minOffset, maxOffset]);
  }

  // Apply the function to the values
  const value = f(...values);

  if (errors.length > 0) {
    return { kind: 'error', start: minOffset, next: maxOffset, value, errors };
  }

  console.assert(parser.offset !== minOffset);
  return parser.success([minOffset, maxOffset], value);
}

// export function accept<S>(value: S, error?: SignalMessage): Combinator<S> {}

// export function acceptIf<S>(
//   value: S,
//   p: (value: S) => boolean,
//   error?: SignalMessage
// ): Combinator<S> {}

export function codepoint(
  value: number,
  msg?: SignalMessage
): Combinator<string> {
  return (parser: ParserState): Result<string> => {
    const start = parser.offset;
    if (parser.at(start) === value) {
      return parser.success(
        [start, start + codePointLength(value)],
        String.fromCodePoint(value)
      );
    }
    return parser.failure(
      msg ?? ['literal-expected', String.fromCodePoint(value)]
    );
  };
}

export function parseString(
  parser: ParserState,
  value: string,
  msg?: SignalMessage
): Result<string> {
  let i = 0;
  let match = true;
  const start = parser.offset;
  while (i < value.length && match && i < parser.length) {
    match = parser.at(start + i) === value.codePointAt(i);
    i++;
  }
  if (match && i === value.length) {
    return parser.success([start, start + value.length], value);
  }
  return parser.failure(msg);
}

/** Combinator for a sequence of one or more characters */
export function literal(
  value: string,
  msg?: SignalMessage
): Combinator<string> {
  console.assert(value.length > 0);

  //
  // Special case when value is a single character
  //
  if (value.length === 1) return codepoint(value.codePointAt(0), msg);

  //
  // General case: value is more than a single char
  //
  return (parser) => parseString(parser, value, msg);
}

/** Combinator that accepts a "fancy" Unicode alternative for
 * "value".
 *
 * Value can consist of more than one character, for example "!=".
 * It will match the corresponding "≠" fancy version. The fancy
 * versions include the characters listed in FANCY_UNICODE. The
 * fancy version is assumed to be a single Unicode character.
 *
 * Note that superscript numbers and subscript numbers are not
 * included since they need to be handled contextually.
 */
export function fancyLiteral(
  value: string,
  msg?: SignalMessage
): Combinator<string> {
  if (REVERSE_FANCY_UNICODE.has(value)) {
    const fancyList = REVERSE_FANCY_UNICODE.get(value);
    return (parser) => {
      const start = parser.offset;
      for (const fancy of fancyList) {
        if (parser.at(start) === fancy) {
          parser.success([start, start + codePointLength(fancy)], value);
        }
      }
      return parseString(parser, value, msg);
    };
  }

  // No fancy version...
  return literal(value, msg);
}

export function regex(regex: RegExp, msg?: SignalMessage): Combinator<string> {
  const anchoredRegex = new RegExp(`^${regex.source}`);

  return (parser: ParserState): Result<string> => {
    const start = parser.offset;
    const match = anchoredRegex.exec(parser.slice(start));
    if (match != null) {
      const matchedText = match[0];
      return parser.success(
        [start, parser.offset + matchedText.length],
        matchedText
      );
    }
    return parser.failure(msg);
  };
}

/**
 * Generator for an ordered, non-empty, sequence of elements.
 *
 * If the first one fails, the sequence fails (softly).
 * After the first one, if a generator fails, the sequence returns an
 * error.
 */
export function sequence<T, U extends any[]>(
  cs: { [key in keyof U]: Combinator<U[key]> },
  f: (...results: any[]) => T
): Combinator<T> {
  return (parser: ParserState): Result<T> => {
    const start = parser.offset;
    const values: any[] = [];
    let errors: Signal[] = [];

    for (const c of cs) {
      let result: Result = parseWhitespace(parser);
      if (result.kind === 'error') errors = [...errors, ...result.errors];
      result = c(parser);

      if (result.kind === 'ignore') {
        // Do nothing
      } else if (result.kind === 'failure') {
        // If this is the first element, return a failure.
        if (values.length === 0) return result;
        values.push(undefined);
        // Since this is not the first element, if we get a failure later in
        // the sequence, the whole sequence is in error
        errors.push(result.error);
      } else if (result.kind === 'error') {
        values.push(result.value);
        errors = [...errors, ...result.errors];
      } else if (result.kind === 'success') {
        values.push(result.value);
      }
    }

    const value = f(...values);

    const end = parser.offset;
    if (errors.length === 0) return parser.success<T>([start, end], value);
    return parser.errors([start, end], value, errors);
  };
}

/**
 * Explore multiple alternatives.
 * Select the one that advances the most.
 *
 */
export function best<T>(cs: Combinator[], msg?: ParsingError): Combinator<T> {
  return (parser: ParserState): Result<T> => {
    // Pick the best alternative that succeeds
    let best: Result<T> = null;
    for (const c of cs) {
      const result = c(parser);
      if (result.kind === 'success') {
        if (!best || result.next > best.next) best = result;
      }
    }
    if (best) return best;
    // No alternative succeeded
    return parser.failure(msg);
  };
}

/**
 * Explore multiple alternatives.
 * Select the first one that matches.
 *
 */
export function alt<T>(cs: Combinator<T>[], msg?: ParsingError): Combinator<T> {
  return (parser: ParserState): Result<T> => {
    // Pick the first alternative that succeeds
    let error: Error<T>;
    for (const c of cs) {
      const result = c(parser);
      if (result.kind === 'success') return result;
      if (!error && result.kind === 'error') error = result;
    }
    if (error) return error;
    // No alternative succeeded
    return parser.failure(msg);
  };
}

/**
 *  1 or more `something`
 */
export function many<T>(
  something: Combinator<T>,
  f: (result: Success<T>[]) => T,
  msg?: SignalMessage
): Combinator<T> {
  return (parser: ParserState): Result<T> => {
    const start = parser.offset;
    const results: Result<T>[] = [];
    let done = false;
    let result = something(parser);
    if (result.kind !== 'success') {
      // We were expecting at least one
      return parser.failure(msg);
    }
    while (!done) {
      done = result.kind !== 'success';
      if (!done) {
        results.push(result);
        result = something(parser);
      }
    }

    console.assert(results.every((x) => x.kind === 'success'));
    return parser.success([start, parser.offset], f(results as Success<T>[]));
  };
}

/**
 * 0 or more `something`.
 * This combinator will never fail (since ø is an acceptable match).
 * The value of its result may be `undefined` if there was no match.
 */
export function some<T>(
  something: Combinator<T>,
  f: (...values: (Success<T> | Error<T>)[]) => T
): Combinator<T> {
  return (parser: ParserState): Result<T> => {
    const start = parser.offset;
    let errors: Signal[] = [];

    let result: Result<T> = parseWhitespace(parser);
    if (result.kind === 'error') errors = [...result.errors];
    result = something(parser);
    if (result.kind === 'failure') {
      if (errors.length === 0) {
        return parser.success([start, result.next], undefined);
      }
      return parser.errors([start, result.next], undefined, errors);
    }
    const results: (Success<T> | Error<T>)[] = [];

    let done = false;
    while (result.kind !== 'failure' && !done) {
      if (result.kind === 'ignore') {
        // Do nothing
      } else if (result.kind === 'success') {
        results.push(result);
      } else if (result.kind === 'error') {
        results.push(result);
        errors = [...errors, ...result.errors];
      }
      // Skip Whitespace
      result = parseWhitespace(parser);
      if (result.kind === 'error') errors = [...errors, ...result.errors];
      done = parser.offset >= parser.length;
      // Parse something
      if (!done) result = something(parser);
    }

    const value = f(...results);

    const end = parser.offset;
    if (errors.length === 0) return parser.success<T>([start, end], value);
    return parser.errors([start, end], value, errors);
  };
}

// Succeeds even if `something` fails
export function maybe(something: Combinator): Combinator {
  return (parser: ParserState) => {
    const start = parser.offset;
    const result = something(parser);
    if (result.kind === 'success') return result;
    if (result.kind === 'ignore') return result;
    if (result.kind === 'failure') return parser.ignore([start, result.next]);
    // This was an error, turn it into a success
    return parser.success([start, result.next], result.value);
  };
}

/**
 * Return an error if gets a failure (soft fail)
 *
 */
export function must<T>(
  something: Combinator<T>,
  msg?: ParsingError,
  defaultValue?: T
): Combinator<T> {
  return (parser: ParserState): Result<T> => {
    // @todo: we could propagate the value...?
    const result = something(parser);
    if (result.kind === 'failure') {
      return parser.error<T>([result.start, result.next], defaultValue, msg);
    }
    return result;
  };
}

// function any<T>(
//   seq: Combinator[],
//   map: (result: Result<T>[]) => Result<T>
// ): Combinator<T> {}

// function manySeparated<T>(
//   sep: string,
//   map: (result: Result<T>[]) => Result<T>
// ): Combinator<T> {}

export function between<T>(
  open: string,
  something: Combinator<T>,
  close: string,
  msg?: ParsingError,
  defaultValue?: T
): Combinator<T> {
  // @todo: could have a specialized version for when open and close
  // are single chars
  const openCombinator = normalize(open);
  const closeCombinator = normalize(close);
  return (parser: ParserState): Result<T> => {
    const start = parser.offset;
    let result: Result = openCombinator(parser);
    if (result.kind !== 'success') {
      return parser.failure(msg ?? ['opening-bracket-expected', open]);
    }
    result = something(parser);
    if (result.kind === 'error') {
      const closeResult = closeCombinator(parser);
      if (closeResult.kind !== 'success') {
        // Something went wrong and we don't see the close fence.
        // Look for it...
        result.next = skipUntilString(parser, close);
        return result;
      }
      result.next = closeResult.next;
      return result;
    }
    if (result.kind !== 'success') {
      return parser.error<T>(
        [start, result.next],
        defaultValue,
        msg ?? ['closing-bracket-expected', close]
      );
    }
    if (closeCombinator(parser).kind === 'success') {
      return parser.success([start, result.next], result.value);
    }
  };
}

// export function maybeWhitespaceAround(
//   something: string | Combinator<string>,
//   msg?: SignalCode
// ): Combinator<string> {
//   // @todo: could have a version that specializes for when something
//   // is a string.
//   const combinator = normalize(something);
//   return (initialState: ParserState): Result<string> => {
//     let state = skipWhitespace(initialState);
//     const result = combinator(state);
//     if (result.kind !== 'success') {
//       return failure(initialState, state.offset, msg);
//     }
//     state = skipWhitespace(result.state);
//     return success(initialState, state.offset, result.value);
//   };
// }

export function manySeparatedBetween<T>(
  open: string,
  something: Combinator<T>,
  separator: string,
  close: string,
  f: (result: Success<T>[]) => T,
  msg?: ParsingError,
  defaultValue?: T
): Combinator<T> {
  const sep = normalize(separator);
  return (parser: ParserState): Result<T> => {
    const start = parser.offset;
    let result: Result = normalize(open)(parser);
    if (result.kind !== 'success') return parser.failure(msg);

    const results: Result<T>[] = [];
    let done = false;
    while (!done) {
      result = something(parser);
      done = result.kind !== 'success';
      if (!done) {
        results.push(result);
        result = sep(parser);
        done = result.kind !== 'success';
      }
    }

    if (results.length === 0) {
      return parser.error<T>(
        [start, result.next],
        defaultValue,
        msg ?? 'expression-expected'
      );
    }

    result = normalize(close)(parser);
    if (result.kind !== 'success') {
      return parser.error<T>(
        [start, result.next],
        defaultValue,
        msg ?? ['closing-bracket-expected', close]
      );
    }
    return parser.success([start, result.next], f(results as Success<T>[]));
  };
}

/** 0 or more, separated */
export function someSeparatedBetween<T>(
  open: string,
  something: Combinator<T>,
  separator: string,
  close: string,
  f: (results: Result<T>[]) => T,
  msg?: ParsingError
): Combinator<T> {
  return (parser: ParserState): Result<T> => {
    let result: Result = normalize(open)(parser);
    if (result.kind !== 'success') return parser.failure(msg);

    const start = parser.offset;

    result = something(parser);
    if (result.kind !== 'success') return parser.failure(msg);

    const results: Result[] = [result];
    const sep = normalize(separator);
    while (result.kind === 'success') {
      result = sep(parser);
      if (result.kind === 'success') results.push(something(parser));
    }

    result = normalize(close)(parser);
    if (result.kind !== 'success') {
      return parser.error<T>(
        [start, result.next],
        f(results),
        msg ?? ['closing-bracket-expected', close]
      );
    }
    return parser.success([start, result.next], f(results));
  };
}

export function eof(msg?: SignalCode): Combinator<void> {
  return (parser: ParserState) => {
    if (parser.offset >= parser.length) {
      return parser.success([parser.length, parser.length], undefined);
    }
    return parser.failure(msg ?? 'eof-expected');
  };
}
