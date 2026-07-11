import {
  operator,
  isEmptySequence,
  missingIfEmpty,
  nops,
  operand,
  operands,
  stringValue,
} from '../../../math-json/utils.js';
import { joinLatex } from '../tokenizer.js';
import { MathJsonExpression } from '../../../math-json/types.js';
import {
  LatexDictionary,
  Serializer,
  LatexString,
  Parser,
  Terminator,
  COMPARISON_PRECEDENCE,
} from '../types.js';

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

/**
 * Read an ambiguous bracket pair as an interval when it appears as a direct
 * operand of a set operator or relation: in `x \in [1, 5]` or
 * `(-\infty, 0) \cup (0, \infty)`, `[a, b]` (parsed as a 2-element `List`)
 * is a closed interval and a parenthesized pair `(a, b)` is an open one.
 *
 * This reading happens HERE, at the LaTeX boundary. A directly-constructed
 * MathJSON `["List", a, b]` (or a Cortex `[a, b]` literal) is a two-element
 * collection, never an interval — set operations on it use collection
 * semantics (e.g. `Intersection([1,2], [2,3])` → `Set(2)`). Unambiguous
 * interval notations (`[a, b)`, `]a, b[`, …) have dedicated matchfix entries.
 */
function parsedIntervalOperand(
  expr: MathJsonExpression | null
): MathJsonExpression | null {
  if (expr === null) return null;

  // `[a, b]` — a bracket pair, parsed as a 2-element List
  if (operator(expr) === 'List' && nops(expr) === 2)
    return ['Interval', operand(expr, 1)!, operand(expr, 2)!];

  // `(a, b)` — a parenthesized pair, parsed as a Delimiter sequence
  if (operator(expr) === 'Delimiter') {
    const delim = stringValue(operand(expr, 2)) ?? '(,)';
    if (delim !== ',' && delim !== '(,)' && delim !== '()') return expr;
    const body = operand(expr, 1);
    if (operator(body) === 'Sequence' && nops(body!) === 2)
      return [
        'Interval',
        ['Open', operand(body!, 1)!],
        ['Open', operand(body!, 2)!],
      ];
  }

  return expr;
}

/**
 * The default infix parse (associativity `none`), reading ambiguous bracket
 * pairs among the operands as intervals (`sides` selects which operands are
 * set-valued: both for `\cup`, only the rhs for `\in`).
 */
function parseSetOperator(name: string, prec: number, sides: 'both' | 'rhs') {
  return (
    parser: Parser,
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null => {
    if (lhs === null) return null;
    const rhs = missingIfEmpty(
      parser.parseExpression({ ...until, minPrec: prec })
    );
    return [
      name,
      sides === 'both' ? parsedIntervalOperand(lhs)! : lhs,
      parsedIntervalOperand(rhs)!,
    ];
  };
}

// Operator heads that indicate the LHS of a top-level Colon inside `{...}`
// is a boolean predicate (compact-piecewise branch), not a value to type-tag
// (set-builder).
const COMPARISON_HEADS = new Set<string>([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'And',
  'Or',
  'Not',
]);

export const DEFINITIONS_SETS: LatexDictionary = [
  //
  // Constants
  //
  { name: 'AlgebraicNumbers', latexTrigger: '\\overline\\Q' },
  { latexTrigger: '\\bar\\Q', parse: 'AlgebraicNumbers' },
  { name: 'ComplexNumbers', latexTrigger: ['\\C'] },
  { latexTrigger: '\\mathbb{C}', parse: 'ComplexNumbers' },
  // `\mathbb{C}^+` is input shorthand for the open upper half-plane. In a
  // membership (`z \in \mathbb{C}^+`) it canonicalizes to `Im(z) > 0` (see the
  // Element handler in library/sets.ts); the longer trigger wins over the
  // `\mathbb{C}` + `^+` (PseudoInverse) parse.
  { name: 'UpperHalfPlane', latexTrigger: '\\mathbb{C}^+' },
  { latexTrigger: '\\mathbb{C}^{+}', parse: 'UpperHalfPlane' },
  // Terse aliases (parse only): `\C^+` mirrors `\C` for `\mathbb{C}`.
  { latexTrigger: '\\C^+', parse: 'UpperHalfPlane' },
  { latexTrigger: '\\C^{+}', parse: 'UpperHalfPlane' },
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
  { latexTrigger: '\\R^{\\leqslant0}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\R^{-0}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\R^{\\leq}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\R^{\\leqslant}', parse: 'NonPositiveNumbers' },
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
  { latexTrigger: '\\R_{\\geqslant0}', parse: 'NonNegativeNumbers' },
  { latexTrigger: '\\R^{0+}', parse: 'NonNegativeNumbers' },
  { latexTrigger: '\\R^{\\geq}', parse: 'NonNegativeNumbers' },
  { latexTrigger: '\\R^{\\geqslant}', parse: 'NonNegativeNumbers' },

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
  { latexTrigger: '\\Z_{\\leqslant0}', parse: 'NonPositiveIntegers' },
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
  { latexTrigger: '\\Z^{\\geqslant}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{\\geq0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\Z^{\\geqslant0}', parse: 'NonNegativeIntegers' },
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
  // Subscript-/superscript-qualified blackboard-bold sets.
  //
  // The terse aliases (`\R_{>0}`, `\Z^+`, ...) above already map every common
  // sign restriction to a named set. The `\mathbb{...}` spellings need their
  // own multi-token triggers (each is longer than the bare `\mathbb{R}` etc.,
  // so it wins the longest-match). Where a restriction names an existing set we
  // map to it (round-trips to the canonical LaTeX); the one form with no named
  // set — `\mathbb{N}_{>1}` — falls back to a faithful inert set-builder.
  //

  // Reals > 0 / >= 0 / < 0 / <= 0
  { latexTrigger: '\\mathbb{R}_{>0}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\gt0}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\mathbb{R}_+', parse: 'PositiveNumbers' },
  { latexTrigger: '\\mathbb{R}_{+}', parse: 'PositiveNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\geq0}', parse: 'NonNegativeNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\ge0}', parse: 'NonNegativeNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\geqslant0}', parse: 'NonNegativeNumbers' },
  { latexTrigger: '\\mathbb{R}_{<0}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\lt0}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\mathbb{R}_-', parse: 'NegativeNumbers' },
  { latexTrigger: '\\mathbb{R}_{-}', parse: 'NegativeNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\leq0}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\le0}', parse: 'NonPositiveNumbers' },
  { latexTrigger: '\\mathbb{R}_{\\leqslant0}', parse: 'NonPositiveNumbers' },

  // Integers > 0 / >= 0 / < 0 / <= 0
  { latexTrigger: '\\mathbb{Z}_{>0}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\gt0}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}_+', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}_{+}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}^+', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}^{+}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\geq0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\ge0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\geqslant0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{Z}_{<0}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\lt0}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\mathbb{Z}_-', parse: 'NegativeIntegers' },
  { latexTrigger: '\\mathbb{Z}_{-}', parse: 'NegativeIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\leq0}', parse: 'NonPositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\le0}', parse: 'NonPositiveIntegers' },
  { latexTrigger: '\\mathbb{Z}_{\\leqslant0}', parse: 'NonPositiveIntegers' },

  // Naturals: > 0 is the positive integers; N_0 already includes 0.
  { latexTrigger: '\\mathbb{N}_{>0}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}_{\\gt0}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}^+', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}^{+}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}^*', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}^{*}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}_0', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{N}_{0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{N}_{\\geq0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{N}_{\\ge0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{N}_{\\geqslant0}', parse: 'NonNegativeIntegers' },
  { latexTrigger: '\\mathbb{N}_1', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}_{1}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}_{\\geq1}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}_{\\ge1}', parse: 'PositiveIntegers' },
  { latexTrigger: '\\mathbb{N}_{\\geqslant1}', parse: 'PositiveIntegers' },

  // `\mathbb{N}_{>1}` (integers strictly greater than 1) has no named set:
  // transcribe it faithfully as an inert set-builder `{ n ∈ ℕ | n > 1 }`.
  {
    latexTrigger: '\\mathbb{N}_{>1}',
    parse: () =>
      [
        'Set',
        ['Element', 'n', 'NonNegativeIntegers'],
        ['Condition', ['Greater', 'n', 1]],
      ] as MathJsonExpression,
  },
  {
    latexTrigger: '\\N_{>1}',
    parse: () =>
      [
        'Set',
        ['Element', 'n', 'NonNegativeIntegers'],
        ['Condition', ['Greater', 'n', 1]],
      ] as MathJsonExpression,
  },

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
    parse: (_parser: Parser, lhs: MathJsonExpression) => {
      return ['Complement', lhs] as MathJsonExpression;
    },
    // precedence: 240,
  },
  {
    name: 'Complement',
    latexTrigger: ['^', '<{>', '\\complement', '<}>'],
    kind: 'postfix',
    // precedence: 240,
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      return joinLatex([
        serializer.serialize(operand(expr, 1)),
        '^\\complement',
      ]);
    },
  },
  {
    name: 'Intersection',
    latexTrigger: ['\\cap'],
    kind: 'infix',
    precedence: 350,
    parse: parseSetOperator('Intersection', 350, 'both'),
  },
  {
    // Unicode ∩ (U+2229 INTERSECTION): literal-glyph spelling of `\cap`.
    latexTrigger: ['∩'],
    kind: 'infix',
    precedence: 350,
    parse: parseSetOperator('Intersection', 350, 'both'),
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
    serialize: serializeSet,
  },
  {
    name: 'Union',
    latexTrigger: ['\\cup'],
    kind: 'infix',
    precedence: 350,
    parse: parseSetOperator('Union', 350, 'both'),
  },
  {
    // Unicode ∪ (U+222A UNION): literal-glyph spelling of `\cup`.
    latexTrigger: ['∪'],
    kind: 'infix',
    precedence: 350,
    parse: parseSetOperator('Union', 350, 'both'),
  },

  // \mid as a separator/operator (used in set-builder notation: {x \mid x > 0})
  // Low precedence so it binds loosely — everything on each side is parsed first
  {
    name: 'Divides',
    latexTrigger: ['\\mid'],
    kind: 'infix',
    precedence: 160,
  },

  // Non-divisibility: `a \nmid b` → `NotDivides(a, b)` (canonicalizes to
  // `Not(Divides(a, b))`). `\nmid` is a distinct command, so this does not
  // affect `\mid`'s set-builder / such-that role above.
  {
    name: 'NotDivides',
    latexTrigger: ['\\nmid'],
    kind: 'infix',
    precedence: 160,
  },

  {
    name: 'Set',
    kind: 'matchfix',
    openTrigger: '{',
    closeTrigger: '}',
    parse: (_parser: Parser, body: MathJsonExpression): MathJsonExpression => {
      if (isEmptySequence(body)) return 'EmptySet';

      // Unwrap a trailing-comma Delimiter (e.g. `{1, 2,}` parses as
      // `Delimiter(Sequence(1,2), ',')`) so the discriminators below see the
      // inner shape directly. Also handles single-element trailing-comma
      // cases like `{cond:val,}` → bare `Colon(cond, val)`.
      if (
        operator(body) == 'Delimiter' &&
        stringValue(operand(body, 2)) === ','
      ) {
        body = operand(body, 1)!;
      }

      const h = operator(body);

      // Set-builder via `\mid`: `{expr \mid cond}` parses to Divides(expr, cond).
      if (h === 'Divides') {
        const expr = operand(body, 1);
        const condition = operand(body, 2);
        if (expr !== null && condition !== null)
          return ['Set', expr, ['Condition', condition]];
      }

      // A single Colon at top level could be:
      // - Set-builder `{x : cond}` — LHS is a simple expression (variable/literal)
      // - Compact piecewise `{cond : val}` — LHS is a comparison/boolean expression
      // Detect the piecewise case by checking if LHS has a comparison head.
      if (h === 'Colon') {
        const lhs = operand(body, 1);
        const rhs = operand(body, 2);
        if (lhs !== null && rhs !== null) {
          const lhsOp = operator(lhs);
          if (lhsOp !== null && COMPARISON_HEADS.has(lhsOp)) {
            // Compact piecewise with a single branch and no default.
            return ['Which', lhs, rhs];
          }
          // Set-builder form: {x : cond}
          return ['Set', lhs, ['Condition', rhs]];
        }
      }

      // Sequence form: check for compact Desmos piecewise. To treat the whole
      // brace as piecewise, EVERY Colon element must have a comparison-head
      // LHS (mirrors the single-Colon discriminator above). A final non-Colon
      // element, if present, becomes the default: True, default.
      if (h === 'Sequence') {
        const elements = operands(body);
        const colonElements = elements.filter((el) => operator(el) === 'Colon');
        const allPiecewise =
          colonElements.length > 0 &&
          colonElements.every((el) => {
            const lhs = operand(el, 1);
            const lhsOp = lhs !== null ? operator(lhs) : null;
            return lhsOp !== null && COMPARISON_HEADS.has(lhsOp);
          });
        if (allPiecewise) {
          const whichOps: MathJsonExpression[] = [];
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (operator(el) === 'Colon') {
              const cond = operand(el, 1);
              const val = operand(el, 2);
              if (cond === null || val === null) {
                // Malformed — fall through to Set.
                return ['Set', ...elements];
              }
              whichOps.push(cond, val);
            } else {
              // Non-Colon element — should be the final default.
              if (i !== elements.length - 1) {
                // Non-Colon in the middle: malformed, fall through to Set.
                return ['Set', ...elements];
              }
              whichOps.push('True', el);
            }
          }
          return ['Which', ...whichOps];
        }
        return ['Set', ...elements];
      }

      return ['Set', body];
    },
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      // Set-builder notation: ["Set", expr, ["Condition", cond]]
      if (nops(expr) === 2 && operator(operand(expr, 2)) === 'Condition') {
        const condition = operand(expr, 2);
        return joinLatex([
          '\\lbrace',
          serializer.serialize(operand(expr, 1)),
          '\\mid',
          // Serialize the inner expression of the Condition wrapper
          serializer.serialize(operand(condition, 1)),
          '\\rbrace',
        ]);
      }
      // Enumerated set: ["Set", ...elements]
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
    parse: parseSetOperator('SetMinus', 650, 'both'),
  },
  {
    // `\backslash` between two expressions is a common spelling of set
    // difference (`A \backslash B`). As an *infix* entry it only fires when a
    // left-hand side is present, so a standalone `\backslash` (a literal
    // backslash in text) is unaffected. The multi-token `\R\backslash\bar\Q`
    // trigger (transcendental numbers) is longer and still wins.
    latexTrigger: ['\\backslash'],
    kind: 'infix',
    precedence: 650,
    parse: parseSetOperator('SetMinus', 650, 'both'),
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
      // Reversed membership: the COLLECTION is the lhs (`[1,5] \ni x`)
      return rhs === null
        ? null
        : ['Element', rhs, parsedIntervalOperand(lhs)!];
    },
  },
  {
    name: 'Element',
    latexTrigger: ['\\in'],
    kind: 'infix',
    // Bind tighter than `Colon` (240) so set-builder notation with a domain,
    // `{x \in \R : x > 0}`, parses as `Colon(Element(x, \R), x>0)` — the
    // membership grouping first, the `:` condition attaching to the whole
    // comprehension — rather than `Element(x, Colon(\R, x>0))`, which nested
    // the condition inside the domain. Still below comparisons (245).
    precedence: 241,
    parse: parseSetOperator('Element', 241, 'rhs'),
  },
  {
    // Unicode ∈ (U+2208 ELEMENT OF): literal-glyph spelling of `\in`.
    latexTrigger: ['∈'],
    kind: 'infix',
    precedence: 241,
    parse: parseSetOperator('Element', 241, 'rhs'),
  },
  {
    name: 'NotElement',
    latexTrigger: ['\\notin'],
    kind: 'infix',
    precedence: 240,
    parse: parseSetOperator('NotElement', 240, 'rhs'),
  },
  {
    // Unicode ∉ (U+2209 NOT AN ELEMENT OF): literal-glyph spelling of `\notin`.
    latexTrigger: ['∉'],
    kind: 'infix',
    precedence: 240,
    parse: parseSetOperator('NotElement', 240, 'rhs'),
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
    // `\not\in` is the composed spelling of `\notin` (∉).
    latexTrigger: ['\\not', '\\in'],
    kind: 'infix',
    precedence: 240,
    parse: parseSetOperator('NotElement', 240, 'rhs'),
  },
  {
    // `\not\subset` is the composed spelling of `\nsubset` (⊄).
    latexTrigger: ['\\not', '\\subset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: 'NotSubset',
  },
  {
    // `\not\supset` is the composed spelling of `\nsupset` (⊅).
    latexTrigger: ['\\not', '\\supset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: 'NotSuperset',
  },
  {
    // `\not\subseteq`: no dedicated negated head, so wrap `SubsetEqual`.
    latexTrigger: ['\\not', '\\subseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: (parser, lhs, terminator): MathJsonExpression | null => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 240 });
      if (rhs === null) return null;
      return [
        'Not',
        ['SubsetEqual', parsedIntervalOperand(lhs)!, parsedIntervalOperand(rhs)!],
      ];
    },
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
    parse: parseSetOperator('Subset', 240, 'both'),
  },
  {
    latexTrigger: ['\\subsetneq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: parseSetOperator('Subset', 240, 'both'),
  },
  {
    latexTrigger: ['\\varsubsetneqq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: parseSetOperator('Subset', 240, 'both'),
  },
  {
    name: 'SubsetEqual',
    latexTrigger: ['\\subseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: parseSetOperator('SubsetEqual', 240, 'both'),
  },
  {
    name: 'Superset',
    latexTrigger: ['\\supset'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: parseSetOperator('Superset', 240, 'both'),
  },
  {
    latexTrigger: ['\\supsetneq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: parseSetOperator('Superset', 240, 'both'),
  },
  {
    latexTrigger: ['\\varsupsetneq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: parseSetOperator('Superset', 240, 'both'),
  },
  {
    name: 'SupersetEqual',
    latexTrigger: ['\\supseteq'],
    kind: 'infix',
    associativity: 'none',
    precedence: 240,
    parse: parseSetOperator('SupersetEqual', 240, 'both'),
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

function serializeSet(
  serializer: Serializer,
  expr: MathJsonExpression | null
): LatexString {
  if (expr === null) return '';
  const h = operator(expr);
  if (!h) return '';

  // Note: `Set` serialization is handled by the matchfix entry's inline serializer.

  //
  // Multiple
  //
  if (h === 'Multiple') {
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
