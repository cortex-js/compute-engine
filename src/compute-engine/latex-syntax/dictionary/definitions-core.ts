import { Expression } from '../../../math-json/types';
import {
  machineValue,
  mapArgs,
  operand,
  nops,
  stringValue,
  operator,
  operands,
  missingIfEmpty,
  stripText,
  isEmptySequence,
  unhold,
  symbol,
  dictionaryFrom,
} from '../../../math-json/utils';
import {
  isEquationOperator,
  isInequalityOperator,
} from '../../boxed-expression/utils';
import {
  ADDITION_PRECEDENCE,
  ARROW_PRECEDENCE,
  ASSIGNMENT_PRECEDENCE,
  LatexDictionary,
  Parser,
  Serializer,
  Terminator,
} from '../public';
import { joinLatex } from '../tokenizer';

// function isSpacingToken(token: string): boolean {
//   return (
//     token === '<space>' ||
//     token === '\\qquad' ||
//     token === '\\quad' ||
//     token === '\\enskip' ||
//     token === '\\;' ||
//     token === '\\,' ||
//     token === '\\ ' ||
//     token === '~'
//   );
// }

/**
 * Parse a sequence of expressions separated with `sep`
 */
function parseSequence(
  parser: Parser,
  terminator: Readonly<Terminator> | undefined,
  lhs: Expression | null,
  prec: number,
  sep: string
): Expression[] | null {
  if (terminator && terminator.minPrec >= prec) return null;

  const result: Expression[] = lhs ? [lhs] : ['Nothing'];
  let done = false;
  while (!done) {
    done = true;

    parser.skipSpace();
    while (parser.match(sep)) {
      result.push('Nothing');
      parser.skipSpace();
    }

    if (parser.atTerminator(terminator)) {
      result.push('Nothing');
    } else {
      const rhs = parser.parseExpression({ ...terminator, minPrec: prec });
      result.push(rhs ?? 'Nothing');
      done = rhs === null;
    }
    if (!done) {
      parser.skipSpace();
      done = !parser.match(sep);
    }
  }

  return result;
}

function serializeOps(sep = '') {
  return (serializer: Serializer, expr: Expression | null): string => {
    if (!expr) return '';
    const xs = operands(expr);
    if (xs.length === 0) return '';
    if (xs.length === 1) return serializer.serialize(xs[0]);

    sep =
      {
        '&': '\\&',
        ':': '\\colon',
        '|': '\\mvert',
        '-': '-',
        '\u00b7': '\\cdot', // U+00B7 MIDDLE DOT
        '\u2012': '-', // U+2012 FIGURE DASH
        '\u2013': '--', // U+2013 EN DASH
        '\u2014': '---', // U+2014 EM DASH
        '\u2015': '-', // U+2015 HORIZONTAL BAR
        '\u2022': '\\bullet', // U+2022 BULLET
        '\u2026': '\\ldots',
      }[sep] ?? sep;

    const ys = xs.reduce((acc, item) => {
      acc.push(serializer.serialize(item), sep);
      return acc;
    }, [] as string[]);

    ys.pop();

    return joinLatex(ys);
  };
}

export const DEFINITIONS_CORE: LatexDictionary = [
  //
  // Constants
  //
  {
    latexTrigger: ['\\placeholder'],
    kind: 'symbol',
    parse: (parser: Parser) => {
      // Parse, but ignore, the optional and required LaTeX args
      while (parser.match('<space>')) {}
      if (parser.match('['))
        while (!parser.match(']') && !parser.atBoundary) parser.nextToken();

      while (parser.match('<space>')) {}
      if (parser.match('<{>'))
        while (!parser.match('<}>') && !parser.atBoundary) parser.nextToken();

      return 'Nothing';
    },
  },

  //
  // Functions
  //

  // Anonymous function, i.e. `(x) \mapsto x^2`
  {
    name: 'Function',
    latexTrigger: ['\\mapsto'],
    kind: 'infix',
    precedence: ARROW_PRECEDENCE, // MathML rightwards arrow
    parse: (parser: Parser, lhs: Expression) => {
      let params: string[] = [];
      if (operator(lhs) === 'Delimiter') lhs = operand(lhs, 1) ?? 'Nothing';
      if (operator(lhs) === 'Sequence') {
        for (const x of operands(lhs)) {
          if (!symbol(x)) return null;
          params.push(symbol(x)!);
        }
      } else {
        if (!symbol(lhs)) return null;
        params = [symbol(lhs)!];
      }

      let rhs =
        parser.parseExpression({ minPrec: ARROW_PRECEDENCE }) ?? 'Nothing';
      if (operator(rhs) === 'Delimiter') rhs = operand(rhs, 1) ?? 'Nothing';
      if (operator(rhs) === 'Sequence') rhs = ['Block', ...operands(rhs)];

      return ['Function', rhs, ...params];
    },
    serialize: (serializer: Serializer, expr: Expression): string => {
      const args = operands(expr);
      if (args.length < 1) return '()\\mapsto()';
      if (args.length === 1)
        return joinLatex([
          '()',
          '\\mapsto',
          serializer.serialize(operand(expr, 1)),
        ]);

      if (args.length === 2) {
        return joinLatex([
          serializer.serialize(operand(expr, 2)),
          '\\mapsto',
          serializer.serialize(operand(expr, 1)),
        ]);
      }

      return joinLatex([
        serializer.wrapString(
          operands(expr)
            ?.slice(1)
            .map((x) => serializer.serialize(x))
            .join(', '),
          'normal'
        ),
        '\\mapsto',
        serializer.serialize(operand(expr, 1)),
      ]);
    },
  },

  {
    name: 'Apply',
    kind: 'function',
    identifierTrigger: 'apply',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const lhs = operand(expr, 1); // The function body

      const h = operator(lhs);
      if (h === 'InverseFunction' || h === 'Derivative') {
        // For inverse functions and derivatives display as a regular function,
        // e.g. \sin^{-1} x, f'(x) instead of x \rhd f' and x \rhd \sin^{-1}
        const style = serializer.options.applyFunctionStyle(
          expr,
          serializer.level
        );
        const args = operands(expr).slice(1) as any as Expression[];
        return (
          serializer.serializeFunction(
            lhs!,
            serializer.dictionary.ids.get(h!)
          ) +
          serializer.wrapString(
            args.map((x) => serializer.serialize(x)).join(', '),
            style
          )
        );
      }

      // If no argument, or the body is a single symbol, display as a regular function
      const rhs = operand(expr, 2); // The first argument
      if (typeof lhs === 'string' || !rhs) {
        // e.g. "Apply(f, x)" -> "f(x)"
        const fn = operands(expr).slice(1) as any as Expression;
        return serializer.serialize(fn);
      }

      if (nops(expr) === 2) {
        // If there's a single argument, we can use the pipeline operator
        // (i.e. `\rhd` `|>`)
        return joinLatex([
          serializer.wrap(lhs, 20),
          '\\lhd',
          serializer.wrap(rhs, 20),
        ]);
      }

      const style = serializer.options.applyFunctionStyle(
        expr,
        serializer.level
      );
      return joinLatex([
        '\\operatorname{apply}',
        serializer.wrapString(
          serializer.serialize(h) +
            ', ' +
            serializer.serialize(['List', ...operands(expr)]),
          style
        ),
      ]);
    },
  },
  {
    latexTrigger: '\\lhd',
    kind: 'infix',
    precedence: 20,
    parse: 'Apply',
  },
  {
    latexTrigger: '\\rhd',
    kind: 'infix',
    precedence: 20,
    parse: (parser: Parser, lhs: Expression) => {
      const rhs = parser.parseExpression({ minPrec: 21 }) ?? 'Nothing';
      return ['Apply', rhs, lhs];
    },
  },

  // The mathtools package includes several synonmyms for \colonequals. The
  // preferred one as of summer 2022 is `\coloneq` (see § 3.7.3 https://ctan.math.illinois.edu/macros/latex/contrib/mathtools/mathtools.pdf)
  {
    name: 'Assign',
    latexTrigger: '\\coloneq',
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    serialize: (serializer: Serializer, expr: Expression): string => {
      const id = unhold(operand(expr, 1));

      if (operator(operand(expr, 2)) === 'Function') {
        const op_2 = operand(expr, 2);
        const body = unhold(operand(op_2, 1));
        const args = operands(op_2).slice(1);

        return joinLatex([
          serializer.serialize(id),
          serializer.wrapString(
            args.map((x) => serializer.serialize(x)).join(', '),
            serializer.options.applyFunctionStyle(expr, serializer.level)
          ),
          '\\coloneq',
          serializer.serialize(body),
        ]);
      }
      return joinLatex([
        serializer.serialize(id),
        '\\coloneq',
        serializer.serialize(operand(expr, 2)),
      ]);
    },
    parse: parseAssign,
  },
  {
    latexTrigger: '\\coloneqq',
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    parse: parseAssign,
  },
  // From the colonequals package:
  {
    latexTrigger: '\\colonequals',
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    parse: parseAssign,
  },
  {
    latexTrigger: [':', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    parse: parseAssign,
  },

  {
    name: 'BaseForm',
    serialize: (serializer, expr) => {
      const radix = machineValue(operand(expr, 2)) ?? NaN;
      if (isFinite(radix) && radix >= 2 && radix <= 36) {
        // CAUTION: machineValue() may return a truncated value
        // if the number is outside of the machine range.
        const num = machineValue(operand(expr, 1)) ?? NaN;
        if (isFinite(num) && Number.isInteger(num)) {
          let digits = Number(num).toString(radix);
          let groupLength = 0;
          if (radix === 2) {
            groupLength = 4;
          } else if (radix === 10) {
            groupLength = 4;
          } else if (radix === 16) {
            groupLength = 2;
          } else if (radix > 16) {
            groupLength = 4;
          }
          if (groupLength > 0) {
            const oldDigits = digits;
            digits = '';
            for (let i = 0; i < oldDigits.length; i++) {
              if (i > 0 && i % groupLength === 0) digits = '\\, ' + digits;

              digits = oldDigits[oldDigits.length - i - 1] + digits;
            }
          }
          return `(\\text{${digits}}_{${radix}}`;
        }
      }
      return (
        '\\operatorname{BaseForm}(' +
        serializer.serialize(operand(expr, 1)) +
        ', ' +
        serializer.serialize(operand(expr, 2)) +
        ')'
      );
    },
  },
  {
    name: 'Sequence',
    // Use a space as a separator, otherwise a sequence of numbers
    // could be interpreted as a single number.
    serialize: serializeOps(' '),
  },
  {
    name: 'InvisibleOperator',
    serialize: serializeOps(''),
  },
  {
    // The first argument is a function expression.
    // The second (optional) argument is a string specifying the
    // delimiters and separator.
    name: 'Delimiter',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const style = serializer.options.groupStyle(expr, serializer.level + 1);

      const arg1 = operand(expr, 1);
      let delims = {
        Set: '{,}',
        List: '[,]',
        Tuple: '(,)',
        Single: '(,)',
        Pair: '(,)',
        Triple: '(,)',
        Sequence: '(,)',
        String: '""',
      }[operator(arg1)];

      const items = delims ? arg1 : (['Sequence', arg1] as Expression);

      delims ??= '(,)';

      // Check if there are custom delimiters specified
      if (nops(expr) > 1) {
        const op2 = stringValue(operand(expr, 2));
        if (typeof op2 === 'string' && op2.length <= 3) delims = op2;
      }

      let [open, sep, close] = ['', '', ''];
      if (delims.length === 3) [open, sep, close] = delims;
      else if (delims.length === 2) [open, close] = delims;
      else if (delims.length === 1) sep = delims;

      const body = arg1
        ? items
          ? serializeOps(sep)(serializer, items)
          : serializer.serialize(arg1)
        : '';

      // if (!open || !close) return serializer.wrapString(body, style);
      return serializer.wrapString(body, style, open + close);
    },
  },

  {
    name: 'Domain',
    serialize: (serializer, expr) => {
      if (operator(expr) === 'Error') return serializer.serialize(expr);
      return `\\mathbf{${serializer.serialize(operand(expr, 1))}}`;
    },
  },
  {
    latexTrigger: ['\\mathtip'],
    parse: (parser: Parser) => {
      const op1 = parser.parseGroup();
      parser.parseGroup();
      return op1;
    },
  },
  {
    latexTrigger: ['\\texttip'],
    parse: (parser: Parser) => {
      const op1 = parser.parseGroup();
      parser.parseGroup();
      return op1;
    },
  },
  {
    latexTrigger: ['\\error'],
    parse: (parser: Parser) => ['Error', parser.parseGroup()] as Expression,
  },
  {
    name: 'Error',
    serialize: (serializer, expr) => {
      const op1 = operand(expr, 1);
      if (stringValue(op1) === 'missing')
        return `\\error{${
          serializer.options.missingSymbol ?? '\\placeholder{}'
        }}`;

      const where = errorContextAsLatex(serializer, expr) || '\\blacksquare';

      const code =
        operator(op1) === 'ErrorCode'
          ? stringValue(operand(op1, 1))
          : stringValue(op1);

      if (code === 'incompatible-domain') {
        if (symbol(operand(op1, 3)) === 'Undefined') {
          return `\\mathtip{\\error{${where}}}{\\notin ${serializer.serialize(
            operand(op1, 2)
          )}}`;
        }
        return `\\mathtip{\\error{${where}}}{\\in ${serializer.serialize(
          operand(op1, 3)
        )}\\notin ${serializer.serialize(operand(op1, 2))}}`;
      }

      // if (code === 'missing') {
      //   return `\\mathtip{\\error{${where}}}{${serializer.serialize(
      //     op(op1, 2)
      //   )}\\text{ missing}}`;
      // }

      if (typeof code === 'string') return `\\error{${where}}`;

      return `\\error{${where}}`;
    },
  },
  {
    name: 'ErrorCode',
    serialize: (serializer, expr) => {
      const code = stringValue(operand(expr, 1));

      if (code === 'missing')
        return serializer.options.missingSymbol ?? '\\placeholder{}';

      if (
        code === 'unexpected-command' ||
        code === 'unexpected-operator' ||
        code === 'unexpected-token' ||
        code === 'invalid-identifier' ||
        code === 'unknown-environment' ||
        code === 'unexpected-base' ||
        code === 'incompatible-domain' ||
        code === 'invalid-domain'
      ) {
        return '';
      }

      return `\\texttip{\\error{\\blacksquare}}{\\mathtt{${code}}}`;
    },
  },
  {
    name: 'FromLatex',
    serialize: (_serializer, expr) => {
      return `\\texttt{${sanitizeLatex(stringValue(operand(expr, 1)))}}`;
    },
  },

  {
    name: 'Latex',
    serialize: (serializer, expr) => {
      if (expr === null) return '';
      return joinLatex(
        mapArgs<string>(expr, (x) => stringValue(x) ?? serializer.serialize(x))
      );
    },
  },
  {
    name: 'LatexString',
    serialize: (serializer, expr) => {
      if (expr === null) return '';
      return joinLatex(mapArgs<string>(expr, (x) => serializer.serialize(x)));
    },
  },
  { name: 'LatexTokens', serialize: serializeLatexTokens },

  {
    name: 'At',
    kind: 'postfix',
    precedence: 810,
    latexTrigger: ['['],
    parse: parseAt(']'),
    serialize: (serializer, expr) =>
      joinLatex(['\\lbrack', serializeOps(', ')(serializer, expr), '\\rbrack']),
  },
  {
    kind: 'postfix',
    precedence: 810,
    latexTrigger: ['\\lbrack'],
    parse: parseAt('\\rbrack'),
  },
  {
    kind: 'postfix',
    precedence: 810,
    latexTrigger: ['\\left', '\\lbrack'],
    parse: parseAt('\\right', '\\rbrack'),
  },
  {
    kind: 'postfix',
    latexTrigger: ['_'],
    parse: (parser, lhs) => {
      // @fixme: should check that the lhs is a collection. If not a collection,
      // return null (or interpret as an identifier).

      // Parse either a group or a single symbol
      const rhs = parser.parseGroup() ?? parser.parseToken();
      return ['Subscript', lhs, rhs];
    },
  },
  {
    name: 'List',
    kind: 'matchfix',
    openTrigger: '[',
    closeTrigger: ']',
    parse: parseBrackets,
    serialize: serializeList,
  },
  {
    kind: 'matchfix',
    openTrigger: '(',
    closeTrigger: ')',
    parse: parseParenDelimiter,
  },
  {
    latexTrigger: [','],
    kind: 'infix',
    precedence: 20,
    // Unlike the matchfix version of List,
    // when the comma operator is used, the lhs and rhs are flattened,
    // i.e. `1,2,3` -> `["Delimiter", ["List", 1, 2, 3],  ","]`,
    // and `1, (2, 3)` -> `["Delimiter",
    // ["Sequence", 1, ["Delimiter", ["List", 2, 3],  "()", ","]]],
    parse: (
      parser: Parser,
      lhs: Expression,
      terminator: Readonly<Terminator>
    ): Expression | null => {
      const seq = parseSequence(parser, terminator, lhs, 20, ',');
      if (seq === null) return null;
      return ['Delimiter', ['Sequence', ...seq], { str: ',' }];
    },
  },
  // Entry to handle the case of a single comma
  // with a missing lhs.
  {
    latexTrigger: [','],
    kind: 'prefix',
    precedence: 20,
    parse: (parser, terminator): Expression | null => {
      const seq = parseSequence(parser, terminator, null, 20, ',');
      if (seq === null) return null;
      return ['Delimiter', ['Sequence', ...seq], { str: ',' }];
    },
  },
  {
    name: 'Range',
    latexTrigger: ['.', '.'],
    kind: 'infix',
    precedence: 800,
    parse: parseRange,
    serialize: (serializer: Serializer, expr: Expression): string => {
      const args = operands(expr);
      if (args.length === 0) return '';
      if (args.length === 1)
        return '1..' + serializer.serialize(operand(expr, 1));
      // 1..2
      if (args.length === 2)
        return (
          serializer.wrap(operand(expr, 1), 10) +
          '..' +
          serializer.wrap(operand(expr, 2), 10)
        );
      // 1..3..7
      if (args.length === 3) {
        // Are step and start numeric values?
        const step = machineValue(operand(expr, 3));
        const start = machineValue(operand(expr, 1));
        if (step !== null && start !== null) {
          return (
            serializer.wrap(operand(expr, 1), 10) +
            '..' +
            serializer.wrap(start + step, 10) +
            '..' +
            serializer.wrap(operand(expr, 2), 10)
          );
        }

        // We have arbitrary expressions for start (a) or step (b)...
        // i.e. a..(a+b)..c
        return (
          serializer.wrap(operand(expr, 1), 10) +
          '..(' +
          (serializer.wrap(operand(expr, 1), ADDITION_PRECEDENCE) +
            '+' +
            serializer.wrap(operand(expr, 3), ADDITION_PRECEDENCE)) +
          ')..' +
          serializer.wrap(operand(expr, 2), 10)
        );
      }
      return '';
    },
  },
  {
    latexTrigger: [';'],
    kind: 'infix',
    precedence: 19,
    parse: (
      parser: Parser,
      lhs: Expression,
      terminator: Readonly<Terminator>
    ) => {
      const seq = parseSequence(parser, terminator, lhs, 19, ';');
      if (seq === null) return null;

      return ['Delimiter', ['Sequence', ...seq], "';'"] as Expression;
    },
  },
  {
    name: 'String',
    latexTrigger: ['\\text'],
    parse: (scanner) => parseTextRun(scanner),
    serialize: (serializer: Serializer, expr: Expression): string => {
      const args = operands(expr);
      if (args.length === 0) return '\\text{}';
      return joinLatex([
        '\\text{',
        args.map((x) => serializer.serialize(x)).join(''),
        '}',
      ]);
    },
  },
  {
    name: 'Subscript',
    latexTrigger: ['_'],
    kind: 'infix',
    serialize: (serializer: Serializer, expr: Expression): string => {
      if (nops(expr) === 2) {
        return (
          serializer.serialize(operand(expr, 1)) +
          '_{' +
          serializer.serialize(operand(expr, 2)) +
          '}'
        );
      }
      return '_{' + serializer.serialize(operand(expr, 1)) + '}';
    },
  },
  { name: 'Superplus', latexTrigger: ['^', '+'], kind: 'postfix' },
  { name: 'Subplus', latexTrigger: ['_', '+'], kind: 'postfix' },
  { name: 'Superminus', latexTrigger: ['^', '-'], kind: 'postfix' },
  { name: 'Subminus', latexTrigger: ['_', '-'], kind: 'postfix' },
  {
    latexTrigger: ['^', '*'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Superstar', lhs],
  },
  // { name: 'Superstar', latexTrigger: ['^', '\\star'], kind: 'postfix' },
  {
    latexTrigger: ['_', '*'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Substar', lhs],
  },
  { name: 'Substar', latexTrigger: ['_', '\\star'], kind: 'postfix' },
  { name: 'Superdagger', latexTrigger: ['^', '\\dagger'], kind: 'postfix' },
  {
    latexTrigger: ['^', '\\dag'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Superdagger', lhs],
  },
  {
    name: 'Prime',
    latexTrigger: ['^', '\\prime'],
    // Note: we don't need a precedence because the trigger is '^'
    // and '^' (and '_') are treated specially by the parser.
    kind: 'postfix',
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 1),
    serialize: (serializer, expr) => {
      const n2 = machineValue(operand(expr, 2)) ?? 1;
      const base = serializer.serialize(operand(expr, 1));
      if (n2 === 1) return base + '^\\prime';
      if (n2 === 2) return base + '^\\doubleprime';
      if (n2 === 3) return base + '^\\tripleprime';
      return base + '^{(' + serializer.serialize(operand(expr, 2)) + ')}';
    },
  },
  {
    latexTrigger: '^{\\prime\\prime}',
    kind: 'postfix',
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: '^{\\prime\\prime\\prime}',
    kind: 'postfix',
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 3),
  },
  {
    latexTrigger: ['^', '\\doubleprime'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: ['^', '\\tripleprime'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 3),
  },
  {
    latexTrigger: "'",
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 1),
  },
  {
    latexTrigger: '\\prime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 1),
  },
  {
    latexTrigger: '\\doubleprime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: '\\tripleprime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: Expression) => parsePrime(parser, lhs, 3),
  },

  // Lagrange Notation for n-th order derivatives,
  // i.e. f^{(n)} -> Derivative(f, n)
  {
    latexTrigger: ['^', '<{>', '('],
    kind: 'postfix',
    parse: (parser: Parser, lhs, until) => {
      const sym = symbol(lhs);
      if (!sym || parser.getIdentifierType(sym) !== 'function') return null;

      parser.addBoundary([')']);
      const expr = parser.parseExpression(until);
      if (!parser.matchBoundary()) return null;

      if (!parser.match('<}>')) return null;

      return ['Derivative', lhs, expr] as Expression;
    },
  },

  {
    name: 'InverseFunction',
    latexTrigger: '^{-1', // Note: the closing brace is not included
    kind: 'postfix',
    parse: (parser: Parser, lhs: Expression) => {
      // If the lhs is a function, return the inverse function
      // i.e. f^{-1} -> InverseFunction(f)
      const sym = symbol(lhs);
      if (!sym || parser.getIdentifierType(sym) !== 'function') return null;

      // There may be additional postfixes, i.e. \prime, \doubleprime,
      // \tripleprime in the superscript. Account for them.

      let primeCount = 0;
      while (!parser.atEnd && !parser.match('<}>')) {
        if (parser.match("'")) primeCount++;
        else if (parser.match('\\prime')) primeCount++;
        else if (parser.match('\\doubleprime')) primeCount += 2;
        else if (parser.match('\\tripleprime')) primeCount += 3;
        else return null;
      }
      if (primeCount === 1) return ['Derivative', ['InverseFunction', lhs]];
      if (primeCount > 0)
        return ['Derivative', ['InverseFunction', lhs], primeCount];

      return ['InverseFunction', lhs];
    },
    serialize: (serializer, expr) =>
      serializer.serialize(operand(expr, 1)) + '^{-1}',
  },
  // Lagrange notation
  {
    name: 'Derivative',
    // @todo: Leibniz notation: {% latex " \\frac{d^n}{dx^n} f(x)" %}
    // @todo: Euler modified notation: This notation is used by Mathematica. The Euler notation uses `D` instead of
    // `\partial`: `\partial_{x} f`,  `\partial_{x,y} f`
    // @todo: Newton notation: `\dot{v}` -> first derivative relative to time t `\ddot{v}` -> second derivative relative to time t

    serialize: (serializer: Serializer, expr: Expression): string => {
      const degree = machineValue(operand(expr, 2)) ?? 1;
      const base = serializer.serialize(operand(expr, 1));
      if (degree === 1) return base + '^{\\prime}';
      if (degree === 2) return base + '^{\\doubleprime}';
      if (degree === 3) return base + '^{\\tripleprime}';

      return base + '^{(' + serializer.serialize(operand(expr, 2)) + ')}';
    },
  },
  {
    kind: 'environment',
    name: 'Which',
    identifierTrigger: 'cases',
    parse: parseCasesEnvironment,
    serialize: (serialize: Serializer, expr: Expression): string => {
      const rows: string[] = [];
      const args = operands(expr);
      if (args.length > 0) {
        for (let i = 0; i <= args.length - 2; i += 2) {
          const row: string[] = [];
          row.push(serialize.serialize(args[i + 1]));
          row.push(serialize.serialize(args[i]));
          rows.push(row.join('&'));
        }
      }
      return joinLatex(['\\begin{cases}', rows.join('\\\\'), '\\end{cases}']);
    },
  },
  {
    kind: 'environment',
    identifierTrigger: 'dcases',
    parse: parseCasesEnvironment,
  },
  {
    kind: 'environment',
    identifierTrigger: 'rcases',
    parse: parseCasesEnvironment,
  },
];

// ["Style", expr, dic] where dic: {"color": "#fff", "font-size": "2em" }
// ["HtmlData", expr, dic]

/**
 * Parse content in text mode.
 * 
 * Text mode can only include a small subset of LaTeX commands:
 * - <{> (groups inside text)
 * - \unicode
 * - \char
 * - ^^
 * - ^^^^
 * - \textbf
 * - \textmd
 * - \textup
 * - \textsl
 * - \textit
 * - \texttt
 * - \textsf
 * - \textcolor{}{}
 * - {\color{}}
//
// greek?
// spacing? \hspace, \! \: \enskip...
// \boxed ?
// \fcolorbox ?
 */

/**
 * Start scanning a text run. The scanner is pointing at a `<{>
 */
function parseTextRun(
  parser: Parser,
  style?: { [key: string]: string }
): Expression {
  if (!parser.match('<{>')) return "''";

  const runs: Expression[] = [];
  let text = '';
  let runinStyle: { [key: string]: string } | null = null;

  while (!parser.atEnd && !parser.match('<}>')) {
    if (parser.peek === '<{>') {
      runs.push(parseTextRun(parser));
    } else if (parser.match('\\textbf') && parser.match('<{>')) {
      runs.push(parseTextRun(parser, { 'font-weight': 'bold' }));
      // @todo! other text styles...
    } else if (parser.match('\\color')) {
      // Run-in style
      const color = parser.parseStringGroup();
      if (color !== null) {
        // Stash the current text/runinstyle
        if (runinStyle !== null && text) {
          runs.push(['Style', text, dictionaryFrom(runinStyle)]);
        } else if (text) {
          runs.push(['String', text]);
        }
        text = '';
        runinStyle = { color };
      }
    } else if (parser.match('<space>')) {
      text += ' ';
    } else if (parser.match('<$>')) {
      const index = parser.index;
      const expr = parser.parseExpression() ?? 'Nothing';
      parser.skipSpace();
      if (parser.match('<$>')) {
        runs.push(expr);
      } else {
        text += '$';
        parser.index = index;
      }
    } else if (parser.match('<$$>')) {
      const index = parser.index;
      const expr = parser.parseExpression() ?? 'Nothing';
      parser.skipSpace();
      if (parser.match('<$$>')) {
        runs.push(expr);
      } else {
        text += '$$';
        parser.index = index;
      }
    } else {
      const c = parser.matchChar() ?? parser.nextToken();
      text +=
        {
          '\\enskip': '\u2002', //  en space
          '\\enspace': '\u2002', //  en space
          '\\quad': '\u2003', //  em space
          '\\qquad': '\u2003\u2003', //  2 em space
          '\\space': '\u2003', //  em space
          '\\ ': '\u2003', //  em space
          '\\;': '\u2004', //  three per em space
          '\\,': '\u2009', //  thin space
          '\\:': '\u205f', //  medium mathematical space
          '\\!': '', //  negative thin space
          '\\{': '{',
          '\\}': '}',
          '\\$': '$',
          '\\&': '&',
          '\\#': '#',
          '\\%': '%',
          '\\_': '_',
          '\\textbackslash': '\\',
          '\\textasciitilde': '~',
          '\\textasciicircum': '^',
          '\\textless': '<',
          '\\textgreater': '>',
          '\\textbar': '|',
          '\\textunderscore': '_',
          '\\textbraceleft': '{',
          '\\textbraceright': '}',
          '\\textasciigrave': '`',
          '\\textquotesingle': "'",
          '\\textquotedblleft': '“',
          '\\textquotedblright': '”',
          '\\textquotedbl': '"',
          '\\textquoteleft': '‘',
          '\\textquoteright': '’',
          '\\textbullet': '•',
          '\\textdagger': '†',
          '\\textdaggerdbl': '‡',
          '\\textsection': '§',
          '\\textparagraph': '¶',
          '\\textperiodcentered': '·',
          '\\textellipsis': '…',
          '\\textemdash': '—',
          '\\textendash': '–',
          '\\textregistered': '®',
          '\\texttrademark': '™',
          '\\textdegree': '°',
        }[c] ?? c;
    }
  }

  // Apply leftovers
  if (runinStyle !== null && text) {
    runs.push(['Style', `'${text}'`, dictionaryFrom(runinStyle)]);
  } else if (text) {
    runs.push(`'${text}'`);
  }

  let body: Expression;
  if (runs.length === 1) body = runs[0];
  else {
    if (runs.every((x) => stringValue(x) !== null))
      body = "'" + runs.map((x) => stringValue(x)).join() + "'";
    else body = ['String', ...runs];
  }

  return style ? ['Style', body, dictionaryFrom(style)] : body;
}

function serializeLatexTokens(
  serializer: Serializer,
  expr: Expression | null
): string {
  if (expr === null) return '';
  return joinLatex(
    mapArgs(expr, (x) => {
      const s = stringValue(x);
      if (s === null) return serializer.serialize(x);

      // If not a string, serialize the expression to LaTeX
      if (s === '<{>') return '{';
      if (s === '<}>') return '}';
      if (s === '<$>') return '$';
      if (s === '<$$>') return '$$';
      if (s === '<space>') return ' ';
      return s;
    })
  );
}

/**
 * Given a string of presumed (but possibly invalid) LaTeX, return a
 * LaTeX string with all the special characters escaped.
 */
function sanitizeLatex(s: string | null): string {
  if (s === null) return '';
  // Replace special Latex characters
  return s.replace(
    /[{}\[\]\\:\-\$%]/g,
    (c) =>
      ({
        '{': '\\lbrace ',
        '}': '\\rbrace ',
        '[': '\\lbrack ',
        ']': '\\rbrack ',
        ':': '\\colon ',
        '\\': '\\backslash ',
      })[c] ?? '\\' + c
  );
}

function errorContextAsLatex(
  serializer: Serializer,
  error: Expression
): string {
  const arg = operand(error, 2);
  if (!arg) return '';

  if (operator(arg) === 'LatexString')
    return stringValue(operand(arg, 1)) ?? '';

  if (operator(arg) === 'Hold') return serializer.serialize(operand(arg, 1));

  return serializer.serialize(arg);
}

function parsePrime(
  parser: Parser,
  lhs: Expression,
  order: number
): Expression | null {
  // If the lhs is a Prime/Derivative, increase the derivation order
  const lhsh = operator(lhs);
  if (lhsh === 'Derivative' || lhsh === 'Prime') {
    const n = machineValue(operand(lhs, 2)) ?? 1;
    return [lhsh, missingIfEmpty(operand(lhs, 1)), n + order];
  }

  // If the lhs is a function, return the derivative
  // i.e. f' -> Derivative(f)

  const sym = symbol(lhs);
  if ((sym && parser.getIdentifierType(sym) === 'function') || operator(lhs)) {
    if (order === 1) return ['Derivative', lhs];
    return ['Derivative', lhs, order];
  }
  // Otherwise, if it's a number or a symbol, return a
  // generic "Prime"
  if (order === 1) return ['Prime', missingIfEmpty(lhs)];
  return ['Prime', missingIfEmpty(lhs), order];
}

function parseParenDelimiter(
  _parser: Parser,
  body: Expression
): Expression | null {
  // During parsing, we keep a Delimiter expression as it captures the most
  // information (separator and fences).
  // The Delimiter canonicalization will turn it into something else if
  // appropriate (Tuple, etc...).

  // Handle `()` used for example with `f()`. This will be handled in
  // `canonicalInvisibleOperator()`
  if (isEmptySequence(body)) return ['Delimiter'];

  const h = operator(body);
  // We have a Delimiter inside parens: e.g. `(a, b, c)` with `a, b, c` the
  // Delimiter function.
  if (h === 'Delimiter' && operand(body, 2) !== null) {
    const delims = stringValue(operand(body, 2));
    if (delims?.length === 1) {
      // We have a Delimiter with a single character separator
      return [
        'Delimiter',
        operand(body, 1) ?? 'Nothing',
        { str: `(${delims})` },
      ];
    }
  }

  // @todo: does this codepath ever get hit?
  if (h === 'Matrix') {
    const delims = stringValue(operand(body, 2)) ?? '..';
    if (delims === '..') return ['Matrix', operand(body, 1)!];
  }

  return ['Delimiter', body];
}

/**
 *
 * A list in enclosed in brackets, e.g. `[1, 2, 3]`.
 *
 * It may contain:
 * - a single expression, e.g. `[1]`
 * - an empty sequence, e.g. `[]`
 * - a sequence of expressions, e.g. `[1, 2, 3]` (maybe)
 * - a sequence of expressions separated by a "," delimiter, e.g. `[1, 2, 3]`
 * - a sequence of expressions separated by a ";" delimiter,
 *    which may contain a sequence of expression with a "," delimiter
 *    e.g. `[1; 2; 3; 4]` or `[1, 2; 3, 4]`
 * - a range, e.g. `[1..10]`
 * - a range with a step, e.g. `[1, 3..10]`
 * - a linspace, e.g. `[1..10:50]` (not yet supported)
 * - a list comprehension, e.g. `[x^2 for x in 1..3 if x > 1]` (not yet supported)
 *
 */
function parseBrackets(
  parser: Parser,
  body: Expression | null | undefined
): Expression {
  if (isEmptySequence(body)) return ['List'];

  const h = operator(body);
  if (h === 'Range' || h === 'Linspace') return body;
  if (h === 'Sequence') return ['List', ...operands(body)];

  if (h === 'Delimiter') {
    const delim = stringValue(operand(body, 2)) ?? '...';
    if (delim === ';' || delim === '.;.') {
      return [
        'List',
        ...(operands(operand(body, 1)) ?? []).map((x) =>
          parseBrackets(parser, x)
        ),
      ];
    }
    if (delim === ',' || delim === '.,.') {
      body = operand(body, 1);
      if (operator(body) === 'Sequence') return ['List', ...operands(body)];
      return ['List', body ?? 'Nothing'];
    }
  }

  return ['List', body];
}

/** A "List" expression can represent a collection of arbitrary elements,
 * or a system of equations.
 */
function serializeList(serializer: Serializer, expr: Expression): string {
  // Is it a system of equations?
  if (
    nops(expr) > 1 &&
    operands(expr).every((x) => {
      const op = operator(x);
      return isEquationOperator(op) || isInequalityOperator(op);
    })
  ) {
    return joinLatex([
      '\\begin{cases}',
      serializeOps('\\\\')(serializer, expr),
      '\\end{cases}',
    ]);
  }

  // Note: Avoid \\[ ... \\] because it is used for display math
  return joinLatex([
    '\\bigl\\lbrack',
    serializeOps(', ')(serializer, expr),
    '\\bigr\\rbrack',
  ]);
}
/**
 * A range is a sequence of numbers, e.g. `1..10`.
 * Optionally, they may include a step, e.g. `1..3..10`.
 */
function parseRange(parser: Parser, lhs: Expression | null): Expression | null {
  if (lhs === null) return null;

  const second = parser.parseExpression({ minPrec: 270 });
  // This was `1..`. Don't know what to do with it. Bail.
  if (second === null) return null;

  // Is there a `..` after the second expression?
  if (parser.matchAll(['.', '.'])) {
    // It's a range with a step, i.e. "1..3..10"
    const end = parser.parseExpression({ minPrec: 270 });
    // If we get `1..3..` we don't know what to do with it. Bail.
    if (end === null) return null;

    // The step is the difference between the second and first values
    // Are they both numbers?
    const lhsValue = machineValue(lhs);
    const secondValue = machineValue(second);
    if (lhsValue !== null && secondValue !== null) {
      // If we get `2..2..3`, bail.
      if (secondValue <= lhsValue) return null;
      // If the step is 1, we don't need to include it
      if (secondValue - lhsValue === 1) return ['Range', lhs, end];
      return ['Range', lhs, end, secondValue - lhsValue];
    }
    return ['Range', lhs, end, ['Subtract', second, lhs]];
  }

  return ['Range', lhs, second];
}

export const DELIMITERS_SHORTHAND = {
  '(': '(',
  ')': ')',
  '[': '\\lbrack',
  ']': '\\rbrack',
  '\u27E6': '\\llbrack', // U+27E6 MATHEMATICAL LEFT WHITE SQUARE BRACKET
  '\u27E7': '\\rrbrack', // U+27E7 MATHEMATICAL RIGHT WHITE SQUARE BRACKET
  '{': '\\lbrace',
  '}': '\\rbrace',
  '<': '\\langle',
  '>': '\\rangle',
  // '|': '\\vert',
  '‖': '\\Vert', // U+2016 DOUBLE VERTICAL LINE
  '\\': '\\backslash',
  '⌈': '\\lceil', // ⌈ U+2308 LEFT CEILING
  '⌉': '\\rceil', // U+2309 RIGHT CEILING
  '⌊': '\\lfloor', // ⌊ U+230A LEFT FLOOR
  '⌋': '\\rfloor', // ⌋ U+230B RIGHT FLOOR
  '⌜': '\\ulcorner', // ⌜ U+231C TOP LEFT CORNER
  '⌝': '\\urcorner', // ⌝ U+231D TOP RIGHT CORNER
  '⌞': '\\llcorner', // ⌞ U+231E BOTTOM LEFT CORNER
  '⌟': '\\lrcorner', // ⌟ U+231F BOTTOM RIGHT CORNER
  '⎰': '\\lmoustache', // U+23B0 UPPER LEFT OR LOWER RIGHT CURLY BRACKET SECTION
  '⎱': '\\rmoustache', // U+23B1 UPPER RIGHT OR LOWER LEFT CURLY BRACKET SECTION
  // '⎹': '', // U+23B9 DIVIDES
  // '⎾': '', // U+23BE RIGHT PARENTHESIS UPPER HOOK
  // '⎿': '', // U+23BF RIGHT PARENTHESIS LOWER HOOK
};

export function latexToDelimiterShorthand(s: string): string | undefined {
  for (const key in DELIMITERS_SHORTHAND)
    if (DELIMITERS_SHORTHAND[key] === s) return key;

  return undefined;
}

function parseAssign(parser: Parser, lhs: Expression): Expression | null {
  // Do we have an assignment of the form `f(x) := ...`?
  if (
    operator(lhs) === 'InvisibleOperator' &&
    nops(lhs) === 2 &&
    operator(operand(lhs, 2)) === 'Delimiter'
  ) {
    const fn = symbol(operand(lhs, 1));
    if (!fn) return null;

    const rhs = parser.parseExpression({ minPrec: 0 });
    if (rhs === null) return null;

    const delimBody = operand(operand(lhs, 2), 1);
    let args: Expression[] = [];
    if (operator(delimBody) === 'Sequence') args = [...operands(delimBody)];
    else if (delimBody) args = [delimBody!];

    return ['Assign', fn, ['Function', rhs, ...(args ?? [])]];
  }

  // If this is a previously defined function, the lhs might be a
  // function application...
  const fn = operator(lhs);
  if (fn) {
    const args = operands(lhs);
    const rhs = parser.parseExpression({ minPrec: 0 });
    if (rhs === null) return null;

    return ['Assign', fn, ['Function', rhs, ...args]];
  }

  if (!symbol(lhs)) return null;

  const rhs = parser.parseExpression({ minPrec: 0 });
  if (rhs === null) return null;

  return ['Assign', lhs, rhs];
}

/** Parse a \begin{cases}...\end{cases} expression.
 *
 * This could be a "Which" expression, i.e. a sequence of conditions and values
 * or a system of equations (a "List" of equations or inequalities).
 *
 */
function parseCasesEnvironment(parser: Parser): Expression | null {
  const rows: Expression[][] | null = parser.parseTabular();
  if (!rows) return ['List'];

  //
  // 1/ Is it a system of equations?
  //
  // Single column with an equality or inequality
  //
  if (
    rows.every((row) => {
      if (row.length !== 1) return false;
      const op = operator(row[0]);
      return isInequalityOperator(op) || isEquationOperator(op);
    })
  ) {
    return ['List', ...rows.map((row) => row[0])];
  }

  //
  // 2/ It's a "Which" expression
  //
  // Each row must have 1 or 2 elements:
  // - 1 element: the default value
  // - 2 elements: the condition and the value

  // Note: return `True` for the condition, because it must be present
  // as the second element of the Tuple. Return an empty sequence for the
  // value, because it is optional
  const result: Expression[] = [];
  for (const row of rows) {
    if (row.length === 1) {
      result.push('True');
      result.push(row[0]);
    } else if (row.length === 2) {
      const s = stringValue(row[1]);
      // If a string, probably 'else' or 'otherwise'
      result.push(s ? 'True' : (stripText(row[1]) ?? 'True'));
      result.push(row[0]);
    }
  }
  return ['Which', ...result];
}

function parseAt(...close: string[]): (parser, lhs) => Expression | null {
  // @todo: if there are no `close` symbols, parse as a subscript: either
  // a single symbol, or a group.
  return (parser: Parser, lhs: Expression): Expression | null => {
    // If the lhs is a symbol or a List literal...
    if (!symbol(lhs) && operator(lhs) !== 'List') return null;

    let rhs: Expression | null = null;
    if (close.length === 0) rhs = parser.parseGroup();
    rhs ??= parser.parseExpression({ minPrec: 0 });
    if (rhs === null) return null;

    if (close.length > 0 && !parser.matchAll(close)) return null;

    if (stringValue(rhs) !== null) return null;

    if (operator(rhs) === 'Delimiter') rhs = operand(rhs, 1) ?? 'Nothing';
    if (operator(rhs) === 'Sequence') return ['At', lhs, ...operands(rhs)];
    return ['At', lhs, rhs];
  };
}
