import { LatexDictionary } from './public';

export const DEFINITIONS_ALGEBRA: LatexDictionary<any> = [
  {
    name: 'To',
    trigger: { infix: ['\\to'] },
    precedence: 270, // MathML rightwards arrow
  },
];
