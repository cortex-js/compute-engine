import { LatexDictionary } from './public';

export const DEFINITIONS_INEQUALITIES: LatexDictionary<number> = [
  {
    name: 'NotLess',
    trigger: { infix: ['!', '<'] },
    associativity: 'right',
    precedence: 246,
  },
  {
    name: 'NotLess',
    trigger: { infix: ['\\nless'] },
    associativity: 'right',
    precedence: 246,
  },
  {
    name: 'Less',
    trigger: { infix: ['<'] },
    associativity: 'right',
    precedence: 245,
  },
  {
    name: 'Less',
    trigger: { infix: ['\\lt'] },
    associativity: 'right',
    precedence: 245,
  },
  {
    name: 'LessEqual',
    trigger: { infix: ['<', '='] },
    associativity: 'right',
    precedence: 241,
  },
  {
    name: 'LessEqual',
    trigger: { infix: ['\\le'] },
    associativity: 'right',
    precedence: 241,
  },
  {
    name: 'LessEqual',
    trigger: { infix: ['\\leq'] },
    associativity: 'right',
    precedence: 241,
  },
  {
    name: 'LessEqual',
    trigger: { infix: ['\\leqslant'] },
    associativity: 'right',
    precedence: 265, // Note different precendence than `<=` as per MathML
  },
  {
    name: 'LessNotEqual',
    trigger: { infix: ['\\lneqq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'NotLessNotEqual',
    trigger: { infix: ['\\nleqq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'LessOverEqual',
    trigger: { infix: ['\\leqq'] },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'GreaterOverEqual',
    trigger: { infix: ['\\geqq'] },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'Equal',
    trigger: { infix: ['='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'StarEqual',
    trigger: { infix: ['*', '='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'StarEqual',
    trigger: { infix: ['\\star', '='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'PlusEqual',
    trigger: { infix: ['+', '='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'MinusEqual',
    trigger: { infix: ['-', '='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'SlashEqual',
    trigger: { infix: ['/', '='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'EqualEqual',
    trigger: { infix: ['=', '='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'EqualEqualEqual',
    trigger: { infix: ['=', '=', '='] },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'TildeFullEqual', // MathML: approximately equal to
    trigger: { infix: ['\\cong'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'NotTildeFullEqual', // MathML: approximately but not actually equal to
    trigger: { infix: ['\\ncong'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'Assign',
    trigger: { infix: [':', '='] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'Assign',
    trigger: { infix: ['\\coloneq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'Approx', // Note: Mathematica TildeTilde
    trigger: { infix: ['\\approx'] },
    associativity: 'right',
    precedence: 247,
  },
  {
    name: 'NotApprox', // Note: Mathematica TildeTilde
    trigger: { infix: ['\\approx'] },
    associativity: 'right',
    precedence: 247,
  },
  {
    name: 'ApproxEqual', // Note: Mathematica TildeEqual, MathML: `asymptotically equal to`
    trigger: { infix: ['\\approxeq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'NotApproxEqual', // Note: Mathematica NotTildeEqual
    trigger: { infix: ['!', '\\approxeq'] }, // Note: no LaTeX symbol for char U+2249
    associativity: 'right',
    precedence: 250,
  },
  {
    name: 'NotEqual',
    trigger: { infix: ['\\ne'] },
    associativity: 'right',
    precedence: 255,
  },
  {
    name: 'Unequal',
    trigger: { infix: ['!', '='] },
    associativity: 'right',
    precedence: 260, // Note different precendence than \\ne per MathML
  },
  {
    name: 'GreaterEqual',
    trigger: { infix: ['\\ge'] },
    associativity: 'right',
    precedence: 242, // Note: different precendence than `>=` as per MathML
  },
  {
    name: 'GreaterEqual',
    trigger: { infix: ['\\geq'] },
    associativity: 'right',
    precedence: 242, // Note: different precendence than `>=` as per MathML
  },
  {
    name: 'GreaterEqual',
    trigger: { infix: ['>', '='] },
    associativity: 'right',
    precedence: 243,
  },
  {
    name: 'GreaterEqual',
    trigger: { infix: ['\\geqslant'] },
    associativity: 'right',
    precedence: 265, // Note: different precendence than `>=` as per MathML
  },
  {
    name: 'GreaterNotEqual',
    trigger: { infix: ['\\gneqq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'NotGreaterNotEqual',
    trigger: { infix: ['\\ngeqq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'Greater',
    trigger: { infix: ['>'] },
    associativity: 'right',
    precedence: 245,
  },
  {
    name: 'Greater',
    trigger: { infix: ['\\gt'] },
    associativity: 'right',
    precedence: 245,
  },
  {
    name: 'NotGreater',
    trigger: { infix: ['\\ngtr'] },
    associativity: 'right',
    precedence: 244,
  },
  {
    name: 'NotGreater',
    trigger: { infix: ['!', '>'] },
    associativity: 'right',
    precedence: 244,
  },
  {
    name: 'RingEqual',
    trigger: { infix: ['\\circeq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'TriangleEqual', // MathML: delta equal to
    trigger: { infix: ['\\triangleq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'DotEqual', // MathML: approaches the limit
    trigger: { infix: ['\\doteq'] },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'DotEqualDot', // MathML: Geometrically equal
    trigger: { infix: ['\\doteqdot'] },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'FallingDotEqual', // MathML: approximately equal to or the image of
    trigger: { infix: ['\\fallingdotseq'] },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'RisingDotEqual', // MathML: image of or approximately equal to
    trigger: { infix: ['\\fallingdotseq'] },
    associativity: 'right',
    precedence: 265,
  },
  {
    name: 'QuestionEqual',
    trigger: { infix: ['\\questeq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'Equivalent', // MathML: identical to, Mathematica: Congruent
    trigger: { infix: ['\\equiv'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'MuchLess',
    trigger: { infix: ['\\ll'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'MuchGreater',
    trigger: { infix: ['\\gg'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'Precedes',
    trigger: { infix: ['\\prec'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'Succeeds',
    trigger: { infix: ['\\succ'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'PrecedesEqual',
    trigger: { infix: ['\\preccurlyeq'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'SucceedsEqual',
    trigger: { infix: ['\\curlyeqprec'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'NotPrecedes',
    trigger: { infix: ['\\nprec'] },
    associativity: 'right',
    precedence: 260,
  },
  {
    name: 'NotSucceeds',
    trigger: { infix: ['\\nsucc'] },
    associativity: 'right',
    precedence: 260,
  },

  {
    name: 'Between',
    trigger: { infix: ['\\between'] },
    associativity: 'right',
    precedence: 265,
  },
];
