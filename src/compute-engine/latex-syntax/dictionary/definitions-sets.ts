import {
  operator,
  isEmptySequence,
  nops,
  operand,
  operands,
  stringValue,
} from '../../../math-json/utils';
import { joinLatex } from '../tokenizer';
import { MathJsonExpression } from '../../../math-json/types';
import {
  LatexDictionary,
  Serializer,
  LatexString,
  Parser,
  COMPARISON_PRECEDENCE,
} from '../types';

/**
 * Parse the body of an interval expression and create an Interval MathJSON expression.
 *
 * @param body - The parsed body between the delimiters (typically a Delimiter with comma separator)
 * @param openLeft - If true, the left endpoint is open (excluded)
 * @param openRight - If true, the right endpoint is open (excluded)
 * @returns An Interval expression or null if the body doesn't have exactly 2 elements
 */
function parseIntervalBody(
  body: MathJsonExpression,
  openLeft: boolean,
  openRight: boolean
): MathJsonExpression | null {
  // Handle empty body
  if (isEmptySequence(body)) return null;

  // Extract the two endpoints from the body
  // The body is typically a Delimiter with a comma separator: ["Delimiter", ["Sequence", a, b], ","]
  // or just a Sequence: ["Sequence", a, b]
  let elements: MathJsonExpression[];

  const h = operator(body);
  if (h === 'Delimiter') {
    const delim = stringValue(operand(body, 2));
    // Must be comma-separated
    if (delim !== ',' && delim !== '(,)' && delim !== '[,]') return null;
    const inner = operand(body, 1);
    if (operator(inner) === 'Sequence') {
      elements = [...operands(inner)];
    } else {
      elements = inner ? [inner] : [];
    }
  } else if (h === 'Sequence') {
    elements = [...operands(body)];
  } else {
    // Single element - not valid for interval
    return null;
  }

  // Intervals must have exactly two endpoints
  if (elements.length !== 2) return null;

  const [lower, upper] = elements;

  // Build the Interval expression with Open wrappers for open endpoints
  const lowerExpr: MathJsonExpression = openLeft ? ['Open', lower] : lower;
  const upperExpr: MathJsonExpression = openRight ? ['Open', upper] : upper;

  return ['Interval', lowerExpr, upperExpr];
}

export const DEFINITIONS_SETS: LatexDictionary = [
  //
  // Constants
  //
  { name: 'AlgebraicNumbers', latexTrigger: '\\overline\\Q' },
  { latexTrigger: '\\bar\\Q', parse: 'AlgebraicNumbers' },
  { name: 'ComplexNumbers', latexTrigger: ['\\C'] },
  { latexTrigger: '\\mathbb{C}', parse: 'ComplexNumbers' },
  { name: 'ImaginaryNumbers', latexTrigger: ['\\imaginaryI', '\\R'] },
  { name: 'EmptySet', latexTrigger: ['\\emptyset'] },
  { latexTrigger: ['\\varnothing'], parse: 'EmptySet' }, // Parsing only
  { name: 'Integers', latexTrigger: ['\\Z'] },
  { latexTrigger: '\\mathbb{Z}', parse: 'Integers' },
  { name: 'RationalNumbers', latexTrigger: ['\\Q'] },
  { latexTrigger: '\\mathbb{Q}', parse: 'RationalNumbers' },
  { name: 'RealNumbers', latexTrigger: ['\\R'] },
  { latexTrigger: '\\mathbb{R}', parse: 'RealNumbers' },
  { name: 'TranscendentalNumbers', latexTrigger: '\\R-\\bar\\Q' },
  { latexTrigger: '\\R\\backslash\\bar\\Q', parse: 'TranscendentalNumbers' },

  // Real numbers < 0
  { name: 'NegativeNumbers', latexTrigger: '\\R_{<0}' },
  { latexTrigger: '\\R^-', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R^{-}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R^-', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R_-', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R_{-}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R^{\\lt}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R^{<}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R^{\\lt0}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\R^{<0}', parse: 'NegativeNumbers' },

  // Real numbers <= 0
  { name: 'NonPositiveNumbers', latexTrigger: '\\R_{\\le0}' },
  { latexTrigger: '\\R^{\\leq0}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\R^{-0}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\R^{\\leq}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\R^{0-}', parse: 'NonPositiveNumbers' },

  // Real numbers > 0
  { name: 'PositiveNumbers', latexTrigger: '\\R_{>0}' },
  { latexTrigger: '\\R^+', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R^{+}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R_+', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R_{+}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R^{\\gt}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R^{\\gt 0}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R^{>}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\R^{>0}', parse: 'PositiveNumbers' },

  // Real numbers >= 0
  { name: 'NonNegativeNumbers', latexTrigger: '\\R_{\\geq0}' },
  { latexTrigger: '\\R^{0+}', parse: 'NonNegativeNumbers' },
  { latexTrigger: '\\R^{\\geq}', parse: 'NonNegativeNumbers' },

  // Extended Real numbers = \R \cup \{-\infty, +\infty\}
  { name: 'ExtendedRealNumbers', latexTrigger: '\\overline\\R' },
  { latexTrigger: '\\bar\\R', parse: 'ExtendedRealNumbers' },

  // Integers < 0
  { name: 'NegativeIntegers', latexTrigger: '\\Z_{<0}' },
  { latexTrigger: '\\Z_{\\lt0}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z^-', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z^{-}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z_-', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z_{-}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\Z^{\\lt}', parse: 'NegativeIntegers' },

  // Integers <= 0
  { name: 'NonPositiveIntegers', latexTrigger: '\\Z_{\\le0}' },
  { latexTrigger: '\\Z_{\\leq0}', parse: 'NonPositiveIntegers' },
  { latexTrigger: '\\Z_{<0}', parse: 'NonPositiveIntegers' },

  // Integers >  0
  { name: 'PositiveIntegers', latexTrigger: '\\N^*' },
  { latexTrigger: '\\Z_{>0}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\Z_{\\gt0}', parse: 'PositiveIntegers' },
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
  // Note that 0 is included in $\N$, following the convention from
  // [ISO/IEC 80000](https://en.wikipedia.org/wiki/ISO_80000-2)
  { name: 'NonNegativeIntegers', latexTrigger: ['\\N'] },
  { latexTrigger: '\\Z^{+0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{\\geq}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{\\geq0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{0+}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{N}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\N_0', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\N_{0}', parse: 'NonNegativeIntegers' },

  // Extended Integers = \Z \cup \{-\infty, +\infty\}
  { name: 'ExtendedIntegers', latexTrigger: '\\overline\\Z' },
  { latexTrigger: '\\bar\\Z', parse: 'ExtendedIntegers' },

  // Extended Rationals = \Q \cup \{-\infty, +\infty\}
  { name: 'ExtendedRationalNumbers', latexTrigger: '\\overline\\Q' },
  { latexTrigger: '\\bar\\Q', parse: 'ExtendedRationalNumbers' },

  // Extended Complex Numbers = \C \cup \{-\infty, +\infty\}
  { name: 'ExtendedComplexNumbers', latexTrigger: '\\overline\\C' },
  { latexTrigger: '\\bar\\C', parse: 'ExtendedComplexNumbers' },

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

  //     if (!ce || !ce.expr(lhs).domain?.isCompatible('Sets')) return null;

  //     const index = parser.index;
  //     const rhs = parser.parseExpression({ ...until, minPrec: 390 });
  //     // If the rhs argument is not a set, bail
  //     if (rhs === null || ce.expr(lhs).domain?.isCompatible('Sets') !== true) {
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
      return ['Complement', lhs] as MathJsonExpression;
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
    serialize: serializeSet,
  },

  //
  // Interval Parsing - Half-open intervals with mismatched brackets
  //
  // These matchfix entries handle interval notations where the opening and closing
  // delimiters differ, indicating open vs closed endpoints.
  //

  // [a, b) - Closed-open interval (American notation)
  {
    kind: 'matchfix',
    openTrigger: ['['],
    closeTrigger: [')'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, false, true),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\lbrack'],
    closeTrigger: ['\\rparen'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, false, true),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\lbrack'],
    closeTrigger: [')'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, false, true),
  },
  {
    kind: 'matchfix',
    openTrigger: ['['],
    closeTrigger: ['\\rparen'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, false, true),
  },

  // (a, b] - Open-closed interval (American notation)
  {
    kind: 'matchfix',
    openTrigger: ['('],
    closeTrigger: [']'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, true, false),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\lparen'],
    closeTrigger: ['\\rbrack'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, true, false),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\lparen'],
    closeTrigger: [']'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, true, false),
  },
  {
    kind: 'matchfix',
    openTrigger: ['('],
    closeTrigger: ['\\rbrack'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, true, false),
  },

  // ]a, b[ - Open interval (ISO/European reversed bracket notation)
  {
    kind: 'matchfix',
    openTrigger: [']'],
    closeTrigger: ['['],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, true, true),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\rbrack'],
    closeTrigger: ['\\lbrack'],
    parse: (
      _parser: Parser,
      body: MathJsonExpression
    ): MathJsonExpression | null => parseIntervalBody(body, true, true),
  },

  // Note: ISO notation ]a, b] (open-closed) and [a, b[ (closed-open) are NOT
  // supported with plain brackets because they conflict with nested list parsing.
  // Use the American notation (a, b] and [a, b) instead, or use explicit
  // commands like \rbrack a, b \rbrack which are unambiguous.
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
    parse: (_parser: Parser, body: MathJsonExpression): MathJsonExpression => {
      if (isEmptySequence(body)) return 'EmptySet';
      if (
        operator(body) == 'Delimiter' &&
        stringValue(operand(body, 2)) === ','
      ) {
        body = operand(body, 1)!;
      }
      if (operator(body) !== 'Sequence') return ['Set', body];
      return ['Set', ...operands(body)];
    },
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      return joinLatex([
        '\\lbrace',
        operands(expr)
          .map((x) => serializer.serialize(x))
          .join(', '),
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
    parse: (parser, lhs, terminator): MathJsonExpression | null => {
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
  expr: MathJsonExpression | null
): LatexString {
  if (expr === null) return '';
  const h = operator(expr);
  if (!h) return '';

  //
  // `Set`
  //
  if (h === 'Set') {
    if (nops(expr) === 0) return '\\emptyset';

    //
    // 1/ First variant: ["Set", <set | predicate>, ["Condition"]]
    //
    if (nops(expr) === 2 && operator(operand(expr, 2)) === 'Condition') {
      return joinLatex([
        '\\left\\lbrace',
        serializer.serialize(operand(expr, 1)),
        '\\middle\\mid',
        serializer.serialize(operand(expr, 2)),
        '\\right\\rbrace',
      ]);
    }

    //
    // 2/ 2nd variant: ["Set", ...<sequence>]
    //
    return joinLatex([
      '\\left\\lbrace',
      ...operands(expr).map((x) => serializer.serialize(x) + ' ,'),
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
      serializer.serialize(operand(expr, 1)),
      ', ',
      serializer.serialize(operand(expr, 2)),
      '\\mathclose\\rbrack',
    ]);
  }
  //
  // `Range`
  //
  if (h === 'Interval') {
    let op1 = operand(expr, 1);
    let op2 = operand(expr, 2);
    let openLeft = false;
    let openRight = false;
    if (operator(op1) === 'Open') {
      op1 = operand(op1, 1);
      openLeft = true;
    }
    if (operator(op2) === 'Open') {
      op2 = operand(op2, 1);
      openRight = true;
    }
    // Use American notation for interval serialization:
    // [a, b] closed, (a, b) open, [a, b) closed-open, (a, b] open-closed
    // This enables round-trip parsing for half-open intervals.
    // Note: [a, b] and (a, b) will parse back as List/Tuple respectively
    // due to backward compatibility constraints.
    return joinLatex([
      openLeft ? '\\lparen' : '\\lbrack',
      serializer.serialize(op1),
      ', ',
      serializer.serialize(op2),
      openRight ? '\\rparen' : '\\rbrack',
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
// function isZeroSet(expr: MathJsonExpression): boolean {
//   return (
//     getFunctionName(expr) === 'Set' && getNumberValue(getArg(expr, 1)) === 0
//   );
// }

// | `NaturalNumber`
//| \\(= \mathbb{N}\\).
// Counting numbers, \\(0, 1, 2, 3\ldots\\)<br>Note that \\(0\\) is included, following the convention from [ISO/IEC 80000](https://en.wikipedia.org/wiki/ISO_80000-2)                                                                              |
