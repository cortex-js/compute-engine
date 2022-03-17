import { LatexDictionary, Serializer } from '../public';

import { LIST, op, head, tail, getSequence } from '../../../math-json/utils';
import { Expression } from '../../../math-json/math-json-format';

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
    precedence: 265,
    // @todo: check lhs and rhs are functions
  },
  {
    name: 'Transpose',
    trigger: ['^', 'T'],
    kind: 'infix',
    // @todo: if lhs is a list/tensor
  },
  {
    // @todo: if lhs is a list/tensor
    name: 'ConjugateTranspose',
    trigger: ['^', 'H'],
    kind: 'infix',
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
    parse: (parser) => {
      let done = false;
      let sup: Expression | null = 'Nothing';
      let sub: Expression | null = 'Nothing';
      while (!done) {
        parser.skipSpace();
        if (parser.match('_')) {
          sub = parser.matchRequiredLatexArgument();
        } else if (parser.match('^')) {
          sup = parser.matchRequiredLatexArgument();
        } else {
          done = true;
        }
      }
      const seq = getSequence(sub);
      if (seq) sub = [LIST, ...seq];

      if (!sub || !sup) return null;
      let rhs = parser.matchRequiredLatexArgument() ?? 'Nothing';
      if (rhs !== 'Nothing') {
        const arg = parser.matchArguments('group') ?? 'Nothing';
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
        if (head(vars) === LIST) {
          result +=
            '_{' + serializer.serialize(['Sequence', ...tail(vars)]) + '}';
        } else {
          result += '_{' + serializer.serialize(vars) + '}';
        }
      }
      if (degree !== null && degree !== 'Nothing') {
        result += '^{' + serializer.serialize(degree) + '}';
      }
      if (fn !== null && fn !== 'Nothing') {
        result += serializer.serialize(fn);
      }
      return result;
    },
    precedence: 740,
  },
  {
    name: 'OverBar',
    trigger: ['\\overline'],
    requiredLatexArg: 1,
  },
  {
    name: 'UnderBar',
    trigger: ['\\underline'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverVector',
    trigger: ['\\vec'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverTilde',
    trigger: ['\\tilde'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverHat',
    trigger: ['\\hat'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverRightArrow',
    trigger: ['\\overrightarrow'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverLeftArrow',
    trigger: ['\\overleftarrow'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverRightDoubleArrow',
    trigger: ['\\Overrightarrow'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverLeftHarpoon',
    trigger: ['\\overleftharpoon'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverRightHarpoon',
    trigger: ['\\overrightharpoon'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverLeftRightArrow',
    trigger: ['\\overleftrightarrow'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverBrace',
    trigger: ['\\overbrace'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverLineSegment',
    trigger: ['\\overlinesegment'],
    requiredLatexArg: 1,
  },
  {
    name: 'OverGroup',
    trigger: ['\\overgroup'],
    requiredLatexArg: 1,
  },

  // {
  //     name: '',
  //     trigger: '\\mathring',
  //     requiredLatexArg: 1,
  // },
  // {
  //     name: '',
  //     trigger: '\\check',
  //     requiredLatexArg: 1,
  // },
];

// https://reference.wolfram.com/language/tutorial/TextualInputAndOutput.html
