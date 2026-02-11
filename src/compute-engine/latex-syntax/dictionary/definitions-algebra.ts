import type { LatexDictionary } from '../types';

export const DEFINITIONS_ALGEBRA: LatexDictionary = [
  {
    name: 'To',
    latexTrigger: ['\\to'],
    kind: 'infix',
    precedence: 270, // MathML rightwards arrow
  },
  {
    // Non-strict mode: -> for maps-to arrow
    latexTrigger: ['-', '>'],
    kind: 'infix',
    precedence: 270,
    parse: (parser, lhs, until) => {
      if (parser.options.strict !== false) return null;
      const rhs = parser.parseExpression({ ...until, minPrec: 270 });
      if (rhs === null) return null;
      return ['To', lhs, rhs];
    },
  },
];
