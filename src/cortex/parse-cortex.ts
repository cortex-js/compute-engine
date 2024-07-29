import { Expression } from '../math-json/types';
import { Origin } from '../common/debug';
import {
  FatalParsingError,
  Parser,
  ParsingDiagnostic,
  Result,
} from '../point-free-parser/parsers';
import {
  either,
  eof,
  literal,
  maybe,
  must,
  parseString,
  sequence,
  some,
} from '../point-free-parser/core-combinators';
import {
  between,
  manySeparatedBetween,
  operatorSequence,
} from '../point-free-parser/combinators';
import { parseSignedNumber } from '../point-free-parser/numeric-parsers';
import { parseIdentifier } from '../point-free-parser/identifier-parsers';
import {
  parseExtendedString,
  parseMultilineString,
  parseSingleLineString,
} from '../point-free-parser/string-parsers';
import { Grammar } from '../point-free-parser/grammar';
// import { parseShebang } from '../fixed-point-parser/whitespace-parsers';
import {
  xop,
  machineValue,
  stringValue,
  isStringObject,
  mapArgs,
} from '../math-json/utils';
import { parseWhitespace } from '../point-free-parser/whitespace-parsers';
import { escapeJsonString } from '../common/json';

// eslint-disable-next-line prefer-const
const grammar = new Grammar<Expression>();

// For debugging purposes, output an expression as a string
function expressionToString(expr: Expression | undefined | null): string {
  if (expr === undefined || expr === null) return '';
  const strValue = stringValue(expr);
  if (strValue !== null) return strValue;
  if (typeof expr === 'number') return Number(expr).toString();
  if (typeof expr === 'object' && 'num' in expr) return expr.num;
  return expr.toString();
}

/** Decorate an expression with a source origin
 * (offset range in the source code)
 */
function exprOrigin(
  expr: Expression,
  offsets: [number, number] | Result
): Expression {
  if (!Array.isArray(offsets)) offsets = offsets.range;
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
  'whitespace',
  (parser: Parser): Result<boolean> => parseWhitespace(parser)
);
grammar.rule('pragma', either(['pragma-symbol', 'pragma-function']));

grammar.rule(
  'pragma-symbol',
  either(
    [
      literal('#line'),
      literal('#column'),
      literal('#filename'),
      literal('#url'),
      literal('#date'),
      literal('#time'),
    ],
    (fn: Result<string>): Expression => {
      if (fn.value === '#date') {
        const today = new Date();
        return (
          today.getFullYear() +
          '-' +
          ('00' + (1 + today.getMonth())).slice(-2) +
          '-' +
          ('00' + (1 + today.getDay())).slice(-2)
        );
      }
      if (fn.value === '#time') {
        const today = new Date();
        return (
          ('00' + today.getHours().toString()).slice(-2) +
          ':' +
          ('00' + today.getMinutes().toString()).slice(-2) +
          ':' +
          ('00' + today.getSeconds().toString()).slice(-2)
        );
      }
      if (fn.value === '#url') {
        return fn.parser.url ?? 'Nothing';
      }
      if (fn.value === '#filename') {
        if (!fn.parser.url) return 'Nothing';
        return fn.parser.url.substring(fn.parser.url.lastIndexOf('/') + 1);
      }
      if (fn.value === '#line') {
        const origin = new Origin(fn.parser.source, fn.parser.url);
        return origin.getLinecol(fn.parser.offset)[0];
      }
      if (fn.value === '#column') {
        const origin = new Origin(fn.parser.source, fn.parser.url);
        return origin.getLinecol(fn.parser.offset)[1];
      }
      // @todo: #time, #line, etc...
      return 'Nothing';
    }
  )
);

grammar.rule(
  'pragma-function',
  sequence(
    [
      either([
        literal('#warning'),
        literal('#error'),
        literal('#env'),
        literal('#navigator'),
      ]),
      'function-call-argument-clause',
    ],
    (fn: Result<string>, args: Result<Expression>): Expression => {
      if (fn.value === '#warning') {
        const message = mapArgs<string>(args.value!, (x) =>
          expressionToString(x)
        ).join(' ');
        console.log(message);
        return { str: message };
      } else if (fn.value === '#error') {
        const message = mapArgs<string>(args.value!, (x) =>
          expressionToString(x)
        ).join(' ');
        console.error(message);
        throw new FatalParsingError(message);
      } else if (fn.value === '#env') {
        if ('process' in globalThis && process.env) {
          return {
            str: process.env[expressionToString(xop(args.value!, 1))] ?? '',
          };
        }
      } else if (fn.value === '#navigator') {
        // eslint-disable-next-line no-restricted-globals
        if ('navigator' in globalThis) {
          // eslint-disable-next-line no-restricted-globals
          return { str: navigator[expressionToString(xop(args.value!, 1))] };
        }
      }
      return 'Nothing';
    }
  )
);

grammar.rule(
  'function-call-argument-clause',
  manySeparatedBetween(
    '(',
    'expression',
    ',',
    ')',
    (values: Result<Expression>[]): Expression => {
      return ['List', ...values.map((x) => x.value!)];
    }
  )
);

grammar.rule(
  'signed-number',
  '_numerical-constant_ | (\\[_sign_\\] (_binary-number_ | _hexadecimal-number_ | _decimal-number_)'
);

grammar.rule('signed-number', (parser: Parser): Result<Expression> => {
  const result = new Result<Expression>(parser);
  let litResult = parseString(parser, 'NaN');
  if (litResult.isFailure) litResult = parseString(parser, '+Infinity');
  if (litResult.isFailure) litResult = parseString(parser, '-Infinity');
  if (litResult.isSuccess) {
    return result.success(exprOrigin({ num: litResult.value! }, litResult));
  }

  // `Infinity` is equal to `+Infinity`.
  litResult = parseString(parser, 'Infinity');
  if (litResult.isSuccess) {
    return result.success(exprOrigin({ num: '+Infinity' }, litResult));
  }

  const numResult = parseSignedNumber(parser);
  if (numResult.isSuccess) {
    // Return a number expression
    // @todo: we could return a FromDigits() for hexadecimal and decimal
    return result.success(exprOrigin(numResult.value!, numResult));
  }
  return numResult;
});

grammar.rule('symbol', '_verbatim-symbol_ | _inline-symbol_');

grammar.rule('symbol', (parser: Parser): Result<Expression> => {
  const result = new Result<Expression>(parser);
  const res = parseIdentifier(parser);
  result.copyDiagnostics(res);
  result.end = res.end;
  if (res.isSuccess || res.isError) {
    result.success(exprOrigin(res.value!, res));
  }
  return result;
});

grammar.rule(
  'string',
  '_single-line-string_ | _multiline-string_ | _extended-string_'
);
grammar.rule('string', (parser: Parser): Result<Expression> => {
  let result: Result<any> = parseSingleLineString(parser, 'expression');
  if (result.isFailure) result = parseMultilineString(parser, 'expression');

  if (result.isFailure) {
    result = parseExtendedString(parser);
    if (result.isSuccess) {
      return result.success(exprOrigin({ str: result.value }, result));
    }
  }

  if (result.isFailure || result.isEmpty) return result;

  const values: string[] = [];
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
  result.value = value;
  return result;
});

grammar.rule(
  'primary',
  either([
    'pragma',
    'signed-number',
    'symbol',
    'string',
    'parenthesized-expression',
  ])
);

grammar.rule(
  'expression',
  operatorSequence<Expression, string>(
    [
      ['NotElement', '!in', 160],
      ['Element', 'in', 240],
      ['LessEqual', '<=', 241],
      ['GreaterEqual', '>=', 242],
      ['Less', '<', 245],
      ['Greater', '>', 245],
      ['NotEqual', '!=', 255],
      ['Assign', '=', 258],
      ['Equal', '==', 260],
      ['Same', '===', 260],
      ['KeyValuePair', '->', 265],
      ['Add', '+', 275],
      ['Subtract', '-', 275],
      ['Multiply', '*', 390],
      ['Divide', '/', 660],
      ['Negate', '-', 665, 'prefix'],
      ['Power', '^', 720, 'left'],
      // ['Subscript', '_', 720, 'left'],
      ['Pipe', '|>', 790],
      ['BackPipe', '~>', 790],
      ['Or', '||', 800],
      ['And', '&&', 810],
      ['Not', '!', 820, 'prefix'],
    ],
    'primary',
    (op: string, lhs: Expression, rhs: Expression): Expression => {
      if (!lhs && rhs) {
        if (op === 'Negate') {
          const val = machineValue(rhs);
          if (val !== null && !Number.isNaN(val)) {
            return { num: Number(-val).toString() };
          }
        }
        return { fn: [op, rhs] };
      }
      return lhs;
    }
  )
);

grammar.rule('parenthesized-expression', between('(', 'expression', ')'));

// Top-level rule for the Cortex grammar
grammar.rule(
  'cortex',
  must(
    sequence(
      [
        maybe('shebang'),
        some(
          'expression',
          (...expressions: Result<Expression>[]): Expression => {
            console.assert(expressions && expressions.length > 0);
            const exprs = expressions.filter((x) => !x.isEmpty && !x.isFailure);
            if (exprs.length === 0) {
              return exprOrigin('Nothing', expressions[0]);
            }
            if (exprs.length === 1) {
              return exprOrigin(exprs[0].value ?? 'Nothing', exprs[0]);
            }

            return exprOrigin(
              ['Do', ...exprs.map((x) => x.value!)],
              [exprs[0].start, exprs[exprs.length - 1].end]
            );
          }
        ),
        must(eof()),
      ],
      (
        _shebang: Result<boolean>,
        expr: Result<Expression>,
        _eof: Result<boolean>
      ): Expression => exprOrigin(expr.value ?? 'Nothing', expr)
    )
  )
);

/** Analyze the reported errors and combine them when possible */
export function analyzeErrors(
  errors: ParsingDiagnostic[]
): ParsingDiagnostic[] {
  const result: ParsingDiagnostic[] = [...errors];
  // @todo: could combine a 'string-literal-closing-delimiter-expected'
  // followed by a 'string-literal-opening-delimiter-expected'
  return result;
}

export function parseCortex(
  source: string,
  url?: string
): [Expression, ParsingDiagnostic[]] {
  const result = grammar.parse('cortex', source, url);

  // Yay!
  if (result.isSuccess) return [result.value!, []];

  // Uh-oh.
  const origin = new Origin(source);
  if (result.isError) {
    // Something went wrong: 1 or more syntax errors
    return [
      result.value!,
      analyzeErrors(result.diagnostics).map((x) => {
        return {
          ...x,
          // Convert from offset to line/col
          origin: origin.signalOrigin(x.range[2] ?? x.range[1]),
        };
      }),
    ];
  }
  // Should not happen
  if (result.isEmpty) return ['Nothing', []];

  if (result.isFailure) {
    // Should not happen (should get an error instead)
    return ['Nothing', []];
  }
  return ['Nothing', []];
}
