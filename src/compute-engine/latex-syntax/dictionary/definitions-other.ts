import { LatexDictionary, Parser, Serializer } from '../public';

import {
  op,
  head,
  getSequence,
  dictionary,
  stringValue,
  machineValue,
  ops,
  isEmptySequence,
} from '../../../math-json/utils';
import { Expression } from '../../../math-json/math-json-format';
import { joinLatex } from '../tokenizer';

function parseSingleArg(cmd: string): (parser: Parser) => Expression {
  return (parser) => {
    const arg = parser.parseGroup();
    return arg === null ? [cmd] : [cmd, arg];
  };
}

export const DEFINITIONS_OTHERS: LatexDictionary = [
  {
    name: 'Overscript',
    trigger: ['\\overset'],
    kind: 'infix',
    precedence: 700, // @todo: not in MathML
  },
  {
    name: 'Underscript',
    trigger: ['\\underset'],
    kind: 'infix',
    precedence: 700, // @todo: not in MathML
  },
  {
    name: 'Increment',
    trigger: ['+', '+'],
    kind: 'postfix',
    precedence: 880,
  },
  {
    name: 'Decrement',
    trigger: ['-', '-'],
    kind: 'postfix',
    precedence: 880,
  },
  {
    name: 'PreIncrement',
    trigger: ['+', '+'],
    kind: 'prefix',
    precedence: 880,
  },
  {
    name: 'PreDecrement',
    trigger: ['-', '-'],
    kind: 'prefix',
    precedence: 880,
  },
  {
    name: 'Ring', // Aka 'Composition', i.e. function composition
    trigger: ['\\circ'],
    kind: 'infix',
    precedence: 265, // @todo: MathML is 950
    // @todo: check lhs and rhs are functions
  },
  {
    name: 'Transpose',
    trigger: ['^', 'T'],
    kind: 'postfix',
    // @todo: if lhs is a list/tensor
  },
  {
    // @todo: if lhs is a list/tensor
    name: 'ConjugateTranspose',
    trigger: ['^', 'H'],
    kind: 'postfix',
  },
  {
    name: 'StringJoin', // @todo From Mathematica...?
    trigger: ['\\lt', '\\gt'],
    kind: 'infix',
    precedence: 780,
  },
  {
    name: 'Starstar',

    trigger: ['\\star', '\\star'],
    kind: 'infix',
    precedence: 780,
  },
  {
    // Partial derivative using a variation of the Euler notation: `∂_xf(x)`
    // (the Euler notation uses `D_1f(x)` where "1" is for the first variable
    // For the Leibniz notation see 'Divide' that handles `∂f/∂x`
    name: 'PartialDerivative', // PartialDerivative(expr, {lists of vars}, degree)
    trigger: ['\\partial'],
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
      if (rhs !== 'Nothing' && !isEmptySequence(rhs)) {
        const arg = parser.parseArguments() ?? ['Nothing'];
        rhs = [rhs, ...arg];
      }
      return ['PartialDerivative', rhs, sub, sup] as Expression;
    },
    serialize: (serializer: Serializer, expr: Expression): string => {
      let result = '\\partial';
      const fn = op(expr, 1);
      const vars = op(expr, 2);
      const degree = op(expr, 3);
      if (vars !== null && vars !== 'Nothing') {
        if (head(vars) === 'List') {
          result +=
            '_{' +
            serializer.serialize(['Sequence', ...(ops(vars) ?? [])]) +
            '}';
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
    trigger: ['\\overline'],
    parse: parseSingleArg('OverBar'),
  },
  {
    name: 'UnderBar',
    trigger: ['\\underline'],
    parse: parseSingleArg('UnderBar'),
  },
  {
    name: 'OverVector',
    trigger: ['\\vec'],
    parse: parseSingleArg('OverVector'),
  },
  {
    name: 'OverTilde',
    trigger: ['\\tilde'],
    parse: parseSingleArg('OverTilde'),
  },
  {
    name: 'OverHat',
    trigger: ['\\hat'],
    parse: parseSingleArg('OverHat'),
  },
  {
    name: 'OverRightArrow',
    trigger: ['\\overrightarrow'],
    parse: parseSingleArg('OverRightArrow'),
  },
  {
    name: 'OverLeftArrow',
    trigger: ['\\overleftarrow'],
    parse: parseSingleArg('OverLeftArrow'),
  },
  {
    name: 'OverRightDoubleArrow',
    trigger: ['\\Overrightarrow'],
    parse: parseSingleArg('OverRightDoubleArrow'),
  },
  {
    name: 'OverLeftHarpoon',
    trigger: ['\\overleftharpoon'],
    parse: parseSingleArg('OverLeftHarpoon'),
  },
  {
    name: 'OverRightHarpoon',
    trigger: ['\\overrightharpoon'],
    parse: parseSingleArg('OverRightHarpoon'),
  },
  {
    name: 'OverLeftRightArrow',
    trigger: ['\\overleftrightarrow'],
    parse: parseSingleArg('OverLeftRightArrow'),
  },
  {
    name: 'OverBrace',
    trigger: ['\\overbrace'],
    parse: parseSingleArg('OverBrace'),
  },
  {
    name: 'OverLineSegment',
    trigger: ['\\overlinesegment'],
    parse: parseSingleArg('OverLineSegment'),
  },
  {
    name: 'OverGroup',
    trigger: ['\\overgroup'],
    parse: parseSingleArg('OverGroup'),
  },

  {
    trigger: ['\\displaystyle'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\textstyle'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\scriptstyle'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\scriptscriptstyle'],
    parse: () => ['Sequence'] as Expression,
  },

  {
    trigger: ['\\tiny'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\scriptsize'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\footnotesize'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\small'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\normalsize'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\large'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\Large'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\LARGE'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\huge'],
    parse: () => ['Sequence'] as Expression,
  },
  {
    trigger: ['\\Huge'],
    parse: () => ['Sequence'] as Expression,
  },

  {
    name: 'Style',
    serialize: (serializer, expr): string => {
      let result = serializer.serialize(op(expr, 1));

      const dict = dictionary(op(expr, 2));
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
    trigger: ['\\!'],
    parse: () => ['HorizontalSpacing', -3] as Expression,
  },
  {
    trigger: ['\\ '],
    parse: () => ['HorizontalSpacing', 6] as Expression,
  },
  {
    trigger: ['\\:'],
    parse: () => ['HorizontalSpacing', 4] as Expression,
  },
  {
    trigger: ['\\enskip'],
    parse: () => ['HorizontalSpacing', 9] as Expression,
  },
  {
    trigger: ['\\quad'],
    parse: () => ['HorizontalSpacing', 18] as Expression,
  },
  {
    trigger: ['\\qquad'],
    parse: () => ['HorizontalSpacing', 36] as Expression,
  },
  {
    trigger: ['\\,'],
    parse: () => ['HorizontalSpacing', 3] as Expression,
  },
  {
    trigger: ['\\;'],
    parse: () => ['HorizontalSpacing', 5] as Expression,
  },
  {
    trigger: ['\\enspace'],
    parse: () => ['HorizontalSpacing', 9] as Expression,
  },
  {
    name: 'HorizontalSpacing',
    // The `HorizontalSpacing` function has two forms
    // `["HorizontalSpacing", number]` -> indicate a space of mu units
    // `["HorizontalSpacing", expr, 'op'|'bin'|rel]` -> indicate a spacing around and expression, i.e. `\mathbin{x}`, etc...
    serialize: (serializer, expr): string => {
      if (op(expr, 2)) {
        // @todo: handle op(expr,2) == 'op', 'bin', etc...
        return serializer.serialize(op(expr, 1));
      }

      const v = machineValue(op(expr, 1));
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
