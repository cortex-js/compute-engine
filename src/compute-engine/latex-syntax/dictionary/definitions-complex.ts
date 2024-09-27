import { LatexDictionary } from '../public.ts';

export const DEFINITIONS_COMPLEX: LatexDictionary = [
  {
    name: 'Real',
    kind: 'function',
    latexTrigger: ['\\Re'],
  },
  {
    name: 'Imaginary',
    kind: 'function',
    latexTrigger: ['\\Im'],
  },
  {
    name: 'Argument',
    kind: 'function',
    latexTrigger: ['\\arg'],
  },
  {
    name: 'Conjugate',
    latexTrigger: ['^', '\\star'],
    kind: 'postfix',
  },
];
