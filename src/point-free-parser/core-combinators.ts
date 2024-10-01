import { codePointLength, REVERSE_FANCY_UNICODE } from './characters';
import { Combinator, Parser, DiagnosticMessage, Result } from './parsers';

// export function normalize(
//   value: number | string | RegExp | Combinator<string>
// ): Combinator<string> {
//   if (typeof value === 'number') return codepoint(value);

//   if (typeof value === 'string') return literal(value);

//   if (value instanceof RegExp) return regex(value);

//   return value;
// }

// export function normalize(
//   // rules: Rules<T>,
//   value: number | string | RegExp
// ): (parser: Parser) => Result<any> {
//   if (typeof value === 'number') {
//     return (parser): Result<string> => parseCodepoint(parser, value);
//   }

//   if (typeof value === 'string') {
//     //    // If this is a known rule, use it.
//     //  // Otherwise, assume it's a string literal
//     // return rules.get(value) ?? ((parser) => parseString(parser, value));
//     return (parser) => parseString(parser, value);
//   }

//   // if (value instanceof RegExp) return regex(value);

//   return null;
// }

export function normalize<IR>(
  // rules: Rules<T>,
  c: string | Combinator | ((parser: Parser) => Result<IR>)
): string | ((parser: Parser) => Result<IR>) {
  if (typeof c === 'function' || typeof c === 'string') return c;
  return c[0];
}

export function description(c: string | Combinator): string {
  if (typeof c === 'string') return c;
  return c[0];
}

export function parseCodepoint(parser: Parser, value: number): Result<string> {
  const result = new Result<string>(parser);
  const start = parser.offset;
  if (parser.get(start) !== value) result.failure();
  parser.skipTo(start + codePointLength(value));
  return result.success(String.fromCodePoint(value));
}

export function codepoint(value: number): Combinator<string> {
  return [
    `U+${('0000' + value.toString(16)).slice(-4)} (${String.fromCodePoint(
      value
    )})`,
    (parser: Parser): Result<string> => parseCodepoint(parser, value),
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
// export function map<T = string, IR>(
//   f: (result: T) => IR,
//   ...results: Result<T>[]
// ): IR[] {
//   return results.map((x) => {
//     if (x.isFailure || x.isIgnore) return x;
//     return { ...x, value: f(x.value) };
//   });
// }

/**
 *
 * Combine one or more results into a single result using the `f()` function.
 *
 * Keep all the diagnostics (if any of the results has an error, the overall
 * result is an error).
 * If there are no results, the result is empty (not a failure).
 */
export function combine<T>(
  parser: Parser,
  f: (...results: Result[]) => T,
  results: Result[],
  errors?: Result[],
  msg?: DiagnosticMessage | ((Parser) => DiagnosticMessage)
): Result<T> {
  const result = new Result<T>(parser);

  let maxOffset = 0;
  let minOffset = Infinity;

  // Get all the values
  for (const res of results) {
    result.copyDiagnostics(res);
    if (res.isSuccess || res.isError) {
      maxOffset = Math.max(maxOffset, res.end);
      minOffset = Math.min(minOffset, res.end);
    }
  }

  result.range = [minOffset, maxOffset];

  // If we haven't captured any values, return an empty result (`value === null`)
  result.value = results.length > 0 ? f(...results) : null;

  if (msg) result.error(result.value!, msg);

  if (errors) for (const err of errors) result.copyDiagnostics(err);

  return result;
}

// export function accept<S>(value: S, error?: DiagnosticMessage): Combinator<S> {}

// export function acceptIf<S>(
//   value: S,
//   p: (value: S) => boolean,
//   error?: DiagnosticMessage
// ): Combinator<S> {}

export function parseString(parser: Parser, value: string): Result<string> {
  const result = new Result<string>(parser);
  let i = 0;
  let match = true;
  const start = parser.offset;
  while (i < value.length && match && i < parser.length) {
    match = parser.get(start + i) === value.codePointAt(i);
    i++;
  }
  if (match && i === value.length) {
    parser.skipTo(parser.offset + i);
    result.success(value);
  }
  return result;
}

/** Combinator for a sequence of one or more characters */
export function literal(value: string): Combinator<string> {
  console.assert(value.length > 0);

  //
  // Special case when value is a single character
  //
  if (value.length === 1) return codepoint(value.codePointAt(0)!);

  //
  // General case: value is more than a single char
  //
  return [`**\`${value}\`**`, (parser) => parseString(parser, value)];
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
export function fancyLiteral(value: string): Combinator<string> {
  if (REVERSE_FANCY_UNICODE.has(value)) {
    const fancyList = REVERSE_FANCY_UNICODE.get(value)!;
    return [
      `**_\`${value}\`_**`,
      (parser) => {
        const start = parser.offset;
        for (const fancy of fancyList) {
          if (parser.get(start) === fancy) {
            const result = new Result<string>(parser);
            parser.skipTo(start + codePointLength(fancy));
            result.success(value);
            return result;
          }
        }
        return parseString(parser, value);
      },
    ];
  }

  // No fancy version...
  return literal(value);
}

export function regex(regex: RegExp): Combinator<string> {
  const anchoredRegex = new RegExp(`^${regex.source}`);

  return [
    `regex(${regex.toString()})`,
    (parser: Parser): Result<string> => {
      const result = new Result<string>(parser);
      const start = parser.offset;
      const match = anchoredRegex.exec(parser.slice(start));
      if (match != null) {
        const matchedText = match[0];
        parser.skipTo(start + matchedText.length);
        result.value = matchedText;
      }
      return result;
    },
  ];
}

/**
 * Generator for an ordered, non-empty, sequence of elements separated
 * by whitespace.
 *
 * If the first one fails, the sequence fails (softly).
 * After the first one, if a generator fails, the sequence returns an
 * error.
 */
export function sequence<IR>(
  cs: (string | Combinator)[],
  f: (...results: Result[]) => IR
): Combinator<IR> {
  return [
    cs.map((x) => description(x)).join(' '),
    (parser: Parser): Result<IR> => {
      const results: Result<any>[] = [];
      const whitespaces: Result<boolean>[] = [];
      let isFirst = true;

      whitespaces.push(parser.parseWhitespace());

      for (const c of cs) {
        const pos = parser.offset;
        const res = parser.parse(c);
        results.push(res);

        // If this is the first element, return a failure.
        if (res.isFailure && isFirst) return res;

        if (res.isFailure) {
          // We got a failure later in the sequence,
          // the whole sequence is in error
          return combine(parser, f, results, whitespaces, [
            'unexpected-symbol',
            String.fromCodePoint(parser.get(pos)),
            parser.trace(c),
          ]);
        }

        isFirst = false;
        whitespaces.push(parser.parseWhitespace());
      }

      return combine(parser, f, results, whitespaces);
    },
  ];
}

/**
 * Explore multiple alternatives.
 * Select the one that advances the most.
 */
export function best<IR>(cs: Combinator[]): Combinator<IR> {
  return [
    `best(${cs.map((x) => x[0]).join(' | ')})`,
    (parser: Parser): Result<IR> => {
      const result = new Result<IR>(parser);
      let best: Result<IR> | null = null;
      for (const c of cs) {
        const res = parser.parse(c);
        if (res.isSuccess && (!best || res.end > best.end)) best = res;
      }
      if (best) return best;
      // No alternative succeeded
      parser.skipTo(result.start);
      return result.failure();
    },
  ];
}

/**
 * Explore multiple alternatives.
 * Select the first one that matches.
 *
 */
export function either<IR = any>(
  cs: (string | Combinator)[],
  f?: (result: Result) => IR
): Combinator {
  return [
    cs.map((x) => description(x)).join(' | '),
    (parser: Parser): Result => {
      // Pick the first alternative that succeeds
      const start = parser.offset;
      let error: Result | undefined;
      for (const c of cs) {
        parser.skipTo(start);
        const result = parser.parse(c);
        if (f && (result.isSuccess || result.isError)) {
          result.value = f(result);
        }
        if (result.isSuccess) return result;
        if (!error && result.isError) error = result;
      }
      if (error) {
        parser.skipTo(error.end + 1);
        return error;
      }
      // No alternative succeeded
      parser.skipTo(start);
      return parser.failure();
    },
  ];
}

/**
 *  1 or more `something`
 */
export function many<IR>(
  something: Combinator<IR>,
  f: (...results: Result<IR>[]) => IR
): Combinator<IR> {
  return [
    `(${description(something)})+`,
    (parser: Parser): Result<IR> => {
      const whitespaces: Result<boolean>[] = [parser.parseWhitespace()];

      let res = parser.parse(something);

      // We are expecting at least one
      if (!res.isSuccess && !res.isEmpty) return res;

      const results: Result<IR>[] = [];
      while (res.isSuccess || res.isEmpty) {
        results.push(res);
        res = parser.parse<IR>(something);
        whitespaces.push(parser.parseWhitespace());
      }

      return combine<IR>(parser, f, results, whitespaces);
    },
  ];
}

/**
 * 0 or more `something`.
 *
 * The parser of this combinator will never fail (since ø is an acceptable match).
 * If there are 0 something, the parser will return an Ignore result.
 */
export function some<IR>(
  something: string | Combinator<IR>,
  f: (...results: Result<IR>[]) => IR
): Combinator<IR> {
  return [
    `(${description(something)})*`,
    (parser: Parser): Result<IR> => {
      const whitespaces: Result<boolean>[] = [parser.parseWhitespace()];
      let res = parser.parse(something);

      const results: Result<IR>[] = [res];
      while (!parser.atEnd() && (res.isSuccess || res.isEmpty)) {
        whitespaces.push(parser.parseWhitespace());
        res = parser.parse<IR>(something);
        results.push(res);
      }

      return combine<IR>(parser, f, results, whitespaces);
    },
  ];
}

/**
 *  Succeeds even if `something` fails
 */
export function maybe<T>(something: Combinator<T> | string): Combinator<T> {
  return [
    `\\[${description(something)}\\]`,
    (parser: Parser): Result<T> => {
      const start = parser.offset;

      const result = parser.parse(something);
      if (result.isSuccess || result.isEmpty) return result;
      if (result.isFailure) {
        parser.skipTo(start);
        return parser.ignore();
      }
      return result;
    },
  ];
}

/**
 * Return an error if `something` is a failure
 */
export function must<T>(
  something: string | Combinator<T>,
  inMsg?: DiagnosticMessage | ((Parser) => DiagnosticMessage)
): Combinator<T> {
  return [
    `(${description(something)})!`,
    (parser: Parser): Result<T> => {
      const result = parser.parse<T>(something);
      if (result.isSuccess || result.isEmpty || result.isError) return result;

      // We could not process the next character, skip it and try to continue
      let retryCount = 5;
      const pos = parser.offset; // Position of where the unexpected error occurred
      let msg = inMsg;
      if (!msg) {
        msg = parser.atEnd()
          ? ['expression-expected']
          : [
              'unexpected-symbol',
              String.fromCodePoint(parser.get(pos)),
              parser.trace(something),
            ];
      }
      while (retryCount > 0 && !parser.atEnd()) {
        parser.skipTo(parser.offset + 1);
        const res = parser.parse(something);
        if (res.isSuccess || res.isEmpty) {
          result.errorAt(res.value!, msg, pos);
          result.copyDiagnostics(res);
          return result;
        }
        retryCount -= 1;
      }
      return result.errorAt(result.value!, msg, pos);
    },
  ];
}

// export function ignore(something: string | Combinator): Combinator {
//   return [
//     `\\[${description(something)}\\]!`,
//     (parser: Parser): Result<any> => parser.parse(something).ignore(),
//   ];
// }

export function eof(): Combinator<boolean> {
  return [
    '_eof_',
    (parser: Parser): Result<boolean> => {
      const result = new Result<boolean>(parser);
      return parser.atEnd() ? result.success(true) : result.failure();
    },
  ];
}
