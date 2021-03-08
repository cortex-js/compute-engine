import { Expression, Signal } from '../public';
import { Origin } from '../common/debug';
import {
  ParserState,
  Result,
  Success,
  Error,
} from '../combinator-parser/parsers';
import {
  Combinator,
  eof,
  must,
  parseString,
  sequence,
  some,
} from '../combinator-parser/combinators';
import { parseSignedNumber } from '../combinator-parser/numeric-parsers';

function signedNumber(): Combinator<Expression> {
  return (parser: ParserState): Result<Expression> => {
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
      return parser.success<Expression>(litResult.next, {
        num: litResult.value,
        originOffset: litResult.start,
      });
    }

    const numResult = parseSignedNumber(parser);
    if (numResult.kind === 'success') {
      // Return a number expression
      // @todo: we could return a BaseForm() for hexadecimal and decimal
      return parser.success<Expression>(numResult.next, {
        num: numResult.value.toString(),
        originOffset: numResult.start,
      });
    }
    return numResult;
  };
}

function primary(): Combinator<Expression> {
  return signedNumber();
}

function exprOrigin(expr: Expression, offset: number): Expression {
  if (Array.isArray(expr)) {
    return {
      fn: expr,
      originOffset: offset,
    };
  } else if (typeof expr === 'object') {
    return {
      ...expr,
      originOffset: offset,
    };
  } else if (typeof expr === 'number') {
    return {
      num: expr.toString(),
      originOffset: offset,
    };
  }
  return {
    sym: expr,
    originOffset: offset,
  };
}

function cortexGrammar(): Combinator<Expression> {
  return must(
    sequence(
      [
        some(
          primary(),
          (...results: (Success<Expression> | Error<Expression>)[]) => {
            console.assert(results && results.length > 0);
            if (results.length === 1) {
              return exprOrigin(results[0].value, results[0].start);
            }
            return exprOrigin(
              [
                'Do',
                ...results.map((x: Success<Expression>) =>
                  exprOrigin(x.value, x.start)
                ),
              ],
              results[0].start
            );
          }
        ),
        eof(),
      ],
      (result, _): Expression => result ?? 'Nothing'
    )
  );
}

const CORTEX_GRAMMAR = cortexGrammar();

export function parseCortex(source: string): [Expression, Signal[]] {
  // const cortex = new CortexExpression(s);
  // return [cortex.parseExpression(), cortex.warnings];
  const parser = new ParserState(source);
  const result = CORTEX_GRAMMAR(parser);
  const origin = new Origin(source);

  if (result.kind === 'success') {
    // Yay!
    return [result.value, []];
  } else if (result.kind === 'error') {
    // Something went wrong: 1 or more syntax errors
    return [
      result.value,
      result.errors.map((x) => {
        return {
          ...x,
          // Convert from offset to line/col
          origin: origin.signalOrigin(x.origin.offset),
        };
      }),
    ];
  } else if (result.kind === 'ignore') {
    // Should not happen
    return ['Nothing', []];
  } else if (result.kind === 'failure') {
    // Should not happen (should get a hypothetical instead)
    return [
      'False',
      [{ ...result.error, origin: origin.signalOrigin(result.next) }],
    ];
  }
}
