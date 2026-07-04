import { LatexDictionaryEntry, COMPARISON_PRECEDENCE } from '../types';

export const DEFINITIONS_INEQUALITIES: LatexDictionaryEntry[] = [
  {
    latexTrigger: ['\\not', '<'],
    kind: 'infix',
    associativity: 'any',
    precedence: 246,
    parse: 'NotLess',
  },
  {
    name: 'NotLess',
    latexTrigger: ['\\nless'],
    kind: 'infix',
    associativity: 'any',
    precedence: 246,
  },
  {
    latexTrigger: ['<'],
    kind: 'infix',
    associativity: 'any',
    precedence: 245,
    parse: 'Less',
  },
  {
    name: 'Less',
    latexTrigger: ['\\lt'],
    kind: 'infix',
    associativity: 'any',
    precedence: 245,
  },
  {
    latexTrigger: ['<', '='],
    kind: 'infix',
    associativity: 'any',
    precedence: 241,
    parse: 'LessEqual',
  },
  {
    name: 'LessEqual',
    latexTrigger: ['\\le'],
    kind: 'infix',
    associativity: 'any',
    precedence: 241,
  },
  {
    latexTrigger: ['\\leq'],
    kind: 'infix',
    associativity: 'any',
    precedence: 241,
    parse: 'LessEqual',
  },
  {
    latexTrigger: ['\\leqslant'],
    kind: 'infix',
    associativity: 'any',
    precedence: COMPARISON_PRECEDENCE + 5, // Note different precedence than `<=` as per MathML
    parse: 'LessEqual',
  },
  // Unicode operator spellings. Copy/paste and keyboard input frequently carry
  // the literal glyphs `≤` `≥` `≠` rather than the LaTeX commands; parse them
  // directly (in every mode), the way Greek-letter codepoints already do.
  {
    latexTrigger: ['≤'], // ≤ U+2264 LESS-THAN OR EQUAL TO
    kind: 'infix',
    associativity: 'any',
    precedence: 241,
    parse: 'LessEqual',
  },
  {
    latexTrigger: ['≥'], // ≥ U+2265 GREATER-THAN OR EQUAL TO
    kind: 'infix',
    associativity: 'any',
    precedence: 242,
    parse: 'GreaterEqual',
  },
  {
    latexTrigger: ['≠'], // ≠ U+2260 NOT EQUAL TO
    kind: 'infix',
    associativity: 'right',
    precedence: 255,
    parse: 'NotEqual',
  },
  {
    name: 'LessNotEqual',
    latexTrigger: ['\\lneqq'],
    kind: 'infix',
    associativity: 'any',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'NotLessNotEqual',
    latexTrigger: ['\\nleqq'],
    kind: 'infix',
    associativity: 'any',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'LessOverEqual',
    latexTrigger: ['\\leqq'],
    kind: 'infix',
    associativity: 'any',
    precedence: COMPARISON_PRECEDENCE + 5,
  },
  {
    name: 'GreaterOverEqual',
    latexTrigger: ['\\geqq'],
    kind: 'infix',
    associativity: 'any',
    precedence: COMPARISON_PRECEDENCE + 5,
    parse: 'GreaterEqual',
  },
  {
    name: 'Equal',
    latexTrigger: ['='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    latexTrigger: ['*', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
    parse: 'StarEqual',
  },
  {
    name: 'StarEqual',
    latexTrigger: ['\\star', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'PlusEqual',
    latexTrigger: ['+', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'MinusEqual',
    latexTrigger: ['-', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'SlashEqual',
    latexTrigger: ['/', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    // `==` (double-equals, a programming-habit spelling of equality) parses as
    // `Equal` so it actually evaluates. It used to parse to an inert
    // `EqualEqual` head that no library handler ever reduced. Parse-only alias;
    // serialization of `Equal` stays `=`. (See docs/LENIENT_PARSER.md: `== → =`.)
    latexTrigger: ['=', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
    parse: 'Equal',
  },
  {
    name: 'EqualEqualEqual',
    latexTrigger: ['=', '=', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5,
  },
  {
    name: 'Tilde', // Note: Mathematica Tilde — similarity (geometric figures),
    // asymptotic equivalence, or "is distributed as". Inert relation.
    latexTrigger: ['\\sim'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'NotTilde',
    latexTrigger: ['\\nsim'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'TildeEqual', // Note: Mathematica TildeEqual — the library head
    // existed without a LaTeX trigger; `\simeq` is its standard spelling.
    latexTrigger: ['\\simeq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'TildeFullEqual', // MathML: approximately equal to
    latexTrigger: ['\\cong'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'NotTildeFullEqual', // MathML: approximately but not actually equal to
    latexTrigger: ['\\ncong'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'Approx', // Note: Mathematica TildeTilde
    latexTrigger: ['\\approx'],
    kind: 'infix',
    associativity: 'right',
    precedence: 247,
  },
  {
    // Unicode ≈ (U+2248 ALMOST EQUAL TO): literal-glyph spelling of `\approx`.
    latexTrigger: ['≈'],
    kind: 'infix',
    associativity: 'right',
    precedence: 247,
    parse: 'Approx',
  },
  {
    name: 'NotApprox', // Note: Mathematica TildeTilde
    latexTrigger: ['\\not', '\\approx'],
    kind: 'infix',
    associativity: 'right',
    precedence: 247,
  },
  {
    name: 'ApproxEqual', // Note: Mathematica TildeEqual, MathML: `asymptotically equal to`
    latexTrigger: ['\\approxeq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'NotApproxEqual', // Note: Mathematica NotTildeEqual
    latexTrigger: ['\\not', '\\approxeq'],
    kind: 'infix', // Note: no LaTeX symbol for char U+2249
    associativity: 'right',
    precedence: 250,
  },
  {
    name: 'NotEqual',
    latexTrigger: ['\\ne'],
    kind: 'infix',
    associativity: 'right',
    precedence: 255,
  },
  {
    // `\neq` is the more common spelling of `\ne` (≠); parse-only alias
    // (serialization stays `\ne`).
    latexTrigger: ['\\neq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 255,
    parse: 'NotEqual',
  },
  {
    // `!=` (ASCII not-equal, per docs/LENIENT_PARSER.md `!=` → `\neq`) parses
    // as `NotEqual` so it actually evaluates — the inert `Unequal` head that no
    // handler reduced was the same dead-end as `EqualEqual`. `3!=2` is
    // not-equal; `3! = 2` (with a space) is still `Factorial(3) = 2` — see the
    // adjacency guard on the `Factorial` postfix. The `name: 'Unequal'` keeps
    // the `Unequal` → `!=` serialization for programmatically-built `Unequal`
    // expressions, while `parse` redirects the `!=` input to `NotEqual`.
    name: 'Unequal',
    latexTrigger: ['!', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE, // Note different precedence than \\ne per MathML
    parse: 'NotEqual',
  },
  {
    name: 'GreaterEqual',
    latexTrigger: ['\\ge'],
    kind: 'infix',
    associativity: 'right',
    precedence: 242, // Note: different precedence than `>=` as per MathML
  },
  {
    latexTrigger: ['\\geq'],
    kind: 'infix',
    associativity: 'right',
    precedence: 242, // Note: different precedence than `>=` as per MathML
    parse: 'GreaterEqual',
  },
  {
    latexTrigger: ['>', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: 243,
    parse: 'GreaterEqual',
  },
  {
    latexTrigger: ['\\geqslant'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5, // Note: different precedence than `>=` as per MathML
    parse: 'GreaterEqual',
  },
  {
    name: 'GreaterNotEqual',
    latexTrigger: ['\\gneqq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'NotGreaterNotEqual',
    latexTrigger: ['\\ngeqq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    latexTrigger: ['>'],
    kind: 'infix',
    associativity: 'right',
    precedence: 245,
    parse: 'Greater',
  },
  {
    name: 'Greater',
    latexTrigger: ['\\gt'],
    kind: 'infix',
    associativity: 'right',
    precedence: 245,
  },
  {
    name: 'NotGreater',
    latexTrigger: ['\\ngtr'],
    kind: 'infix',
    associativity: 'right',
    precedence: 244,
  },
  {
    latexTrigger: ['\\not', '>'],
    kind: 'infix',
    associativity: 'right',
    precedence: 244,
    parse: 'NotGreater',
  },
  {
    name: 'RingEqual',
    latexTrigger: ['\\circeq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'TriangleEqual', // MathML: delta equal to
    latexTrigger: ['\\triangleq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'DotEqual', // MathML: approaches the limit
    latexTrigger: ['\\doteq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5,
  },
  {
    name: 'DotEqualDot', // MathML: Geometrically equal
    latexTrigger: ['\\doteqdot'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5,
  },
  {
    name: 'FallingDotEqual', // MathML: approximately equal to or the image of
    latexTrigger: ['\\fallingdotseq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5,
  },
  {
    name: 'RisingDotEqual', // MathML: image of or approximately equal to
    latexTrigger: ['\\fallingdotseq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5,
  },
  {
    name: 'QuestionEqual',
    latexTrigger: ['\\questeq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'MuchLess',
    latexTrigger: ['\\ll'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'MuchGreater',
    latexTrigger: ['\\gg'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'Precedes',
    latexTrigger: ['\\prec'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'Succeeds',
    latexTrigger: ['\\succ'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'PrecedesEqual',
    latexTrigger: ['\\preccurlyeq'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'SucceedsEqual',
    latexTrigger: ['\\curlyeqprec'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'NotPrecedes',
    latexTrigger: ['\\nprec'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'NotSucceeds',
    latexTrigger: ['\\nsucc'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },

  {
    name: 'Between',
    latexTrigger: ['\\between'],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5,
  },
];
