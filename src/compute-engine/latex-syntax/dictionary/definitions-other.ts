import type { LatexDictionary, Parser, Serializer } from '../types';

import {
  operand,
  operator,
  getSequence,
  dictionaryFromExpression,
  machineValue,
  operands,
  isEmptySequence,
  stringValue,
  symbol,
} from '../../../math-json/utils';
import { MathJsonExpression, MathJsonSymbol } from '../../../math-json/types';
import { joinLatex } from '../tokenizer';

// TeX dimension units (each letter is a separate token from the tokenizer)
const TEX_UNITS = [
  'pt', 'em', 'mu', 'ex', 'mm', 'cm', 'in', 'bp', 'sp', 'dd', 'cc', 'pc',
  'nc', 'nd',
];

/** Skip an inline TeX dimension (e.g., `3mu`, `-5pt`, `0.5em`).
 *  Used to consume arguments of `\hskip` and `\kern`.
 *  Each character is a separate token from the tokenizer. */
function skipTexDimension(parser: Parser): void {
  parser.skipSpace();
  // Skip optional sign
  if (parser.peek === '-' || parser.peek === '+') parser.nextToken();
  // Skip digits and decimal point
  while (/^[\d.]$/.test(parser.peek)) parser.nextToken();
  // Try to match a known two-letter TeX unit
  // Peek at the next two tokens to see if they form a known unit
  for (const unit of TEX_UNITS) {
    if (parser.matchAll([...unit])) return;
  }
}

function parseSingleArg(cmd: string): (parser: Parser) => MathJsonExpression {
  return (parser) => {
    const arg = parser.parseGroup();
    return arg === null ? [cmd] : [cmd, arg];
  };
}

/** Parse a LaTeX "switch" command that sets a math style for everything
 *  following it in the current group (e.g. `{\displaystyle x+y}`). */
function parseMathStyleSwitch(
  mathStyle: string
): (parser: Parser) => MathJsonExpression {
  return (parser) => {
    const body = parser.parseExpression();
    if (body !== null && !isEmptySequence(body))
      return ['Annotated', body, { dict: { mathStyle } }];
    return 'Nothing';
  };
}

/** Parse a LaTeX "switch" command that sets a font size for everything
 *  following it in the current group (e.g. `{\large x+y}`). */
function parseSizeSwitch(
  size: number
): (parser: Parser) => MathJsonExpression {
  return (parser) => {
    const body = parser.parseExpression();
    if (body !== null && !isEmptySequence(body))
      return ['Annotated', body, { dict: { size } }];
    return 'Nothing';
  };
}

export const DEFINITIONS_OTHERS: LatexDictionary = [
  {
    name: 'Overscript',
    latexTrigger: ['\\overset'],
    kind: 'infix',
    precedence: 700, // @todo: not in MathML
  },
  {
    name: 'Underscript',
    latexTrigger: ['\\underset'],
    kind: 'infix',
    precedence: 700, // @todo: not in MathML
  },
  {
    name: 'Increment',
    latexTrigger: ['+', '+'],
    kind: 'postfix',
    precedence: 880,
    parse: (_parser, lhs) => {
      // If lhs is not a symbol, ignore it, i.e. "5++"
      if (symbol(lhs) === null) return null;
      return ['Increment', lhs] as MathJsonExpression;
    },
  },
  {
    name: 'Decrement',
    latexTrigger: ['-', '-'],
    kind: 'postfix',
    precedence: 880,
    parse: (_parser, lhs) => {
      // If lhs is not a symbol, ignore it, i.e. "5--"
      if (symbol(lhs) === null) return null;
      return ['Decrement', lhs] as MathJsonExpression;
    },
  },
  {
    name: 'PreIncrement',
    latexTrigger: ['+', '+'],
    kind: 'prefix',
    precedence: 880,
    parse: (parser, until): MathJsonExpression | null => {
      const rhs = parser.parseExpression(until);
      if (symbol(rhs) === null) return null;
      return ['PreIncrement', rhs!];
    },
  },
  {
    name: 'PreDecrement',
    latexTrigger: ['-', '-'],
    kind: 'prefix',
    precedence: 880,
    parse: (parser, until): MathJsonExpression | null => {
      const rhs = parser.parseExpression(until);
      if (symbol(rhs) === null) return null;
      return ['PreDecrement', rhs!];
    },
  },
  {
    name: 'Ring', // Aka 'Composition', i.e. function composition
    latexTrigger: ['\\circ'],
    kind: 'infix',
    precedence: 265, // @todo: MathML is 950
    // @todo: check lhs and rhs are functions
  },
  {
    name: 'StringJoin', // @todo From Mathematica...?
    latexTrigger: ['\\lt', '\\gt'],
    kind: 'infix',
    precedence: 780,
  },
  {
    name: 'Starstar',

    latexTrigger: ['\\star', '\\star'],
    kind: 'infix',
    precedence: 780,
  },
  {
    // Partial derivative using a variation of the Euler notation: `∂_xf(x)`
    // (the Euler notation uses `D_1f(x)` where "1" is for the first variable
    // For the Leibniz notation see 'Divide' that handles `∂f/∂x`
    name: 'PartialDerivative', // PartialDerivative(expr, {lists of vars}, degree)
    latexTrigger: ['\\partial'],
    kind: 'prefix',
    parse: (parser: Parser) => {
      let done = false;
      let sup: MathJsonExpression | null = 'Nothing';
      let sub: MathJsonExpression | null = 'Nothing';
      while (!done) {
        parser.skipSpace();
        if (parser.match('_')) {
          sub = parser.parseGroup() ?? parser.parseToken();
        } else if (parser.match('^')) {
          sup = parser.parseGroup() ?? parser.parseToken();
        } else {
          done = true;
        }
      }
      const seq = getSequence(sub);
      if (seq) sub = ['List', ...seq];

      if (sub === null || sup === null) return null;
      let rhs = parser.parseGroup() ?? 'Nothing';
      if (!isEmptySequence(rhs)) {
        const args = parser.parseArguments() ?? ['Nothing'];
        rhs = [rhs as MathJsonSymbol, ...args];
      }
      return ['PartialDerivative', rhs, sub, sup] as MathJsonExpression;
    },
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      let result = '\\partial';
      const fn = operand(expr, 1);
      const vars = operand(expr, 2);
      const degree = operand(expr, 3);
      if (vars !== null && vars !== 'Nothing') {
        if (operator(vars) === 'List') {
          result +=
            '_{' + serializer.serialize(['Sequence', ...operands(vars)]) + '}';
        } else {
          result += '_{' + serializer.serialize(vars) + '}';
        }
      }

      if (degree !== null && degree !== 'Nothing')
        result += '^{' + serializer.serialize(degree) + '}';

      if (fn !== null && fn !== 'Nothing') result += serializer.serialize(fn);

      return result;
    },
    precedence: 740,
  },
  {
    name: 'OverBar',
    latexTrigger: ['\\overline'],
    parse: parseSingleArg('OverBar'),
  },
  {
    name: 'UnderBar',
    latexTrigger: ['\\underline'],
    parse: parseSingleArg('UnderBar'),
  },
  {
    name: 'OverVector',
    latexTrigger: ['\\vec'],
    parse: parseSingleArg('OverVector'),
  },
  {
    name: 'OverTilde',
    latexTrigger: ['\\tilde'],
    parse: parseSingleArg('OverTilde'),
  },
  {
    name: 'OverHat',
    latexTrigger: ['\\hat'],
    parse: parseSingleArg('OverHat'),
  },
  {
    name: 'OverRightArrow',
    latexTrigger: ['\\overrightarrow'],
    parse: parseSingleArg('OverRightArrow'),
  },
  {
    name: 'OverLeftArrow',
    latexTrigger: ['\\overleftarrow'],
    parse: parseSingleArg('OverLeftArrow'),
  },
  {
    name: 'OverRightDoubleArrow',
    latexTrigger: ['\\Overrightarrow'],
    parse: parseSingleArg('OverRightDoubleArrow'),
  },
  {
    name: 'OverLeftHarpoon',
    latexTrigger: ['\\overleftharpoon'],
    parse: parseSingleArg('OverLeftHarpoon'),
  },
  {
    name: 'OverRightHarpoon',
    latexTrigger: ['\\overrightharpoon'],
    parse: parseSingleArg('OverRightHarpoon'),
  },
  {
    name: 'OverLeftRightArrow',
    latexTrigger: ['\\overleftrightarrow'],
    parse: parseSingleArg('OverLeftRightArrow'),
  },
  {
    name: 'OverBrace',
    latexTrigger: ['\\overbrace'],
    parse: parseSingleArg('OverBrace'),
  },
  {
    name: 'OverLineSegment',
    latexTrigger: ['\\overlinesegment'],
    parse: parseSingleArg('OverLineSegment'),
  },
  {
    name: 'OverGroup',
    latexTrigger: ['\\overgroup'],
    parse: parseSingleArg('OverGroup'),
  },

  {
    latexTrigger: ['\\textcolor'],
    parse: (parser: Parser): MathJsonExpression => {
      const pos = parser.index;
      const color = parser.parseStringGroup();
      const body = parser.parseGroup();
      if (color !== null) {
        if (body !== null) return ['Annotated', body, { dict: { color } }];
        return 'Nothing';
      }
      // We had an opening `\textcolor` but no closing `}`
      // We return the `\textcolor` command as a string
      parser.index = pos;
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\colorbox'],
    parse: (parser: Parser): MathJsonExpression => {
      const pos = parser.index;
      const backgroundColor = parser.parseStringGroup();
      const body = parser.parseGroup();
      if (backgroundColor !== null) {
        if (body !== null)
          return ['Annotated', body, { dict: { backgroundColor } }];
        return 'Nothing';
      }
      parser.index = pos;
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\boxed'],
    parse: (parser: Parser): MathJsonExpression => {
      const body = parser.parseGroup();
      if (body !== null) return ['Annotated', body, { dict: { border: true } }];
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\displaystyle'],
    parse: parseMathStyleSwitch('normal'),
  },
  {
    latexTrigger: ['\\textstyle'],
    parse: parseMathStyleSwitch('compact'),
  },
  {
    latexTrigger: ['\\scriptstyle'],
    parse: parseMathStyleSwitch('script'),
  },
  {
    latexTrigger: ['\\scriptscriptstyle'],
    parse: parseMathStyleSwitch('scriptscript'),
  },
  {
    latexTrigger: ['\\color'],
    parse: (parser: Parser): MathJsonExpression => {
      const color = parser.parseStringGroup();
      if (color !== null) {
        const body = parser.parseExpression();
        if (body !== null && !isEmptySequence(body))
          return ['Annotated', body, { dict: { color } }];
      }
      return 'Nothing';
    },
  },

  {
    latexTrigger: ['\\tiny'],
    parse: parseSizeSwitch(1),
  },
  {
    latexTrigger: ['\\scriptsize'],
    parse: parseSizeSwitch(2),
  },
  {
    latexTrigger: ['\\footnotesize'],
    parse: parseSizeSwitch(3),
  },
  {
    latexTrigger: ['\\small'],
    parse: parseSizeSwitch(4),
  },
  {
    latexTrigger: ['\\normalsize'],
    parse: parseSizeSwitch(5),
  },
  {
    latexTrigger: ['\\large'],
    parse: parseSizeSwitch(6),
  },
  {
    latexTrigger: ['\\Large'],
    parse: parseSizeSwitch(7),
  },
  {
    latexTrigger: ['\\LARGE'],
    parse: parseSizeSwitch(8),
  },
  {
    latexTrigger: ['\\huge'],
    parse: parseSizeSwitch(9),
  },
  {
    latexTrigger: ['\\Huge'],
    parse: parseSizeSwitch(10),
  },

  {
    name: 'Annotated',
    serialize: (serializer, expr): string => {
      let result = serializer.serialize(operand(expr, 1));

      const dict = dictionaryFromExpression(operand(expr, 2));
      if (dict === null || dict === undefined) return result;

      //
      // Display: "math style"
      //
      if (dict.dict.mathStyle === 'normal')
        result = joinLatex(['{\\displaystyle', result, '}']);
      else if (dict.dict.mathStyle === 'compact')
        result = joinLatex(['{\\textstyle', result, '}']);
      else if (dict.dict.mathStyle === 'script')
        result = joinLatex(['{\\scriptstyle', result, '}']);
      else if (dict.dict.mathStyle === 'scriptscript')
        result = joinLatex(['{\\scriptscriptstyle', result, '}']);

      //
      // Font Size
      //
      const v = dict.dict.size as number;
      if (v !== null && v >= 1 && v <= 10) {
        result = joinLatex([
          '{',
          {
            1: '\\tiny',
            2: '\\scriptsize',
            3: '\\footnotesize',
            4: '\\small',
            5: '\\normalsize',
            6: '\\large',
            7: '\\Large',
            8: '\\LARGE',
            9: '\\huge',
            10: '\\Huge',
          }[v]!,
          result,
          '}',
        ]);
      }

      //
      // Font family
      //
      if (dict.dict.fontFamily === 'monospace')
        result = joinLatex(['\\texttt{', result, '}']);
      else if (dict.dict.fontFamily === 'sans-serif')
        result = joinLatex(['\\textsf{', result, '}']);

      if (dict.dict.fontWeight === 'bold')
        result = joinLatex(['\\textbf{', result, '}']);

      if (dict.dict.fontStyle === 'italic')
        result = joinLatex(['\\textit{', result, '}']);
      else if (dict.dict.fontStyle === 'normal')
        result = joinLatex(['\\textup{', result, '}']);

      //
      // Color
      //
      if (dict.dict.color)
        result = joinLatex([
          '\\textcolor{',
          dict.dict.color as string,
          '}{',
          result,
          '}',
        ]);

      //
      // Background Color
      //
      if (dict.dict.backgroundColor)
        result = joinLatex([
          '\\colorbox{',
          dict.dict.backgroundColor as string,
          '}{',
          result,
          '}',
        ]);

      //
      // Border
      //
      if (dict.dict.border === true)
        result = joinLatex(['\\boxed{', result, '}']);

      //
      // Annotation
      //

      return result;
    },
  },
  {
    latexTrigger: ['\\!'],
    parse: () => ['HorizontalSpacing', -3] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\ '],
    parse: () => ['HorizontalSpacing', 6] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\:'],
    parse: () => ['HorizontalSpacing', 4] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\enskip'],
    parse: () => ['HorizontalSpacing', 9] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\quad'],
    parse: () => ['HorizontalSpacing', 18] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\qquad'],
    parse: () => ['HorizontalSpacing', 36] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\,'],
    parse: () => ['HorizontalSpacing', 3] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\;'],
    parse: () => ['HorizontalSpacing', 5] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\enspace'],
    parse: () => ['HorizontalSpacing', 9] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\hspace'],
    parse: (parser): MathJsonExpression => {
      if (parser.peek === '*') parser.nextToken();
      parser.parseStringGroup(); // consume the braced dimension argument
      return ['HorizontalSpacing', 0];
    },
  },
  {
    latexTrigger: ['\\hskip'],
    parse: (parser): MathJsonExpression => {
      skipTexDimension(parser);
      return ['HorizontalSpacing', 0];
    },
  },
  {
    latexTrigger: ['\\kern'],
    parse: (parser): MathJsonExpression => {
      skipTexDimension(parser);
      return ['HorizontalSpacing', 0];
    },
  },
  {
    latexTrigger: ['\\phantom'],
    parse: (parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\vphantom'],
    parse: (parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\hphantom'],
    parse: (parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\placeholder'],
    parse: (parser) => {
      parser.parseOptionalGroup();
      return parser.parseGroup() ?? 'Nothing';
    },
  },
  {
    latexTrigger: ['\\smash'],
    parse: (parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\strut'],
    parse: (_parser) => 'Nothing',
  },
  {
    latexTrigger: ['\\mathstrut'],
    parse: (_parser) => 'Nothing',
  },
  {
    name: 'HorizontalSpacing',
    // The `HorizontalSpacing` function has two forms
    // `["HorizontalSpacing", number]` -> indicate a space of mu units
    // `["HorizontalSpacing", expr, 'op'|'bin'|rel]` -> indicate a spacing around and expression, i.e. `\mathbin{x}`, etc...
    serialize: (serializer, expr): string => {
      if (operand(expr, 2) !== null) {
        const cls = stringValue(operand(expr, 2));
        const inner = serializer.serialize(operand(expr, 1));
        if (cls === 'bin') return `\\mathbin{${inner}}`;
        if (cls === 'op') return `\\mathop{${inner}}`;
        if (cls === 'rel') return `\\mathrel{${inner}}`;
        if (cls === 'ord') return `\\mathord{${inner}}`;
        if (cls === 'open') return `\\mathopen{${inner}}`;
        if (cls === 'close') return `\\mathclose{${inner}}`;
        if (cls === 'punct') return `\\mathpunct{${inner}}`;
        if (cls === 'inner') return `\\mathinner{${inner}}`;
        return inner;
      }

      const v = machineValue(operand(expr, 1));
      if (v === null) return '';
      return (
        {
          '-3': '\\!',
          6: '\\ ',
          3: '\\,',
          4: '\\:',
          5: '\\;',
          9: '\\enspace',
          18: '\\quad',
          36: '\\qquad',
        }[v] ?? ''
      );
    },
  },
  // if (
  //   [
  //     '\\!',
  //     '\\:',
  //     '\\enskip',
  //     '\\quad',
  //     '\\,',
  //     '\\;',
  //     '\\enspace',
  //     '\\qquad',
  //     '\\selectfont',
  //   ].includes(token)
  // ) {
  //   return 'skip';
  // }

  // {
  //     name: '',
  //     trigger: '\\mathring',
  // },
  // {
  //     name: '',
  //     trigger: '\\check',
  // },
];

// https://reference.wolfram.com/language/tutorial/TextualInputAndOutput.html
