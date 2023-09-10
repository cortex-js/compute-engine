import { LatexDictionary } from '../public';

// See https://en.wikipedia.org/wiki/List_of_logic_symbols

export const DEFINITIONS_LOGIC: LatexDictionary = [
  // Constants
  {
    name: 'True',
    kind: 'symbol',
    trigger: ['\\top'], // ⊤ U+22A4
  },
  {
    kind: 'symbol',
    trigger: '\\mathrm{True}',
    parse: 'True',
  },
  {
    kind: 'symbol',
    trigger: '\\operator{True}',
    parse: 'True',
  },
  {
    kind: 'symbol',
    trigger: '\\mathsf{T}',
    parse: 'True',
  },

  {
    name: 'False',
    kind: 'symbol',
    trigger: ['\\bot'], // ⊥ U+22A5
  },
  {
    kind: 'symbol',
    trigger: '\\operator{False}',
    parse: 'True',
  },
  {
    kind: 'symbol',
    trigger: '\\mathsf{F}',
    parse: 'True',
  },

  {
    name: 'Maybe',
    kind: 'symbol',
    trigger: '\\operatorname{Maybe}',
    serialize: '\\operatorname{Maybe}',
  },
  {
    kind: 'symbol',
    trigger: '\\mathrm{Maybe}',
    parse: 'Maybe',
  },

  // Operators
  {
    name: 'And',
    kind: 'infix',
    trigger: ['\\land'],
    precedence: 317,
    // serialize: '\\land',
  },
  { kind: 'infix', trigger: ['\\wedge'], parse: 'And', precedence: 317 },
  { kind: 'infix', trigger: '\\&', parse: 'And', precedence: 317 },
  {
    kind: 'infix',
    trigger: '\\operatorname{and}',
    parse: 'And',
    precedence: 317,
  },

  {
    name: 'Or',
    kind: 'infix',
    trigger: ['\\lor'],
    precedence: 310,
  },
  { kind: 'infix', trigger: ['\\vee'], parse: 'Or', precedence: 310 },
  { kind: 'infix', trigger: '\\parallel', parse: 'Or', precedence: 310 },
  {
    kind: 'infix',
    trigger: '\\operatorname{or}',
    parse: 'And',
    precedence: 310,
  },

  {
    name: 'Xor',
    kind: 'infix',
    trigger: ['\\veebar'],
    precedence: 315,
  },
  // Possible alt: \oplus ⊕ U+2295

  {
    name: 'Not',
    kind: 'prefix',
    trigger: ['\\lnot'],
    precedence: 880,
  },

  {
    name: 'Nand',
    kind: 'infix',
    trigger: ['\\barwedge'],
    precedence: 315,
    // serialize: '\\mid',
  },
  {
    name: 'Nor',
    kind: 'infix',
    trigger: ['\u22BD'], // bar vee
    precedence: 315,
    // serialize: '\\downarrow',
  },
  // Functions
  {
    kind: 'function',
    trigger: 'and',
    parse: 'And',
  },
  {
    kind: 'function',
    trigger: 'or',
    parse: 'Or',
  },
  {
    kind: 'function',
    trigger: 'not',
    parse: 'Not',
  },
  // Relations
  {
    name: 'Implies',
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    trigger: ['\\implies'],
    serialize: '\\implies',
  },
  {
    trigger: ['\\Rightarrow'],
    kind: 'infix',
    precedence: 220,
    associativity: 'right',
    parse: 'Implies',
  },

  {
    name: 'Equivalent', // MathML: identical to, Mathematica: Congruent
    trigger: ['\\iff'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
  },
  {
    trigger: ['\\Leftrightarrow'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: 'Equivalent',
  },
  {
    trigger: ['\\equiv'],
    kind: 'infix',
    associativity: 'right',
    precedence: 219,
    parse: 'Equivalent',
  },

  {
    name: 'Proves',
    kind: 'infix',
    trigger: ['\\vdash'],
    precedence: 220,
    associativity: 'right',
    serialize: '\\vdash',
  },
  {
    name: 'Entails',
    kind: 'infix',
    trigger: ['\\vDash'],
    precedence: 220,
    associativity: 'right',
    serialize: '\\vDash',
  },
  {
    name: 'Satisfies',
    kind: 'infix',
    trigger: ['\\models'],
    precedence: 220,
    associativity: 'right',
    serialize: '\\models',
  },
];
