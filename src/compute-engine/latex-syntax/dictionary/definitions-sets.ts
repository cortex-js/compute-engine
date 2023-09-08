import { head, nops, op, ops } from '../../../math-json/utils';
import { joinLatex } from '../tokenizer';
import { Expression } from '../../../math-json/math-json-format';
import { LatexDictionary, Serializer, LatexString } from '../public';

export const DEFINITIONS_SETS: LatexDictionary = [
  // Constants
  { name: 'AlgebraicNumber', trigger: '\\bar\\Q' },
  { name: 'ComplexNumber', trigger: ['\\C'] },
  { trigger: '\\mathbb{C}', parse: 'ComplexNumber' },
  { name: 'ImaginaryNumber', trigger: ['\\imaginaryI\\R'] },
  { name: 'ExtendedComplexNumber', trigger: ['\\bar\\C'] },
  { name: 'EmptySet', trigger: ['\\emptyset'] },
  { trigger: ['\\varnothing'], parse: 'EmptySet' }, // Parsing only
  { name: 'Integer', trigger: ['\\Z'] },
  { trigger: '\\mathbb{Z}', parse: 'Integer' },
  { name: 'RationalNumber', trigger: ['\\Q'] },
  { name: 'RealNumber', trigger: ['\\R'] },
  { trigger: '\\mathbb{R}', parse: 'RealNumber' },
  { name: 'ExtendedRealNumber', trigger: ['\\bar\\R'] },
  { name: 'TranscendentalNumber', trigger: '\\R-\\bar\\Q' },
  { trigger: '\\R\\backslash\\bar\\Q', parse: 'TranscendentalNumber' },

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
    parse: (parser, lhs, until) => {
      if (390 < until.minPrec) return null;
      // Since this is triggered on `\times` we have to be careful we only
      // accept arguments that are `Set`
      const ce = parser.computeEngine!;

      if (!ce || !ce.box(lhs).domain.isCompatible('Set')) return null;

      const index = parser.index;
      const rhs = parser.parseExpression({ ...until, minPrec: 390 });
      // If the rhs argument is not a set, bail
      if (rhs === null || ce.box(lhs).domain.isCompatible('Set') !== true) {
        parser.index = index;
        return null;
      }
      return ['CartesianProduct', lhs, rhs];
    },
  },
  {
    trigger: ['^', '\\complement'],
    kind: 'postfix',
    parse: (_parser, lhs) => {
      return ['Complement', lhs];
    },

    // precedence: 240,
    // @todo: serialize for the multiple argument case
  },
  {
    name: 'Complement',
    trigger: ['^', '<{>', '\\complement', '<}>'],
    kind: 'postfix',
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
    parse: (parser, lhs, terminator): Expression | null => {
      const rhs = parser.parseExpression(terminator);
      return rhs === null ? null : ['Element', rhs, lhs];
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
