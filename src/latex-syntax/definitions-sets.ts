import { LatexDictionary } from './public';

export const DEFINITIONS_SETS: LatexDictionary<any> = [
  // Sets
  { trigger: { symbol: '\\N' }, parse: 'NaturalNumber' },
  { trigger: { symbol: '\\Z' }, parse: 'Integer' },
  { trigger: { symbol: '\\Q' }, parse: 'RationalNumber' },
  {
    trigger: { symbol: ['\\mathbb', '<{>', 'A', '<}>'] },
    parse: 'AlgebraicNumber',
  },
  { trigger: { symbol: '\\R' }, parse: 'RealNumber' },
  { trigger: { symbol: '\\C' }, parse: 'ComplexNumber' },
  { trigger: { symbol: '\\varnothing' }, parse: 'EmptySet' },
  { trigger: { symbol: '\\emptyset' }, parse: 'EmptySet' },

  {
    name: 'Complement',
    trigger: { infix: '\\complement' },
    precedence: 240,
  },

  {
    name: 'Element',
    trigger: { infix: '\\in' },
    precedence: 240,
  },
  {
    name: 'Intersection',
    trigger: { infix: '\\Cap' },
    precedence: 350,
  },

  {
    name: 'NotElement',
    trigger: { infix: '\\notin' },
    precedence: 240,
  },
  {
    name: 'SetMinus',
    trigger: { infix: '\\setminus' },
    precedence: 650,
  },
  {
    name: 'SubsetEqual',
    trigger: { infix: '\\subseteq' },
    precedence: 240,
  },
  {
    name: 'SymmetricDifference',
    trigger: { infix: '\\triangle' }, // or \\ominus
    precedence: 260,
  },
  {
    name: 'Union',
    trigger: { infix: '\\cup' },
    precedence: 350,
  },
  {
    name: 'Contains',
    trigger: { infix: '\\ni' },
    associativity: 'right',
    precedence: 160, // As per MathML, lower precedence
  },
  {
    name: 'Subset',
    trigger: { infix: '\\subset' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SquareSubset', // MathML: square image of
    trigger: { infix: '\\sqsubset' },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'SquareSubsetEqual', // MathML: square image of or equal to
    trigger: { infix: '\\sqsubseteq' },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'Superset',
    trigger: { infix: '\\supset' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SquareSuperset', // MathML: square original of
    trigger: { infix: '\\sqsupset' },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'SquareSupersetEqual', // MathML: square original of or equal
    trigger: { infix: '\\sqsupseteq' },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'NotSubset',
    trigger: { infix: '\\nsubset' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'NotSuperset',
    trigger: { infix: '\\nsupset' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SupersetEqual',
    trigger: { infix: '\\supseteq' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'NotSubsetNotEqual',
    trigger: { infix: '\\nsubseteq' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'NotSupersetNotEqual',
    trigger: { infix: '\\nsupseteq' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SubsetNotEqual',
    trigger: { infix: '\\subsetneq' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SubsetNotEqual',
    trigger: { infix: '\\varsupsetneqq' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SupersetNotEqual',
    trigger: { infix: '\\supsetneq' },
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SupersetNotEqual',
    trigger: { infix: '\\varsupsetneq' },
    associativity: 'right',
    precedence: 240,
  },
];
