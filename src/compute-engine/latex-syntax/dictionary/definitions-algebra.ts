import type { LatexDictionary } from '../types';

export const DEFINITIONS_ALGEBRA: LatexDictionary = [
  {
    name: 'To',
    latexTrigger: ['\\to'],
    kind: 'infix',
    precedence: 270, // MathML rightwards arrow
  },
  {
    latexTrigger: ['\\rightarrow'],
    kind: 'infix',
    precedence: 270, // MathML rightwards arrow
    parse: 'To',
  },
];
