import { Expression, Signal } from '../public';
import { Origin } from '../common/debug';
import { Parser, Result, Success, Error } from '../combinator-parser/parsers';
import {
  alt,
  eof,
  maybe,
  must,
  parseString,
  sequence,
} from '../combinator-parser/core-combinators';
import { some } from '../combinator-parser/combinators';
import { parseSignedNumber } from '../combinator-parser/numeric-parsers';
import { parseIdentifier } from '../combinator-parser/identifier-parsers';
import {
  parseExtendedString,
  parseMultilineString,
  parseSingleLineString,
} from '../combinator-parser/string-parsers';
import { Grammar } from '../combinator-parser/grammar';
import { parseShebang } from '../combinator-parser/whitespace-parsers';
import { isStringObject } from '../common/utils';

// eslint-disable-next-line prefer-const
const grammar = new Grammar<Expression>();

const JSON_ESCAPE_CHARS = {
  0x00: '\\u0000',
  0x01: '\\u0001',
  0x02: '\\u0002',
  0x03: '\\u0003',
  0x04: '\\u0004',
  0x05: '\\u0005',
  0x06: '\\u0006',
  0x07: '\\u0007',
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0b: '\\u000b',
  0x0c: '\\f',
  0x0d: '\\r',
  0x0e: '\\u000e',
  0x0f: '\\u000f',
  0x10: '\\u0010',
  0x11: '\\u0011',
  0x12: '\\u0012',
  0x13: '\\u0013',
  0x14: '\\u0014',
  0x15: '\\u0015',
  0x16: '\\u0016',
  0x17: '\\u0017',
  0x18: '\\u0018',
  0x19: '\\u0019',
  0x1a: '\\u001a',
  0x1b: '\\u001b',
  0x1c: '\\u001c',
  0x1d: '\\u001d',
  0x1e: '\\u001e',
  0x1f: '\\u001f',
  0x22: '\\"',
  0x2f: '\\/',
  0x5c: '\\\\',
};
/**
 * Escape a string according to the JSON string requirements
 */
function escapeJsonString(s: string): string {
  let result = '';
  for (const c of s) result += JSON_ESCAPE_CHARS[c.codePointAt(0)] ?? c;
  return result;
}

/** Decorate an expression with a source origin
 * (offset range in the source code)
 */
function exprOrigin(
  expr: Expression,
  offsets: [number, number] | Result
): Expression {
  if (!Array.isArray(offsets)) offsets = [offsets.start, offsets.next];
  if (Array.isArray(expr)) return { fn: expr, sourceOffsets: offsets };

  if (typeof expr === 'object') return { ...expr, sourceOffsets: offsets };

  if (typeof expr === 'number') {
    return { num: expr.toString(), sourceOffsets: offsets };
  }
  if (
    typeof expr === 'string' &&
    expr[0] === "'" &&
    expr[expr.length - 1] === "'"
  ) {
    return { str: expr.slice(1, -1), sourceOffsets: offsets };
  }
  return { sym: expr, sourceOffsets: offsets };
}

grammar.rule(
  'quoted-text-item',
  'U+0000-U+0009 U+000B-U+000C U+000E-U+0021 U+0023-U+2027 U+202A-U+D7FF | U+E000-U+10FFFF'
);

grammar.rule('linebreak', '(U+000A \\[U+000D\\]) | U+000D | U+2028 | U+2029');

grammar.rule('unicode-char', '_quoted-text-item_ | _linebreak_ | U+0022');

grammar.rule(
  'pattern-syntax',
  'U+0021-U+002F | U+003A-U+0040 | U+005b-U+005E | U+0060 | U+007b-U+007e | U+00A1-U+00A7 | U+00A9 | U+00AB-U+00AC | U+00AE | U+00B0-U+00B1 | U+00B6 | U+00BB | U+00BF | U+00D7 | U+00F7 | U+2010-U+203E | U+2041-U+2053 | U+2190-U+2775 | U+2794-U+27EF | U+3001-U+3003 | U+3008-U+3020 | U+3030 | U+FD3E | U+FD3F | U+FE45 | U+FE46'
);

grammar.rule('inline-space', 'U+0009 | U+0020');

grammar.rule(
  'pattern-whitespace',
  '_inline-space_ | U+000A | U+000B | U+000C | U+000D | U+0085 | U+200E | U+200F | U+2028 | U+2029'
);

grammar.rule(
  'whitespace',
  '_pattern-whitespace_ | U+0000 | U+00A0 | U+1680 | U+180E | U+2000-U+200A | U+202f | U+205f | U+3000'
);

grammar.rule('line-comment', '**`//`** (_unicode-char_)* _linebreak_)');

grammar.rule(
  'block-comment',
  '**`/*`** (((_unicode-char_)\\* _linebreak_)) | _block-comment_) **`*/`**'
);

grammar.rule('digit', 'U+0030-U+0039 | U+FF10-U+FF19');

grammar.rule(
  'hex-digit',
  '_digit_ | U+0041-U+0046 | U+0061-U+0066 | U+FF21-FF26 | U+FF41-U+FF46'
);

grammar.rule('binary-digit', 'U+0030 | U+0031 | U+FF10 | U+FF11');

grammar.rule(
  'numerical-constant',
  '**`NaN`** | **`Infinity`** | **`+Infinity`** | **`-Infinity`**'
);

grammar.rule('base-10-exponent', '(**`e`** | **`E`**) \\[_sign_\\](_digit_)+');
grammar.rule('base-2-exponent', '(**`p`** | **`P`**) \\[_sign_\\](_digit_)+');

grammar.rule(
  'binary-number',
  '**`0b`** (_binary-digit_)+ \\[**`.`** (_binary-digit_)+ \\]\\[_exponent_\\]'
);

grammar.rule(
  'hexadecimal-number',
  '**`0x`** (_hex-digit_)+ \\[**`.`** (_hex-digit_)+ \\]\\[_exponent_\\]'
);

grammar.rule(
  'decimal-number',
  '(_digit_)+ \\[**`.`** (_digit_)+ \\]\\[_exponent_\\]'
);

grammar.rule('sign', '**`+`** | **`-`**');

const signedNumber = grammar.rule('signed-number', [
  '_numerical-constant_ | (\\[_sign_\\] (_binary-number_ | _hexadecimal-number_ | _decimal-number_)',
  (parser: Parser): Result<Expression> => {
    let litResult = parseString(parser, 'NaN');
    if (litResult.kind === 'failure') {
      litResult = parseString(parser, 'Infinity');
    }
    if (litResult.kind === 'failure') {
      litResult = parseString(parser, '+Infinity');
    }
    if (litResult.kind === 'failure') {
      litResult = parseString(parser, '-Infinity');
    }
    if (litResult.kind === 'success') {
      return parser.success<Expression>(
        [litResult.start, litResult.next],
        exprOrigin({ num: litResult.value }, litResult)
      );
    }

    const numResult = parseSignedNumber(parser);
    if (numResult.kind === 'success') {
      // Return a number expression
      // @todo: we could return a BaseForm() for hexadecimal and decimal
      return parser.success<Expression>(
        [numResult.start, numResult.next],
        exprOrigin(numResult.value, numResult)
      );
    }
    return numResult;
  },
]);

grammar.rule('symbol', '_verbatim-symbol_ | _inline-symbol_');
grammar.rule(
  'verbatim-symbol',
  '**``` ` ```** (_escape-sequence_ | _symbol_start_) (_escape-sequence_ | _symbol_continue_)* **``` ` ```**'
);
grammar.rule('inline-symbol', '_symbol-start_ (_symbol_continue_)*');

const symbol = grammar.rule('symbol', [
  '_verbatim-symbol_ | _inline-symbol_',
  (parser: Parser): Result<Expression> => {
    const result = parseIdentifier(parser);
    if (result.kind !== 'success' && result.kind !== 'error') return result;
    const value = exprOrigin(result.value, result);
    if (result.kind === 'success') {
      return parser.success([result.start, result.next], value);
    }
    return parser.errors([result.start, result.next], value, result.errors);
  },
]);

grammar.rule('escape-expression', '**`\\(`** _expression_ **`)`**');
grammar.rule(
  'single-line-string',
  '**`"`** (_escape-sequence_ | _escape-expression_ | _quoted-text-item_)* **`"`**'
);
grammar.rule('multiline-string', '**`"""`** _multiline-string-line_ **`"""`**');
grammar.rule('extended-string', '');

const string = grammar.rule('string', [
  '_single-line-string_ | _multiline-string_ | _extended-string_',
  (parser: Parser): Result<Expression> => {
    let result:
      | Result<string>
      | Result<(string | Expression)[]> = parseSingleLineString<Expression>(
      parser,
      expression[1]
    );
    if (result.kind === 'failure') {
      result = parseMultilineString(parser, expression[1]);
    }
    if (result.kind === 'failure') {
      result = parseExtendedString(parser);
      if (result.kind === 'success') {
        return parser.success(
          [result.start, result.next],
          exprOrigin({ str: result.value }, result)
        );
      } else if (result.kind === 'error') {
        return parser.errors(
          [result.start, result.next],
          exprOrigin({ str: result.value }, result),
          [...result.errors]
        );
      }
    }

    if (result.kind !== 'success' && result.kind !== 'error') return result;

    const values = [];
    let previousString: string | undefined;
    for (const value of result.value) {
      if (typeof value === 'string') {
        previousString = (previousString ?? '') + value;
      } else if (isStringObject(value)) {
        previousString = (previousString ?? '') + value.str;
      } else {
        if (typeof previousString === 'string') {
          values.push(previousString);
          previousString = undefined;
        }
        values.push(value);
      }
    }

    if (typeof previousString === 'string') values.push(previousString);

    let value: Expression;
    if (values.length === 1 && typeof values[0] === 'string') {
      // It's a simple, non-interpolated string
      value = exprOrigin({ str: escapeJsonString(values[0]) }, result);
    } else {
      // It's an interpolated string
      value = exprOrigin(
        [
          'String',
          ...values.map((x) => {
            return typeof x === 'string' ? { str: x } : x;
          }),
        ],
        result
      );
    }

    if (result.kind === 'success') {
      return parser.success([result.start, result.next], value);
    }
    return parser.errors([result.start, result.next], value, result.errors);
  },
]);

const primary = grammar.rule(
  'primary',
  alt<Expression>([signedNumber, symbol, string])
);

const expression = grammar.rule('expression', primary);

const shebang = grammar.rule('shebang', [
  '**`#!`** (unicode-char)* (_linebreak | _eof_)',
  parseShebang,
]);

// Define the top-level rule for the grammar
grammar.rule(
  'cortex',
  must(
    sequence(
      [
        maybe(shebang),
        some(
          expression,
          (...results: (Success<Expression> | Error<Expression>)[]) => {
            console.assert(results && results.length > 0);
            if (results.length === 1) return results[0].value;

            return exprOrigin(
              ['Do', ...results.map((x) => x.value)],
              [results[0].start, results[results.length - 1].next]
            );
          }
        ),
        eof('unexpected-symbol'),
      ],
      (result: Success<Expression> | Error<Expression>): Expression =>
        exprOrigin(result.value ?? 'Nothing', result)
    )
  )
);

/** Analyze the reported errors and combine them when possible */
export function analyzeErrors(errors: Signal[]): Signal[] {
  const result: Signal[] = [...errors];
  // @todo: could combine a 'string-literal-closing-delimiter-expected'
  // followed by a 'string-literal-opening-delimiter-expected'
  return result;
}

export function parseCortex(source: string): [Expression, Signal[]] {
  const result = grammar.parse(source, 'cortex');

  // Yay!
  if (result.kind === 'success') return [result.value, []];

  // Uh-oh.
  const origin = new Origin(source);
  if (result.kind === 'error') {
    // Something went wrong: 1 or more syntax errors
    return [
      result.value,
      analyzeErrors(result.errors).map((x) => {
        return {
          ...x,
          // Convert from offset to line/col
          origin: origin.signalOrigin(x.origin.offset),
        };
      }),
    ];
  }
  // Should not happen
  if (result.kind === 'ignore') return ['Nothing', []];

  if (result.kind === 'failure') {
    // Should not happen (should get an error instead)
    return [
      'False',
      [{ ...result.error, origin: origin.signalOrigin(result.next) }],
    ];
  }
}
