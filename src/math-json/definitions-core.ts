import { LatexDictionary, Scanner, Serializer } from './public';
import { Expression } from './math-json-format';
import {
  getNumberValue,
  getArg,
  getArgCount,
  getFunctionName,
  getTail,
  LIST,
  MISSING,
  PRIME,
  INVERSE_FUNCTION,
  DERIVATIVE,
  NOTHING,
  getStringValue,
  jsonForm,
  getSequence,
} from '../common/utils';
import { Numeric } from './compute-engine-interface';
import { joinLatex } from './core/tokenizer';

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
    lhs: Expression | null,
    scanner: Scanner,
    minPrec: number
  ): [Expression | null, Expression | null] => {
    if (minPrec >= prec) return [lhs, null];

    if (lhs === 'Missing' || lhs === null) lhs = NOTHING;

    const result: Expression[] = ['Sequence', lhs];
    let done = false;
    while (!done) {
      done = true;

      scanner.skipSpace();
      while (scanner.match(',')) {
        result.push(NOTHING);
        scanner.skipSpace();
      }

      if (scanner.atEnd) {
        result.push(NOTHING);
      } else {
        const rhs = scanner.matchExpression(prec);
        result.push(rhs ?? NOTHING);
        done = rhs === null;
      }
      if (!done) {
        scanner.skipSpace();
        done = !scanner.match(',');
      }
    }

    return [null, result];
  };
}

/* Parse a sequence of sequences separated with ';' */
function parseSequence2(prec: number) {
  return (
    lhs: Expression | null,
    scanner: Scanner,
    minPrec: number
  ): [Expression | null, Expression | null] => {
    if (minPrec >= prec) return [lhs, null];

    if (lhs === 'Missing' || lhs === null) lhs = NOTHING;

    lhs = getSequence(lhs) ?? ['Sequence', lhs];

    const result: Expression[] = ['Sequence', lhs];

    while (true) {
      scanner.skipSpace();
      while (scanner.match(',')) {
        result.push(NOTHING);
        scanner.skipSpace();
      }

      if (scanner.atEnd) {
        result.push(NOTHING);
        break;
      }
      let rhs = scanner.matchExpression(prec);
      if (rhs === null) {
        result.push('Nothing');
        break;
      }
      rhs = getSequence(rhs) ?? ['Sequence', rhs];
      result.push(rhs);
      scanner.skipSpace();
      if (!scanner.match(',')) break;
    }

    return [null, result];
  };
}
function serializeSequence<T extends number = number>(sep = '') {
  return (serializer: Serializer<T>, expr: Expression<T> | null): string => {
    return getTail(expr)
      .map((x) => serializer.serialize(x))
      .join(sep);
  };
}

export function serializeLatex<T extends number = number>(
  serializer: Serializer<T>,
  expr: Expression<T> | null
): string {
  const head = getFunctionName(expr);
  if (head === 'LatexString') {
    return joinLatex(
      getTail(expr).map((x) => getStringValue(x) ?? serializer.serialize(x))
    );
  }

  if (head === 'LatexTokens') {
    // @todo: add onError handler to serialize()
    return joinLatex(
      getTail(expr).map((x) => {
        const stringValue = getStringValue(x);
        if (stringValue === null) return serializer.serialize(x);

        // If not a string, serialize the expression to LaTeX
        if (stringValue === '<{>') return '{';
        if (stringValue === '<}>') return '}';
        if (stringValue === '<$>') return '$';
        if (stringValue === '<$$>') return '$$';
        if (stringValue === '<space>') return ' ';
        return stringValue;
      })
    );
  }

  const strValue = getStringValue(expr);
  if (strValue !== null) return `\\text{${strValue}}`;

  const numValue = getNumberValue(expr);
  if (numValue !== null) return numValue.toString();

  return `\\text{${JSON.stringify(jsonForm(expr))}}`;
}

export const DEFINITIONS_CORE: LatexDictionary<Numeric> = [
  //
  // Constants
  //
  {
    name: MISSING,
    trigger: ['\\placeholder'],
    requiredLatexArg: 1,
    serialize: '\\placeholder',
  },

  //
  // Functions
  //
  {
    name: 'BaseForm',
    serialize: (serializer: Serializer, expr: Expression<Numeric>): string => {
      const radix = getNumberValue(getArg(expr, 2)) ?? NaN;
      if (isFinite(radix) && radix >= 2 && radix <= 36) {
        const num = getNumberValue(getArg(expr, 1)) ?? NaN;
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
          return `(\\mathtt{${digits}})_{${radix}}`;
        }
      }
      return (
        '\\operatorname{BaseForm}(' +
        serializer.serialize(getArg(expr, 1)) +
        ', ' +
        serializer.serialize(getArg(expr, 2)) +
        ')'
      );
    },
  },
  {
    name: 'Delimiter',
    serialize: (serializer: Serializer, expr: Expression<Numeric>): string => {
      // @todo: could use `serializer.groupStyle`
      const argCount = getArgCount(expr);
      if (argCount === 0) return '';
      if (argCount === 1)
        return `\\left( ${serializer.serialize(getArg(expr, 1))} \\right)`;
      let sep = '';
      let open = '\\left(';
      let close = '\\left)';

      if (argCount === 2)
        sep = serializeLatex(serializer, getArg(expr, 2)) ?? '';
      else if (argCount === 3) {
        open = serializeLatex(serializer, getArg(expr, 2)) ?? '';
        close = serializeLatex(serializer, getArg(expr, 3)) ?? '';
      } else {
        open = serializeLatex(serializer, getArg(expr, 2)) ?? '';
        sep = serializeLatex(serializer, getArg(expr, 3)) ?? '';
        close = serializeLatex(serializer, getArg(expr, 4)) ?? '';
      }
      const arg1 = getArg(expr, 1);
      if (sep && getFunctionName(arg1) === 'Sequence') {
        return `${open} ${serializeSequence(sep)(serializer, arg1)} ${close}`;
      }
      return `${open} ${serializer.serialize(arg1)} ${close}`;
    },
  },
  {
    name: 'Error',
    serialize: (serializer: Serializer, expr: Expression<Numeric>): string => {
      if (getArgCount(expr) >= 1) {
        return serializeLatex(serializer, getArg(expr, 1));
      }

      return '\\text{error}';
    },
  },
  { name: 'LatexString', serialize: serializeLatex },
  { name: 'LatexTokens', serialize: serializeLatex },

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
    parse: (
      seq: Expression,
      _scanner: Scanner
    ): [Expression | null, Expression | null] => {
      if (getFunctionName(seq) === 'Sequence') {
        if (getArgCount(seq) === 0) return [null, ['Delimiter']];
        return [null, ['Delimiter', ...getTail(seq)]];
      }
      return [null, ['Delimiter', seq]];
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
    parse: (lhs: Expression, scanner: Scanner, _minPrec: number) => [
      lhs,
      parseTextRun(scanner),
    ],
    serialize: (serializer: Serializer, expr: Expression): string => {
      const tail = getTail(expr);
      if (tail === null || tail.length === 0) return '\\text{}';
      return (
        '\\text{' + tail.map((x) => serializer.serialize(x)).join('') + '}'
      );
    },
  },
  {
    name: 'Subscript',
    trigger: ['_'],
    kind: 'infix',
    serialize: (serializer: Serializer, expr: Expression): string => {
      if (getArgCount(expr) === 2) {
        return (
          serializer.serialize(getArg(expr, 1)) +
          '_{' +
          serializer.serialize(getArg(expr, 2)) +
          '}'
        );
      }
      return '_{' + serializer.serialize(getArg(expr, 1)) + '}';
    },
  },
  { name: 'Superplus', trigger: ['^', '+'], kind: 'postfix' },
  { name: 'Subplus', trigger: ['_', '+'], kind: 'postfix' },
  { name: 'Superminus', trigger: ['^', '-'], kind: 'postfix' },
  { name: 'Subminus', trigger: ['_', '-'], kind: 'postfix' },
  {
    trigger: ['^', '*'],
    kind: 'postfix',
    parse: (lhs) => [null, ['Superstar', lhs]],
  },
  // @todo: when lhs is a complex number, 'Conjugate'
  // { name: 'Conjugate', trigger: ['\\star'], kind: 'infix' },
  { name: 'Superstar', trigger: ['^', '\\star'], kind: 'postfix' },
  {
    trigger: ['_', '*'],
    kind: 'postfix',
    parse: (lhs) => [null, ['Substar', lhs]],
  },
  { name: 'Substar', trigger: ['_', '\\star'], kind: 'postfix' },
  { name: 'Superdagger', trigger: ['^', '\\dagger'], kind: 'postfix' },
  {
    trigger: ['^', '\\dag'],
    kind: 'postfix',
    parse: (lhs) => [null, ['Superdagger', lhs]],
  },
  {
    name: PRIME,
    trigger: ['^', '\\prime'],
    kind: 'postfix',
  },
  {
    trigger: ['^', '\\doubleprime'],
    kind: 'postfix',
    parse: (lhs: Expression): [Expression | null, Expression] => {
      return [null, [PRIME, lhs ?? NOTHING, 2]];
    },
  },
  {
    name: INVERSE_FUNCTION,
    trigger: '^{-1}',
    kind: 'postfix',
    serialize: (serializer: Serializer, expr: Expression): string => {
      return serializer.serialize(getArg(expr, 1)) + '^{-1}';
    },
  },
  {
    name: DERIVATIVE,
    serialize: (serializer: Serializer, expr: Expression): string => {
      const degree = getNumberValue(getArg(expr, 1)) ?? NaN;
      if (!isFinite(degree)) return '';
      const base = serializer.serialize(getArg(expr, 2));
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
    parse: (lhs: Expression, scanner: Scanner): [Expression, Expression] => {
      return [lhs, ['Piecewise', scanner.matchTabular() ?? NOTHING]];
    },
    serialize: (serialize: Serializer, expr: Expression): string => {
      if (getFunctionName(getArg(expr, 1)) !== LIST) return '';
      const rows = getTail(getArg(expr, 1));
      let body = '';
      let rowSep = '';
      for (const row of rows) {
        body += rowSep;
        const arg1 = getArg(row, 1);
        if (arg1 !== null) {
          body += serialize.serialize(arg1);
          const arg2 = getArg(row, 2);
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
  scanner: Scanner,
  style?: { [key: string]: string }
): Expression {
  if (!scanner.match('<{>')) return NOTHING;

  const runs: Expression[] = [];
  let text = '';
  let runinStyle: { [key: string]: string } | null = null;

  while (!scanner.atEnd && !scanner.match('<}>')) {
    if (scanner.peek === '<{>') {
      runs.push(parseTextRun(scanner));
    } else if (scanner.match('\\textbf') && scanner.match('<{>')) {
      runs.push(parseTextRun(scanner, { 'font-weight': 'bold' }));
      // @todo! other text styles...
    } else if (scanner.match('\\color') && scanner.match('<{>')) {
      // Run-in style
      const color = scanner.matchColor();
      if (color && scanner.match('<}>')) {
        // Stash the current text/runinstyle
        if (runinStyle !== null && text) {
          runs.push(['Style', text, { dict: runinStyle }]);
        } else if (text) {
          runs.push(['String', text]);
        }
        text = '';
        runinStyle = { color };
      }
    } else if (scanner.match('<space>')) {
      text += ' ';
    } else if (scanner.match('<$>')) {
      const index = scanner.index;
      const expr = scanner.matchExpression() ?? NOTHING;
      scanner.skipSpace();
      if (scanner.match('<$>')) {
        runs.push(expr);
      } else {
        text += '$';
        scanner.index = index;
      }
    } else if (scanner.match('<$$>')) {
      const index = scanner.index;
      const expr = scanner.matchExpression() ?? NOTHING;
      scanner.skipSpace();
      if (scanner.match('<$$>')) {
        runs.push(expr);
      } else {
        text += '$$';
        scanner.index = index;
      }
    } else text += scanner.matchChar() ?? '';
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
//   //     return [lhs, NOTHING];
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
