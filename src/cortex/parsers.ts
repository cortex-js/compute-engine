import { SignalCode } from '../public';
import { WHITE_SPACE } from './characters';

export type ParserState = {
  readonly s: string;
  i: number;
};

export type ParsingError = SignalCode | [SignalCode, ...(string | number)[]];

export type Result<T = any> =
  | {
      state: ParserState;
      kind: 'success';
      value?: T;
    }
  | {
      state: ParserState;
      /**
       * A soft-fail indicates a failed attempt to parse, with no presumption
       * success, for example when exploring multiple alternatives.
       * A hard-fail indicate a presumed syntax error: an alternative was chosen
       * and it failed after a while.
       */
      kind: 'soft-fail' | 'hard-fail' | 'fatal-fail';
      error: ParsingError;
    };

export function next(state: ParserState, inc = 1): ParserState {
  return { s: state.s, i: state.i + inc };
}

export function skipWhitespace(state: ParserState): ParserState {
  let i = state.i;
  let done = false;
  while (!done) {
    done = !WHITE_SPACE.includes(state.s.charCodeAt(i));
    if (!done) i += 1;
  }
  return next(state, i - state.i);
}

export function success<T = void>(state: ParserState, value?: T): Result<T> {
  return { kind: 'success', value, state };
}

export function softFailure(state: ParserState, error?: ParsingError): Result {
  return { kind: 'soft-fail', error, state };
}

export function hardFailure(state: ParserState, error?: ParsingError): Result {
  return { kind: 'hard-fail', error, state };
}

export function newline(state: ParserState): Result<void> {
  let i = state.i;
  const c = state.s[i++];
  if (c === '\r' || c === '\u2028' || c === '\u2029') {
    return success(next(state));
  }
  if (c === '\n') {
    if (state.s[i] === '\r') return success(next(state, 2));
    return success(next(state));
  }
  return softFailure(state);
}

const DIGITS = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
};

const HEX_DIGITS = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  'a': 10,
  'A': 10,
  'b': 11,
  'B': 11,
  'c': 12,
  'C': 12,
  'd': 13,
  'D': 13,
  'e': 14,
  'E': 14,
  'f': 15,
  'F': 15,
};

export function exponent(
  state: ParserState,
  prefix: 'e' | 'p'
): Result<number> {
  let i = state.i;
  if (state.s[i] !== prefix && state.s[i] !== prefix.toUpperCase()) {
    return softFailure(state);
  }
  i += 1;
  let sign = 1;
  if (state.s[i] === '-') {
    i++;
    sign = -1;
  } else if (state.s[i] === '+') {
    i++;
  }

  if (state.i !== i && DIGITS[state.s[i]] === undefined) {
    // There was a '+' or '-' followed by a non-digit
    return hardFailure(state, 'exponent-expected');
  }

  let result = 0;
  while (DIGITS[state.s[i]] !== undefined) {
    result = result * 10 + DIGITS[state.s[i++]];
  }

  return success(next(state, state.i - i), sign * result);
}

export function binaryNumber(state: ParserState): Result<number> {
  let i = state.i;

  // `0b` prefix
  if (state.s[i++] !== '0' || state.s[i++] !== 'b') return softFailure(state);

  // Whole part
  let result = 0;
  let done = false;
  while (!done) {
    const c = state.s[i++];
    if (c === '0') {
      result *= 2;
    } else if (c === '1') {
      result = result * 2 + 1;
    } else if (/\d/.test(c)) {
      return hardFailure(
        next(state, i - state.i - 1),
        'binary-number-expected'
      );
    } else if (c !== '_') {
      done = true;
    }
  }

  i--;

  // Fractional part
  if (state.s[i++] === '.') {
    let frac = 0.5;
    done = false;
    while (!done) {
      const c = state.s[i++];
      if (c === '0') {
        frac /= 2;
      } else if (c === '1') {
        result += frac;
        frac = frac / 2;
      } else if (/[\d\.]/.test(c)) {
        return hardFailure(
          next(state, i - state.i - 1),
          'binary-number-expected'
        );
      } else if (c !== '_') {
        done = true;
      }
    }
  }

  // Exponent
  let exp = exponent(next(state, i - state.i - 1), 'e');
  if (exp.kind === 'success') {
    result = result * Math.pow(10, exp.value);
  } else {
    exp = exponent(next(state, i - state.i - 1), 'p');
    if (exp.kind === 'success') result = result * Math.pow(2, exp.value);
  }

  return success<number>(exp.state, result);
}

export function signedFloatingPointNumber(state: ParserState): Result<number> {
  return hardFailure(state);
}

export function floatingPointNumber(state: ParserState): Result<number> {
  return hardFailure(state);
}

export function comment(state: ParserState): Result<void> {
  return hardFailure(state);
}

export function documentation(state: ParserState): Result<void> {
  return hardFailure(state);
}
