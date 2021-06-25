import { Expression } from '../public';
import { LatexDictionary, LatexString, Serializer } from './public';

export const DEFINITIONS_SETS: LatexDictionary<any> = [
  // Sets
  {
    name: 'AlgebraicNumber',
    trigger: { symbol: ['\\mathbb', '<{>', 'A', '<}>'] },
  },
  { name: 'ComplexNumber', trigger: { symbol: '\\C' } },

  { trigger: { symbol: '\\varnothing' }, parse: 'EmptySet' }, // Parsing only
  { name: 'EmptySet', trigger: { symbol: '\\emptyset' } },

  {
    name: 'Complement',
    trigger: { infix: '\\complement' },
    precedence: 240,
  },
  {
    name: 'Contains',
    trigger: { infix: '\\ni' },
    associativity: 'right',
    precedence: 160, // As per MathML, lower precedence
  },

  {
    name: 'Element',
    trigger: { infix: '\\in' },
    precedence: 240,
  },
  { name: 'Integer', trigger: { symbol: '\\Z' } },
  {
    name: 'Intersection',
    trigger: { infix: '\\Cap' },
    precedence: 350,
  },
  { name: 'NaturalNumber', trigger: { symbol: '\\N' } },

  {
    name: 'NotElement',
    trigger: { infix: '\\notin' },
    precedence: 240,
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
  { name: 'RationalNumber', trigger: { symbol: '\\Q' } },
  { name: 'RealNumber', trigger: { symbol: '\\R' } },
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
  {
    name: 'TranscendentalNumber',
    trigger: { symbol: ['\\mathbb', '<{>', 'T', '<}>'] },
  },
  {
    name: 'Union',
    trigger: { infix: '\\cup' },
    precedence: 350,
  },
];

function serializeInterval(
  _serializer: Serializer,
  _style: 'radical' | 'quotient' | 'solidus',
  _expr: Expression | null
): LatexString {
  return '';
}
