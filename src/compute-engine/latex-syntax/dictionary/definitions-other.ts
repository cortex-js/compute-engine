import type {
  LatexDictionary,
  Parser,
  Serializer,
  Terminator,
} from '../types.js';
import { COMPARISON_PRECEDENCE, MULTIPLICATION_PRECEDENCE } from '../types.js';

import {
  operand,
  operands,
  operator,
  getSequence,
  dictionaryFromExpression,
  machineValue,
  isEmptySequence,
  stringValue,
} from '../../../math-json/utils.js';
import {
  MathJsonExpression,
  MathJsonSymbol,
} from '../../../math-json/types.js';
import { joinLatex } from '../tokenizer.js';
import { PIPE_TOPIC_MARKER, parseTextRun } from './definitions-core.js';

// TeX dimension units (each letter is a separate token from the tokenizer)
const TEX_UNITS = [
  'pt',
  'em',
  'mu',
  'ex',
  'mm',
  'cm',
  'in',
  'bp',
  'sp',
  'dd',
  'cc',
  'pc',
  'nc',
  'nd',
];

/** Skip an inline TeX dimension (e.g., `3mu`, `-5pt`, `0.5em`).
 *  Used to consume arguments of `\hskip` and `\kern`.
 *  Each character is a separate token from the tokenizer. */
function skipTexDimension(parser: Parser): void {
  parser.skipSpace();
  // Skip optional sign
  if (parser.peek === '-' || parser.peek === '+') parser.nextToken();
  // Skip digits and decimal point
  while (/^[\d.]$/.test(parser.peek)) parser.nextToken();
  // Try to match a known two-letter TeX unit
  // Peek at the next two tokens to see if they form a known unit
  for (const unit of TEX_UNITS) {
    if (parser.matchAll([...unit])) return;
  }
}

function parseSingleArg(cmd: string): (parser: Parser) => MathJsonExpression {
  return (parser) => {
    const arg = parser.parseGroup();
    return arg === null ? [cmd] : [cmd, arg];
  };
}

/** Build a dictionary entry for a LaTeX command that takes a single braced
 *  argument and maps to a MathJSON decoration operator (accents, over/under
 *  arrows and braces), e.g. `\hat{x}` ↔ `["OverHat", x]`. Defining parse and
 *  serialize together keeps the two directions symmetric: without an explicit
 *  serializer these fall back to function-call notation (`\hat(x)`), which does
 *  not round-trip. */
function singleArgCommand(
  name: MathJsonSymbol,
  cmd: string
): LatexDictionary[number] {
  return {
    name,
    latexTrigger: [cmd],
    parse: parseSingleArg(name),
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const arg = operand(expr, 1);
      if (arg === null) return cmd;
      return `${cmd}{${serializer.serialize(arg)}}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry notation as inert heads.
//
// Euclidean-geometry notation (`\angle`, `\triangle`, `\square`, `\perp`,
// `\parallel`, `\widehat`, `\overparen`) is transcribed faithfully into inert
// "shell" heads — parsed and serialized, but never evaluated (the library
// declarations in `library/core.ts` have no `evaluate` handler). CE takes no
// position on geometry semantics; the structural parse is for consumers that
// render figures. See `docs/mathnet/parser-hardening-plan.md` (Tier 3, #6).
// ---------------------------------------------------------------------------

/** Parse a geometry *mark* — a prefix command (`\angle`, `\triangle`,
 *  `\square`) followed by a run of point labels, e.g. `\angle ABC`,
 *  `\triangle A B C`, `\angle A_1C_1B_1`. The immediately-following
 *  juxtaposition is captured and spread into separate operands so consumers
 *  get `["Angle", "A", "B", "C"]` (source order preserved). Capture stops at
 *  relational/arithmetic operators, so `\angle ABC = 90` yields
 *  `Equal(Angle(A,B,C), 90)` and `\angle A + \angle B` splits at `+`. When no
 *  label run follows (e.g. `\angle(\alpha,\beta)`), the single following
 *  expression is wrapped instead: `["Angle", expr]`. With nothing following,
 *  the `bare` fallback (or a zero-argument head) is returned. */
function parseGeometryMark(
  name: MathJsonSymbol,
  bare?: MathJsonExpression
): (parser: Parser, until?: Readonly<Terminator>) => MathJsonExpression | null {
  return (parser, until) => {
    // Capture the following juxtaposition (InvisibleOperator precedence 650)
    // but stop before additive/relational operators (< 390).
    const arg = parser.parseExpression({
      ...(until ?? {}),
      minPrec: MULTIPLICATION_PRECEDENCE,
    });
    if (arg === null || isEmptySequence(arg)) return bare ?? [name];
    const op = operator(arg);
    if (op === 'InvisibleOperator' || op === 'Multiply')
      return [name, ...operands(arg)];
    return [name, arg];
  };
}

/** Serialize a geometry mark head back to its prefix command, e.g.
 *  `Angle(A,B,C)` → `\angle ABC`. Point labels are concatenated (matching the
 *  parse), so the result round-trips through `parseGeometryMark`. */
function serializeGeometryMark(
  cmd: string
): (serializer: Serializer, expr: MathJsonExpression) => string {
  return (serializer, expr) => {
    const args = operands(expr);
    if (args.length === 0) return cmd;
    return cmd + ' ' + args.map((x) => serializer.serialize(x)).join('');
  };
}

/** Parse a geometry *accent* — a command taking a single braced argument
 *  (`\widehat{ABC}`, `\overparen{BC}`). Like the marks, a multi-letter argument
 *  is spread into separate operands: `\widehat{ABC}` → `["Arc","A","B","C"]`,
 *  while `\widehat{a}` → `["Arc","a"]`. */
function parseGeometryAccent(
  name: MathJsonSymbol
): (parser: Parser) => MathJsonExpression {
  return (parser) => {
    const arg = parser.parseGroup() ?? parser.parseToken();
    if (arg === null || isEmptySequence(arg)) return [name];
    const op = operator(arg);
    if (op === 'InvisibleOperator' || op === 'Multiply')
      return [name, ...operands(arg)];
    return [name, arg];
  };
}

/** Serialize a geometry accent head, e.g. `Arc(A,B,C)` → `\widehat{ABC}`. */
function serializeGeometryAccent(
  cmd: string
): (serializer: Serializer, expr: MathJsonExpression) => string {
  return (serializer, expr) => {
    const args = operands(expr);
    return cmd + '{' + args.map((x) => serializer.serialize(x)).join('') + '}';
  };
}

/** Parse a LaTeX "switch" command that sets a math style for everything
 *  following it in the current group (e.g. `{\displaystyle x+y}`). */
function parseMathStyleSwitch(
  mathStyle: string
): (parser: Parser) => MathJsonExpression {
  return (parser) => {
    const body = parser.parseExpression();
    if (body !== null && !isEmptySequence(body))
      return ['Annotated', body, { dict: { mathStyle } }];
    return 'Nothing';
  };
}

/** Parse a LaTeX "switch" command that sets a font size for everything
 *  following it in the current group (e.g. `{\large x+y}`). */
function parseSizeSwitch(size: number): (parser: Parser) => MathJsonExpression {
  return (parser) => {
    const body = parser.parseExpression();
    if (body !== null && !isEmptySequence(body))
      return ['Annotated', body, { dict: { size } }];
    return 'Nothing';
  };
}

export const DEFINITIONS_OTHERS: LatexDictionary = [
  {
    name: 'Overscript',
    latexTrigger: ['\\overset'],
    kind: 'infix',
    precedence: 700, // @todo: not in MathML
  },
  {
    name: 'Underscript',
    latexTrigger: ['\\underset'],
    kind: 'infix',
    precedence: 700, // @todo: not in MathML
  },
  // Note: the C-style `++`/`--` increment/decrement operators (`Increment`,
  // `Decrement`, `PreIncrement`, `PreDecrement`) used to be parsed here, but in
  // a mathematical context `--` and `++` are far more naturally read as double
  // negation / repeated unary plus. Parsing `x--y` as `Decrement` also broke
  // serializer round-trips: `Subtract(x, Negate(y))` serializes to `x--y`,
  // which used to re-parse as `Multiply(y, Decrement(x))`. With these entries
  // removed, `--` falls through to the arithmetic `-` operators, so `x--y`
  // parses as `x-(-y)` = `x+y` and `--x` as `-(-x)` = `x`. (The `PreIncrement`
  // / `PreDecrement` operator definitions remain in the arithmetic library for
  // programmatic use; they simply no longer have a `++`/`--` LaTeX trigger.)
  {
    name: 'Ring', // Aka 'Composition', i.e. function composition
    latexTrigger: ['\\circ'],
    kind: 'infix',
    precedence: 265, // @todo: MathML is 950
    // @todo: check lhs and rhs are functions
  },
  {
    name: 'StringJoin', // @todo From Mathematica...?
    latexTrigger: ['\\lt', '\\gt'],
    kind: 'infix',
    precedence: 780,
  },
  {
    name: 'Starstar',

    latexTrigger: ['\\star', '\\star'],
    kind: 'infix',
    precedence: 780,
  },
  {
    // Partial-derivative notation using the ∂ symbol. Both the Euler form
    // `∂_x f(x)` and the Leibniz form `∂f/∂x` (assembled by `parseFraction`)
    // canonicalize to the `D` operator. `PartialDerivative` is retained only as
    // a transient parse marker for the Leibniz pieces — `['PartialDerivative',
    // fnOrVar, degree]` — and is never emitted as a result.
    name: 'PartialDerivative',
    latexTrigger: ['\\partial'],
    kind: 'prefix',
    parse: (parser: Parser) => {
      let done = false;
      let sup: MathJsonExpression | null = 'Nothing';
      let sub: MathJsonExpression | null = 'Nothing';
      while (!done) {
        parser.skipSpace();
        if (parser.match('_')) {
          sub = parser.parseGroup() ?? parser.parseToken();
        } else if (parser.match('^')) {
          sup = parser.parseGroup() ?? parser.parseToken();
        } else {
          done = true;
        }
      }
      if (sub === null || sup === null) return null;

      // Euler notation with an explicit subscript variable, e.g. `∂_x f(x)`,
      // `∂_{x,y} f`, or `∂_x^2 f` — a complete derivative → `D`.
      if (sub !== 'Nothing') {
        const seq = getSequence(sub);
        const vars = seq ?? [sub];
        parser.skipSpace();
        let rhs: MathJsonExpression =
          parser.parseGroup() ?? parser.parseSymbol() ?? 'Nothing';
        if (!isEmptySequence(rhs)) {
          const args = parser.parseArguments();
          if (args) rhs = [rhs as MathJsonSymbol, ...args];
        }
        // A superscript degree repeats a single variable: ∂_x^2 f → D(f, x, x).
        const degree = machineValue(sup) ?? 1;
        const expanded: MathJsonExpression[] =
          vars.length === 1 && degree > 1
            ? Array.from({ length: degree }, () => vars[0])
            : [...vars];
        return ['D', rhs, ...expanded] as MathJsonExpression;
      }

      // Bare ∂ (a Leibniz numerator or denominator piece). Greedily absorb a
      // chain of ∂-terms in the same group, so a denominator like `∂x ∂y` or
      // `∂x²` is captured by this single marker rather than tripping the group
      // parser on the following prefix `∂`. Each term contributes a variable
      // (a `∂xⁿ` exponent repeats it). The numerator forms `∂f` and bare `∂`
      // yield a single item, left for `parseFraction` to interpret.
      const items: MathJsonExpression[] = [];
      const grabItem = () => {
        parser.skipSpace();
        let v: MathJsonExpression =
          parser.parseGroup() ?? parser.parseSymbol() ?? 'Nothing';
        let reps = 1;
        if (operator(v) === 'Power') {
          reps = machineValue(operand(v, 2)) ?? 1;
          v = operand(v, 1) ?? v;
        } else if (parser.match('^')) {
          const e = parser.parseGroup() ?? parser.parseToken();
          reps = machineValue(e) ?? 1;
        }
        for (let i = 0; i < reps; i++) items.push(v);
      };
      grabItem();
      while (true) {
        parser.skipSpace();
        if (!parser.match('\\partial')) break;
        grabItem();
      }
      if (items.length === 1)
        return ['PartialDerivative', items[0], sup] as MathJsonExpression;
      return [
        'PartialDerivative',
        ['List', ...items],
        sup,
      ] as MathJsonExpression;
    },
    precedence: 740,
  },
  singleArgCommand('OverBar', '\\overline'),
  singleArgCommand('UnderBar', '\\underline'),
  singleArgCommand('OverVector', '\\vec'),
  singleArgCommand('OverTilde', '\\tilde'),
  singleArgCommand('OverHat', '\\hat'),
  singleArgCommand('OverRightArrow', '\\overrightarrow'),
  singleArgCommand('OverLeftArrow', '\\overleftarrow'),
  singleArgCommand('OverRightDoubleArrow', '\\Overrightarrow'),
  singleArgCommand('OverLeftHarpoon', '\\overleftharpoon'),
  singleArgCommand('OverRightHarpoon', '\\overrightharpoon'),
  singleArgCommand('OverLeftRightArrow', '\\overleftrightarrow'),
  singleArgCommand('OverBrace', '\\overbrace'),
  singleArgCommand('UnderBrace', '\\underbrace'),
  singleArgCommand('OverLineSegment', '\\overlinesegment'),
  singleArgCommand('OverGroup', '\\overgroup'),

  {
    latexTrigger: ['\\textcolor'],
    parse: (parser: Parser): MathJsonExpression => {
      const pos = parser.index;
      const color = parser.parseStringGroup();
      const body = parser.parseGroup();
      if (color !== null) {
        if (body !== null) return ['Annotated', body, { dict: { color } }];
        return 'Nothing';
      }
      // We had an opening `\textcolor` but no closing `}`
      // We return the `\textcolor` command as a string
      parser.index = pos;
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\colorbox'],
    parse: (parser: Parser): MathJsonExpression => {
      const pos = parser.index;
      const backgroundColor = parser.parseStringGroup();
      const body = parser.parseGroup();
      if (backgroundColor !== null) {
        if (body !== null)
          return ['Annotated', body, { dict: { backgroundColor } }];
        return 'Nothing';
      }
      parser.index = pos;
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\boxed'],
    parse: (parser: Parser): MathJsonExpression => {
      const body = parser.parseGroup();
      if (body !== null) return ['Annotated', body, { dict: { border: true } }];
      return 'Nothing';
    },
  },
  //
  // Text-styling commands: parse the argument as a text run (like `\text`)
  // and wrap it in an `Annotated` expression carrying the style dictionary.
  // The `Annotated` serializer (below) re-emits these from the dict keys.
  // Note: the same commands are also handled *inside* a text run by
  // `parseTextRun`; these entries handle them at the top level (math mode).
  //
  {
    latexTrigger: ['\\textbf'],
    parse: (parser: Parser) => parseTextRun(parser, { fontWeight: 'bold' }),
  },
  {
    latexTrigger: ['\\textit'],
    parse: (parser: Parser) => parseTextRun(parser, { fontStyle: 'italic' }),
  },
  {
    latexTrigger: ['\\emph'],
    parse: (parser: Parser) => parseTextRun(parser, { fontStyle: 'italic' }),
  },
  {
    latexTrigger: ['\\textup'],
    parse: (parser: Parser) => parseTextRun(parser, { fontStyle: 'normal' }),
  },
  {
    latexTrigger: ['\\texttt'],
    parse: (parser: Parser) =>
      parseTextRun(parser, { fontFamily: 'monospace' }),
  },
  {
    latexTrigger: ['\\textsf'],
    parse: (parser: Parser) =>
      parseTextRun(parser, { fontFamily: 'sans-serif' }),
  },
  {
    // Plain text run, no styling annotation (same result as `\text{…}`)
    latexTrigger: ['\\textrm'],
    parse: (parser: Parser) => parseTextRun(parser),
  },
  {
    latexTrigger: ['\\mbox'],
    parse: (parser: Parser) => parseTextRun(parser),
  },
  {
    latexTrigger: ['\\displaystyle'],
    parse: parseMathStyleSwitch('normal'),
  },
  {
    latexTrigger: ['\\textstyle'],
    parse: parseMathStyleSwitch('compact'),
  },
  {
    latexTrigger: ['\\scriptstyle'],
    parse: parseMathStyleSwitch('script'),
  },
  {
    latexTrigger: ['\\scriptscriptstyle'],
    parse: parseMathStyleSwitch('scriptscript'),
  },
  {
    latexTrigger: ['\\color'],
    parse: (parser: Parser): MathJsonExpression => {
      const color = parser.parseStringGroup();
      if (color !== null) {
        const body = parser.parseExpression();
        if (body !== null && !isEmptySequence(body))
          return ['Annotated', body, { dict: { color } }];
      }
      return 'Nothing';
    },
  },

  {
    latexTrigger: ['\\tiny'],
    parse: parseSizeSwitch(1),
  },
  {
    latexTrigger: ['\\scriptsize'],
    parse: parseSizeSwitch(2),
  },
  {
    latexTrigger: ['\\footnotesize'],
    parse: parseSizeSwitch(3),
  },
  {
    latexTrigger: ['\\small'],
    parse: parseSizeSwitch(4),
  },
  {
    latexTrigger: ['\\normalsize'],
    parse: parseSizeSwitch(5),
  },
  {
    latexTrigger: ['\\large'],
    parse: parseSizeSwitch(6),
  },
  {
    latexTrigger: ['\\Large'],
    parse: parseSizeSwitch(7),
  },
  {
    latexTrigger: ['\\LARGE'],
    parse: parseSizeSwitch(8),
  },
  {
    latexTrigger: ['\\huge'],
    parse: parseSizeSwitch(9),
  },
  {
    latexTrigger: ['\\Huge'],
    parse: parseSizeSwitch(10),
  },

  {
    name: 'Annotated',
    serialize: (serializer, expr): string => {
      let result = serializer.serialize(operand(expr, 1));

      const dict = dictionaryFromExpression(operand(expr, 2));
      if (dict === null || dict === undefined) return result;

      // Text-family styling commands (`\textbf`, `\textit`, `\texttt`, …) are
      // themselves text-mode wrappers, so a plain-string body should be
      // emitted as raw text, not re-wrapped in `\text{…}` — otherwise
      // `\textbf{abc}` would serialize to `\textbf{\text{abc}}` (which does not
      // round-trip through `parseTextRun`).
      const rawText = stringValue(operand(expr, 1));
      if (
        rawText !== null &&
        (dict.dict.fontFamily === 'monospace' ||
          dict.dict.fontFamily === 'sans-serif' ||
          dict.dict.fontWeight === 'bold' ||
          dict.dict.fontStyle === 'italic' ||
          dict.dict.fontStyle === 'normal')
      )
        result = rawText;

      //
      // Display: "math style"
      //
      if (dict.dict.mathStyle === 'normal')
        result = joinLatex(['{\\displaystyle', result, '}']);
      else if (dict.dict.mathStyle === 'compact')
        result = joinLatex(['{\\textstyle', result, '}']);
      else if (dict.dict.mathStyle === 'script')
        result = joinLatex(['{\\scriptstyle', result, '}']);
      else if (dict.dict.mathStyle === 'scriptscript')
        result = joinLatex(['{\\scriptscriptstyle', result, '}']);

      //
      // Font Size
      //
      const v = dict.dict.size as number;
      if (v !== null && v >= 1 && v <= 10) {
        result = joinLatex([
          '{',
          {
            1: '\\tiny',
            2: '\\scriptsize',
            3: '\\footnotesize',
            4: '\\small',
            5: '\\normalsize',
            6: '\\large',
            7: '\\Large',
            8: '\\LARGE',
            9: '\\huge',
            10: '\\Huge',
          }[v]!,
          result,
          '}',
        ]);
      }

      //
      // Font family
      //
      if (dict.dict.fontFamily === 'monospace')
        result = joinLatex(['\\texttt{', result, '}']);
      else if (dict.dict.fontFamily === 'sans-serif')
        result = joinLatex(['\\textsf{', result, '}']);

      if (dict.dict.fontWeight === 'bold')
        result = joinLatex(['\\textbf{', result, '}']);

      if (dict.dict.fontStyle === 'italic')
        result = joinLatex(['\\textit{', result, '}']);
      else if (dict.dict.fontStyle === 'normal')
        result = joinLatex(['\\textup{', result, '}']);

      //
      // Color
      //
      if (dict.dict.color)
        result = joinLatex([
          '\\textcolor{',
          dict.dict.color as string,
          '}{',
          result,
          '}',
        ]);

      //
      // Background Color
      //
      if (dict.dict.backgroundColor)
        result = joinLatex([
          '\\colorbox{',
          dict.dict.backgroundColor as string,
          '}{',
          result,
          '}',
        ]);

      //
      // Border
      //
      if (dict.dict.border === true)
        result = joinLatex(['\\boxed{', result, '}']);

      //
      // Annotation
      //

      return result;
    },
  },
  {
    latexTrigger: ['\\!'],
    parse: () => ['HorizontalSpacing', -3] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\ '],
    parse: () => ['HorizontalSpacing', 6] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\:'],
    parse: () => ['HorizontalSpacing', 4] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\enskip'],
    parse: () => ['HorizontalSpacing', 9] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\quad'],
    parse: () => ['HorizontalSpacing', 18] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\qquad'],
    parse: () => ['HorizontalSpacing', 36] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\,'],
    parse: () => ['HorizontalSpacing', 3] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\;'],
    parse: () => ['HorizontalSpacing', 5] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\enspace'],
    parse: () => ['HorizontalSpacing', 9] as MathJsonExpression,
  },
  {
    latexTrigger: ['\\hspace'],
    parse: (parser: Parser): MathJsonExpression => {
      if (parser.peek === '*') parser.nextToken();
      parser.parseStringGroup(); // consume the braced dimension argument
      return ['HorizontalSpacing', 0];
    },
  },
  {
    latexTrigger: ['\\hskip'],
    parse: (parser: Parser): MathJsonExpression => {
      skipTexDimension(parser);
      return ['HorizontalSpacing', 0];
    },
  },
  {
    latexTrigger: ['\\kern'],
    parse: (parser: Parser): MathJsonExpression => {
      skipTexDimension(parser);
      return ['HorizontalSpacing', 0];
    },
  },
  {
    latexTrigger: ['\\phantom'],
    parse: (parser: Parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\vphantom'],
    parse: (parser: Parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\hphantom'],
    parse: (parser: Parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\placeholder'],
    parse: (parser: Parser) => {
      parser.parseOptionalGroup();
      return parser.parseGroup() ?? 'Nothing';
    },
  },
  {
    latexTrigger: ['\\smash'],
    parse: (parser: Parser) => {
      parser.parseGroup();
      return 'Nothing';
    },
  },
  {
    latexTrigger: ['\\strut'],
    parse: (_parser: Parser) => 'Nothing',
  },
  {
    latexTrigger: ['\\mathstrut'],
    parse: (_parser: Parser) => 'Nothing',
  },
  {
    name: 'HorizontalSpacing',
    // The `HorizontalSpacing` function has two forms
    // `["HorizontalSpacing", number]` -> indicate a space of mu units
    // `["HorizontalSpacing", expr, 'op'|'bin'|rel]` -> indicate a spacing around and expression, i.e. `\mathbin{x}`, etc...
    serialize: (serializer, expr): string => {
      if (operand(expr, 2) !== null) {
        const cls = stringValue(operand(expr, 2));
        const inner = serializer.serialize(operand(expr, 1));
        if (cls === 'bin') return `\\mathbin{${inner}}`;
        if (cls === 'op') return `\\mathop{${inner}}`;
        if (cls === 'rel') return `\\mathrel{${inner}}`;
        if (cls === 'ord') return `\\mathord{${inner}}`;
        if (cls === 'open') return `\\mathopen{${inner}}`;
        if (cls === 'close') return `\\mathclose{${inner}}`;
        if (cls === 'punct') return `\\mathpunct{${inner}}`;
        if (cls === 'inner') return `\\mathinner{${inner}}`;
        return inner;
      }

      const v = machineValue(operand(expr, 1));
      if (v === null) return '';
      return (
        {
          '-3': '\\!',
          6: '\\ ',
          3: '\\,',
          4: '\\:',
          5: '\\;',
          9: '\\enspace',
          18: '\\quad',
          36: '\\qquad',
        }[v] ?? ''
      );
    },
  },
  // if (
  //   [
  //     '\\!',
  //     '\\:',
  //     '\\enskip',
  //     '\\quad',
  //     '\\,',
  //     '\\;',
  //     '\\enspace',
  //     '\\qquad',
  //     '\\selectfont',
  //   ].includes(token)
  // ) {
  //   return 'skip';
  // }

  // {
  //     name: '',
  //     trigger: '\\mathring',
  // },
  // {
  //     name: '',
  //     trigger: '\\check',
  // },

  // ---------------------------------------------------------------------------
  // Function-style aliases for collection / random operators that some
  // notations write in lowercase (e.g. `\operatorname{shuffle}(L)`).
  // The capitalized library entries already exist; these are pure parse
  // aliases so the lowercase names don't land in `unsupported-operator`.
  // ---------------------------------------------------------------------------
  { latexTrigger: '\\operatorname{count}', parse: 'Length' },
  { latexTrigger: '\\operatorname{length}', parse: 'Length' },
  // `nCr(n, r)` = binomial coefficient. (No `nPr` alias: CE's `Permutations`
  // enumerates arrangements of a collection; there is no n!/(n−r)! counting
  // operator to map it to.)
  { latexTrigger: '\\operatorname{nCr}', parse: 'Choose' },
  { latexTrigger: '\\operatorname{random}', parse: 'Random' },
  { latexTrigger: '\\operatorname{shuffle}', parse: 'Shuffle' },
  { latexTrigger: '\\operatorname{repeat}', parse: 'Repeat' },
  { latexTrigger: '\\operatorname{join}', parse: 'Join' },
  { latexTrigger: '\\operatorname{range}', parse: 'Range' },
  { latexTrigger: '\\operatorname{histogram}', parse: 'Histogram' },
  { latexTrigger: '\\operatorname{pdf}', parse: 'PDF' },
  { latexTrigger: '\\operatorname{cdf}', parse: 'CDF' },

  // Note: `\operatorname{with}` (Desmos's local-binding clause) is intentionally
  // NOT registered here. Use the math-notation equivalent `\operatorname{where}`
  // (with `\coloneq` for bindings), or register `with` as a custom dictionary
  // entry at the integration layer — see the "Desmos-Specific Syntax — Prefer
  // Custom LaTeX Dictionary" section in COMPUTE_ENGINE.md for a worked example.

  // ---------------------------------------------------------------------------
  // Geometric primitive heads. Registered as known typed heads so consumers
  // can branch on the operator name; CE itself doesn't render them. The
  // library entries (with no evaluator) live in `library/core.ts`.
  // ---------------------------------------------------------------------------
  {
    name: 'Triangle',
    latexTrigger: ['\\operatorname{triangle}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{triangle}' + serializer.wrapArguments(expr),
  },
  // Desmos's geometric `vector(p1, p2)` — a directed segment between two
  // points. Routed to a dedicated head (not the existing column-vector
  // `Vector`, which has a narrower `(number+) -> vector` signature).
  {
    name: 'GeometricVector',
    latexTrigger: ['\\operatorname{vector}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{vector}' + serializer.wrapArguments(expr),
  },
  {
    name: 'Sphere',
    latexTrigger: ['\\operatorname{sphere}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{sphere}' + serializer.wrapArguments(expr),
  },
  {
    name: 'Segment',
    latexTrigger: ['\\operatorname{segment}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{segment}' + serializer.wrapArguments(expr),
  },
  {
    name: 'Polygon',
    latexTrigger: ['\\operatorname{polygon}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{polygon}' + serializer.wrapArguments(expr),
  },

  // --- Euclidean-geometry notation (inert; see the block comment above the
  // parseGeometryMark helper). ---

  // Angle mark: `\angle ABC`, `\varangle X Y Z`, `∠ABC` → `Angle(A,B,C)`.
  {
    name: 'Angle',
    latexTrigger: ['\\angle'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Angle'),
    serialize: serializeGeometryMark('\\angle'),
  },
  // `\varangle` is a variant angle glyph; folded onto the same `Angle` head
  // (serialization uses `\angle`).
  {
    latexTrigger: ['\\varangle'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Angle'),
  },
  // `\measuredangle` (AMS) and `\Varangle` (marvosym/European sources) are
  // further variant angle glyphs; also folded onto `Angle`.
  {
    latexTrigger: ['\\measuredangle'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Angle'),
  },
  {
    latexTrigger: ['\\Varangle'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Angle'),
  },
  // Unicode `∠` (U+2220) and `∡` (U+2221 MEASURED ANGLE) — same as `\angle`.
  {
    latexTrigger: ['∠'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Angle'),
  },
  {
    latexTrigger: ['∡'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Angle'),
  },

  // Triangle mark: `\triangle ABC` → `Triangle(A,B,C)`. Parse-only: the
  // `Triangle` head already has a serializer (`\operatorname{triangle}(...)`)
  // above, and the infix `\triangle` (SymmetricDifference) remains available
  // for set expressions — a leading `\triangle` (no left operand) is the mark.
  {
    latexTrigger: ['\\triangle'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Triangle'),
  },

  // Quadrilateral mark: `\square ABCD` → `Quadrilateral(A,B,C,D)`. A bare
  // `\square` (placeholder / QED / pipeline topic marker) falls back to the
  // topic-marker symbol, which has its own `\square` serializer in
  // definitions-core.ts. (`Square` is taken by the `x^2` head, hence
  // `Quadrilateral`.)
  {
    name: 'Quadrilateral',
    latexTrigger: ['\\square'],
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: parseGeometryMark('Quadrilateral', PIPE_TOPIC_MARKER),
    serialize: serializeGeometryMark('\\square'),
  },

  // Perpendicular / parallel relations: `FG \perp AO` → `Perpendicular(FG, AO)`,
  // `AB \parallel CD` → `Parallel(AB, CD)`. Operands arrive as juxtaposition
  // runs (e.g. `Multiply(F, G)`); that is acceptable for inert transcription.
  {
    name: 'Perpendicular',
    latexTrigger: ['\\perp'],
    kind: 'infix',
    precedence: COMPARISON_PRECEDENCE,
  },
  {
    name: 'Parallel',
    latexTrigger: ['\\parallel'],
    kind: 'infix',
    precedence: COMPARISON_PRECEDENCE,
  },

  // Arc / over-paren accents: `\widehat{ABC}` → `Arc(A,B,C)`,
  // `\overparen{BC}` → `OverParen(B,C)`.
  {
    name: 'Arc',
    latexTrigger: ['\\widehat'],
    parse: parseGeometryAccent('Arc'),
    serialize: serializeGeometryAccent('\\widehat'),
  },
  {
    name: 'OverParen',
    latexTrigger: ['\\overparen'],
    parse: parseGeometryAccent('OverParen'),
    serialize: serializeGeometryAccent('\\overparen'),
  },
];

// https://reference.wolfram.com/language/tutorial/TextualInputAndOutput.html
