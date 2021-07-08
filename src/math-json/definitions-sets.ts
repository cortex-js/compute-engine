import { getArg, getArgCount, getFunctionName, getTail } from '../common/utils';
import { Expression } from './math-json-format';
import { joinLatex } from './core/tokenizer';
import { LatexDictionary, LatexString, Scanner, Serializer } from './public';

export const DEFINITIONS_SETS: LatexDictionary<any> = [
  // Constants
  { name: 'AlgebraicNumber', trigger: '\\mathbb{A}' },
  { name: 'ComplexNumber', trigger: ['\\C'] },
  { trigger: '\\mathbb{C}', parse: 'ComplexNumber' },
  { name: 'EmptySet', trigger: ['\\emptyset'] },
  { trigger: ['\\varnothing'], parse: 'EmptySet' }, // Parsing only
  { name: 'Integer', trigger: ['\\Z'] },
  { trigger: '\\mathbb{Z}', parse: 'Integer' },
  { name: 'RationalNumber', trigger: ['\\Q'] },
  { name: 'RealNumber', trigger: ['\\R'] },
  { name: 'TranscendentalNumber', trigger: '\\mathbb{T}' },

  // Real numbers < 0
  { name: 'NegativeNumber', trigger: '\\R^-' },
  { trigger: '\\R^{-}', parse: 'NegativeNumber' },
  { trigger: '\\R_-', parse: 'NegativeNumber' },
  { trigger: '\\R_{-}', parse: 'NegativeNumber' },
  { trigger: '\\R^{\\lt}', parse: 'NegativeNumber' },

  // Real numbers > 0
  { name: 'PositiveNumber', trigger: '\\R^+' },
  { trigger: '\\R^{+}', parse: 'PositiveNumber' },
  { trigger: '\\R_+', parse: 'PositiveNumber' },
  { trigger: '\\R_{+}', parse: 'PositiveNumber' },
  { trigger: '\\R^{\\gt}', parse: 'PositiveNumber' },

  // Real numbers <= 0
  { name: 'NonPositiveNumber', trigger: '\\R^{0-}' },
  { trigger: '\\R^{-0}', parse: 'NonPositiveNumber' },
  { trigger: '\\R^{\\leq}', parse: 'NonPositiveNumber' },

  // Integers < 0
  { name: 'NegativeInteger', trigger: '\\Z^-' },
  { trigger: '\\Z^-', parse: 'NegativeInteger' },
  { trigger: '\\Z^{-}', parse: 'NegativeInteger' },
  { trigger: '\\Z_-', parse: 'NegativeInteger' },
  { trigger: '\\Z_{-}', parse: 'NegativeInteger' },
  { trigger: '\\Z^{\\lt}', parse: 'NegativeInteger' },

  // Integers >  0
  { name: 'PositiveInteger', trigger: '\\Z^+' },
  { trigger: '\\Z^{+}', parse: 'PositiveInteger' },
  { trigger: '\\Z_+', parse: 'PositiveInteger' },
  { trigger: '\\Z_{+}', parse: 'PositiveInteger' },
  { trigger: '\\Z^{\\gt}', parse: 'PositiveInteger' },
  { trigger: '\\Z^{\\gt0}', parse: 'PositiveInteger' },
  { trigger: '\\N^+', parse: 'PositiveInteger' },
  { trigger: '\\N^{+}', parse: 'PositiveInteger' },
  { trigger: '\\N^*', parse: 'PositiveInteger' },
  { trigger: '\\N^{*}', parse: 'PositiveInteger' },
  { trigger: '\\N^\\star', parse: 'PositiveInteger' },
  { trigger: '\\N^{\\star}', parse: 'PositiveInteger' },
  { trigger: '\\N_1', parse: 'PositiveInteger' },
  { trigger: '\\N_{1}', parse: 'PositiveInteger' }, // https://mathvault.ca/hub/higher-math/math-symbols/algebra-symbols/

  // Integers >=  0
  { name: 'NonNegativeInteger', trigger: ['\\N'] },
  { trigger: '\\Z^{+0}', parse: 'NonNegativeInteger' },
  { trigger: '\\Z^{\\geq}', parse: 'NonNegativeInteger' },
  { trigger: '\\Z^{\\geq0}', parse: 'NonNegativeInteger' },
  { trigger: '\\Z^{0+}', parse: 'NonNegativeInteger' },
  { trigger: '\\mathbb{N}', parse: 'NonNegativeInteger' },
  { trigger: '\\N_0', parse: 'NonNegativeInteger' },
  { trigger: '\\N_{0}', parse: 'NonNegativeInteger' },

  //
  // Set Expressions
  //
  // @todo: could also have a `CartesianPower` function with a number `rhs`
  {
    name: 'CartesianProduct',
    trigger: ['\\times'],
    kind: 'infix',
    associativity: 'right', // Caution: cartesian product is not associative
    precedence: 390, // Same as Multiply?
    parse: (
      lhs: Expression,
      scanner: Scanner,
      _minPrec: number
    ): [Expression | null, Expression | null] => {
      // Since this is triggered on `\times` we have to be careful we only
      // accept arguments that are `Set`
      const ce = scanner.computeEngine;
      if (!ce || !ce.isSubsetOf(ce.domain(lhs), 'Set')) return [lhs, null];

      const index = scanner.index;
      const rhs = scanner.matchExpression(390);
      // If the rhs argument is not a set, bail
      if (rhs === null || ce.isSubsetOf(ce.domain(lhs), 'Set') !== true) {
        scanner.index = index;
        return [lhs, null];
      }
      return [null, ['CartesianProduct', lhs, rhs]];
    },
  },
  {
    name: 'Complement',
    trigger: ['^', '\\complement'],
    kind: 'infix',
    // precedence: 240,
    // @todo: serialize for the multiple argument case
  },
  {
    name: 'Intersection',
    trigger: ['\\cap'],
    kind: 'infix',
    precedence: 350,
  },
  {
    name: 'Interval',
    // @todo: parse opening '[' or ']' or '('
    serialize: serializeSet,
  },
  {
    name: 'Multiple',
    // @todo: parse
    serialize: serializeSet,
  },
  {
    name: 'Union',
    trigger: ['\\cup'],
    kind: 'infix',
    precedence: 350,
  },
  {
    name: 'Range',
    // @todo: parse opening '[' or ']' or '('
    serialize: serializeSet,
  },
  // {
  //   name: 'Set',
  //   kind: 'matchfix',
  //   openDelimiter: '{',
  //   closeDelimiter: '}',
  //   precedence: 20,
  //   // @todo: the set syntax can also include conditions...
  // },
  {
    name: 'SetMinus',
    trigger: ['\\setminus'],
    kind: 'infix',
    precedence: 650,
  },
  {
    name: 'SymmetricDifference',
    trigger: ['\\triangle'], // or \\ominus
    kind: 'infix',
    // @todo: parser could check that lhs and rhs are sets
    precedence: 260,
  },

  // Predicates/Relations
  {
    trigger: ['\\ni'],
    kind: 'infix',
    associativity: 'right',
    precedence: 160, // As per MathML, lower precedence
    parse: (
      lhs: Expression,
      scanner: Scanner,
      minPrec: number
    ): [Expression | null, Expression | null] => {
      if (lhs === null) return [null, null];
      const rhs = scanner.matchExpression(minPrec);
      if (rhs === null) return [lhs, null];
      return [null, ['Element', rhs, lhs]];
    },
  },
  {
    name: 'Element',
    trigger: ['\\in'],
    kind: 'infix',
    precedence: 240,
  },
  {
    name: 'NotElement',
    trigger: ['\\notin'],
    kind: 'infix',
    precedence: 240,
  },
  {
    name: 'NotSubset',
    trigger: ['\\nsubset'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'NotSuperset',
    trigger: ['\\nsupset'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'NotSubsetNotEqual',
    trigger: ['\\nsubseteq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'NotSupersetNotEqual',
    trigger: ['\\nsupseteq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
  },
  {
    name: 'SquareSubset', // MathML: square image of
    trigger: ['\\sqsubset'],
    kind: 'infix',
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'SquareSubsetEqual', // MathML: square image of or equal to
    trigger: ['\\sqsubseteq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'SquareSuperset', // MathML: square original of
    trigger: ['\\sqsupset'],
    kind: 'infix',
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'SquareSupersetEqual', // MathML: square original of or equal
    trigger: ['\\sqsupseteq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'Subset',
    trigger: ['\\subset'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
  },
  {
    trigger: ['\\subsetneq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
    parse: 'Subset',
  },
  {
    trigger: ['\\varsubsetneqq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
    parse: 'Subset',
  },
  {
    name: 'SubsetEqual',
    trigger: ['\\subseteq'],
    kind: 'infix',
    precedence: 240,
  },
  {
    name: 'Superset',
    trigger: ['\\supset'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
  },
  {
    trigger: ['\\supsetneq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
    parse: 'Superset',
  },
  {
    trigger: ['\\varsupsetneq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
    parse: 'Superset',
  },
  {
    name: 'SupersetEqual',
    trigger: ['\\supseteq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
  },
];

// Compact:     \R^*
// Regular       R \setminus { 0 }
// Interval     ]-\infty, 0( \union )0, \infty ]
// Set builder  { x \in \R | x \ne 0 }

// Serialize:
// - Set
// - Range
// - Interval
// - Multiple

// Note: does not serialize
// - Union
// - Intersection
// - SymmetricDifference
// - SetMinus
// - Complement
// - CartesianProduct

function serializeSet(
  serializer: Serializer,
  expr: Expression | null
): LatexString {
  if (expr === null) return '';
  const head = getFunctionName(expr);
  if (head === null) return '';

  //
  // `Set`
  //
  if (head === 'Set') {
    if (getArgCount(expr) === 0) return '\\emptyset';

    //
    // 1/ First variant: ["Set", <set | predicate>, ["Condition"]]
    //
    if (
      getArgCount(expr) === 2 &&
      getFunctionName(getArg(expr, 2)) === 'Condition'
    ) {
      return joinLatex([
        '\\left\\lbrace',
        serializer.serialize(getArg(expr, 1)),
        '\\middle\\mid',
        serializer.serialize(getArg(expr, 2)),
        '\\right\\rbrace',
      ]);
    }

    //
    // 2/ 2nd variant: ["Set", ...<sequence>]
    //
    return joinLatex([
      '\\left\\lbrace',
      ...getTail(expr).map((x) => serializer.serialize(x) + ' ,'),
      '\\right\\rbrace',
    ]);
  }

  //
  // Multiple
  //
  if (head === 'Multiple') {
    // @todo!
  }

  //
  // `Range`
  //
  if (head === 'Range') {
  }
  //
  // `Range`
  //
  if (head === 'Interval') {
  }

  // -----
  const style = serializer.numericSetStyle(expr, serializer.level);

  if (style === 'compact') {
    // A domain with one or more modifier:
    // ^* if 0 is excluded (when it would normally be included)
    // ^0 if 0 is included (when it would normally be excluded)
    // _+ if negative < 0 numbers are excluded
    // _- if positive > 0 numbers are excluded
  } else if (style === 'interval') {
  } else if (style === 'regular') {
  } else if (style === 'set-builder') {
  }
  return '';
}

// Return true if `["Set", 0]`
// function isZeroSet(expr: Expression): boolean {
//   return (
//     getFunctionName(expr) === 'Set' && getNumberValue(getArg(expr, 1)) === 0
//   );
// }

// | `NaturalNumber`
//| \\(= \mathbb{N}\\).
// Counting numbers, \\(0, 1, 2, 3\ldots\\)<br>Note that \\(0\\) is included, following the convention from [ISO/IEC 80000](https://en.wikipedia.org/wiki/ISO_80000-2)                                                                              |
