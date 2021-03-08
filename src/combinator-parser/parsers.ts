import { Signal, SignalMessage } from '../public';
import { codePointLength } from './characters';

export type ParsingError = SignalMessage;

/**
 * The `ParserState` keeps track of what we are parsing and what we have
 * parsed so far (the offset).
 */
export class ParserState {
  private source: string;
  protected _offset = 0;
  length = 0;
  at(offset: number): number {
    return this.source.codePointAt(offset);
  }
  slice(start: number, end?: number): string {
    return this.source.slice(start, end);
  }
  get offset(): number {
    return this._offset;
  }
  skipTo(offset: number): ParserState {
    this._offset = offset;
    return this;
  }
  constructor(source: string) {
    this.source = source;
    this.length = source.length;
  }
  /**
   * Use when a portion of the source has been successfully reduced to a value
   * (or just reduced, the value is optional)
   */
  success<T = void>(next: number, value?: T): Success<T> {
    const start = this._offset;
    this._offset = next;
    return { kind: 'success', next, value, start };
  }

  /** A failure is used to signal that an attempt to parse failed. This may be
   * a benign failure, for example attempting to take one out of multiple
   * branches will result in a failure, backtracking, and attempting the next
   * branch.
   */
  failure(error?: ParsingError): Failure {
    return {
      kind: 'failure',
      start: this.offset,
      next: this.offset,
      error: {
        severity: 'warning',
        message: error,
        origin: {
          source: this.source,
          offset: this.offset,
        },
      },
    };
  }

  /**
   * An `error` is used when an unexpected failure was encountered.
   * It typically indicates a syntax error.
   *
   * Nonetheless, an attempt is made to recover.
   *
   */
  error<T>(next: number, value: T, error?: ParsingError): Error<T> {
    const start = this._offset;
    this._offset = next;
    return {
      kind: 'error',
      start,
      next,
      value,
      errors: [
        {
          severity: 'warning',
          message: error ?? 'syntax-error',
          origin: {
            source: this.source,
            offset: start,
          },
        },
      ],
    };
  }

  errors<T>(next: number, value: T, errors: Signal[]): Error<T> {
    const start = this._offset;
    this._offset = next;
    return {
      kind: 'error',
      start,
      next,
      value,
      errors: [...errors],
    };
  }

  ignore(next: number): Ignore {
    const start = this._offset;
    this._offset = next;
    return { kind: 'ignore', next, start };
  }
}

/**
 * The result of applying a parsing rule:
 * - `Ignore`: the rule matched and the result can be ignored
 * - `Failure`: the rule did not match at all. Maybe try something else?
 * - `Success`: the rule matched and generated a value that can be passed on.
 * - `Hypothetical`: the rule matched, then something went wrong. Probably a
 * syntax error. It still produce a value so the parsing can attempt to
 * recover and continue (Panic Mode).
 */
export type Result<T = any> = Ignore | Failure | Success<T> | Error<T>;

/**
 * An `ignore` result indicates success in parsing, but with a result that
 * can be ignored.
 *
 * This is useful for whitespace, keywords, braces and other similar syntactic
 * constructs.
 *
 * `state` is the state from which parsing can continue.
 * `start` is the offset in the source where the element was first ignored.
 *
 */
export type Ignore = {
  kind: 'ignore';
  start: number;
  next: number;
};

/**
 * A `failure` indicates a failed attempt to parse, with no presumption
 * of success, for example when exploring multiple alternatives.
 *
 * `state` indicate where to restart parsing from.
 *
 * The `error` includes the origin (offset) of the failure. It could be after
 * the `state`.
 *
 */
export type Failure = {
  kind: 'failure';
  start: number;
  next: number; // for a failure, `next` is always = `start`
  error: Signal;
};

/**
 * An 'error' result indicates a presumed syntax error: a rule was
 * partially applied than failed after a while.
 *
 * The `value` contains an interpretation of what has been parsed.
 * The `state` where to continue the parsing from.
 *
 * `errors` is a list of errors encountered while parsing up to this point.
 * This includes the errors from the current rule, and previous errors.
 *
 * Note that `Error` tends to propagate, except for `alt`
 *
 * - sequence(Success | Failure | Ignore, Hypothetical) = Hypothetical
 * - alt(Success, Hypothetical) = Success
 * - alt(Failure, Hypothetical) = Hypothetical
 * - alt(Failure, Success, Hypothetical) = Success
 *
 */
export type Error<T = any> = {
  kind: 'error';
  start: number;
  next: number;
  value: T;
  errors: Signal[];
};

/**
 * A `success` result indicates that a value was successfully parsed.
 *
 * `state` indicate where to continue parsing from.
 * The `start` indicates where the parsing began from.
 *
 */
export type Success<T = any> = {
  kind: 'success';
  start: number;
  next: number;
  value: T;
};

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

export function skipUntil(state: ParserState, value: number): number {
  let i = state.offset;
  while (i < state.length) {
    const c = state.at(i);
    if (c === value) return i;
    i += codePointLength(c);
  }
  return -1;
}

export function skipUntilString(state: ParserState, pattern: string): number {
  let i = state.offset;
  const cps = [...pattern].map((x) => x.codePointAt(0));
  while (i < pattern.length - cps.length) {
    let c = state.at(i);
    if (c === cps[0]) {
      let match = true;
      let j = 1;
      while (match && j < cps.length) {
        c = state.at(i);
        match = c === cps[j];
        if (match) {
          j += 1;
          i += codePointLength(c);
        }
      }
      if (match) return i;
    }
    i += codePointLength(c);
  }
  return -1;
}
