import { Signal, SignalMessage } from '../public';
import { codePointLength, isLinebreak } from './characters';

export type ParsingError = SignalMessage;

/**
 * The `Parser` keeps track of what we are parsing (the source) and what we have
 * parsed so far (the offset).
 */
export class Parser {
  private source: string;
  protected _offset = 0;
  length = 0;

  constructor(source: string) {
    this.source = source;
    this.length = source.length;
  }

  at(offset: number): number {
    return this.source.codePointAt(offset);
  }
  atEnd(): boolean {
    return this.offset >= this.source.length;
  }
  atLinebreak(): boolean {
    return isLinebreak(this.source.codePointAt(this.offset));
  }
  slice(start: number, end?: number): string {
    return this.source.slice(start, end);
  }
  get offset(): number {
    return this._offset;
  }
  skipTo(offset: number): Parser {
    this._offset = offset;
    return this;
  }

  /**
   * Use when a portion of the source has been successfully parsed.
   */
  success<T = void>(range: [start: number, end: number], value: T): Success<T> {
    this._offset = range[1];
    return { kind: 'success', next: range[1], value, start: range[0] };
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
   * The range indicate the portion of the source covered by this result.
   * The optional `pos` indicate where the error occurred. It's the `end`
   * by default.
   *
   */
  error<T>(
    range: [start: number, end: number, pos?: number],
    value: T,
    error?: ParsingError
  ): Error<T> {
    this._offset = range[1];
    return {
      kind: 'error',
      start: range[0],
      next: range[1],
      value,
      errors: [
        {
          severity: 'warning',
          message: error ?? 'syntax-error',
          origin: {
            source: this.source,
            offset: range[2] ?? range[0],
          },
        },
      ],
    };
  }

  errors<T>(
    range: [start: number, end: number],
    value: T,
    errors: Signal[]
  ): Error<T> {
    this._offset = range[1];
    return {
      kind: 'error',
      start: range[0],
      next: range[1],
      value,
      errors: [...errors],
    };
  }

  ignore(range: [start: number, end: number]): Ignore {
    this._offset = range[1];
    return { kind: 'ignore', next: range[1], start: range[0] };
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

export function skipUntil(parser: Parser, value: number): number {
  let i = parser.offset;
  while (i < parser.length) {
    const c = parser.at(i);
    if (c === value) return i;
    i += codePointLength(c);
  }
  return -1;
}

export function skipUntilString(parser: Parser, pattern: string): number {
  let i = parser.offset;
  const cps = [...pattern].map((x) => x.codePointAt(0));
  while (i < pattern.length - cps.length) {
    let c = parser.at(i);
    if (c === cps[0]) {
      let match = true;
      let j = 1;
      while (match && j < cps.length) {
        c = parser.at(i);
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
