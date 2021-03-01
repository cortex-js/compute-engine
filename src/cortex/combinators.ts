import { SignalCode } from '../public';
import {
  hardFailure,
  next,
  ParserState,
  ParsingError,
  Result,
  skipWhitespace,
  softFailure,
  success,
} from './parsers';

type Combinator<T = any> = (state: ParserState) => Result<T>;

function normalize<T>(
  c: string | RegExp | Combinator<T>
): Combinator<T | string> {
  if (typeof c === 'string') return literal(c);

  if (c instanceof RegExp) return regex(c);

  return c;
}

export function literal(c: string, error?: SignalCode): Combinator<string> {
  return (input: ParserState) => {
    if (input.s[input.i] === c) return success(next(input), c);
    return softFailure(input, error);
  };
}

// function word(w:string, error?: SignalCode): Combinator<string> {
// }

export function regex(regex: RegExp, error?: SignalCode): Combinator<string> {
  const anchoredRegex = new RegExp(`^${regex.source}`);

  return (state: ParserState) => {
    const match = anchoredRegex.exec(state.s.substring(state.i));
    if (match != null) {
      const matchedText = match[0];
      return success(next(state, matchedText.length), matchedText);
    }
    return softFailure(state, error);
  };
}

// Apply a function to a Result[]
// function using
// function map

export function sequence<T, U extends any[]>(
  cs: { [key in keyof U]: Combinator<U[key]> },
  map: (result: Result[]) => T,
  error?: SignalCode
): Combinator<T> {
  return (initialState: ParserState) => {
    const results: Result[] = [];
    let state = initialState;
    cs.forEach((c) => {
      const result = c(state);
      if (result.kind !== 'success') {
        return hardFailure(state, error ?? 'expression-expected');
      }
      state = result.state;
      results.push(result);
    });
    return success<T>(state, map(results));
  };
}

export function alt<T>(
  cs: Combinator[],
  map: (result: Result) => T,
  error?: SignalCode
): Combinator<T> {
  return (state: ParserState) => {
    let candidate = null;
    // Pick the alternative with the longest match
    for (const result of cs.map((c) => c(state))) {
      if (result.kind === 'success') {
        if (!candidate || result.state.i >= candidate.state.i) {
          candidate = result;
        }
      }
    }
    if (!candidate) return softFailure(state, error);
    return success(candidate.state, map(candidate));
  };
}

// 1 or more c
export function many<T>(
  something: Combinator<T>,
  map: (result: Result<T>[]) => T,
  error?: SignalCode
): Combinator<T> {
  return (state: ParserState) => {
    const results: Result[] = [];
    let done = false;
    let result;
    while (!done) {
      result = something(state);
      done = result.kind !== 'success';
      if (!done) results.push(result);
    }

    if (results.length === 0) {
      return hardFailure(state, error ?? 'expression-expected');
    }

    return success(result.state, map(results));
  };
}

// 0 or more c
export function some<T>(
  something: Combinator<T>,
  map: (result: Result<T>[]) => T
): Combinator<T> {
  return (state: ParserState) => {
    const results: Result[] = [];
    let done = false;
    let result: Result;
    while (!done) {
      result = something(state);
      done = result.kind !== 'success';
      if (!done) results.push(result);
    }

    return success(result?.state ?? state, map(results));
  };
}

// Succeeds even if c fails
export function maybe(c: Combinator): Combinator {
  return (state: ParserState) => {
    return success(c(state).state);
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
  map: (result: Result<T>) => T,
  error?: SignalCode
): Combinator<T> {
  return (state: ParserState) => {
    if (normalize(open)(state).kind !== 'success') {
      return softFailure(state, error);
    }
    const result: Result<T> = something(state);
    if (
      result.kind !== 'success' ||
      normalize(close)(state).kind !== 'success'
    ) {
      return hardFailure(state, error ?? ['closing-bracket-expected', close]);
    }
    return success(result.state, map(result));
  };
}

export function maybeWhitespacearound<T>(
  something: Combinator<T>,
  map: (result: Result<T>) => T,
  error?: SignalCode
): Combinator<T> {
  return (initialState: ParserState) => {
    let state = skipWhitespace(initialState);
    const result = something(state);
    if (result.kind !== 'success') return softFailure(initialState, error);
    state = skipWhitespace(initialState);
    return success(state, map(result));
  };
}

export function manySeparatedBetween<T>(
  open: string,
  something: Combinator<T>,
  separator: string,
  close: string,
  map: (result: Result<T>[]) => T,
  error?: SignalCode
): Combinator<T> {
  return (state: ParserState) => {
    let result = normalize(open)(state);
    if (result.kind !== 'success') return softFailure(state, error);

    const sep = normalize(separator);
    const results: Result[] = [];
    let done = false;
    while (!done) {
      result = something(state);
      done = result.kind !== 'success';
      if (!done) {
        results.push(result);
        result = sep(result.state);
        done = result.kind !== 'success';
      }
    }

    if (results.length === 0) {
      return hardFailure(state, error ?? 'expression-expected');
    }

    result = normalize(close)(result.state);
    if (result.kind !== 'success') {
      return hardFailure(state, error ?? ['closing-bracket-expected', close]);
    }
    return success(result.state, map(results));
  };
}

export function someSeparatedBetween<T>(
  open: string,
  something: Combinator<T>,
  separator: string,
  close: string,
  map: (result: Result[]) => T,
  error?: ParsingError
): Combinator<T> {
  return (initialState: ParserState) => {
    let result = normalize(open)(initialState);
    if (result.kind !== 'success') return softFailure(initialState, error);

    result = something(result.state);
    if (result.kind !== 'success') return softFailure(initialState, error);

    const results: Result[] = [result];
    const sep = normalize(separator);
    while (result.kind === 'success') {
      result = sep(result.state);
      if (result.kind === 'success') {
        result = something(result.state);
        if (result.kind === 'success') results.push(result);
      }
    }

    result = normalize(close)(result.state);
    if (result.kind !== 'success') {
      return hardFailure(
        initialState,
        error ?? ['closing-bracket-expected', close]
      );
    }
    return success(result.state, map(results));
  };
}

export function eof<T>(error?: SignalCode): Combinator<T> {
  return (state: ParserState) => {
    if (state.i >= state.s.length) return success(state);
    return hardFailure(state, error ?? 'eof-expected');
  };
}
