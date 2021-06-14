import { LatexDictionary } from './public';

export const DEFINITIONS_SETS: LatexDictionary = [
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
    name: 'Subset',
    trigger: { infix: '\\subset' },
    precedence: 240,
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
];
