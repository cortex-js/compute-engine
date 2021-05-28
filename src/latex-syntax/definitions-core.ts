import { LatexDictionary, LatexToken, Scanner, Serializer } from './public';
import { Expression } from '../public';
import {
  getNumberValue,
  getArg,
  getArgCount,
  getFunctionName,
  getTail,
  getFunctionHead,
  LATEX_TOKENS,
  PARENTHESES,
  LIST,
  MISSING,
  PRIME,
  INVERSE_FUNCTION,
  DERIVATIVE,
  NOTHING,
  SEQUENCE,
  SEQUENCE2,
  getStringValue,
} from '../common/utils';
import { getGroupStyle } from './serializer-style';

function isSpacingToken(token: string): boolean {
  return (
    token === '<space>' ||
    token === '\\qquad' ||
    token === '\\quad' ||
    token === '\\enskip' ||
    token === '\\;' ||
    token === '\\,' ||
    token === '\\ ' ||
    token === '~'
  );
}

/**
 * Parse a sequence of expressions separated with ',' or ';'.
 * - ',' indicate a simple sequence
 * - ';' indicate a sequence of sequences
 */
function parseSequence(head: string, prec: number, sep: LatexToken) {
  return (
    lhs: Expression,
    scanner: Scanner,
    minPrec: number
  ): [Expression | null, Expression | null] => {
    if (minPrec >= prec) return [lhs, null];

    scanner.skipSpace();
    scanner.match(sep);

    if (lhs === 'Missing') lhs = NOTHING;

    const result: Expression[] = [head, lhs ?? NOTHING];
    let done = false;
    while (!done) {
      done = true;

      scanner.skipSpace();
      while (scanner.match(sep)) {
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
        done = !scanner.match(sep);
      }
    }

    return [null, result];
  };
}

function serializeSequence(sep: string) {
  return (serializer: Serializer, expr: Expression | null): string => {
    return getTail(expr)
      .map((x) => serializer.serialize(x))
      .join(sep);
  };
}

function serializeLatex(
  serializer: Serializer,
  expr: Expression | null
): string {
  console.assert(getFunctionHead(expr) === LATEX_TOKENS);

  // @todo: add onError handler to serialize()
  return getTail(expr)
    .map((x) => {
      const stringValue = getStringValue(x);
      // If not a string, serialize the expression to Latex
      if (stringValue === null) return serializer.serialize(x);
      if (stringValue === '<{>') return '{';
      if (stringValue === '<}>') return '}';
      if (stringValue === '<$>') return '$';
      if (stringValue === '<$$>') return '$$';
      if (stringValue === "<space>'") return ' ';
      return stringValue;
    })
    .join('');
}

export const DEFINITIONS_CORE: LatexDictionary = [
  { name: LATEX_TOKENS, serialize: serializeLatex },
  {
    name: PARENTHESES,
    trigger: { matchfix: '(' },
    parse: (
      lhs: Expression,
      scanner: Scanner,
      _minPrec: number
    ): [Expression | null, Expression | null] => {
      const originalIndex = scanner.index;
      if (!scanner.match('(')) return [lhs, null];
      //
      // 1. Attempt to scan a base-n number
      // i.e. `(deadbeef)_{16}`
      //
      let done = false;
      let couldBeBaseNumber = true;
      let wrappedInMathTt = false;
      let maxDigit = 0;
      let digits = '';
      while (!done && couldBeBaseNumber) {
        const token = scanner.next();
        if (scanner.atEnd || token === ')') {
          done = true;
        } else if (token === '\\mathtt') {
          scanner.match('<{>');
          wrappedInMathTt = true;
        } else if (isSpacingToken(token)) {
          // Skip 'spacing' token
        } else if (!/^[0-9a-zA-Z]$/.test(token)) {
          couldBeBaseNumber = false;
        } else {
          maxDigit = Math.max(maxDigit, parseInt(token, 36));
          digits += token;
        }
        if (wrappedInMathTt) {
          scanner.match('<}>');
        }
      }
      scanner.skipSpace();
      if (couldBeBaseNumber && scanner.match('_')) {
        const radix =
          getNumberValue(scanner.matchRequiredLatexArgument()) ?? NaN;
        if (!isFinite(radix) || radix < 2 || radix > 36 || maxDigit >= radix) {
          scanner.onError({ code: 'base-out-of-range' });
          return [lhs, NOTHING];
        }
        return [lhs, ['BaseForm', parseInt(digits, radix), radix]];
      }

      //
      // 2. It wasn't a number in a base. Scan a sequence
      //
      scanner.index = originalIndex;
      const seq = scanner.matchBalancedExpression('(', ')', scanner.onError);

      // If it's a simple sequence, 'upgrade it' to a group
      if (!seq) return [lhs, [PARENTHESES]];

      if (getFunctionName(seq) === SEQUENCE) {
        return [lhs, [PARENTHESES, ...getTail(seq)]];
      }
      return [lhs, [PARENTHESES, seq]];
    },
    serialize: (serializer, expr) =>
      serializer.wrapString(
        serializeSequence(',')(serializer, expr),
        getGroupStyle(expr, serializer.level)
      ),
    separator: ',',
    closeFence: ')',
    precedence: 20,
  },
  {
    name: LIST,
    trigger: { matchfix: '\\lbrack' },
    separator: ',',
    closeFence: '\\rbrack',
    precedence: 20,
    parse: (
      lhs: Expression,
      scanner: Scanner,
      _minPrec: number
    ): [Expression | null, Expression | null] => {
      if (lhs === null) {
        // No lhs -> it's a list
        const seq = scanner.matchBalancedExpression(
          '\\lbrack',
          '\\rbrack',
          scanner.onError
        );
        if (!seq) return [null, [LIST]];
        if (getFunctionName(seq) === SEQUENCE) {
          return [lhs, [LIST, ...getTail(seq)]];
        }
        return [lhs, [LIST, seq]];
      }
      return [lhs, null];
      // There is a lhs -> it might be an index accessor, i.e. `v[23]` @todo
    },
  },
  {
    name: 'BaseForm',
    serialize: (serializer: Serializer, expr: Expression): string => {
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
    name: 'Set',
    trigger: { matchfix: '\\lbrace' },
    separator: ',',
    closeFence: '\\rbrace',
    precedence: 20,
  },
  {
    name: SEQUENCE,
    trigger: { infix: ',' },
    // Unlike the matchfix version of List,
    // when the comma operator is used, the lhs and rhs are flattened,
    // i.e. `1,2,3` -> `["Sequence", 1, 2, 3],
    // but `1, (2, 3)` -> ["Sequence", 1, ["Parentheses", 2, 3]]`
    parse: parseSequence(SEQUENCE, 20, ','),
    serialize: serializeSequence(', '),
    precedence: 20,
  },
  {
    name: SEQUENCE2,
    trigger: { infix: ';' },
    parse: parseSequence(SEQUENCE2, 19, ';'),
    serialize: serializeSequence('; '),
    precedence: 19,
  },
  {
    name: MISSING,
    trigger: '\\placeholder',
    serialize: '\\placeholder',
    requiredLatexArg: 1,
  },
  {
    name: 'Subscript',
    trigger: { infix: '_' },
    precedence: 720,
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
    parse: (
      lhs: Expression,
      scanner: Scanner,
      _minPrec: number
    ): [Expression | null, Expression | null] => {
      if (!scanner.match('_')) return [lhs, null];
      const rhs = scanner.matchRequiredLatexArgument() ?? MISSING;
      if (!lhs) return [null, ['Subscript', rhs]];
      return [null, ['Subscript', lhs, rhs]];
    },
  },
  {
    name: 'Superplus',
    trigger: { superfix: '+' },
  },
  {
    name: 'Subplus',
    trigger: { subfix: '+' },
  },
  {
    name: 'Superminus',
    trigger: { superfix: '-' },
  },
  {
    name: 'Subminus',
    trigger: { subfix: '-' },
  },
  {
    // @todo: when lhs is a complex number, 'Conjugate'
    name: 'Superstar',
    trigger: { superfix: '*' },
  },
  {
    // @todo: when lhs is a complex number, 'Conjugate'
    name: 'Superstar',
    trigger: { superfix: '\\star' },
  },
  {
    name: 'Substar',
    trigger: { subfix: '*' },
  },
  {
    name: 'Substar',
    trigger: { subfix: '\\star' },
  },
  {
    name: 'Superdagger',
    trigger: { superfix: '\\dagger' },
  },
  {
    name: 'Superdagger',
    trigger: { superfix: '\\dag' },
  },
  {
    name: PRIME,
    trigger: { superfix: '\\prime' },
    arguments: 'group',
  },
  {
    // name: 'prime',
    trigger: { superfix: '\\doubleprime' },
    parse: (
      lhs: Expression,
      _scanner: Scanner
    ): [Expression | null, Expression] => {
      return [null, [PRIME, lhs ?? NOTHING, 2]];
    },
    arguments: 'group',
  },
  {
    name: INVERSE_FUNCTION,
    serialize: (serializer: Serializer, expr: Expression): string => {
      return serializer.serialize(getArg(expr, 1)) + '^{-1}';
    },
  },
  {
    name: DERIVATIVE,
    trigger: 'D',
    parse: (lhs: Expression, _scanner: Scanner): [Expression, Expression] => {
      return [lhs, [DERIVATIVE, 1]];
    },
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
    trigger: { environment: 'cases' },
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
