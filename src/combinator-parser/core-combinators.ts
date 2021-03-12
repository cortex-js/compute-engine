import { Signal, SignalCode, SignalMessage } from '../public';
import { codePointLength, REVERSE_FANCY_UNICODE } from './characters';
import {
  Parser,
  ParsingError,
  Result,
  Success,
  Error,
  Failure,
  Ignore,
} from './parsers';
import { parseWhitespace } from './whitespace-parsers';

export type Combinator<T = any> = [
  label: string,
  parser: (Parser) => Result<T>
];

export function normalize(
  value: number | string | RegExp | Combinator<string>
): Combinator<string> {
  if (typeof value === 'number') return codepoint(value);

  if (typeof value === 'string') return literal(value);

  if (value instanceof RegExp) return regex(value);

  return value;
}

export function codepoint(
  value: number,
  msg?: SignalMessage
): Combinator<string> {
  return [
    `U+${('0000' + value.toString(16)).slice(-4)} (${String.fromCodePoint(
      value
    )})`,
    (parser: Parser): Result<string> => {
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
    },
  ];
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
  parser: Parser,
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

export function parseString(
  parser: Parser,
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
  return [`**\`${value}\`**`, (parser) => parseString(parser, value, msg)];
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
    return [
      `**_\`${value}\`_**`,
      (parser) => {
        const start = parser.offset;
        for (const fancy of fancyList) {
          if (parser.at(start) === fancy) {
            parser.success([start, start + codePointLength(fancy)], value);
          }
        }
        return parseString(parser, value, msg);
      },
    ];
  }

  // No fancy version...
  return literal(value, msg);
}

export function regex(regex: RegExp, msg?: SignalMessage): Combinator<string> {
  const anchoredRegex = new RegExp(`^${regex.source}`);

  return [
    `regex(${regex.toString()})`,
    (parser: Parser): Result<string> => {
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
    },
  ];
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
  f: (...results: (Result<T> | Error<T>)[]) => T
): Combinator<T> {
  return [
    cs.map((x) => x[0]).join(' '),
    (parser: Parser): Result<T> => {
      const start = parser.offset;
      const results: (Result<T> | Error<T>)[] = [];
      let errors: Signal[] = [];

      for (const c of cs) {
        let result: Result = parseWhitespace(parser);
        if (result.kind === 'error') errors = [...errors, ...result.errors];
        result = c[1](parser);

        if (result.kind === 'ignore') {
          // Do nothing
        } else if (result.kind === 'failure') {
          // If this is the first element, return a failure.
          if (results.length === 0) return result;
          results.push(undefined);
          // Since this is not the first element, if we get a failure later in
          // the sequence, the whole sequence is in error
          errors.push(result.error);
        } else if (result.kind === 'error') {
          results.push(result);
          errors = [...errors, ...result.errors];
        } else if (result.kind === 'success') {
          results.push(result);
        }
      }

      const value = f(...results);

      const end = parser.offset;
      if (errors.length === 0) return parser.success<T>([start, end], value);
      return parser.errors([start, end], value, errors);
    },
  ];
}

/**
 * Explore multiple alternatives.
 * Select the one that advances the most.
 *
 */
export function best<T>(cs: Combinator[], msg?: ParsingError): Combinator<T> {
  return [
    `best(${cs.map((x) => x[0]).join(' | ')})`,
    (parser: Parser): Result<T> => {
      // Pick the best alternative that succeeds
      let best: Result<T> = null;
      for (const c of cs) {
        const result = c[1](parser);
        if (result.kind === 'success') {
          if (!best || result.next > best.next) best = result;
        }
      }
      if (best) return best;
      // No alternative succeeded
      return parser.failure(msg);
    },
  ];
}

/**
 * Explore multiple alternatives.
 * Select the first one that matches.
 *
 */
export function alt<T>(cs: Combinator<T>[], msg?: ParsingError): Combinator<T> {
  return [
    cs.map((x) => x[0]).join(' | '),
    (parser: Parser): Result<T> => {
      // Pick the first alternative that succeeds
      const start = parser.offset;
      let error: Error<T>;
      for (const c of cs) {
        parser.skipTo(start);
        const result = c[1](parser);
        if (result.kind === 'success') return result;
        if (!error && result.kind === 'error') error = result;
      }
      if (error) {
        parser.skipTo(error.next);
        return error;
      }
      // No alternative succeeded
      return parser.failure(msg);
    },
  ];
}

/**
 *  1 or more `something`
 */
export function many<T>(
  something: Combinator<T>,
  f: (result: Success<T>[]) => T,
  msg?: SignalMessage
): Combinator<T> {
  return [
    `(${something[0]})+`,
    (parser: Parser): Result<T> => {
      const start = parser.offset;
      const results: Result<T>[] = [];
      let done = false;
      let result = something[1](parser);
      if (result.kind !== 'success') {
        // We were expecting at least one
        return parser.failure(msg);
      }
      while (!done) {
        done = result.kind !== 'success';
        if (!done) {
          results.push(result);
          result = something[1](parser);
        }
      }

      console.assert(results.every((x) => x.kind === 'success'));
      return parser.success([start, parser.offset], f(results as Success<T>[]));
    },
  ];
}

// Succeeds even if `something` fails
export function maybe(something: Combinator): Combinator {
  return [
    `\\[${something[0]}\\]`,
    (parser: Parser) => {
      const start = parser.offset;
      const result = something[1](parser);
      if (result.kind === 'success') return result;
      if (result.kind === 'ignore') return result;
      if (result.kind === 'failure') return parser.ignore([start, result.next]);
      return result;
      // This was an error, turn it into a success
      // return parser.success([start, result.next], result.value);
    },
  ];
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
  return [
    `(${something[0]})!`,
    (parser: Parser): Result<T> => {
      // @todo: we could propagate the value...?
      const start = parser.offset;
      let result = something[1](parser);
      if (result.kind === 'failure') {
        if (result.next === start) {
          // We could not process the next character, skip it and try to continue
          let retryCount = 5;
          const pos = parser.offset; // Position of where the unexpected error occurred
          while (retryCount > 0 && !parser.atEnd()) {
            parser.skipTo(parser.offset + 1);
            result = something[1](parser);
            if (result.kind === 'error') {
              return parser.errors([start, parser.offset], result.value, [
                ...result.errors,
                {
                  severity: 'error',
                  message: msg,
                  origin: {
                    source: this.source,
                    offset: pos,
                  },
                },
              ]);
            }
            if (result.kind === 'success') {
              return parser.error(
                [start, parser.offset, pos],
                result.value,
                msg
              );
            }
            retryCount -= 1;
          }
        }
        return parser.error<T>([start, result.next], defaultValue, msg);
      }
      return result;
    },
  ];
}

export function ignore(something: Combinator): Combinator {
  return [
    `\\[${something[0]}\\]!`,
    (parser: Parser): Ignore => {
      const result = something[1](parser);
      return parser.ignore([result.start, result.next]);
    },
  ];
}

export function eof(msg?: SignalCode): Combinator<void> {
  return [
    '_eof_',
    (parser: Parser) => {
      if (parser.atEnd()) {
        return parser.success([parser.length, parser.length], undefined);
      }
      return parser.failure([
        msg ?? 'eof-expected',
        String.fromCodePoint(parser.at(parser.offset)),
      ]);
    },
  ];
}
