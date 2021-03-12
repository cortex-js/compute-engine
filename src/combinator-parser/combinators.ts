import { Signal } from '../public';
import { Combinator, normalize } from './core-combinators';
import {
  Parser,
  ParsingError,
  Result,
  Success,
  Error,
  skipUntilString,
} from './parsers';
import { parseWhitespace } from './whitespace-parsers';

/**
 * 0 or more `something`.
 * This combinator will never fail (since ø is an acceptable match).
 * The value of its result may be `undefined` if there was no match.
 */
export function some<T>(
  something: Combinator<T>,
  f: (...values: (Success<T> | Error<T>)[]) => T
): Combinator<T> {
  return [
    `(${something[0]})*`,
    (parser: Parser): Result<T> => {
      const start = parser.offset;
      let errors: Signal[] = [];

      let result: Result<T> = parseWhitespace(parser);
      if (result.kind === 'error') errors = [...result.errors];
      result = something[1](parser);
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
        done = parser.atEnd();
        // Parse something
        if (!done) result = something[1](parser);
      }

      const value = f(...results);

      const end = parser.offset;
      if (errors.length === 0) return parser.success<T>([start, end], value);
      return parser.errors([start, end], value, errors);
    },
  ];
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
  return [
    `**\`${open}\`** (${something[0]})* **\`${close}\`**`,
    (parser: Parser): Result<T> => {
      const start = parser.offset;
      let result: Result = openCombinator[1](parser);
      if (result.kind !== 'success') {
        return parser.failure(msg ?? ['opening-bracket-expected', open]);
      }
      result = something[1](parser);
      if (result.kind === 'error') {
        const closeResult = closeCombinator[1](parser);
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
      if (closeCombinator[1](parser).kind === 'success') {
        return parser.success([start, result.next], result.value);
      }
    },
  ];
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
  return [
    `**\`${open}\`** (${something[0]}+#**\`${separator}\`** **\`${close}\`**`,
    (parser: Parser): Result<T> => {
      const start = parser.offset;
      let result: Result = normalize(open)[1](parser);
      if (result.kind !== 'success') return parser.failure(msg);

      const results: Result<T>[] = [];
      let done = false;
      while (!done) {
        result = something[1](parser);
        done = result.kind !== 'success';
        if (!done) {
          results.push(result);
          result = sep[1](parser);
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

      result = normalize(close)[1](parser);
      if (result.kind !== 'success') {
        return parser.error<T>(
          [start, result.next],
          defaultValue,
          msg ?? ['closing-bracket-expected', close]
        );
      }
      return parser.success([start, result.next], f(results as Success<T>[]));
    },
  ];
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
  return [
    `**\`${open}\`** (${something[0]}*#**\`${separator}\`** **\`${close}\`**`,
    (parser: Parser): Result<T> => {
      let result: Result = normalize(open)[1](parser);
      if (result.kind !== 'success') return parser.failure(msg);

      const start = parser.offset;

      result = something[1](parser);
      if (result.kind !== 'success') return parser.failure(msg);

      const results: Result[] = [result];
      const sep = normalize(separator);
      while (result.kind === 'success') {
        result = sep[1](parser);
        if (result.kind === 'success') results.push(something[1](parser));
      }

      result = normalize(close)[1](parser);
      if (result.kind !== 'success') {
        return parser.error<T>(
          [start, result.next],
          f(results),
          msg ?? ['closing-bracket-expected', close]
        );
      }
      return parser.success([start, result.next], f(results));
    },
  ];
}
