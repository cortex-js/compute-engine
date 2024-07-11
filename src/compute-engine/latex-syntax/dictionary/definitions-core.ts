import { Expression } from '../../../math-json/math-json-format';
import {
  machineValue,
  mapArgs,
  op,
  nops,
  stringValue,
  head,
  ops,
  missingIfEmpty,
  stripText,
  isEmptySequence,
  unhold,
  symbol,
} from '../../../math-json/utils';
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
    const xs = ops(expr) ?? [];
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
      if (head(lhs) === 'Delimiter') lhs = op(lhs, 1) ?? 'Nothing';
      if (head(lhs) === 'Sequence') {
        for (const x of ops(lhs) ?? []) {
          if (!symbol(x)) return null;
          params.push(symbol(x)!);
        }
      } else {
        if (!symbol(lhs)) return null;
        params = [symbol(lhs)!];
      }

      let rhs =
        parser.parseExpression({ minPrec: ARROW_PRECEDENCE }) ?? 'Nothing';
      if (head(rhs) === 'Delimiter') rhs = op(rhs, 1) ?? 'Nothing';
      if (head(rhs) === 'Sequence') rhs = ['Block', ...(ops(rhs) ?? [])];

      return ['Function', rhs, ...params];
    },
    serialize: (serializer: Serializer, expr: Expression): string => {
      const args = ops(expr);
      if (args === null || args.length < 1) return '()\\mapsto()';
      if (args.length === 1)
        return joinLatex(['()', '\\mapsto', serializer.serialize(op(expr, 1))]);

      if (args.length === 2) {
        return joinLatex([
          serializer.serialize(op(expr, 2)),
          '\\mapsto',
          serializer.serialize(op(expr, 1)),
        ]);
      }

      return joinLatex([
        serializer.wrapString(
          (ops(expr)?.slice(1) ?? [])
            .map((x) => serializer.serialize(x))
            .join(', '),
          'normal'
        ),
        '\\mapsto',
        serializer.serialize(op(expr, 1)),
      ]);
    },
  },

  {
    name: 'Apply',
    kind: 'function',
    identifierTrigger: 'apply',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const h = op(expr, 1);
      if (typeof h === 'string') {
        const fn = (expr as Expression[]).slice(1) as Expression;
        return serializer.serialize(fn);
      }

      return serializer.serializeFunction(ops(expr) as Expression);
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
      const id = unhold(op(expr, 1));

      if (head(op(expr, 2)) === 'Function') {
        const op_2 = op(expr, 2);
        const body = unhold(op(op_2, 1));
        const args = ops(op_2)?.slice(1) ?? [];

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
        serializer.serialize(op(expr, 2)),
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
      const radix = machineValue(op(expr, 2)) ?? NaN;
      if (isFinite(radix) && radix >= 2 && radix <= 36) {
        // CAUTION: machineValue() may return a truncated value
        // if the number is outside of the machine range.
        const num = machineValue(op(expr, 1)) ?? NaN;
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
        serializer.serialize(op(expr, 1)) +
        ', ' +
        serializer.serialize(op(expr, 2)) +
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

      const arg1 = op(expr, 1);
      const h1 = head(arg1);
      let delims = {
        Set: '{,}',
        List: '[,]',
        Tuple: '(,)',
        Single: '(,)',
        Pair: '(,)',
        Triple: '(,)',
        Sequence: '(,)',
        String: '""',
      }[typeof h1 === 'string' ? h1 : ''];

      const items = delims ? arg1 : (['Sequence', arg1] as Expression);

      delims ??= '(,)';

      // Check if there are custom delimiters specified
      if (nops(expr) > 1) {
        const op2 = stringValue(op(expr, 2));
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
      if (head(expr) === 'Error') return serializer.serialize(expr);
      return `\\mathbf{${serializer.serialize(op(expr, 1))}}`;
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
      const op1 = op(expr, 1);
      if (stringValue(op1) === 'missing')
        return `\\error{${
          serializer.options.missingSymbol ?? '\\placeholder{}'
        }}`;

      const where = errorContextAsLatex(serializer, expr) || '\\blacksquare';

      const code =
        head(op1) === 'ErrorCode' ? stringValue(op(op1, 1)) : stringValue(op1);

      if (code === 'incompatible-domain') {
        if (symbol(op(op1, 3)) === 'Undefined') {
          return `\\mathtip{\\error{${where}}}{\\notin ${serializer.serialize(
            op(op1, 2)
          )}}`;
        }
        return `\\mathtip{\\error{${where}}}{\\in ${serializer.serialize(
          op(op1, 3)
        )}\\notin ${serializer.serialize(op(op1, 2))}}`;
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
      const code = stringValue(op(expr, 1));

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
      return `\\texttt{${sanitizeLatex(stringValue(op(expr, 1)))}}`;
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
    parse: parseAt(),
  },
  {
    name: 'List',
    kind: 'matchfix',
    openTrigger: '[',
    closeTrigger: ']',
    parse: parseBrackets,
    // Note: Avoid \\[ ... \\] because it is used for display math
    serialize: (serializer: Serializer, expr: Expression): string =>
      joinLatex([
        '\\bigl\\lbrack',
        serializeOps(', ')(serializer, expr),
        '\\bigr\\rbrack',
      ]),
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
    precedence: 10,
    parse: parseRange,
    serialize: (serializer: Serializer, expr: Expression): string => {
      const args = ops(expr);
      if (args === null) return '';
      if (args.length === 1) return '1..' + serializer.serialize(op(expr, 1));
      if (args.length === 2)
        return (
          serializer.wrap(op(expr, 1), 10) +
          '..' +
          serializer.wrap(op(expr, 2), 10)
        );
      if (args.length === 3) {
        const step = machineValue(op(expr, 3));
        const start = machineValue(op(expr, 1));
        if (step !== null && start !== null) {
          return (
            serializer.wrap(op(expr, 1), 10) +
            ',' +
            serializer.wrap(start + step, 10) +
            '..' +
            serializer.wrap(op(expr, 2), 10)
          );
        }

        return (
          serializer.wrap(op(expr, 1), 10) +
          ',' +
          (serializer.wrap(op(expr, 3), ADDITION_PRECEDENCE) +
            '+' +
            serializer.wrap(op(expr, 3), ADDITION_PRECEDENCE)) +
          '..' +
          serializer.wrap(op(expr, 2), 10)
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
      const args = ops(expr);
      if (args === null || args.length === 0) return '\\text{}';
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
          serializer.serialize(op(expr, 1)) +
          '_{' +
          serializer.serialize(op(expr, 2)) +
          '}'
        );
      }
      return '_{' + serializer.serialize(op(expr, 1)) + '}';
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
      const n2 = machineValue(op(expr, 2)) ?? 1;
      const base = serializer.serialize(op(expr, 1));
      if (n2 === 1) return base + '^\\prime';
      if (n2 === 2) return base + '^\\doubleprime';
      if (n2 === 3) return base + '^\\tripleprime';
      return base + '^{(' + serializer.serialize(op(expr, 2)) + ')}';
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

      const start = parser.index;
      parser.addBoundary([')']);
      const expr = parser.parseExpression(until);
      if (!parser.matchBoundary()) {
        parser.index = start;
        return null;
      }
      if (!parser.match('<}>')) {
        parser.index = start;
        return null;
      }
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
      const start = parser.index;
      while (!parser.atEnd && !parser.match('<}>')) {
        if (parser.match("'")) primeCount++;
        else if (parser.match('\\prime')) primeCount++;
        else if (parser.match('\\doubleprime')) primeCount += 2;
        else if (parser.match('\\tripleprime')) primeCount += 3;
        else {
          parser.index = start;
          return null;
        }
      }
      if (primeCount === 1) return ['Derivative', ['InverseFunction', lhs]];
      if (primeCount > 0)
        return ['Derivative', ['InverseFunction', lhs], primeCount];

      return ['InverseFunction', lhs];
    },
    serialize: (serializer, expr) =>
      serializer.serialize(op(expr, 1)) + '^{-1}',
  },
  // Lagrange notation
  {
    name: 'Derivative',
    // @todo: Leibniz notation: {% latex " \\frac{d^n}{dx^n} f(x)" %}
    // @todo: Euler modified notation: This notation is used by Mathematica. The Euler notation uses `D` instead of
    // `\partial`: `\partial_{x} f`,  `\partial_{x,y} f`
    // @todo: Newton notation: `\dot{v}` -> first derivative relative to time t `\ddot{v}` -> second derivative relative to time t

    serialize: (serializer: Serializer, expr: Expression): string => {
      const degree = machineValue(op(expr, 2)) ?? 1;
      const base = serializer.serialize(op(expr, 1));
      if (degree === 1) return base + '^{\\prime}';
      if (degree === 2) return base + '^{\\doubleprime}';
      if (degree === 3) return base + '^{\\tripleprime}';

      return base + '^{(' + serializer.serialize(op(expr, 2)) + ')}';
    },
  },
  {
    kind: 'environment',
    name: 'Which',
    identifierTrigger: 'cases',
    parse: parseWhich,
    serialize: (serialize: Serializer, expr: Expression): string => {
      const rows: string[] = [];
      const args = ops(expr);
      if (args) {
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
    parse: parseWhich,
  },
  {
    kind: 'environment',
    identifierTrigger: 'rcases',
    parse: parseWhich,
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
          runs.push(['Style', text, { dict: runinStyle }]);
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
      const expr = parser.parseExpression() ?? ['Sequence'];
      parser.skipSpace();
      if (parser.match('<$>')) {
        runs.push(expr);
      } else {
        text += '$';
        parser.index = index;
      }
    } else if (parser.match('<$$>')) {
      const index = parser.index;
      const expr = parser.parseExpression() ?? ['Sequence'];
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
    runs.push(['Style', `'${text}'`, { dict: runinStyle }]);
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

  return style ? ['Style', body, { dict: style }] : body;
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
  const arg = op(error, 2);
  if (!arg) return '';

  if (head(arg) === 'LatexString') return stringValue(op(arg, 1)) ?? '';

  if (head(arg) === 'Hold') return serializer.serialize(op(arg, 1));

  return serializer.serialize(arg);
}

function parsePrime(
  parser: Parser,
  lhs: Expression,
  order: number
): Expression | null {
  // If the lhs is a Prime/Derivative, increase the derivation order
  const lhsh = head(lhs);
  if (lhsh === 'Derivative' || lhsh === 'Prime') {
    const n = machineValue(op(lhs, 2)) ?? 1;
    return [lhsh, missingIfEmpty(op(lhs, 1)), n + order];
  }

  // If the lhs is a function, return the derivative
  // i.e. f' -> Derivative(f)

  const sym = symbol(lhs);
  if ((sym && parser.getIdentifierType(sym) === 'function') || head(lhs)) {
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
  if (body === null || isEmptySequence(body)) return ['Delimiter'];

  const h = head(body);
  // We have a Delimiter inside parens: e.g. `(a, b, c)` with `a, b, c` the
  // Delimiter function.
  if (h === 'Delimiter' && op(body, 2)) {
    const delims = stringValue(op(body, 2));
    if (delims?.length === 1) {
      // We have a Delimiter with a single character separator
      return ['Delimiter', op(body, 1) ?? ['Sequence'], { str: `(${delims})` }];
    }
  }

  // @todo: does this codepath ever get hit?
  if (h === 'Matrix') {
    const delims = stringValue(op(body, 2)) ?? '..';
    if (delims === '..') return ['Matrix', op(body, 1)!];
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
function parseBrackets(parser: Parser, body: Expression | null): Expression {
  if (body === null || isEmptySequence(body)) return ['List'];

  const h = head(body);
  if (h === 'Range' || h === 'Linspace') return body;
  if (h === 'Sequence') return ['List', ...(ops(body) ?? [])];

  if (h === 'Delimiter') {
    const delim = stringValue(op(body, 2)) ?? '...';
    if (delim === ';' || delim === '.;.') {
      return [
        'List',
        ...(ops(op(body, 1)) ?? []).map((x) => parseBrackets(parser, x)),
      ];
    }
    if (delim === ',' || delim === '.,.') {
      body = op(body, 1);
      if (head(body) === 'Sequence') return ['List', ...(ops(body) ?? [])];
      return ['List', body ?? ['Sequence']];
    }
  }

  return ['List', body];
}

/**
 * A range is a sequence of numbers, e.g. `1..10`.
 * Optionally, they may include a step, e.g. `1, 3..10`.
 */
function parseRange(parser: Parser, lhs: Expression): Expression | null {
  const index = parser.index;
  if (!lhs) return null;

  // Is there a step implied? e.g. "1,3..10"
  let start: Expression | null = null;
  let second: Expression | null = null;
  if (head(lhs) === 'Sequence') {
    if (nops(lhs) !== 2) return null;
    start = op(lhs, 1);
    second = op(lhs, 2);
    if (second === null) {
      parser.index = index;
      return null;
    }
  } else start = op(lhs, 1);

  if (start === null) return null;

  const end = parser.parseExpression({ minPrec: 0 });
  if (!end) {
    parser.index = index;
    return null;
  }

  // Is there an implied step?
  if (second) {
    // If the step is a number, use it
    const secondValue = machineValue(second);
    const startValue = machineValue(start);
    if (secondValue !== null && startValue !== null) {
      return ['Range', start, end, secondValue - startValue];
    }
    return ['Range', start, end, ['Subtract', second, start]];
  }

  return ['Range', start, end];
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
  const index = parser.index;

  // Do we have an assignment of the form `f(x) := ...`?
  if (
    head(lhs) === 'InvisibleOperator' &&
    nops(lhs) === 2 &&
    head(op(lhs, 2)) === 'Delimiter'
  ) {
    const fn = symbol(op(lhs, 1));
    if (!fn) return null;

    const rhs = parser.parseExpression({ minPrec: 0 });
    if (rhs === null) {
      parser.index = index;
      return null;
    }

    const delimBody = op(op(lhs, 2), 1);
    let args: Expression[] = [];
    if (head(delimBody) === 'Sequence') args = ops(delimBody) ?? [];
    else if (delimBody) args = [delimBody!];

    return ['Assign', fn, ['Function', rhs, ...(args ?? [])]];
  }

  // If this is a previously defined function, the lhs might be a
  // function application...
  if (typeof head(lhs) === 'string') {
    const fn = head(lhs) as string;
    const args = ops(lhs) ?? [];
    const rhs = parser.parseExpression({ minPrec: 0 });
    if (rhs === null) {
      parser.index = index;
      return null;
    }
    return ['Assign', fn, ['Function', rhs, ...args]];
  }

  if (!symbol(lhs)) return null;

  const rhs = parser.parseExpression({ minPrec: 0 });
  if (rhs === null) {
    parser.index = index;
    return null;
  }

  return ['Assign', lhs, rhs];
}

function parseWhich(parser: Parser): Expression | null {
  const tabular: Expression[][] | null = parser.parseTabular();
  if (!tabular) return ['Which'];
  // Note: return `True` for the condition, because it must be present
  // as the second element of the Tuple. Return an empty sequence for the
  // value, because it is optional
  const result: Expression = ['Which'];
  for (const row of tabular) {
    if (row.length === 1) {
      result.push('True');
      result.push(row[0]);
    } else if (row.length === 2) {
      const s = stringValue(row[1]);
      // If a string, probably 'else' or 'otherwise'
      result.push(s ? 'True' : stripText(row[1]) ?? 'True');
      result.push(row[0]);
    }
  }
  return result;
}

function parseAt(...close: string[]): (parser, lhs) => Expression | null {
  return (parser: Parser, lhs: Expression): Expression | null => {
    // If the lhs is a symbol or a List literal...
    if (!symbol(lhs) && head(lhs) !== 'List') return null;
    const index = parser.index;

    let rhs: Expression | null = null;
    if (close.length === 0) rhs = parser.parseGroup();
    rhs ??= parser.parseExpression({ minPrec: 0 });
    if (rhs === null) {
      parser.index = index;
      return null;
    }

    if (close.length > 0 && !parser.matchAll(close)) {
      parser.index = index;
      return null;
    }

    if (head(rhs) === 'Delimiter') rhs = op(rhs, 1) ?? ['Sequence'];
    if (head(rhs) === 'Sequence') return ['At', lhs, ...ops(rhs)!];
    return ['At', lhs, rhs];
  };
}
