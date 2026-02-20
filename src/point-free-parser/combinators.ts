// import { REVERSE_FANCY_UNICODE } from './characters';
import { description, literal } from './core-combinators';
import { Parser, Result, skipUntilString, Combinator } from './parsers';

// function any<T>(
//   seq: Combinator[],
//   map: (result: Result<T>[]) => Result<T>
// ): Combinator<T> {}

// function manySeparated<T>(
//   sep: string,
//   map: (result: Result<T>[]) => Result<T>
// ): Combinator<T> {}

/**
 * An element bracketed by open and close delimiters.
 *
 */
export function between<IR>(
  open: string,
  something: string | Combinator<IR>,
  close: string
): Combinator<IR> {
  // @todo: could have a specialized version for when open and close
  // are single chars
  return [
    `**\`${open}\`** (${description(something)})* **\`${close}\`**`,
    (parser: Parser): Result<IR> => {
      const result = new Result<IR>(parser);
      if (!parser.atString(open)) return result.failure();
      const start = parser.offset;
      parser.skipTo(start + open.length);
      const res = parser.parse(something);
      if (res.isError) {
        result.copyDiagnostics(res);
        result.range = [result.start, skipUntilString(parser, close)];
        return result;
      }
      if (!parser.atString(close)) {
        return result.error(res.value!, ['closing-bracket-expected', close]);
      }

      parser.skipTo(parser.offset + close.length);
      result.value = res.value;
      return result;
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

export function manySeparatedBetween<IR>(
  open: string,
  something: string | Combinator<IR>,
  separator: string,
  close: string,
  f: (values: Result<IR>[]) => IR
): Combinator<IR> {
  return [
    `**\`${open}\`** (${description(
      something
    )}+#**\`${separator}\`** **\`${close}\`**`,
    (parser: Parser): Result<IR> => {
      const result = new Result<IR>(parser);

      if (!parser.parse(literal(open)).isSuccess) return result.failure();

      const values: Result<IR>[] = [];
      let done = false;
      while (!done && !parser.atEnd()) {
        const res = parser.parse(something);
        result.copyDiagnostics(res);
        done = !res.isSuccess;
        if (!done) {
          values.push(res);
          done = !parser.parse(literal(separator)).isSuccess;
        }
      }

      if (values.length === 0) {
        return result.error(f([]), 'expression-expected');
      }
      if (!parser.parse(literal(close)).isSuccess) {
        return result.error(f(values), ['closing-bracket-expected', close]);
      }
      return result.success(f(values));
    },
  ];
}

/**
 * 0 or more elements, separated and bracketed with open and close delimiters
 * */
export function someSeparatedBetween<IR>(
  open: string,
  something: string | Combinator<IR>,
  separator: string,
  close: string,
  f: (values: (IR | undefined | null)[]) => IR
): Combinator<IR> {
  return [
    `**\`${open}\`** (${description(
      something
    )}*#**\`${separator}\`** **\`${close}\`**`,
    (parser: Parser): Result<IR> => {
      const result = new Result<IR>(parser);

      if (parser.parse(open).isSuccess) return result.failure();

      const values: (IR | undefined | null)[] = [];
      let done = false;
      while (!done && !parser.atEnd()) {
        const res = parser.parse(something);
        result.copyDiagnostics(res);
        done = !res.isSuccess;
        if (!done) {
          values.push(res.value);
          done = !parser.parse(separator).isSuccess;
        }
      }

      if (!parser.parse(close).isSuccess) {
        return result.error(f(values), ['closing-bracket-expected', close]);
      }
      return result.success(f(values));
    },
  ];
}

/**
 * Combinator for a table of operators.
 * Each operator has a precedence, and can be either a prefix,
 * suffix, left-associating infix, or right-association infix.
 *
 * Prefix and suffix have no whitespace between the operator and its term.
 *
 * Infix have either whitespace on both sides *or* no whitespace.
 *
 * This requirement is necessary to parse multi-line statements without
 * requiring statement separators.
 *
 */
export type OpRecord<U> = [
  data: U,
  op: string,
  prec: number,
  assoc?: 'prefix' | 'suffix' | 'left' | 'right'
];

export type OpsTable<U> = OpRecord<U>[];

/**
 * Return the ops sorted by length of the symbol so that,
 * e.g. '<<-' is before '<-'
 */
// function sortedOps<U>(ops: OpsTable<U>): OpsTable<U> {
//   return [...ops].sort((a: OpRecord<U>, b: OpRecord<U>): number => {
//     if (a[1].length === b[1].length) {
//       if (a[1] === b[1]) {
//         return b[2] - a[2];
//       }
//       return b[1] < a[1] ? -1 : +1;
//     }
//     return b[1].length - a[1].length;
//   });
// }

/**
 * A sequence of prefix, infix and suffix operators with `term`
 * operands.
 *
 * The `f` mapping function is called according to the specified
 * precedence info in the `OpsTable`
 */
export function operatorSequence<IR, U>(
  ops: OpsTable<U>,
  term: string | Combinator<IR>,
  f: (op: U, lhs?: IR, rhs?: IR) => IR
): Combinator<IR> {
  const termDesc = description(term);
  return [
    ops
      .map((x: OpRecord<U>) => {
        const [_data, op, prec] = x;
        const assoc = x[3] ?? 'right';
        if (assoc === 'prefix') {
          return `**\`${op}\`**<sub>${prec}</sub> ${termDesc}`;
        } else if (assoc === 'suffix') {
          return `${termDesc} **\`${op}\`**<sub>${prec}</sub>`;
        } else if (assoc === 'left') {
          return `_···_ **\`${op}\`**<sub>${prec}L</sub> ${termDesc}`;
        }
        return `${termDesc} **\`${op}\`**<sub>${prec}R</sub> _···_`;
      })
      .join(' | '),

    (parser) => parseWithPrecedence(parser, ops, term, f),
  ];
}

// function prefixOps<U>(ops: OpsTable<U>, minPrec: number): OpsTable<U> {
//   return ops.filter((x) => {
//     const [_data, _op, prec, assoc] = x;
//     return prec >= minPrec && assoc === 'prefix';
//   });
// }
// function suffixOps<U>(ops: OpsTable<U>, minPrec: number): OpsTable<U> {
//   return ops.filter((x) => {
//     const [_data, _op, prec, assoc] = x;
//     return prec >= minPrec && assoc === 'suffix';
//   });
// }
// function infixOps<U>(ops: OpsTable<U>, minPrec: number): OpsTable<U> {
//   return ops.filter((x) => {
//     const [_data, _op, prec, assoc] = x;
//     return prec >= minPrec && assoc !== 'suffix' && assoc !== 'prefix';
//   });
// }

// function parseOp<T, U>(parser: Parser, ops: OpsTable<U>): OpRecord<U> {
//   for (const opRecord of ops) {
//     const [_data, op, _precedence, _assoc] = opRecord;
//     if (parser.atString(op)) {
//       parser.skipTo(parser.offset + op.length);
//       return opRecord;
//     }
//     if (
//       REVERSE_FANCY_UNICODE.has(op) &&
//       REVERSE_FANCY_UNICODE.get(op).includes(parser.get(parser.offset))
//     ) {
//       parser.skipTo(parser.offset + 1);
//       return opRecord;
//     }
//   }
//   return [undefined, undefined, undefined, undefined];
// }

// if (prec < minPrec) return null;
// prec += def.associativity === 'left' ? 1 : 0;

function parseWithPrecedence<IR, U>(
  parser: Parser,
  ops: OpsTable<U>,
  term: string | Combinator<IR>,
  _f: (op: U, lhs?: IR, rhs?: IR) => IR
): Result<IR> {
  return parser.parse(term);

  // const result = new Result<IR>(parser);
  // const start = parser.offset;
  // //
  // // Shunting-yard algorithm
  // //

  // // Start off with an empty output stream and an empty stack.
  // const opStack = [];
  // const operandStack = [];
  // let lhs: IR;

  // ops = sortedOps(infixOps(ops, 0));

  // // Repeatedly read a symbol from the input.
  // while (true) {
  //   // 1. Is is an operand?
  //   // If it is part of a number (i.e., a digit or a decimal separator),
  //   //      then keep reading tokens until an operand or parenthesis is encountered,
  //   //       and convert the entire string just read into a number,
  //   //      and transfer the number to the output stream.
  //   // parseOperand() = one or more infix, a term, one or more postfix
  //   if (false) {
  //     // push on output stream (= lhs)
  //   } else {
  //     const [data, op, precedence, assoc] = parseOp(parser, ops);
  //     if (!op) break;
  //     console.assert(opStack.length > 0);

  //     // 2. Is it a left-associative infix operator?
  //     if (assoc === 'left') {
  //       // If it is a left-associative operator,
  //       //      then repeatedly pop from the stack into the output stream
  //       //      until either the stack becomes empty
  //       //      or the top of the stack is a parenthesis
  //       //      or a lower-precedence operator.
  //       //      After that, push it onto the stack.
  //     }
  //     // 3. Is it a right-associative infix operator?
  //     if (assoc === 'right') {
  //       // If it is a right-associative operator,
  //       //      then repeatedly pop from the stack into the output stream
  //       //      until either the stack becomes empty
  //       //      or the top of the stack is a parenthesis
  //       //      or an operator of lower or equal precedence.
  //       //      After that, push it onto the stack.
  //     }
  //     // If it is an opening parenthesis,
  //     //      push it onto the stack.
  //     // If it is a closing parenthesis,
  //     //      repeatedly pop operators from the stack into the output stream until an opening parenthesis is encountered. Pop the opening parenthesis off the stack, but do not emit it into the output stream.
  //   }
  // }

  // return result.success(lhs);
}

// function parseWithPrecedence<T, U>(
//   parser: Parser<T>,
//   ops: OpsTable<U>,
//   term: string | Combinator<T>,
//   f: (op: U, lhs?: T, rhs?: T) => T,
//   minPrec: number
// ): Result<T> {
//   //
//   // 1. Parse a prefix operator
//   //

//   const result = parsePrefixOp(parser, ops, term, f, minPrec);
//   if (! result.isFailure) return result;

//   //
//   // 2. Parse an infix operator
//   //
//   const lhs = parseInfixOp(parser, ops, term, f, minPrec);

//   //
//   // 3. Parse a suffix operator
//   //

//   return lhs;
// }
/**
 * Parse a prefix operator
 */
// function parsePrefixOp<T, U>(
//   parser: Parser<T>,
//   ops: OpsTable<U>,
//   term: string | Combinator<T>,
//   f: (op: U, lhs?: T, rhs?: T) => T,
//   minPrec: number
// ): Result<T> {
//   const start = parser.offset;

//   const prefix = prefixOps(ops, minPrec);
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   // eslint-disable-next-line prefer-const
//   const opRecord = parseOp(parser, prefix);
//   if (!opRecord[1]) return parser.failure();

//   // We've found an eligible prefix operator.
//   parser.skipTo(parser.offset + opRecord[1].length);
//   const whitespace = parseWhitespace(parser);
//   if (
//     whitespace.isError ||
//     (whitespace.isIgnore && whitespace.next !== whitespace.start)
//   ) {
//     // There was some whitespace after the operator:
//     // it's not a prefix operator.
//     parser.skipTo(start);
//     return parser.failure();
//   }

//   // It *is* a prefix operator...
//   // const rhs = parser.parse(term);
//   const rhs = parseWithPrecedence<T, U>(parser, ops, term, f, opRecord[2]);

//   if (rhs.kind !== 'success') return rhs;
//   return parser.success(
//     [start, parser.offset],
//     f(opRecord[0], undefined, rhs.value)
//   );
// }

// /**
//  * Parse an infix operator
//  */
// function parseInfixOp<T, U>(
//   parser: Parser<T>,
//   ops: OpsTable<U>,
//   term: string | Combinator<T>,
//   f: (op: U, lhs?: T, rhs?: T) => T,
//   minPrec: number
// ): Result<T> {
//   const start = parser.offset;

//   const lhs = parser.parse(term);
//   // const lhs = parseWithPrecedence<T, U>(
//   //   parser,
//   //   infixOps(ops, minPrec + 1),
//   //   term,
//   //   f,
//   //   minPrec
//   // );
//   if (lhs.value === undefined || lhs.value === null) return lhs;

//   const offsetAfterLhs = parser.offset;

//   let whitespace = parseWhitespace(parser);
//   const hasLeadingWhitespace = whitespace.value === null;

//   const opRecord = matchOp(parser, infixOps(ops, minPrec + 1));
//   if (!opRecord[1]) return lhs;

//   // We've found an eligible infix operator.
//   parser.skipTo(parser.offset + opRecord[1].length);
//   whitespace = parseWhitespace(parser);

//   if (
//     (!hasLeadingWhitespace || whitespace.value === null) &&
//     (hasLeadingWhitespace || whitespace.value === null)
//   ) {
//     // There was some whitespace before or after, but not both.
//     // It's not an infix operator (might be a prefix).
//     // e.g. in `2 + -3`, the '-' is not an infix.
//     parser.skipTo(offsetAfterLhs);
//     return lhs;
//   }

//   // It *is* an infix operator...
//   // const rhs = parser.parse(term);
//   const rhs = parseWithPrecedence<T, U>(parser, ops, term, f, opRecord[2]);

//   if (rhs.kind !== 'success') return rhs;
//   return parser.result(
//     [start, parser.offset],
//     f(opRecord[0], lhs.value, rhs.value),
//     [...(lhs.errors ?? []), ...(rhs.errors ?? [])]
//   );
// }
