import {
  head,
  isEmptySequence,
  nops,
  op,
  ops,
  stringValue,
} from '../../../math-json/utils';
import { joinLatex } from '../tokenizer';
import { Expression } from '../../../math-json/math-json-format';
import {
  LatexDictionary,
  Serializer,
  LatexString,
  Parser,
  COMPARISON_PRECEDENCE,
} from '../public';

export const DEFINITIONS_SETS: LatexDictionary = [
  // Constants
  { name: 'AlgebraicNumbers', latexTrigger: '\\bar\\Q' },
  { name: 'ComplexNumbers', latexTrigger: ['\\C'] },
  { latexTrigger: '\\mathbb{C}', parse: 'ComplexNumbers' },
  { name: 'ImaginaryNumbers', latexTrigger: ['\\imaginaryI', '\\R'] },
  { name: 'ExtendedComplexNumbers', latexTrigger: ['\\bar', '\\C'] },
  { name: 'EmptySet', latexTrigger: ['\\emptyset'] },
  { latexTrigger: ['\\varnothing'], parse: 'EmptySet' }, // Parsing only
  { name: 'Integers', latexTrigger: ['\\Z'] },
  { latexTrigger: '\\mathbb{Z}', parse: 'Integers' },
  { name: 'RationalNumbers', latexTrigger: ['\\Q'] },
  { name: 'RealNumbers', latexTrigger: ['\\R'] },
  { latexTrigger: '\\mathbb{R}', parse: 'RealNumbers' },
  { name: 'ExtendedRealNumbers', latexTrigger: ['\\bar', '\\R'] },
  { name: 'TranscendentalNumberss', latexTrigger: '\\R-\\bar\\Q' },
  { latexTrigger: '\\R\\backslash\\bar\\Q', parse: 'TranscendentalNumbers' },

  // Real numbers < 0
  { name: 'NegativeNumbers', latexTrigger: '\\R^-' },
  { latexTrigger: '\\R^{-}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R_-', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R_{-}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R^{\\lt}', parse: 'NegativeNumbers' },

  // Real numbers > 0
  { name: 'PositiveNumbers', latexTrigger: '\\R^+' },
  { latexTrigger: '\\R^{+}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R_+', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R_{+}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R^{\\gt}', parse: 'PositiveNumbers' },

  // Real numbers <= 0
  { name: 'NonPositiveNumbers', latexTrigger: '\\R^{0-}' },
  { latexTrigger: '\\R^{-0}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\R^{\\leq}', parse: 'NonPositiveNumbers' },

  // Integers < 0
  { name: 'NegativeIntegers', latexTrigger: '\\Z^-' },
  { latexTrigger: '\\Z^-', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z^{-}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z_-', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z_{-}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z^{\\lt}', parse: 'NegativeIntegers' },

  // Integers >  0
  { name: 'PositiveIntegers', latexTrigger: '\\Z^+' },
  { latexTrigger: '\\Z^{+}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\Z_+', parse: 'PositiveIntegers' },
  { latexTrigger: '\\Z_{+}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\Z^{\\gt}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\Z^{\\gt0}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N^+', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N^{+}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N^*', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N^{*}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N^\\star', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N^{\\star}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N_1', parse: 'PositiveIntegers' },
  { latexTrigger: '\\N_{1}', parse: 'PositiveIntegers' }, // https://mathvault.ca/hub/higher-math/math-symbols/algebra-symbols/

  // Integers >=  0
  { name: 'NonNegativeIntegers', latexTrigger: ['\\N'] },
  { latexTrigger: '\\Z^{+0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{\\geq}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{\\geq0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{0+}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{N}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\N_0', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\N_{0}', parse: 'NonNegativeIntegers' },

  //
  // Set Expressions
  //
  // @todo: could also have a `CartesianPower` function with a number `rhs`
  // {
  //   name: 'CartesianProduct',
  //   latexTrigger: ['\\times'],
  //   kind: 'infix',
  //   associativity: 'right', // Caution: cartesian product is not associative
  //   precedence: 390, // Same as Multiply?
  //   parse: (parser, lhs, until) => {
  //     if (390 < until.minPrec) return null;
  //     // Since this is triggered on `\times` we have to be careful we only
  //     // accept arguments that are `Set`
  //     const ce = parser.computeEngine!;

  //     if (!ce || !ce.box(lhs).domain?.isCompatible('Sets')) return null;

  //     const index = parser.index;
  //     const rhs = parser.parseExpression({ ...until, minPrec: 390 });
  //     // If the rhs argument is not a set, bail
  //     if (rhs === null || ce.box(lhs).domain?.isCompatible('Sets') !== true) {
  //       parser.index = index;
  //       return null;
  //     }
  //     return ['CartesianProduct', lhs, rhs];
  //   },
  // },
  {
    latexTrigger: ['^', '\\complement'],
    kind: 'postfix',
    parse: (_parser, lhs) => {
      return ['Complement', lhs];
    },

    // precedence: 240,
    // @todo: serialize for the multiple argument case
  },
  {
    name: 'Complement',
    latexTrigger: ['^', '<{>', '\\complement', '<}>'],
    kind: 'postfix',
    // precedence: 240,
    // @todo: serialize for the multiple argument case
  },
  {
    name: 'Intersection',
    latexTrigger: ['\\cap'],
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
    latexTrigger: ['\\cup'],
    kind: 'infix',
    precedence: 350,
  },
  {
    name: 'Set',
    kind: 'matchfix',
    openTrigger: '{',
    closeTrigger: '}',
    // @todo: the set syntax can also include conditions...
    parse: (_parser: Parser, body: Expression): Expression => {
      if (body === null || isEmptySequence(body)) return 'EmptySet';
      if (head(body) == 'Delimiter' && stringValue(op(body, 2)) === ',') {
        body = op(body, 1)!;
      }
      if (head(body) !== 'Sequence') return ['Set', body];
      return ['Set', ...(ops(body) ?? [])];
    },
    serialize: (serializer: Serializer, expr: Expression): string => {
      return joinLatex([
        '\\lbrace',
        (ops(expr) ?? []).map((x) => serializer.serialize(x)).join(', '),
        '\\rbrace',
      ]);
    },
  },
  {
    name: 'SetMinus',
    latexTrigger: ['\\setminus'],
    kind: 'infix',
    precedence: 650,
  },
  {
    name: 'SymmetricDifference',
    latexTrigger: ['\\triangle'], // or \\ominus
    kind: 'infix',
    // @todo: parser could check that lhs and rhs are sets
    precedence: COMPARISON_PRECEDENCE,
  },

  // Predicates/Relations
  {
    latexTrigger: ['\\ni'],
    kind: 'infix',
    associativity: 'none',
    precedence: 160, // As per MathML, lower precedence
    parse: (parser, lhs, terminator): Expression | null => {
      const rhs = parser.parseExpression(terminator);
      return rhs === null ? null : ['Element', rhs, lhs];
    },
  },
  {
    name: 'Element',
    latexTrigger: ['\\in'],
    kind: 'infix',
    precedence: 240,
  },
  {
    name: 'NotElement',
    latexTrigger: ['\\notin'],
    kind: 'infix',
    precedence: 240,
  },
  {
    name: 'NotSubset',
    latexTrigger: ['\\nsubset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
  },
  {
    name: 'NotSuperset',
    latexTrigger: ['\\nsupset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
  },
  {
    name: 'NotSubsetNotEqual',
    latexTrigger: ['\\nsubseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
  },
  {
    name: 'NotSupersetNotEqual',
    latexTrigger: ['\\nsupseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
  },
  {
    name: 'SquareSubset', // MathML: square image of
    latexTrigger: ['\\sqsubset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 265,
  },
  {
    name: 'SquareSubsetEqual', // MathML: square image of or equal to
    latexTrigger: ['\\sqsubseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 265,
  },
  {
    name: 'SquareSuperset', // MathML: square original of
    latexTrigger: ['\\sqsupset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 265,
  },
  {
    name: 'SquareSupersetEqual', // MathML: square original of or equal
    latexTrigger: ['\\sqsupseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 265,
  },
  {
    name: 'Subset',
    latexTrigger: ['\\subset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
  },
  {
    latexTrigger: ['\\subsetneq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: 'Subset',
  },
  {
    latexTrigger: ['\\varsubsetneqq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: 'Subset',
  },
  {
    name: 'SubsetEqual',
    latexTrigger: ['\\subseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
  },
  {
    name: 'Superset',
    latexTrigger: ['\\supset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
  },
  {
    latexTrigger: ['\\supsetneq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: 'Superset',
  },
  {
    latexTrigger: ['\\varsupsetneq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: 'Superset',
  },
  {
    name: 'SupersetEqual',
    latexTrigger: ['\\supseteq'],
    kind: 'infix',
    associativity: 'none',
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
  const h = head(expr);
  if (h === null) return '';

  //
  // `Set`
  //
  if (h === 'Set') {
    if (nops(expr) === 0) return '\\emptyset';

    //
    // 1/ First variant: ["Set", <set | predicate>, ["Condition"]]
    //
    if (nops(expr) === 2 && head(op(expr, 2)) === 'Condition') {
      return joinLatex([
        '\\left\\lbrace',
        serializer.serialize(op(expr, 1)),
        '\\middle\\mid',
        serializer.serialize(op(expr, 2)),
        '\\right\\rbrace',
      ]);
    }

    //
    // 2/ 2nd variant: ["Set", ...<sequence>]
    //
    return joinLatex([
      '\\left\\lbrace',
      ...(ops(expr) ?? []).map((x) => serializer.serialize(x) + ' ,'),
      '\\right\\rbrace',
    ]);
  }

  //
  // Multiple
  //
  if (h === 'Multiple') {
    // @todo!
  }

  //
  // `Range`
  //
  if (h === 'Range') {
    return joinLatex([
      '\\mathopen\\lbrack',
      serializer.serialize(op(expr, 1)),
      ', ',
      serializer.serialize(op(expr, 2)),
      '\\mathclose\\rbrack',
    ]);
  }
  //
  // `Range`
  //
  if (h === 'Interval') {
    let op1 = op(expr, 1);
    let op2 = op(expr, 2);
    let openLeft = false;
    let openRight = false;
    if (head(op1) === 'Open') {
      op1 = op(op1, 1);
      openLeft = true;
    }
    if (head(op2) === 'Open') {
      op2 = op(op2, 1);
      openRight = true;
    }
    return joinLatex([
      `\\mathopen${openLeft ? '\\rbrack' : '\\lbrack'}`,
      serializer.serialize(op1),
      ', ',
      serializer.serialize(op2),
      `\\mathclose${openRight ? '\\lbrack' : '\\rbrack'}`,
    ]);
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
