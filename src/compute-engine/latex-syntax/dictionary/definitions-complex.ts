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
  // Function-style aliases: `\operatorname{real}(z)` and
  // `\operatorname{imag}(z)`, the spellings Desmos writes for the real and
  // imaginary parts. Parse-only: `Real` and `Imaginary` keep serializing as
  // `\Re` and `\Im`.
  {
    symbolTrigger: 'real',
    kind: 'function',
    parse: 'Real',
    arguments: 'implicit',
  },
  {
    symbolTrigger: 'imag',
    kind: 'function',
    parse: 'Imaginary',
    arguments: 'implicit',
  },
  {
    name: 'Conjugate',
    latexTrigger: ['^', '\\star'],
    kind: 'postfix',
  },
  // Function-style alias: `\operatorname{conj}(z)`, the spelling Desmos writes
  // for the complex conjugate. Without it `conj` lexed as an undeclared symbol:
  // `\operatorname{conj}(z)` was the product `conj·z`, and over a list argument
  // it was an unknown function, which does not broadcast. Parse-only:
  // `Conjugate` keeps serializing as `z^\star`.
  {
    symbolTrigger: 'conj',
    kind: 'function',
    parse: 'Conjugate',
    arguments: 'implicit',
  },
];
