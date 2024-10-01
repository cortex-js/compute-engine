import { LatexDictionaryEntry, COMPARISON_PRECEDENCE } from '../public';

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
    name: 'EqualEqual',
    latexTrigger: ['=', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'EqualEqualEqual',
    latexTrigger: ['=', '=', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE + 5,
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
    name: 'Unequal',
    latexTrigger: ['!', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: COMPARISON_PRECEDENCE, // Note different precedence than \\ne per MathML
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
