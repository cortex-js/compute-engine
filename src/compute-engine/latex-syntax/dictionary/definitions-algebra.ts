import { LatexDictionary } from '../public';

export const DEFINITIONS_ALGEBRA: LatexDictionary = [
  {
    name: 'To',
    trigger: ['\\to'],
    kind: 'infix',
    precedence: 270, // MathML rightwards arrow
  },
];
