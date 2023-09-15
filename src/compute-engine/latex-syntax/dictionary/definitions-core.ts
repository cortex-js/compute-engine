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
  isListLike,
  isEmptySequence,
} from '../../../math-json/utils';
import { LatexDictionary, Parser, Serializer, Terminator } from '../public';
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
 * Parse a sequence of expressions separated with ','
 */
function parseSequence(
  parser: Parser,
  terminator: Readonly<Terminator>,
  lhs: Expression,
  prec: number,
  sep: string
) {
  console.assert(lhs !== null);
  if (terminator.minPrec >= prec) return null;

  const result: Expression[] = [lhs];
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
  return (serializer: Serializer, expr: Expression | null): string =>
    (ops(expr) ?? []).map((x) => serializer.serialize(x)).join(sep);
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
  {
    name: 'Apply',
    kind: 'function',
    identifierTrigger: 'apply',
    serialize: (serializer: Serializer, expr: Expression): string =>
      serializer.serializeFunction(ops(expr) as Expression),
  },
  {
    latexTrigger: '\\rhd',
    kind: 'infix',
    precedence: 20,
    parse: 'Apply',
  },
  {
    latexTrigger: '\\lhd',
    kind: 'infix',
    precedence: 20,
    parse: (parser: Parser, lhs: Expression) => {
      const rhs = parser.parseExpression({ minPrec: 20 }) ?? 'Nothing';
      return ['Apply', rhs, lhs];
    },
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
    name: 'Delimiter',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const argCount = nops(expr);
      if (argCount === 0) return '';

      const style = serializer.options.groupStyle(expr, serializer.level + 1);

      const arg1 = op(expr, 1);
      const h1 = head(arg1);
      const defaultFence =
        { List: '[],', Sequence: '' }[typeof h1 === 'string' ? h1 : ''] ??
        '(),';
      let open = defaultFence[0] ?? '';
      let close = defaultFence[1] ?? '';
      let sep = defaultFence[2] ?? '';

      if (argCount > 1) {
        const op2 = stringValue(op(expr, 2)) ?? '';
        open = op2[0] ?? defaultFence[0];
        close = op2[1] ?? defaultFence[1];
        sep = op2[2] ?? defaultFence[2];
      }

      const body = isListLike(arg1)
        ? serializeOps(sep)(serializer, arg1)
        : serializer.serialize(arg1);

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
      const op2 = parser.parseGroup();
      return op1;
    },
  },
  {
    latexTrigger: ['\\texttip'],
    parse: (parser: Parser) => {
      const op1 = parser.parseGroup();
      const op2 = parser.parseGroup();
      return op1;
    },
  },
  {
    latexTrigger: ['\\error'],
    parse: (parser: Parser) => ['Error', parser.parseGroup()],
  },
  {
    name: 'Error',
    serialize: (serializer, expr) => {
      if (stringValue(op(expr, 1)) === 'missing')
        return `\\error{${
          serializer.options.missingSymbol ?? '\\placeholder{}'
        }}`;

      const where = errorContextAsLatex(serializer, expr) || '\\blacksquare';

      const op1 = op(expr, 1);
      const code =
        head(op1) === 'ErrorCode' ? stringValue(op(op1, 1)) : stringValue(op1);

      if (code === 'incompatible-domain') {
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
    name: 'List',
    kind: 'matchfix',
    openTrigger: '\\lbrack',
    closeTrigger: '\\rbrack',
    parse: parseList,
    serialize: (serializer: Serializer, expr: Expression): string => {
      return joinLatex([
        '\\lbrack',
        serializeOps(', ')(serializer, expr),
        '\\rbrack',
      ]);
    },
  },
  // Synonyms for List
  {
    kind: 'matchfix',
    openTrigger: '[',
    closeTrigger: ']',
    parse: parseList,
  },
  {
    kind: 'matchfix',
    openTrigger: '\\[',
    closeTrigger: '\\]',
    parse: parseList,
  },
  // Synonyms for Delimiter
  {
    kind: 'matchfix',
    openTrigger: '(',
    closeTrigger: ')',
    parse: parseDelimiter,
  },
  {
    kind: 'matchfix',
    openTrigger: '\\lparen',
    closeTrigger: '\\rparen',
    parse: parseDelimiter,
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
      return ['Sequence', ...seq];
    },
  },
  {
    name: 'Sequence',
    serialize: serializeOps(''),
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
      return [
        'Sequence',
        ...seq.map((x) =>
          head(x) === 'Sequence' ? ['List', ...(ops(x) ?? [])] : x
        ),
      ] as Expression;
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
    parse: (parser, lhs) => parsePrime(parser, lhs, 1),
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
    parse: (parser, lhs) => parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: '^{\\prime\\prime\\prime}',
    kind: 'postfix',
    parse: (parser, lhs) => parsePrime(parser, lhs, 3),
  },
  {
    latexTrigger: ['^', '\\doubleprime'],
    kind: 'postfix',
    parse: (parser, lhs) => parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: ['^', '\\tripleprime'],
    kind: 'postfix',
    parse: (parser, lhs) => parsePrime(parser, lhs, 3),
  },
  {
    latexTrigger: "'",
    kind: 'postfix',
    precedence: 810,
    parse: (parser, lhs) => parsePrime(parser, lhs, 1),
  },
  {
    latexTrigger: '\\prime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser, lhs) => parsePrime(parser, lhs, 1),
  },
  {
    latexTrigger: '\\doubleprime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser, lhs) => parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: '\\tripleprime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser, lhs) => parsePrime(parser, lhs, 3),
  },
  {
    latexTrigger: ['^', '<{>', '('],
    kind: 'postfix',
    parse: (parser: Parser, lhs) => {
      if (!parser.computeEngine?.box(lhs)?.domain.isFunction) return null;

      const start = parser.index;
      parser.addBoundary([')']);
      const expr = parser.parseExpression();
      if (!parser.matchBoundary()) {
        parser.index = start;
        return null;
      }
      if (!parser.match('<}>')) {
        parser.index = start;
        return null;
      }
      return ['Derivative', lhs, expr];
    },
  },

  {
    name: 'InverseFunction',
    latexTrigger: '^{-1}',
    kind: 'postfix',
    parse: (parser, lhs) => {
      // If the lhs is a function, return the inverse function
      // i.e. f^{-1} -> InverseFunction(f)
      if (parser.computeEngine?.box(lhs)?.domain.isFunction)
        return ['InverseFunction', lhs];
      // Otherwise, if it's a number or a symbol, return the power
      // i.e. x^{-1} -> Power(x, -1)
      return ['Power', missingIfEmpty(lhs), -1];
    },
    serialize: (serializer, expr) =>
      serializer.serialize(op(expr, 1)) + '^{-1}',
  },
  {
    name: 'Derivative',
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
    parse: (parser: Parser) => {
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
    },
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
    } else text += parser.matchChar() ?? parser.nextToken();
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
      }[c] ?? '\\' + c)
  );
}

function errorContextAsLatex(
  serializer: Serializer,
  error: Expression
): string {
  const arg = op(error, 2);
  if (!arg) return '';

  if (head(arg) === 'Latex')
    return `\\texttt{${sanitizeLatex(stringValue(op(arg, 1)) ?? '')}}`;

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
  if (parser.computeEngine?.box(lhs)?.domain.isFunction) {
    if (order === 1) return ['Derivative', lhs];
    return ['Derivative', lhs, order];
  }
  // Otherwise, if it's a number or a symbol, return a
  // generic "Prime"
  if (order === 1) return ['Prime', missingIfEmpty(lhs)];
  return ['Prime', missingIfEmpty(lhs), order];
}

function parseDelimiter(parser: Parser, body: Expression): Expression | null {
  // @todo: does this really need to be done here? Sequence(Sequence(...))
  // Handle `()` used for example with `f()`
  if (body === null || isEmptySequence(body)) return ['Sequence'];
  if (head(body) === 'Sequence') {
    if (nops(body) === 0) return ['Delimiter'];
    return ['Delimiter', ['Sequence', ...(ops(body) ?? [])]];
  }

  return ['Delimiter', body];
}

function parseList(_parser: Parser, body: Expression): Expression {
  if (body === null || isEmptySequence(body)) return ['List'];
  if (head(body) !== 'Sequence' && head(body) !== 'List') return ['List', body];
  return ['List', ...(ops(body) ?? [])];
}
