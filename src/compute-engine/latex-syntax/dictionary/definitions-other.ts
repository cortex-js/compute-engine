import { LatexDictionary, Parser, Serializer } from '../public.ts';

import {
  operand,
  operator,
  getSequence,
  dictionary,
  stringValue,
  machineValue,
  operands,
  isEmptySequence,
  symbol,
} from '../../../math-json/utils.ts';
import { Expression, MathJsonIdentifier } from '../../../math-json/types.ts';
import { joinLatex } from '../tokenizer.ts';

function parseSingleArg(cmd: string): (parser: Parser) => Expression {
  return (parser) => {
    const arg = parser.parseGroup();
    return arg === null ? [cmd] : [cmd, arg];
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
      return ['Decrement', lhs];
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
      return ['Decrement', lhs];
    },
  },
  {
    name: 'PreIncrement',
    latexTrigger: ['+', '+'],
    kind: 'prefix',
    precedence: 880,
    parse: (parser, until): Expression | null => {
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
    parse: (parser, until): Expression | null => {
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
      let sup: Expression | null = 'Nothing';
      let sub: Expression | null = 'Nothing';
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
        rhs = [rhs as MathJsonIdentifier, ...args];
      }
      return ['PartialDerivative', rhs, sub, sup] as Expression;
    },
    serialize: (serializer: Serializer, expr: Expression): string => {
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
    latexTrigger: ['\\displaystyle'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\textstyle'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\scriptstyle'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\scriptscriptstyle'],
    parse: () => 'Nothing',
  },

  {
    latexTrigger: ['\\tiny'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\scriptsize'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\footnotesize'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\small'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\normalsize'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\large'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\Large'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\LARGE'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\huge'],
    parse: () => 'Nothing',
  },
  {
    latexTrigger: ['\\Huge'],
    parse: () => 'Nothing',
  },

  {
    name: 'Style',
    serialize: (serializer, expr): string => {
      let result = serializer.serialize(operand(expr, 1));

      const dict = dictionary(operand(expr, 2));
      if (dict === null) return result;

      if (stringValue(dict.display) === 'block')
        result = joinLatex(['{\\displaystyle', result, '}']);
      else if (stringValue(dict.display) === 'inline')
        result = joinLatex(['{\\textstyle', result, '}']);
      else if (stringValue(dict.display) === 'script')
        result = joinLatex(['{\\scriptstyle', result, '}']);
      else if (stringValue(dict.display) === 'scriptscript')
        result = joinLatex(['{\\scriptscriptstyle', result, '}']);

      const v = machineValue(dict.size);
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
      return result;
    },
  },
  {
    latexTrigger: ['\\!'],
    parse: () => ['HorizontalSpacing', -3] as Expression,
  },
  {
    latexTrigger: ['\\ '],
    parse: () => ['HorizontalSpacing', 6] as Expression,
  },
  {
    latexTrigger: ['\\:'],
    parse: () => ['HorizontalSpacing', 4] as Expression,
  },
  {
    latexTrigger: ['\\enskip'],
    parse: () => ['HorizontalSpacing', 9] as Expression,
  },
  {
    latexTrigger: ['\\quad'],
    parse: () => ['HorizontalSpacing', 18] as Expression,
  },
  {
    latexTrigger: ['\\qquad'],
    parse: () => ['HorizontalSpacing', 36] as Expression,
  },
  {
    latexTrigger: ['\\,'],
    parse: () => ['HorizontalSpacing', 3] as Expression,
  },
  {
    latexTrigger: ['\\;'],
    parse: () => ['HorizontalSpacing', 5] as Expression,
  },
  {
    latexTrigger: ['\\enspace'],
    parse: () => ['HorizontalSpacing', 9] as Expression,
  },
  {
    name: 'HorizontalSpacing',
    // The `HorizontalSpacing` function has two forms
    // `["HorizontalSpacing", number]` -> indicate a space of mu units
    // `["HorizontalSpacing", expr, 'op'|'bin'|rel]` -> indicate a spacing around and expression, i.e. `\mathbin{x}`, etc...
    serialize: (serializer, expr): string => {
      if (operand(expr, 2) !== null) {
        // @todo: handle op(expr,2) == 'op', 'bin', etc...
        return serializer.serialize(operand(expr, 1));
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
