import { Expression } from '../../../math-json/math-json-format';
import {
  machineValue,
  PRIME,
  DERIVATIVE,
  LIST,
  getSequence,
  mapArgs,
  op,
  nops,
  stringValue,
  tail,
  symbol,
  head,
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
function parseSequence(prec: number) {
  return (
    parser: Parser,
    terminator: Terminator,
    lhs: Expression
  ): Expression | null => {
    console.assert(lhs !== null);
    if (terminator.minPrec >= prec) return null;

    if (lhs === 'Missing') lhs = 'Nothing';

    const result: Expression = ['Sequence', lhs];
    let done = false;
    while (!done) {
      done = true;

      parser.skipSpace();
      while (parser.match(',')) {
        result.push('Nothing');
        parser.skipSpace();
      }

      if (parser.atTerminator(terminator)) {
        result.push('Nothing');
      } else {
        const rhs = parser.matchExpression({ ...terminator, minPrec: prec });
        result.push(rhs ?? 'Nothing');
        done = rhs === null;
      }
      if (!done) {
        parser.skipSpace();
        done = !parser.match(',');
      }
    }

    return result;
  };
}

/* Parse a sequence of sequences separated with ';' */
function parseSequence2(prec: number) {
  return (
    parser: Parser,
    terminator: Terminator,
    lhs: Expression
  ): Expression | null => {
    console.assert(lhs);
    if (terminator.minPrec >= prec) return null;

    if (lhs === 'Missing') lhs = 'Nothing';

    const result: Expression = [
      'Sequence',
      ...(getSequence(lhs) ?? ['Sequence', lhs]),
    ];

    while (true) {
      parser.skipSpace();
      while (parser.match(',')) {
        result.push('Nothing');
        parser.skipSpace();
      }

      if (parser.atEnd) {
        result.push('Nothing');
        break;
      }
      const rhs = parser.matchExpression({ ...terminator, minPrec: prec });
      if (rhs === null) {
        result.push('Nothing');
        break;
      }
      result.push(...(getSequence(rhs) ?? ['Sequence', rhs]));
      parser.skipSpace();
      if (!parser.match(',')) break;
    }

    return result;
  };
}
function serializeSequence(sep = '') {
  return (serializer: Serializer, expr: Expression | null): string => {
    return tail(expr)
      .map((x) => serializer.serialize(x))
      .join(sep);
  };
}

export function serializeLatex(
  serializer: Serializer,
  expr: Expression | null
): string {
  if (expr === null) return '';
  const h = head(expr);
  if (h === 'LatexString') return serializeLatexForm(serializer, expr);
  if (h === 'LatexTokens') return serializeLatexTokens(serializer, expr);
  const strValue = stringValue(expr);
  if (strValue !== null) return `\\text{${strValue}}`;

  const numValue = machineValue(expr);
  if (numValue !== null) return numValue.toString();

  return `\\text{${JSON.stringify(expr)}}`;
}

export const DEFINITIONS_CORE: LatexDictionary = [
  //
  // Constants
  //
  {
    name: 'Missing',
    trigger: ['\\placeholder'],
    requiredLatexArg: 1, // Arg is read, but discarded
    serialize: (serializer) =>
      serializer.options.missingSymbol ?? '\\placeholder{}',
  },

  //
  // Functions
  //
  {
    name: 'BaseForm',
    serialize: (serializer, expr) => {
      const radix = machineValue(op(expr, 2)) ?? NaN;
      if (isFinite(radix) && radix >= 2 && radix <= 36) {
        const num = machineValue(op(expr, 1)) ?? NaN;
        if (isFinite(num)) {
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
              if (i > 0 && i % groupLength === 0) {
                digits = '\\, ' + digits;
              }
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
      // @todo: could use `serializer.groupStyle`
      const argCount = nops(expr);
      if (argCount === 0) return '';
      if (argCount === 1)
        return `\\left( ${serializer.serialize(op(expr, 1))} \\right)`;
      let sep = '';
      let open = '\\left(';
      let close = '\\left)';

      if (argCount === 2) sep = serializeLatex(serializer, op(expr, 2)) ?? '';
      else if (argCount === 3) {
        open = serializeLatex(serializer, op(expr, 2)) ?? '';
        close = serializeLatex(serializer, op(expr, 3)) ?? '';
      } else {
        open = serializeLatex(serializer, op(expr, 2)) ?? '';
        sep = serializeLatex(serializer, op(expr, 3)) ?? '';
        close = serializeLatex(serializer, op(expr, 4)) ?? '';
      }
      const arg1 = op(expr, 1);
      if (sep && head(arg1) === 'Sequence') {
        return `${open} ${serializeSequence(sep)(serializer, arg1)} ${close}`;
      }
      return `${open} ${serializer.serialize(arg1)} ${close}`;
    },
  },
  {
    name: 'Error',
    serialize: (serializer, expr) => {
      const op1 = op(expr, 1);
      const value = symbol(op1) === 'Nothing' ? '' : serializer.serialize(op1);
      if (nops(expr) >= 3) {
        const arg = op(expr, 3);
        if (arg && head(arg) === 'LatexForm') {
          const location = sanitizeLatex(stringValue(op(arg, 1)));
          if (location)
            return `${value ?? ''}\\texttt{\\textcolor{red}{${location}}}`;
        }
      }
      return value ?? '';
    },
  },
  {
    name: 'FromLatex',
    serialize: (serializer, expr) => {
      return `\\texttt{${sanitizeLatex(stringValue(op(expr, 1)))}}`;
    },
  },
  { name: 'LatexForm', serialize: serializeLatexForm },
  { name: 'LatexTokens', serialize: serializeLatexTokens },

  // {
  //   name: LIST,
  //   kind: 'matchfix',
  //   openDelimiter: '[',
  //   closeDelimiter: ']',
  //   precedence: 20,
  //   // parse: (
  //   //   lhs: Expression,
  //   //   _scanner: Scanner,
  //   //   _minPrec: number
  //   // ): [Expression | null, Expression | null] => {
  //   //   if (lhs === null) return [null, [LIST]];
  //   //   if (getFunctionName(lhs) !== SEQUENCE) return [null, [LIST, lhs]];
  //   //   return [null, [LIST, ...getTail(lhs)]];
  //   // },
  // },
  {
    kind: 'matchfix',
    openDelimiter: '(',
    closeDelimiter: ')',
    parse: (_parser, body) => {
      // @todo: does this really need to be done here? Sequence(Sequence(...))
      if (body === null) return null;
      if (head(body) === 'Sequence') {
        if (nops(body) === 0) return ['Delimiter', 'Nothing'];
        return ['Delimiter', ...tail(body)];
      }
      return ['Delimiter', body];
    },
  },
  {
    name: 'Sequence',
    trigger: [','],
    kind: 'infix',
    precedence: 20,
    // Unlike the matchfix version of List,
    // when the comma operator is used, the lhs and rhs are flattened,
    // i.e. `1,2,3` -> `["Delimiter", ["Sequence", 1, 2, 3],  ","]`,
    // and `1, (2, 3)` -> `["Delimiter",
    // ["Sequence", 1, ["Delimiter", ["Sequence", 2, 3],  "(", ",", ")"]],  ","],
    parse: parseSequence(20),
    serialize: serializeSequence(),
  },
  {
    trigger: [';'],
    kind: 'infix',
    precedence: 19,
    parse: parseSequence2(19),
  },
  {
    name: 'String',
    trigger: ['\\text'],
    parse: (scanner) => parseTextRun(scanner),
    serialize: (serializer: Serializer, expr: Expression): string => {
      const args = tail(expr);
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
    trigger: ['_'],
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
  { name: 'Superplus', trigger: ['^', '+'], kind: 'postfix' },
  { name: 'Subplus', trigger: ['_', '+'], kind: 'postfix' },
  { name: 'Superminus', trigger: ['^', '-'], kind: 'postfix' },
  { name: 'Subminus', trigger: ['_', '-'], kind: 'postfix' },
  {
    trigger: ['^', '*'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Superstar', lhs],
  },
  // @todo: when lhs is a complex number, 'Conjugate'
  // { name: 'Conjugate', trigger: ['\\star'], kind: 'infix' },
  { name: 'Superstar', trigger: ['^', '\\star'], kind: 'postfix' },
  {
    trigger: ['_', '*'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Substar', lhs],
  },
  { name: 'Substar', trigger: ['_', '\\star'], kind: 'postfix' },
  { name: 'Superdagger', trigger: ['^', '\\dagger'], kind: 'postfix' },
  {
    trigger: ['^', '\\dag'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Superdagger', lhs],
  },
  {
    name: PRIME,
    trigger: ['^', '\\prime'],
    kind: 'postfix',
  },
  {
    trigger: ['^', '\\doubleprime'],
    kind: 'postfix',
    parse: (_parser, lhs) => [PRIME, lhs ?? 'Nothing', 2],
  },
  // {
  //   name: 'InverseFunction',
  //   trigger: '^{-1}',
  //   kind: 'postfix',
  //   serialize: (serializer, expr) => {
  //     return serializer.serialize(op(expr, 1)) + '^{-1}';
  //   },
  // },
  {
    name: DERIVATIVE,
    serialize: (serializer: Serializer, expr: Expression): string => {
      const degree = machineValue(op(expr, 1)) ?? NaN;
      if (!isFinite(degree)) return '';
      const base = serializer.serialize(op(expr, 2));
      if (degree === 1) {
        return base + '^{\\prime}';
      } else if (degree === 2) {
        return base + '^{\\doubleprime}';
      }
      return base + '^{(' + Number(degree).toString() + ')}';
    },
  },
  {
    name: 'Piecewise',
    trigger: 'cases',
    kind: 'environment',
    parse: (parser) =>
      ['Piecewise', parser.matchTabular('cases') ?? 'Nothing'] as Expression,
    serialize: (serialize: Serializer, expr: Expression): string => {
      if (head(op(expr, 1)) !== LIST) return '';
      const rows = tail(op(expr, 1));
      let body = ''; // @todo: use joinLatex
      let rowSep = '';
      for (const row of rows) {
        body += rowSep;
        const arg1 = op(row, 1);
        if (arg1 !== null) {
          body += serialize.serialize(arg1);
          const arg2 = op(row, 2);
          if (arg2 !== null) body += '&' + serialize.serialize(arg2);
        }
        rowSep = '\\\\';
      }
      return '\\begin{cases}' + body + '\\end{cases}';
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
  if (!parser.match('<{>')) return 'Nothing';

  const runs: Expression[] = [];
  let text = '';
  let runinStyle: { [key: string]: string } | null = null;

  while (!parser.atEnd && !parser.match('<}>')) {
    if (parser.peek === '<{>') {
      runs.push(parseTextRun(parser));
    } else if (parser.match('\\textbf') && parser.match('<{>')) {
      runs.push(parseTextRun(parser, { 'font-weight': 'bold' }));
      // @todo! other text styles...
    } else if (parser.match('\\color') && parser.match('<{>')) {
      // Run-in style
      const color = parser.matchColor();
      if (color && parser.match('<}>')) {
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
      const expr = parser.matchExpression() ?? 'Nothing';
      parser.skipSpace();
      if (parser.match('<$>')) {
        runs.push(expr);
      } else {
        text += '$';
        parser.index = index;
      }
    } else if (parser.match('<$$>')) {
      const index = parser.index;
      const expr = parser.matchExpression() ?? 'Nothing';
      parser.skipSpace();
      if (parser.match('<$$>')) {
        runs.push(expr);
      } else {
        text += '$$';
        parser.index = index;
      }
    } else text += parser.matchChar() ?? '';
  }

  // Apply leftovers
  if (runinStyle !== null && text) {
    runs.push(['Style', text, { dict: runinStyle }]);
  } else if (text) {
    runs.push(['String', text]);
  }

  return style
    ? ['Style', ['String', ...runs], { dict: style }]
    : ['String', ...runs];
}

// parse: (
//   lhs: Expression,
//   _scanner: Scanner,
//   _minPrec: number
// ): [Expression | null, Expression | null] => {
//   // //
//   // // 1. Attempt to scan a base-n number
//   // // i.e. `(deadbeef)_{16}`
//   // //
//   // let done = false;
//   // let couldBeBaseNumber = true;
//   // let wrappedInMathTt = false;
//   // let maxDigit = 0;
//   // let digits = '';
//   // while (!done && couldBeBaseNumber) {
//   //   const token = scanner.next();
//   //   if (scanner.atEnd || token === ')') {
//   //     done = true;
//   //   } else if (token === '\\mathtt') {
//   //     scanner.match('<{>');
//   //     wrappedInMathTt = true;
//   //   } else if (isSpacingToken(token)) {
//   //     // Skip 'spacing' token
//   //   } else if (!/^[0-9a-zA-Z]$/.test(token)) {
//   //     couldBeBaseNumber = false;
//   //   } else {
//   //     maxDigit = Math.max(maxDigit, parseInt(token, 36));
//   //     digits += token;
//   //   }
//   //   if (wrappedInMathTt) {
//   //     scanner.match('<}>');
//   //   }
//   // }
//   // if (couldBeBaseNumber && scanner.match('_')) {
//   //   const radix =
//   //     getNumberValue(scanner.matchRequiredLatexArgument()) ?? NaN;
//   //   if (!isFinite(radix) || radix < 2 || radix > 36 || maxDigit >= radix) {
//   //     scanner.onError({ code: 'base-out-of-range' });
//   //     return [lhs, 'Nothing'];
//   //   }
//   //   return [lhs, ['BaseForm', parseInt(digits, radix), radix]];
//   // }

//   // //
//   // // 2. It wasn't a number in a base. Scan a sequence
//   // //
//   // scanner.index = originalIndex;

//   // If it's an empty sequence, i.e. `()`
//   if (lhs === null) return [null, [PARENTHESES]];

//   // If it's a simple sequence, 'upgrade it' to a `Parentheses`
//   if (getFunctionName(lhs) === SEQUENCE) {
//     return [null, [PARENTHESES, ...getTail(lhs)]];
//   }
//   return [null, [PARENTHESES, lhs]];
// },

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

function serializeLatexForm(
  serializer: Serializer,
  expr: Expression | null
): string {
  if (expr === null) return '';
  return joinLatex(
    mapArgs<string>(expr, (x) => stringValue(x) ?? serializer.serialize(x))
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
