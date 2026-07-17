import { LatexDictionary } from '../types.js';

export const DEFINITIONS_COMPLEX: LatexDictionary = [
  {
    name: 'Real',
    kind: 'function',
    latexTrigger: ['\\Re'],
    arguments: 'implicit',
  },
  {
    name: 'Imaginary',
    kind: 'function',
    latexTrigger: ['\\Im'],
    arguments: 'implicit',
  },
  {
    name: 'Argument',
    kind: 'function',
    latexTrigger: ['\\arg'],
    arguments: 'implicit',
  },
  // Function-style alias: `\operatorname{arg}(z)`. Without it the head lexed as
  // a bare symbol, so `\operatorname{arg}(z)^2` was `arg·z²`. Call-binding
  // matches the native `\arg` command.
  {
    symbolTrigger: 'arg',
    kind: 'function',
    parse: 'Argument',
    arguments: 'implicit',
  },
  {
    name: 'Conjugate',
    latexTrigger: ['^', '\\star'],
    kind: 'postfix',
  },
];
