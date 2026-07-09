import { MathJsonExpression } from '../../../math-json/types.js';
import {
  machineValue,
  mapArgs,
  operand,
  nops,
  stringValue,
  operator,
  operands,
  missingIfEmpty,
  stripText,
  isEmptySequence,
  unhold,
  symbol,
  dictionaryFromEntries,
} from '../../../math-json/utils.js';
import {
  ADDITION_PRECEDENCE,
  ARROW_PRECEDENCE,
  ASSIGNMENT_PRECEDENCE,
  LatexDictionary,
  LatexDictionaryEntry,
  Parser,
  PostfixEntry,
  Serializer,
  Terminator,
} from '../types.js';
import { joinLatex, supsub } from '../tokenizer.js';
import { isEquationOperator, isInequalityOperator } from '../utils.js';
import { BoxedType } from '../../../common/type/boxed-type.js';
import { parseQuantifier } from './definitions-logic.js';

// ---------------------------------------------------------------------------
// Component-access member-name table (C2)
// ---------------------------------------------------------------------------

const COMPONENT_ACCESS_HEADS: Record<string, string> = {
  x: 'First',
  y: 'Second',
  z: 'Third',
  real: 'Real',
  re: 'Real',
  imag: 'Imaginary',
  im: 'Imaginary',
  count: 'Length',
  length: 'Length',
  total: 'Sum',
  max: 'Max',
  min: 'Min',
};

function memberHead(name: string): string | null {
  return COMPONENT_ACCESS_HEADS[name] ?? null;
}

// ---------------------------------------------------------------------------
// Component-access postfix parse function (C3)
// ---------------------------------------------------------------------------
//
// Called after the '.' trigger has already been consumed.
// Handles three forms:
//   Form 1: \operatorname{name}
//   Form 2: \command-name   (e.g. \max, \min)
//   Form 3: bare letter     (x, y, z)
//
function parseComponentAccess(
  parser: Parser,
  lhs: MathJsonExpression
): MathJsonExpression | null {
  parser.skipVisualSpace();

  // Form 1: \operatorname{name}
  if (parser.match('\\operatorname')) {
    const name = parser.parseStringGroup();
    if (name === null) return null;
    const head = memberHead(name.trim());
    if (head === null) return null;
    return [head, lhs] as MathJsonExpression;
  }

  // Form 2: \command-name  (e.g. \max → 'max', \min → 'min')
  const tok = parser.peek;
  if (typeof tok === 'string' && tok.startsWith('\\')) {
    const bare = tok.slice(1); // strip leading backslash
    const head = memberHead(bare);
    if (head !== null) {
      parser.nextToken(); // consume the command token
      return [head, lhs] as MathJsonExpression;
    }
    // Unknown command — don't consume, return null
    return null;
  }

  // Form 3: bare letter (single character a–z or A–Z)
  if (typeof tok === 'string' && /^[a-zA-Z]$/.test(tok)) {
    // Dictionary key access: when the LHS is a symbol declared as a
    // `dictionary`, `.member` reads a run of letters as a string key —
    // `data.height` → `At(data, "height")`. The key is constrained to
    // alphabetic, space-free names to keep `.` unambiguous. This is checked
    // before the component-access heads, so a dictionary's `.x` / `.real` is a
    // key lookup, not a `First` / `Real` component. Non-dictionary LHS keep the
    // existing (deliberately tight) single-letter member behavior below.
    const lhsSym = symbol(lhs);
    if (lhsSym !== null && parser.getSymbolType(lhsSym).matches('dictionary')) {
      let key = '';
      while (typeof parser.peek === 'string' && /^[a-zA-Z]$/.test(parser.peek))
        key += parser.nextToken();
      return ['At', lhs, { str: key }] as MathJsonExpression;
    }

    const head = memberHead(tok);
    if (head === null) return null;
    parser.nextToken(); // consume the letter
    return [head, lhs] as MathJsonExpression;
  }

  return null;
}

// ---------------------------------------------------------------------------
// When-restriction postfix parse function (D3)
// ---------------------------------------------------------------------------
//
// Handles `expr\left\{cond\right\}` → `When(expr, cond)`.
// Called after the trigger tokens have been consumed.
//
// Two postfix entries use this function:
//   - trigger ['\\left', '\\{']  → close ['\\right', '\\}']
//   - trigger ['\\{']            → close ['\\}']
//
function parseWhenRestriction(
  parser: Parser,
  lhs: MathJsonExpression,
  close: string[]
): MathJsonExpression | null {
  // Add a boundary so that parseExpression stops before the close delimiter.
  parser.addBoundary(close);

  parser.skipVisualSpace();
  const cond = parser.parseExpression({ minPrec: 0 });

  if (cond === null) {
    parser.removeBoundary();
    return null;
  }

  parser.skipVisualSpace();

  // matchBoundary() pops the boundary on success only; on failure the
  // boundary stays on the stack, so we must remove it before bailing out
  // or subsequent parsing will see a stray boundary.
  if (!parser.matchBoundary()) {
    parser.removeBoundary();
    return null;
  }

  return ['When', lhs, cond] as MathJsonExpression;
}

// function isSpacingToken(token: string): boolean {
//   return (
//     token === '<space>' ||
//     token === '\\qquad' ||
//     token === '\\quad' ||
//     token === '\\enskip' ||
//     token === '\\;' ||
//     token === '\\,' ||
//     token === '\\ ' ||
//     token === '~'
//   );
// }

/**
 * Parse a sequence of expressions separated with `sep`
 */
function parseSequence(
  parser: Parser,
  terminator: Readonly<Terminator> | undefined,
  lhs: MathJsonExpression | null,
  prec: number,
  sep: string
): MathJsonExpression[] | null {
  if (terminator && terminator.minPrec >= prec) return null;

  const result: MathJsonExpression[] = lhs ? [lhs] : ['Nothing'];
  let done = false;
  while (!done) {
    done = true;

    parser.skipSpace();
    while (parser.match(sep)) {
      result.push('Nothing');
      parser.skipSpace();
    }
    parser.skipVisualSpace();

    if (parser.atTerminator(terminator)) {
      result.push('Nothing');
    } else {
      const rhs = parser.parseExpression({ ...terminator, minPrec: prec });
      result.push(rhs ?? 'Nothing');
      done = rhs === null;
    }
    if (!done) {
      parser.skipSpace();
      done = !parser.match(sep);
      if (!done) parser.skipVisualSpace();
    }
  }

  return result;
}

/** Serialize a `Sequence`: juxtapose operands with a space, but fall back to a
 *  comma at any boundary where the left side ends with a digit and the right
 *  side starts with a digit or sign, which would otherwise fuse into a single
 *  number on re-parse (e.g. `1 2` → `12`). */
function serializeSequence(
  serializer: Serializer,
  expr: MathJsonExpression | null
): string {
  if (!expr) return '';
  const xs = operands(expr);
  if (xs.length === 0) return '';
  if (xs.length === 1) return serializer.serialize(xs[0]);

  const parts = xs.map((x) => serializer.serialize(x));
  const ys: string[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const prev = parts[i - 1];
    const cur = parts[i];
    const fuses = /[0-9]$/.test(prev) && /^[-+0-9]/.test(cur);
    ys.push(fuses ? ', ' : ' ', cur);
  }
  return joinLatex(ys);
}

function serializeOps(sep = '') {
  return (serializer: Serializer, expr: MathJsonExpression | null): string => {
    if (!expr) return '';
    const xs = operands(expr);
    if (xs.length === 0) return '';
    if (xs.length === 1) return serializer.serialize(xs[0]);

    sep =
      {
        '&': '\\&',
        ':': '\\colon',
        '|': '\\mvert',
        '-': '-',
        '\u00b7': '\\cdot', // U+00B7 MIDDLE DOT
        '\u2012': '-', // U+2012 FIGURE DASH
        '\u2013': '--', // U+2013 EN DASH
        '\u2014': '---', // U+2014 EM DASH
        '\u2015': '-', // U+2015 HORIZONTAL BAR
        '\u2022': '\\bullet', // U+2022 BULLET
        '\u2026': '\\ldots',
      }[sep] ?? sep;

    const ys = xs.reduce((acc, item) => {
      acc.push(serializer.serialize(item), sep);
      return acc;
    }, [] as string[]);

    ys.pop();

    return joinLatex(ys);
  };
}

//
// Keyword constructs
//
// Several control-flow / logic keywords (`if`/`then`/`else`, `for`/`from`/
// `to`/`do`, `where`, `and`, `or`, the quantifiers, …) can be written three
// equivalent ways:
//   - `\text{if}`        — text-mode spelling (conventional, but switches the
//                          editor to text mode, which is awkward to input)
//   - `\keyword{if}`     — math-mode keyword command, with symmetric keyword
//                          spacing on both sides (unlike `\operatorname`, whose
//                          spacing is tuned for function application)
//   - `\operatorname{if}` / `\mathrm{if}` — operator-name spelling
//
// Rather than hand-writing an entry per (keyword × spelling), the KEYWORDS
// table below is the single source of truth, and `keywordEntries()` generates
// the `\text`- and `\keyword`-triggered entries (plus an `\operatorname`/symbol
// entry where `operatorname` is set) for each. Inner keywords (`then`, `else`,
// `from`, `to`, `do`, `with`) are matched on demand by `matchKeyword()`, which
// accepts all three spellings.
//

type KeywordPrefixBuild = (
  parser: Parser,
  until?: Readonly<Terminator>
) => MathJsonExpression | null;

type KeywordInfixBuild = (
  parser: Parser,
  lhs: MathJsonExpression,
  until: Readonly<Terminator>
) => MathJsonExpression | null;

type KeywordDef =
  | {
      surface: string;
      kind: 'prefix';
      precedence: number;
      operatorname?: boolean;
      build: KeywordPrefixBuild;
    }
  | {
      surface: string;
      kind: 'infix';
      precedence: number;
      associativity?: 'right' | 'none';
      operatorname?: boolean;
      build: KeywordInfixBuild;
    };

const KEYWORDS: KeywordDef[] = [
  // Control flow
  {
    surface: 'if',
    kind: 'prefix',
    precedence: 245,
    operatorname: true,
    build: parseIfExpression,
  },
  {
    surface: 'for',
    kind: 'prefix',
    precedence: 245,
    operatorname: true,
    build: parseForExpression,
  },
  {
    surface: 'for',
    kind: 'infix',
    precedence: 19, // Just below comma (20), so the body is captured whole
    associativity: 'none',
    operatorname: true,
    build: (parser, lhs, until) => parseForComprehension(parser, lhs, until),
  },
  {
    surface: 'break',
    kind: 'prefix',
    precedence: 245,
    operatorname: true,
    build: () => ['Break'] as MathJsonExpression,
  },
  {
    surface: 'continue',
    kind: 'prefix',
    precedence: 245,
    operatorname: true,
    build: () => ['Continue'] as MathJsonExpression,
  },
  {
    surface: 'return',
    kind: 'prefix',
    precedence: 245,
    operatorname: true,
    build: (parser, until) =>
      [
        'Return',
        parser.parseExpression(until) ?? 'Nothing',
      ] as MathJsonExpression,
  },

  // Quantifiers
  {
    surface: 'for all',
    kind: 'prefix',
    precedence: 200, // Same as \forall
    build: (parser, until) => parseQuantifier('ForAll')(parser, until!),
  },
  {
    surface: 'there exists',
    kind: 'prefix',
    precedence: 200, // Same as \exists
    build: (parser, until) => parseQuantifier('Exists')(parser, until!),
  },

  // Variable binding / constraints
  {
    surface: 'where',
    kind: 'infix',
    precedence: 21, // Above ; (19) and , (20), very low binding
    associativity: 'none',
    operatorname: true,
    build: (parser, lhs, until) => parseWhereExpression(parser, lhs, until),
  },
  {
    surface: 'such that',
    kind: 'infix',
    precedence: 21, // Low precedence to capture full condition (like 'where')
    associativity: 'right',
    build: (parser, lhs, until) =>
      [
        'Colon',
        lhs,
        parser.parseExpression({ ...until, minPrec: 21 }) ?? 'Nothing',
      ] as MathJsonExpression,
  },

  // Logical connectives
  {
    surface: 'and',
    kind: 'infix',
    precedence: 235, // Same as \land
    associativity: 'right',
    build: (parser, lhs, until) =>
      [
        'And',
        lhs,
        parser.parseExpression({ ...until, minPrec: 235 }) ?? 'Nothing',
      ] as MathJsonExpression,
  },
  {
    surface: 'or',
    kind: 'infix',
    precedence: 230, // Same as \lor
    associativity: 'right',
    build: (parser, lhs, until) =>
      [
        'Or',
        lhs,
        parser.parseExpression({ ...until, minPrec: 230 }) ?? 'Nothing',
      ] as MathJsonExpression,
  },
  {
    surface: 'iff',
    kind: 'infix',
    precedence: 219, // Same as \iff
    associativity: 'right',
    build: (parser, lhs, until) =>
      [
        'Equivalent',
        lhs,
        parser.parseExpression({ ...until, minPrec: 219 }) ?? 'Nothing',
      ] as MathJsonExpression,
  },
  {
    surface: 'if and only if',
    kind: 'infix',
    precedence: 219,
    associativity: 'right',
    build: (parser, lhs, until) =>
      [
        'Equivalent',
        lhs,
        parser.parseExpression({ ...until, minPrec: 219 }) ?? 'Nothing',
      ] as MathJsonExpression,
  },
];

/**
 * Generate the LaTeX dictionary entries for every keyword in `KEYWORDS`.
 *
 * For each keyword we emit a `\text{…}`- and a `\keyword{…}`-triggered entry of
 * the keyword's kind/precedence, and — when `operatorname` is set — an
 * `\operatorname{…}` / `\mathrm{…}` (symbol-trigger) entry. The `\text`/
 * `\keyword` entries match the braced surface form (the framework has already
 * consumed the trigger token) before delegating to the keyword's `build`.
 *
 * A final catch-all routes `\keyword{…}` whose content is not a known keyword
 * to a plain text run (a `String`), mirroring `\text{…}`. That is what lets
 * `\keyword{otherwise}` / `\keyword{else}` act as `cases` default markers
 * without any special-casing in the `cases` parser.
 */
function keywordEntries(): LatexDictionary {
  const entries: Partial<LatexDictionaryEntry>[] = [];

  for (const kw of KEYWORDS) {
    const surface = kw.surface;
    for (const trigger of ['\\text', '\\keyword'] as const) {
      if (kw.kind === 'prefix') {
        const build = kw.build;
        entries.push({
          latexTrigger: [trigger],
          kind: 'prefix',
          precedence: kw.precedence,
          parse: (parser, until) => {
            const start = parser.index;
            if (!matchBracedKeyword(parser, surface)) {
              parser.index = start;
              return null;
            }
            return build(parser, until);
          },
        });
      } else {
        const build = kw.build;
        entries.push({
          latexTrigger: [trigger],
          kind: 'infix',
          associativity: kw.associativity ?? 'right',
          precedence: kw.precedence,
          parse: (parser, lhs, until) => {
            const start = parser.index;
            if (!matchBracedKeyword(parser, surface)) {
              parser.index = start;
              return null;
            }
            return build(parser, lhs, until);
          },
        });
      }
    }

    // \operatorname{…} / \mathrm{…} spelling (single-word keywords only).
    if (kw.operatorname) {
      if (kw.kind === 'prefix') {
        const build = kw.build;
        entries.push({
          symbolTrigger: surface,
          kind: 'prefix',
          precedence: kw.precedence,
          parse: (parser, until) => build(parser, until),
        });
      } else {
        const build = kw.build;
        entries.push({
          symbolTrigger: surface,
          kind: 'infix',
          associativity: kw.associativity ?? 'right',
          precedence: kw.precedence,
          parse: (parser, lhs, until) => build(parser, lhs, until),
        });
      }
    }
  }

  // Catch-all: `\keyword{…}` with non-keyword content parses as a text run,
  // exactly like `\text{…}`. (Known keywords are handled by the prefix/infix
  // entries above, which are tried first.)
  entries.push({
    latexTrigger: ['\\keyword'],
    parse: (parser: Parser) => parseTextRun(parser),
  });

  return entries;
}

/**
 * Serialize a keyword (`if`, `then`, `else`, `for`, …) according to the
 * `keywordStyle` serialization option.
 *
 * `lead`/`trail` request a surrounding space. For the `'text'` style the space
 * is placed inside the braces (the conventional spelling, e.g. `\text{ then }`);
 * for `'keyword'`/`'operatorname'` the renderer applies keyword spacing, so the
 * braces hold only the word.
 */
function serializeKeyword(
  serializer: Serializer,
  word: string,
  opts?: { lead?: boolean; trail?: boolean }
): string {
  const style = serializer.options.keywordStyle ?? 'text';
  if (style === 'keyword') return `\\keyword{${word}}`;
  if (style === 'operatorname') return `\\operatorname{${word}}`;
  const lead = opts?.lead ? ' ' : '';
  const trail = opts?.trail ? ' ' : '';
  return `\\text{${lead}${word}${trail}}`;
}

// Pipeline operator (`\rhd`, `\triangleright`, `|>`): the argument on the
// left is applied to the function on the right, e.g. `x |> f` -> `f(x)`.
//
// A topic marker `\square` in the right-hand side names the position the
// left-hand side fills, so the right-hand side may be a multi-argument call,
// e.g. `x |> \operatorname{Solve}(\square, y)` -> `Solve(x, y)`. Without a
// marker the left-hand side is passed as the sole argument (`Apply`).

// The internal symbol a bare `\square` parses to (see the `Quadrilateral`
// definition in definitions-other.ts). Within a pipeline it acts as the
// topic marker / hole for the piped value.
const PIPE_TOPIC_MARKER = 'square';

// Substitute `replacement` for every topic marker in `expr`. Returns the
// (possibly) rewritten expression and whether any marker was found.
function substituteTopic(
  expr: MathJsonExpression,
  replacement: MathJsonExpression
): [MathJsonExpression, boolean] {
  if (symbol(expr) === PIPE_TOPIC_MARKER) return [replacement, true];

  const op = operator(expr);
  if (!op) return [expr, false];

  let found = false;
  const args = operands(expr).map((arg) => {
    const [sub, f] = substituteTopic(arg, replacement);
    if (f) found = true;
    return sub;
  });
  if (!found) return [expr, false];
  return [[op, ...args] as MathJsonExpression, true];
}

// Build the body of a pipeline stage: substitute `arg` for the topic marker
// in `rhs` if present, otherwise apply `rhs` to `arg` as the sole argument.
function buildPipe(
  rhs: MathJsonExpression,
  arg: MathJsonExpression
): MathJsonExpression {
  const [body, found] = substituteTopic(rhs, arg);
  if (found) return body;
  return ['Apply', rhs, arg] as MathJsonExpression;
}

function parsePipeline(
  parser: Parser,
  lhs: MathJsonExpression,
  _until: Readonly<Terminator>
): MathJsonExpression {
  const rhs = parser.parseExpression({ minPrec: 21 }) ?? 'Nothing';
  return buildPipe(rhs, lhs);
}

// Prefix pipeline (`|> f`, `|> \operatorname{Solve}(\square, x)`): the
// left-hand side is implied, so the stage becomes an anonymous unary function
// over the topic. The caller applies it to the value it wants to pipe in.
// e.g. `|> f` -> `Function(Apply(f, _), _)`; `|> Solve(\square, x)` ->
// `Function(Solve(_, x), _)`.
function parsePipelinePrefix(
  parser: Parser,
  _until?: Readonly<Terminator>
): MathJsonExpression {
  const rhs = parser.parseExpression({ minPrec: 21 }) ?? 'Nothing';
  const param = '_';
  return ['Function', buildPipe(rhs, param), param] as MathJsonExpression;
}

export const DEFINITIONS_CORE: LatexDictionary = [
  //
  // Constants
  //
  {
    latexTrigger: ['\\placeholder'],
    kind: 'symbol',
    parse: (parser: Parser) => {
      // Parse, but ignore, the optional and required LaTeX args
      while (parser.match('<space>')) {}
      if (parser.match('['))
        while (!parser.match(']') && !parser.atBoundary) parser.nextToken();

      while (parser.match('<space>')) {}
      if (parser.match('<{>'))
        while (!parser.match('<}>') && !parser.atBoundary) parser.nextToken();

      return 'Nothing';
    },
  },

  // ContinuationPlaceholder serializes to `\dots` (its `latexTrigger`), which
  // is what existing round-trip snapshots expect. The additional triggers
  // below all parse to the same symbol.
  { name: 'ContinuationPlaceholder', latexTrigger: ['\\dots'] },
  { latexTrigger: ['\\ldots'], parse: 'ContinuationPlaceholder' },
  { latexTrigger: ['\\cdots'], parse: 'ContinuationPlaceholder' },
  { latexTrigger: ['\\dotsb'], parse: 'ContinuationPlaceholder' },
  { latexTrigger: ['\\dotsc'], parse: 'ContinuationPlaceholder' },
  { latexTrigger: ['\\dotsm'], parse: 'ContinuationPlaceholder' },
  // … U+2026 HORIZONTAL ELLIPSIS
  { latexTrigger: ['…'], parse: 'ContinuationPlaceholder' },
  { latexTrigger: ['.', '.', '.'], parse: 'ContinuationPlaceholder' },

  //
  // Functions
  //

  // Anonymous function, i.e. `(x) \mapsto x^2`
  {
    name: 'Function',
    latexTrigger: ['\\mapsto'],
    kind: 'infix',
    precedence: ARROW_PRECEDENCE, // MathML rightwards arrow
    parse: (parser: Parser, lhs: MathJsonExpression, _until) => {
      let params: string[] = [];
      if (operator(lhs) === 'Delimiter') lhs = operand(lhs, 1) ?? 'Nothing';
      if (operator(lhs) === 'Sequence') {
        for (const x of operands(lhs)) {
          if (!symbol(x)) return null;
          params.push(symbol(x)!);
        }
      } else {
        if (!symbol(lhs)) return null;
        params = [symbol(lhs)!];
      }

      let rhs =
        parser.parseExpression({ minPrec: ARROW_PRECEDENCE }) ?? 'Nothing';
      if (operator(rhs) === 'Delimiter') rhs = operand(rhs, 1) ?? 'Nothing';
      if (operator(rhs) === 'Sequence') rhs = ['Block', ...operands(rhs)];

      return ['Function', rhs, ...params] as MathJsonExpression;
    },
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (args.length < 1) return '()\\mapsto()';
      if (args.length === 1)
        return joinLatex([
          '()',
          '\\mapsto',
          serializer.serialize(operand(expr, 1)),
        ]);

      if (args.length === 2) {
        return joinLatex([
          serializer.serialize(operand(expr, 2)),
          '\\mapsto',
          serializer.serialize(operand(expr, 1)),
        ]);
      }

      return joinLatex([
        serializer.wrapString(
          operands(expr)
            ?.slice(1)
            .map((x) => serializer.serialize(x))
            .join(', '),
          'normal'
        ),
        '\\mapsto',
        serializer.serialize(operand(expr, 1)),
      ]);
    },
  },

  {
    name: 'Apply',
    kind: 'function',
    symbolTrigger: 'apply',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const lhs = operand(expr, 1); // The function body

      const h = operator(lhs);
      if (h === 'Derivative') {
        // A multi-index partial derivative applied to plain symbols reads best
        // in Leibniz notation, e.g. ∂/∂x f(x,y). Univariate/prime derivatives
        // and compound arguments fall through to the Lagrange form below.
        const leibniz = serializeLeibnizPartial(serializer, expr);
        if (leibniz !== null) return leibniz;
      }
      if (h === 'InverseFunction' || h === 'Derivative') {
        // For inverse functions and derivatives display as a regular function,
        // e.g. \sin^{-1} x, f'(x) instead of x \rhd f' and x \rhd \sin^{-1}
        const style = serializer.options.applyFunctionStyle(
          expr,
          serializer.level
        );
        const args = operands(expr).slice(1) as MathJsonExpression[];
        return (
          serializer.serializeFunction(
            lhs!,
            serializer.dictionary.ids.get(h!)
          ) +
          serializer.wrapString(
            args.map((x) => serializer.serialize(x)).join(', '),
            style
          )
        );
      }

      // If no argument, or the body is a single symbol, display as a regular function
      const rhs = operand(expr, 2); // The first argument
      if (typeof lhs === 'string' || !rhs) {
        // e.g. "Apply(f, x)" -> "f(x)"
        const fn = operands(expr).slice(1) as unknown as MathJsonExpression;
        return serializer.serialize(fn);
      }

      if (nops(expr) === 2) {
        // If there's a single argument, we can use the pipeline operator
        // (i.e. `\rhd` `|>`)
        return joinLatex([
          serializer.wrap(lhs, 20),
          '\\lhd',
          serializer.wrap(rhs, 20),
        ]);
      }

      const style = serializer.options.applyFunctionStyle(
        expr,
        serializer.level
      );
      return joinLatex([
        '\\operatorname{apply}',
        serializer.wrapString(
          serializer.serialize(h) +
            ', ' +
            serializer.serialize(['List', ...operands(expr)]),
          style
        ),
      ]);
    },
  },
  {
    latexTrigger: '\\lhd',
    kind: 'infix',
    precedence: 20,
    parse: 'Apply',
  },
  // Pipeline operator: `x \rhd f` (also `x \triangleright f`, `x |> f`)
  // applies the function on the right to the argument on the left
  {
    latexTrigger: '\\rhd',
    kind: 'infix',
    precedence: 20,
    parse: parsePipeline,
  },
  {
    latexTrigger: '\\triangleright',
    kind: 'infix',
    precedence: 20,
    parse: parsePipeline,
  },
  {
    latexTrigger: '|>',
    kind: 'infix',
    precedence: 20,
    parse: parsePipeline,
  },
  {
    latexTrigger: ['⊳'], // U+22B3 CONTAINS AS NORMAL SUBGROUP
    kind: 'infix',
    precedence: 20,
    parse: parsePipeline,
  },
  // Prefix forms of the pipeline operator: the left-hand side is implied and
  // the stage becomes an anonymous unary function (see `parsePipelinePrefix`).
  {
    latexTrigger: '|>',
    kind: 'prefix',
    precedence: 20,
    parse: parsePipelinePrefix,
  },
  {
    latexTrigger: '\\rhd',
    kind: 'prefix',
    precedence: 20,
    parse: parsePipelinePrefix,
  },
  {
    latexTrigger: '\\triangleright',
    kind: 'prefix',
    precedence: 20,
    parse: parsePipelinePrefix,
  },
  {
    latexTrigger: ['⊳'], // U+22B3 CONTAINS AS NORMAL SUBGROUP
    kind: 'prefix',
    precedence: 20,
    parse: parsePipelinePrefix,
  },

  {
    name: 'EvaluateAt',
    openTrigger: '.',
    closeTrigger: '|',

    kind: 'matchfix',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const fn = operand(expr, 1);
      if (!fn) return '';
      const args = operands(expr).slice(1);

      if (operator(fn) === 'Function') {
        const parameters = operands(fn).slice(1);
        let body = operand(fn, 1);
        if (operator(body) === 'Block' && nops(body) === 1)
          body = operand(body, 1);
        if (parameters.length > 0) {
          return `\\left.\\left(${serializer.serialize(
            body
          )}\\right)\\right|_{${parameters
            .map(
              (x, i) =>
                `${serializer.serialize(x)}=${serializer.serialize(args[i])}`
            )
            .join(', ')}}`;
        }
      }

      return `\\left.\\left(${serializer.serialize(fn)}\\right)\\right|_{${args
        .map((x) => serializer.serialize(x))
        .join(', ')}}`;
    },
  },

  // The mathtools package includes several synonmyms for \colonequals. The
  // preferred one as of summer 2022 is `\coloneq` (see § 3.7.3 https://ctan.math.illinois.edu/macros/latex/contrib/mathtools/mathtools.pdf)
  {
    name: 'Assign',
    latexTrigger: '\\coloneq',
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const id = unhold(operand(expr, 1));

      if (operator(operand(expr, 2)) === 'Function') {
        const op_2 = operand(expr, 2);
        const body = unhold(operand(op_2, 1));
        const args = operands(op_2).slice(1);

        return joinLatex([
          serializer.serialize(id),
          serializer.wrapString(
            args.map((x) => serializer.serialize(x)).join(', '),
            serializer.options.applyFunctionStyle(expr, serializer.level)
          ),
          '\\coloneq',
          serializer.serialize(body),
        ]);
      }
      return joinLatex([
        serializer.serialize(id),
        '\\coloneq',
        serializer.serialize(operand(expr, 2)),
      ]);
    },
    parse: parseAssign,
  },
  {
    latexTrigger: '\\coloneqq',
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    parse: parseAssign,
  },
  // From the colonequals package:
  {
    latexTrigger: '\\colonequals',
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    parse: parseAssign,
  },
  {
    latexTrigger: [':', '='],
    kind: 'infix',
    associativity: 'right',
    precedence: ASSIGNMENT_PRECEDENCE,
    parse: parseAssign,
  },

  // General colon operator (type annotation, mapping notation, Desmos piecewise)
  // Precedence below comparisons (245) so `cond : val` (Desmos compact piecewise)
  // parses as `Colon(cond, val)`, and below arrows (270) so
  // `f: A \to B` parses as `Colon(f, To(A, B))`.
  {
    name: 'Colon',
    latexTrigger: ':',
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      joinLatex([
        serializer.serialize(operand(expr, 1)),
        '\\colon',
        serializer.serialize(operand(expr, 2)),
      ]),
  },
  {
    latexTrigger: '\\colon',
    kind: 'infix',
    associativity: 'right',
    precedence: 240,
    parse: 'Colon',
  },

  {
    name: 'BaseForm',
    serialize: (serializer, expr) => {
      const radix = machineValue(operand(expr, 2)) ?? NaN;
      if (isFinite(radix) && radix >= 2 && radix <= 36) {
        // CAUTION: machineValue() may return a truncated value
        // if the number is outside of the machine range.
        const num = machineValue(operand(expr, 1)) ?? NaN;
        if (isFinite(num) && Number.isInteger(num)) {
          let digits = Number(num).toString(radix);
          let groupLength = 0;
          if (radix === 2) {
            groupLength = 4;
          } else if (radix === 10) {
            groupLength = 4;
          } else if (radix === 16) {
            groupLength = 2;
          } else if (radix > 16) {
            groupLength = 4;
          }
          if (groupLength > 0) {
            const oldDigits = digits;
            digits = '';
            for (let i = 0; i < oldDigits.length; i++) {
              if (i > 0 && i % groupLength === 0) digits = '\\, ' + digits;

              digits = oldDigits[oldDigits.length - i - 1] + digits;
            }
          }
          return `(\\text{${digits}}_{${radix}}`;
        }
      }
      return (
        '\\operatorname{BaseForm}(' +
        serializer.serialize(operand(expr, 1)) +
        ', ' +
        serializer.serialize(operand(expr, 2)) +
        ')'
      );
    },
  },
  {
    name: 'Sequence',
    // A `Sequence` has no delimiters, so its operands are juxtaposed with a
    // space. A plain space does NOT keep numeric neighbors apart, however:
    // the number parser skips visual space between digits, so `1 2` would
    // re-parse as the single number `12`. To keep the round-trip
    // value-preserving, insert a comma wherever the boundary would otherwise
    // fuse into one number (a digit followed by a digit or sign). Such a
    // boundary re-parses as a `Tuple` — a different wrapper but the same
    // ordered elements, never a corrupted value.
    serialize: serializeSequence,
  },
  {
    name: 'InvisibleOperator',
    serialize: serializeOps(''),
  },
  {
    // The first argument is a function expression.
    // The second (optional) argument is a string specifying the
    // delimiters and separator.
    name: 'Delimiter',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const style = serializer.options.groupStyle(expr, serializer.level + 1);

      const arg1 = operand(expr, 1);
      let delims = {
        Set: '{,}',
        List: '[,]',
        Tuple: '(,)',
        Single: '(,)',
        Pair: '(,)',
        Triple: '(,)',
        Sequence: '(,)',
        String: '""',
      }[operator(arg1)];

      const items = delims ? arg1 : (['Sequence', arg1] as MathJsonExpression);

      delims ??= '(,)';

      // Check if there are custom delimiters specified
      if (nops(expr) > 1) {
        const op2 = stringValue(operand(expr, 2));
        if (typeof op2 === 'string' && op2.length <= 3) delims = op2;
      }

      let [open, sep, close] = ['', '', ''];
      if (delims.length === 3) [open, sep, close] = delims;
      else if (delims.length === 2) [open, close] = delims;
      else if (delims.length === 1) sep = delims;

      const body = arg1
        ? items
          ? serializeOps(sep)(serializer, items)
          : serializer.serialize(arg1)
        : '';

      // if (!open || !close) return serializer.wrapString(body, style);
      return serializer.wrapString(body, style, open + close);
    },
  },

  {
    name: 'Tuple',
    serialize: (serializer, expr) =>
      joinLatex(['(', serializeOps(',')(serializer, expr), ')']),
  },
  {
    name: 'Pair',
    serialize: (serializer, expr) =>
      joinLatex(['(', serializeOps(',')(serializer, expr), ')']),
  },
  {
    name: 'Triple',
    serialize: (serializer, expr) =>
      joinLatex(['(', serializeOps(',')(serializer, expr), ')']),
  },
  {
    name: 'Single',
    serialize: (serializer, expr) =>
      joinLatex(['(', serializeOps(',')(serializer, expr), ')']),
  },

  {
    name: 'Domain',
    serialize: (serializer, expr) => {
      if (operator(expr) === 'Error') return serializer.serialize(expr);
      return `\\mathbf{${serializer.serialize(operand(expr, 1))}}`;
    },
  },
  {
    latexTrigger: ['\\mathtip'],
    parse: (parser: Parser) => {
      const op1 = parser.parseGroup();
      parser.parseGroup();
      return op1;
    },
  },
  {
    latexTrigger: ['\\texttip'],
    parse: (parser: Parser) => {
      const op1 = parser.parseGroup();
      parser.parseGroup();
      return op1;
    },
  },
  {
    latexTrigger: ['\\error'],
    parse: (parser: Parser) =>
      ['Error', parser.parseGroup()] as MathJsonExpression,
  },
  {
    name: 'Error',
    serialize: (serializer, expr) => {
      const op1 = operand(expr, 1);
      if (stringValue(op1) === 'missing')
        return `\\error{${
          serializer.options.missingSymbol ?? '\\placeholder{}'
        }}`;

      const where = errorContextAsLatex(serializer, expr) || '\\blacksquare';

      const code =
        operator(op1) === 'ErrorCode'
          ? stringValue(operand(op1, 1))
          : stringValue(op1);

      if (code === 'incompatible-type') {
        if (symbol(operand(op1, 3)) === 'Undefined') {
          return `\\mathtip{\\error{${where}}}{\\notin ${serializer.serialize(
            operand(op1, 2)
          )}}`;
        }
        return `\\mathtip{\\error{${where}}}{\\in ${serializer.serialize(
          operand(op1, 3)
        )}\\notin ${serializer.serialize(operand(op1, 2))}}`;
      }

      // if (code === 'missing') {
      //   return `\\mathtip{\\error{${where}}}{${serializer.serialize(
      //     op(op1, 2)
      //   )}\\text{ missing}}`;
      // }

      if (typeof code === 'string') return `\\error{${where}}`;

      return `\\error{${where}}`;
    },
  },
  {
    name: 'ErrorCode',
    serialize: (serializer, expr) => {
      const code = stringValue(operand(expr, 1));

      if (code === 'missing')
        return serializer.options.missingSymbol ?? '\\placeholder{}';

      if (
        code === 'unexpected-command' ||
        code === 'unexpected-operator' ||
        code === 'unexpected-token' ||
        code === 'invalid-symbol' ||
        code === 'unknown-environment' ||
        code === 'unexpected-base' ||
        code === 'incompatible-type'
      ) {
        return '';
      }

      return `\\texttip{\\error{\\blacksquare}}{\\mathtt{${code}}}`;
    },
  },
  {
    name: 'FromLatex',
    serialize: (_serializer, expr) => {
      return `\\texttt{${sanitizeLatex(stringValue(operand(expr, 1)))}}`;
    },
  },

  {
    name: 'Latex',
    serialize: (serializer, expr) => {
      if (expr === null) return '';
      return joinLatex(
        mapArgs<string>(expr, (x) => stringValue(x) ?? serializer.serialize(x))
      );
    },
  },
  {
    name: 'LatexString',
    serialize: (serializer, expr) => {
      if (expr === null) return '';
      return joinLatex(mapArgs<string>(expr, (x) => serializer.serialize(x)));
    },
  },
  { name: 'LatexTokens', serialize: serializeLatexTokens },

  // Component-access postfix: expr.member  (C3)
  // The '.' trigger is consumed before the parse function is called.
  // Precedence 850 > 810 (At/indexing) so .x chains tightly.
  {
    kind: 'postfix',
    precedence: 850,
    latexTrigger: ['.'],
    parse: parseComponentAccess,
  },

  {
    name: 'At',
    kind: 'postfix',
    precedence: 810,
    latexTrigger: ['['],
    parse: parseAt(']'),
    serialize: (serializer, expr) => {
      // `At(collection, index, ...)`: the first operand is the collection
      // being indexed, the rest are the indices.
      const ops = operands(expr);
      const base = serializer.serialize(ops[0] ?? 'Nothing');
      const indices = ops.slice(1).map((i) => serializer.serialize(i));
      if (serializer.indexStyle(expr, serializer.level) === 'bracket') {
        // Programming-style `v[1]` / `M[i,j]`. Uses literal brackets (not
        // `\lbrack`), which is what the postfix `[` index parser accepts.
        return joinLatex([base, '[', indices.join(', '), ']']);
      }
      // Subscript notation `v_1` / `M_{i,j}` (default).
      return supsub('_', base, indices.join(','));
    },
  },
  {
    kind: 'postfix',
    precedence: 810,
    latexTrigger: ['\\lbrack'],
    parse: parseAt('\\rbrack'),
  },
  {
    kind: 'postfix',
    precedence: 810,
    latexTrigger: ['\\left', '\\lbrack'],
    parse: parseAt('\\right', '\\rbrack'),
  },
  {
    kind: 'postfix',
    precedence: 810,
    latexTrigger: ['\\left', '['],
    parse: parseAt('\\right', ']'),
  },
  // When-restriction: `expr\left\{cond\right\}` → `When(expr, cond)` (D3)
  {
    name: 'When',
    kind: 'postfix',
    precedence: 800,
    latexTrigger: ['\\left', '\\{'],
    parse: (
      parser: Parser,
      lhs: MathJsonExpression
    ): MathJsonExpression | null =>
      parseWhenRestriction(parser, lhs, ['\\right', '\\}']),
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const e = operand(expr, 1);
      const cond = operand(expr, 2);
      if (!e || !cond) return '';
      // Unfold And clauses into stacked braces:
      const clauses =
        operator(cond) === 'And' ? (operands(cond) ?? []) : [cond];
      const inner = clauses
        .map((c) => `\\left\\{${serializer.serialize(c)}\\right\\}`)
        .join('');
      return `${serializer.serialize(e)}${inner}`;
    },
  },
  // When-restriction: bare `expr\{cond\}` → `When(expr, cond)`
  {
    kind: 'postfix',
    precedence: 800,
    latexTrigger: ['\\{'],
    parse: (
      parser: Parser,
      lhs: MathJsonExpression
    ): MathJsonExpression | null => parseWhenRestriction(parser, lhs, ['\\}']),
  },
  {
    kind: 'postfix',
    latexTrigger: ['_'],
    parse: (
      parser: Parser,
      lhs: MathJsonExpression,
      _until?: Readonly<Terminator>
    ) => {
      // Parse either a group or a single symbol
      let rhs = parser.parseGroup() ?? parser.parseToken();
      // In non-strict mode, also accept parenthesized expressions
      if (
        rhs === null &&
        parser.options.strict === false &&
        parser.peek === '('
      )
        rhs = parser.parseEnclosure();
      // If the LHS is a collection (symbol declared as indexed_collection,
      // or a list literal), produce At() directly for indexing.
      const sym = symbol(lhs);
      if (
        rhs !== null &&
        ((sym && parser.getSymbolType(sym).matches('indexed_collection')) ||
          operator(lhs) === 'List')
      ) {
        // Unwrap Delimiter if present (e.g. from comma-separated subscripts)
        if (operator(rhs) === 'Delimiter') rhs = operand(rhs, 1) ?? 'Nothing';
        // Multi-index: unpack Sequence into separate At arguments
        if (operator(rhs) === 'Sequence') return ['At', lhs, ...operands(rhs)];
        return ['At', lhs, rhs];
      }

      return ['Subscript', lhs, rhs];
    },
  } as PostfixEntry,
  {
    name: 'List',
    kind: 'matchfix',
    openTrigger: '[',
    closeTrigger: ']',
    parse: parseBrackets,
    serialize: serializeList,
  },
  {
    kind: 'matchfix',
    openTrigger: '(',
    closeTrigger: ')',
    parse: parseParenDelimiter,
  },
  // Angle brackets `\langle ... \rangle` — inner-product / generated-group /
  // tuple notation. Transcribed to an inert `AngleBracket` head (no evaluation
  // semantics); the comma-separated body is flattened into its arguments. Only
  // the explicit `\langle`/`\rangle` commands trigger this — the `<`/`>`
  // comparison operators are untouched.
  {
    name: 'AngleBracket',
    kind: 'matchfix',
    openTrigger: ['\\langle'],
    closeTrigger: ['\\rangle'],
    parse: (_parser: Parser, body: MathJsonExpression) => {
      if (body === null || isEmptySequence(body))
        return ['AngleBracket'] as MathJsonExpression;
      let inner = body;
      if (operator(inner) === 'Delimiter') inner = operand(inner, 1) ?? inner;
      if (operator(inner) === 'Sequence' || operator(inner) === 'List')
        return ['AngleBracket', ...operands(inner)] as MathJsonExpression;
      return ['AngleBracket', inner] as MathJsonExpression;
    },
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      joinLatex([
        '\\langle ',
        operands(expr)
          .map((x) => serializer.serialize(x))
          .join(', '),
        ' \\rangle',
      ]),
  },
  {
    latexTrigger: [','],
    kind: 'infix',
    precedence: 20,
    // Unlike the matchfix version of List,
    // when the comma operator is used, the lhs and rhs are flattened,
    // i.e. `1,2,3` -> `["Delimiter", ["List", 1, 2, 3],  ","]`,
    // and `1, (2, 3)` -> `["Delimiter",
    // ["Sequence", 1, ["Delimiter", ["List", 2, 3],  "()", ","]]],
    parse: (
      parser: Parser,
      lhs: MathJsonExpression,
      terminator: Readonly<Terminator>
    ): MathJsonExpression | null => {
      const seq = parseSequence(parser, terminator, lhs, 20, ',');
      if (seq === null) return null;
      return ['Delimiter', ['Sequence', ...seq], { str: ',' }];
    },
  },
  // Entry to handle the case of a single comma
  // with a missing lhs.
  {
    latexTrigger: [','],
    kind: 'prefix',
    precedence: 20,
    parse: (parser, terminator): MathJsonExpression | null => {
      const seq = parseSequence(parser, terminator, null, 20, ',');
      if (seq === null) return null;
      return ['Delimiter', ['Sequence', ...seq], { str: ',' }];
    },
  },
  {
    name: 'Range',
    latexTrigger: ['.', '.'],
    kind: 'infix',
    // associativity: 'left',
    precedence: 800,
    parse: parseRange,
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (args.length === 0) return '';
      if (args.length === 1)
        return '1..' + serializer.serialize(operand(expr, 1));
      // 1..2
      if (args.length === 2)
        return (
          serializer.wrap(operand(expr, 1), 10) +
          '..' +
          serializer.wrap(operand(expr, 2), 10)
        );
      // 1..3..7
      if (args.length === 3) {
        // Are step and start numeric values?
        const step = machineValue(operand(expr, 3));
        const start = machineValue(operand(expr, 1));
        if (step !== null && start !== null) {
          return (
            serializer.wrap(operand(expr, 1), 10) +
            '..' +
            serializer.wrap(start + step, 10) +
            '..' +
            serializer.wrap(operand(expr, 2), 10)
          );
        }

        // We have arbitrary expressions for start (a) or step (b)...
        // i.e. a..(a+b)..c
        return (
          serializer.wrap(operand(expr, 1), 10) +
          '..(' +
          (serializer.wrap(operand(expr, 1), ADDITION_PRECEDENCE) +
            '+' +
            serializer.wrap(operand(expr, 3), ADDITION_PRECEDENCE)) +
          ')..' +
          serializer.wrap(operand(expr, 2), 10)
        );
      }
      return '';
    },
  },
  // Additional triggers for Range: `...`, `\ldots`, and `\dots` are
  // equivalent to `..` when used as infix operators (e.g. `[1...9]`).
  // No `name` field here — names must be unique per the dictionary rules;
  // the first Range entry owns the name. When there is no LHS the symbol
  // entries near the top of the file still fire (ContinuationPlaceholder).
  {
    latexTrigger: ['.', '.', '.'],
    kind: 'infix',
    precedence: 800,
    parse: parseRange,
  },
  {
    latexTrigger: ['\\ldots'],
    kind: 'infix',
    precedence: 800,
    parse: parseRange,
  },
  {
    latexTrigger: ['\\dots'],
    kind: 'infix',
    precedence: 800,
    parse: parseRange,
  },
  {
    latexTrigger: [';'],
    kind: 'infix',
    precedence: 19,
    parse: (
      parser: Parser,
      lhs: MathJsonExpression,
      terminator: Readonly<Terminator>
    ) => {
      const seq = parseSequence(parser, terminator, lhs, 19, ';');
      if (seq === null) return null;

      // If any element is an Assign, produce a Block
      if (seq.some((e) => operator(e) === 'Assign'))
        return buildBlockFromSequence(seq);

      return ['Delimiter', ['Sequence', ...seq], "';'"] as MathJsonExpression;
    },
  },
  // Keyword constructs (`if`/`then`/`else`, `for`, `where`, `and`, `or`,
  // quantifiers, …) parsed from `\text{…}`, `\keyword{…}`, and
  // `\operatorname{…}`. Generated from the KEYWORDS table above.
  ...keywordEntries(),
  // Block serializer — used by both `where` and semicolon blocks
  {
    name: 'Block',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (!args || args.length === 0) return '';
      // Skip Declare statements (implicit in LaTeX — the := implies declaration)
      const parts = args
        .filter((a) => operator(a) !== 'Declare')
        .map((a) => serializer.serialize(a));
      return parts.join('; ');
    },
  },
  // Serializer for If expressions (separate from the parser entry
  // because name-based entries affect kind-based indexing)
  {
    name: 'If',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (!args || args.length < 3) return '';
      return joinLatex([
        serializeKeyword(serializer, 'if', { trail: true }),
        serializer.serialize(args[0]),
        serializeKeyword(serializer, 'then', { lead: true, trail: true }),
        serializer.serialize(args[1]),
        serializeKeyword(serializer, 'else', { lead: true, trail: true }),
        serializer.serialize(args[2]),
      ]);
    },
  },
  // Serializer for Loop expressions (imperative control flow)
  {
    name: 'Loop',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (!args || args.length === 0) return '';
      const body = args[0];
      const elements = args.slice(1);

      // Single-Element with Range → emit \text{for ... from ... to ... do ...}
      if (elements.length === 1 && operator(elements[0]) === 'Element') {
        const elem = elements[0];
        const index = operand(elem, 1);
        const coll = operand(elem, 2);
        if (operator(coll) === 'Range') {
          const lo = operand(coll, 1);
          const hi = operand(coll, 2);
          return joinLatex([
            serializeKeyword(serializer, 'for', { trail: true }),
            serializer.serialize(index),
            serializeKeyword(serializer, 'from', { lead: true, trail: true }),
            serializer.serialize(lo),
            serializeKeyword(serializer, 'to', { lead: true, trail: true }),
            serializer.serialize(hi),
            serializeKeyword(serializer, 'do', { lead: true, trail: true }),
            serializer.serialize(body),
          ]);
        }
      }

      // All other Loop shapes → functional fallback \operatorname{Loop}(...).
      // (Comprehension syntax is reserved for the `Comprehension` operator.)
      return joinLatex([
        '\\operatorname{Loop}(',
        args.map((a) => serializer.serialize(a)).join(', '),
        ')',
      ]);
    },
  },
  // Serializer for Comprehension expressions (value-producing)
  {
    name: 'Comprehension',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (!args || args.length < 2) return '';
      const body = args[0];
      const elements = args.slice(1);

      // Emit comprehension form: body \operatorname{for} x = L1, y = L2, ...
      const bindings = elements
        .map((elem) => {
          const name = operand(elem, 1);
          const coll = operand(elem, 2);
          return joinLatex([
            serializer.serialize(name),
            ' = ',
            serializer.serialize(coll),
          ]);
        })
        .join(', ');
      return joinLatex([
        serializer.serialize(body),
        ' \\operatorname{for} ',
        bindings,
      ]);
    },
  },
  // Serializer for Break
  {
    name: 'Break',
    serialize: (serializer: Serializer): string =>
      serializeKeyword(serializer, 'break'),
  },
  // Serializer for Continue
  {
    name: 'Continue',
    serialize: (serializer: Serializer): string =>
      serializeKeyword(serializer, 'continue'),
  },
  // Serializer for Return
  {
    name: 'Return',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const arg = operand(expr, 1);
      if (!arg || symbol(arg) === 'Nothing')
        return serializeKeyword(serializer, 'return');
      return joinLatex([
        serializeKeyword(serializer, 'return', { trail: true }),
        serializer.serialize(arg),
      ]);
    },
  },

  // Text serializer — reconstructs \text{...} with inline $...$ for math
  {
    name: 'Text',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (args.length === 0) return '';

      // Find extent of string (text) operands
      let firstStr = -1;
      let lastStr = -1;
      for (let i = 0; i < args.length; i++) {
        if (stringValue(args[i]) !== null) {
          if (firstStr < 0) firstStr = i;
          lastStr = i;
        }
      }

      // No strings at all — just serialize math args
      if (firstStr < 0)
        return joinLatex(args.map((a) => serializer.serialize(a)));

      const parts: string[] = [];

      // Math args before the text run
      for (let i = 0; i < firstStr; i++)
        parts.push(serializer.serialize(args[i]));

      // The text run (firstStr..lastStr inclusive)
      let textContent = '';
      for (let i = firstStr; i <= lastStr; i++) {
        const s = stringValue(args[i]);
        if (s !== null) textContent += sanitizeLatex(s);
        else if (
          operator(args[i]) === 'Annotated' ||
          operator(args[i]) === 'Text'
        )
          textContent += serializer.serialize(args[i]);
        else textContent += '$' + serializer.serialize(args[i]) + '$';
      }
      parts.push('\\text{' + textContent + '}');

      // Math args after the text run
      for (let i = lastStr + 1; i < args.length; i++)
        parts.push(serializer.serialize(args[i]));

      return joinLatex(parts);
    },
  },

  {
    name: 'String',
    latexTrigger: ['\\text'],
    // Keyword constructs spelled `\text{if}`, `\text{for}`, etc. are handled
    // by the generated prefix/infix keyword entries (see `keywordEntries()`),
    // which are tried before this `expression`-kind entry. Non-keyword
    // `\text{…}` content falls through to here and parses as a text run.
    parse: (parser: Parser) => parseTextRun(parser),
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const args = operands(expr);
      if (args.length === 0) return '\\text{}';
      return joinLatex([
        '\\text{',
        args.map((x) => serializer.serialize(x)).join(''),
        '}',
      ]);
    },
  },
  {
    name: 'Subscript',
    latexTrigger: ['_'],
    kind: 'infix',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      if (nops(expr) === 2) {
        return (
          serializer.serialize(operand(expr, 1)) +
          '_{' +
          serializer.serialize(operand(expr, 2)) +
          '}'
        );
      }
      return '_{' + serializer.serialize(operand(expr, 1)) + '}';
    },
  },
  { name: 'Superplus', latexTrigger: ['^', '+'], kind: 'postfix' },
  { name: 'Subplus', latexTrigger: ['_', '+'], kind: 'postfix' },
  {
    name: 'Superminus',
    latexTrigger: ['^', '-'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) => {
      // In non-strict mode, ^-digits should be Power(x, -n), not Superminus
      if (parser.options.strict === false && /^[0-9]$/.test(parser.peek))
        return null;
      return ['Superminus', lhs] as MathJsonExpression;
    },
  },
  { name: 'Subminus', latexTrigger: ['_', '-'], kind: 'postfix' },
  {
    latexTrigger: ['^', '*'],
    kind: 'postfix',
    parse: (_parser: Parser, lhs: MathJsonExpression) =>
      ['Superstar', lhs] as MathJsonExpression,
  },
  // { name: 'Superstar', latexTrigger: ['^', '\\star'], kind: 'postfix' },
  {
    latexTrigger: ['_', '*'],
    kind: 'postfix',
    parse: (_parser: Parser, lhs: MathJsonExpression) =>
      ['Substar', lhs] as MathJsonExpression,
  },
  { name: 'Substar', latexTrigger: ['_', '\\star'], kind: 'postfix' },
  { name: 'Superdagger', latexTrigger: ['^', '\\dagger'], kind: 'postfix' },
  {
    latexTrigger: ['^', '\\dag'],
    kind: 'postfix',
    parse: (_parser: Parser, lhs: MathJsonExpression) =>
      ['Superdagger', lhs] as MathJsonExpression,
  },
  {
    name: 'Prime',
    latexTrigger: ['^', '\\prime'],
    // Note: we don't need a precedence because the trigger is '^'
    // and '^' (and '_') are treated specially by the parser.
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 1),
    serialize: (serializer, expr) => {
      const n2 = machineValue(operand(expr, 2)) ?? 1;
      const base = serializer.serialize(operand(expr, 1));
      if (n2 === 1) return base + '^\\prime';
      if (n2 === 2) return base + '^\\doubleprime';
      if (n2 === 3) return base + '^\\tripleprime';
      return base + '^{(' + serializer.serialize(operand(expr, 2)) + ')}';
    },
  },
  {
    latexTrigger: '^{\\prime\\prime}',
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: '^{\\prime\\prime\\prime}',
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 3),
  },
  {
    latexTrigger: ['^', '\\doubleprime'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: ['^', '\\tripleprime'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 3),
  },
  {
    latexTrigger: "'",
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 1),
  },
  {
    latexTrigger: '\\prime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 1),
  },
  {
    latexTrigger: '\\doubleprime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 2),
  },
  {
    latexTrigger: '\\tripleprime',
    kind: 'postfix',
    precedence: 810,
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parsePrime(parser, lhs, 3),
  },

  // Lagrange Notation for n-th order derivatives,
  // i.e. f^{(n)} -> Derivative(f, n)
  {
    latexTrigger: ['^', '<{>', '('],
    kind: 'postfix',
    parse: (parser: Parser, lhs, until) => {
      const sym = symbol(lhs);
      if (!sym || !parser.getSymbolType(sym).matches('function')) return null;

      parser.addBoundary([')']);
      const expr = parser.parseExpression(until);
      if (!parser.matchBoundary()) {
        parser.removeBoundary();
        return null;
      }

      if (!parser.match('<}>')) return null;

      return ['Derivative', lhs, expr] as MathJsonExpression;
    },
  },

  {
    name: 'InverseFunction',
    latexTrigger: '^{-1', // Note: the closing brace is not included
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) => {
      // If the lhs is a Matrix expression, return the matrix inverse
      if (operator(lhs) === 'Matrix') {
        parser.match('<}>');
        return ['Inverse', lhs] as MathJsonExpression;
      }

      const sym = symbol(lhs);
      if (!sym) return null;

      const symType = parser.getSymbolType(sym);

      // If the lhs is a matrix-typed symbol, return the matrix inverse
      // i.e. A^{-1} -> Inverse(A)
      if (symType.matches(new BoxedType('matrix'))) {
        parser.match('<}>');
        return ['Inverse', lhs] as MathJsonExpression;
      }

      // If the lhs is a function, return the inverse function
      // i.e. f^{-1} -> InverseFunction(f)
      if (!symType.matches('function')) return null;

      // There may be additional postfixes, i.e. \prime, \doubleprime,
      // \tripleprime in the superscript. Account for them.

      let primeCount = 0;
      while (!parser.atEnd && !parser.match('<}>')) {
        if (parser.match("'")) primeCount++;
        else if (parser.match('\\prime')) primeCount++;
        else if (parser.match('\\doubleprime')) primeCount += 2;
        else if (parser.match('\\tripleprime')) primeCount += 3;
        else return null;
      }
      if (primeCount === 1)
        return ['Derivative', ['InverseFunction', lhs]] as MathJsonExpression;
      if (primeCount > 0)
        return [
          'Derivative',
          ['InverseFunction', lhs],
          primeCount,
        ] as MathJsonExpression;

      return ['InverseFunction', lhs] as MathJsonExpression;
    },
    serialize: (serializer, expr) =>
      serializer.serialize(operand(expr, 1)) + '^{-1}',
  },
  // Lagrange notation
  {
    name: 'Derivative',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const base = serializer.serialize(operand(expr, 1));

      // The multi-index of orders, one per argument of the function.
      const orders = operands(expr).slice(1);

      // Multi-index (mixed partial): f^{(1,0)}. There is no unapplied Lagrange
      // prime notation for it, so use the parenthesized index list.
      if (orders.length > 1)
        return (
          base +
          '^{(' +
          orders.map((o) => serializer.serialize(o)).join(', ') +
          ')}'
        );

      // Univariate: ordinary Lagrange prime notation.
      const degree = machineValue(orders[0]) ?? 1;
      if (degree === 1) return base + '^{\\prime}';
      if (degree === 2) return base + '^{\\doubleprime}';
      if (degree === 3) return base + '^{\\tripleprime}';

      return base + '^{(' + serializer.serialize(orders[0]) + ')}';
    },
  },

  // Serializer for D (partial derivative) - outputs Leibniz notation
  {
    name: 'D',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      // Only handle D function expressions, not the plain symbol D
      if (operator(expr) !== 'D') return 'D';

      // D has form: ["D", function, variable, ...moreVariables]
      const fn = operand(expr, 1);
      const variable = operand(expr, 2);

      if (!fn || !variable) return 'D';

      // Count nested D expressions to determine the derivative order
      let order = 1;
      let innerFn = fn;

      // Check for nested D with same variable
      while (operator(innerFn) === 'D') {
        const innerVar = operand(innerFn, 2);
        if (symbol(innerVar) === symbol(variable)) {
          order++;
          innerFn = operand(innerFn, 1)!;
        } else {
          break;
        }
      }

      // If the inner function is a Function expression, extract the body
      // e.g., ["Function", ["Sin", "x"], "x"] -> ["Sin", "x"]
      let bodyToSerialize = innerFn;
      if (operator(innerFn) === 'Function') {
        bodyToSerialize = operand(innerFn, 1) ?? innerFn;
      }

      // Serialize the function body
      const fnLatex = serializer.serialize(bodyToSerialize);
      const varLatex = serializer.serialize(variable);

      // Output Leibniz notation: \frac{d}{dx}f or \frac{d^n}{dx^n}f
      if (order === 1) {
        return `\\frac{\\mathrm{d}}{\\mathrm{d}${varLatex}}${fnLatex}`;
      }
      return `\\frac{\\mathrm{d}^{${order}}}{\\mathrm{d}${varLatex}^{${order}}}${fnLatex}`;
    },
  },

  // Newton notation for time derivatives: \dot{x}, \ddot{x}, etc.
  {
    name: 'NewtonDerivative1',
    latexTrigger: ['\\dot'],
    kind: 'prefix',
    precedence: 740,
    parse: (parser: Parser): MathJsonExpression | null => {
      const body = parser.parseGroup();
      if (body === null) return null;
      const t = parser.options.timeDerivativeVariable;
      return ['D', body, t] as MathJsonExpression;
    },
  },
  {
    name: 'NewtonDerivative2',
    latexTrigger: ['\\ddot'],
    kind: 'prefix',
    precedence: 740,
    parse: (parser: Parser): MathJsonExpression | null => {
      const body = parser.parseGroup();
      if (body === null) return null;
      const t = parser.options.timeDerivativeVariable;
      return ['D', ['D', body, t], t] as MathJsonExpression;
    },
  },
  {
    name: 'NewtonDerivative3',
    latexTrigger: ['\\dddot'],
    kind: 'prefix',
    precedence: 740,
    parse: (parser: Parser): MathJsonExpression | null => {
      const body = parser.parseGroup();
      if (body === null) return null;
      const t = parser.options.timeDerivativeVariable;
      return ['D', ['D', ['D', body, t], t], t] as MathJsonExpression;
    },
  },
  {
    name: 'NewtonDerivative4',
    latexTrigger: ['\\ddddot'],
    kind: 'prefix',
    precedence: 740,
    parse: (parser: Parser): MathJsonExpression | null => {
      const body = parser.parseGroup();
      if (body === null) return null;
      const t = parser.options.timeDerivativeVariable;
      return ['D', ['D', ['D', ['D', body, t], t], t], t] as MathJsonExpression;
    },
  },

  // Euler notation for derivatives: D_x f, D^2_x f, D_x^2 f
  // Uses latexTrigger to intercept before symbol parsing combines D with subscript
  {
    name: 'EulerDerivative',
    latexTrigger: ['D'],
    kind: 'expression',
    parse: (parser: Parser): MathJsonExpression | null => {
      let degree = 1;
      let variable: MathJsonExpression | null = null;

      // Parse subscript and superscript in either order (D_x^2 or D^2_x)
      let done = false;
      while (!done) {
        if (parser.match('_')) {
          // Parse the subscript (variable)
          variable = parser.parseGroup() ?? parser.parseToken();
          if (!variable) return null;
        } else if (parser.match('^')) {
          // Parse the superscript (degree)
          const degExpr = parser.parseGroup() ?? parser.parseToken();
          degree = machineValue(degExpr) ?? 1;
        } else {
          done = true;
        }
      }

      // Only trigger if we have a subscript (to distinguish from D as a variable)
      if (!variable) return null;

      // The subscript must be a single symbol to be a differentiation variable.
      // A multi-character subscript (e.g. `D_{etectsize}`, common in Desmos
      // identifiers) parses as an InvisibleOperator of letters, not a variable.
      // In that case this is a subscripted identifier, not Euler derivative
      // notation: bail out so the parser falls back to parsing `D_{...}` as a
      // symbol.
      if (symbol(variable) === null) return null;

      // Parse the function/expression to differentiate
      parser.skipSpace();
      const fn = parser.parseExpression({ minPrec: 740 });
      if (!fn) return null;

      // Build nested D for the degree
      let result: MathJsonExpression = fn;
      for (let i = 0; i < degree; i++) {
        result = ['D', result, variable] as MathJsonExpression;
      }
      return result;
    },
  },

  {
    kind: 'environment',
    name: 'Which',
    symbolTrigger: 'cases',
    parse: parseCasesEnvironment,
    serialize: (serialize: Serializer, expr: MathJsonExpression): string => {
      const rows: string[] = [];
      const args = operands(expr);
      if (args.length > 0) {
        for (let i = 0; i <= args.length - 2; i += 2) {
          const row: string[] = [];
          row.push(serialize.serialize(args[i + 1]));
          row.push(serialize.serialize(args[i]));
          rows.push(row.join('&'));
        }
      }
      return joinLatex(['\\begin{cases}', rows.join('\\\\'), '\\end{cases}']);
    },
  },
  {
    kind: 'environment',
    symbolTrigger: 'dcases',
    parse: parseCasesEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'rcases',
    parse: parseCasesEnvironment,
  },

  // Alignment/multiline environments (`aligned`, `align`, `gather`, ...) are
  // used in prose to lay out a *system* of equations (or a multi-line
  // derivation), one equation per row. We parse them to the same convention as
  // a single-column `cases`: a `List` of the row expressions (see
  // `parseAlignedEnvironment`). The `&` alignment markers are not columns here,
  // just typesetting hints, so they are stripped/merged within each row.
  {
    kind: 'environment',
    symbolTrigger: 'aligned',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'aligned*',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'align',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'align*',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'gather',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'gather*',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'gathered',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'split',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'multline',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'multline*',
    parse: parseAlignedEnvironment,
  },
  {
    kind: 'environment',
    symbolTrigger: 'eqnarray',
    parse: parseAlignedEnvironment,
  },
];

/**
 * Parse content in text mode.
 * 
 * Text mode can only include a small subset of LaTeX commands:
 * - <{> (groups inside text)
 * - \unicode
 * - \char
 * - ^^
 * - ^^^^
 * - \textbf
 * - \textmd
 * - \textup
 * - \textsl
 * - \textit
 * - \texttt
 * - \textsf
 * - \textcolor{}{}
 * - {\color{}}
//
// greek?
// spacing? \hspace, \! \: \enskip...
// \boxed ?
// \fcolorbox ?
 */

/**
 * Start scanning a text run. The scanner is pointing at a `<{>
 */
function parseTextRun(
  parser: Parser,
  style?: { [key: string]: string }
): MathJsonExpression {
  if (!parser.match('<{>')) return "''";

  const runs: MathJsonExpression[] = [];
  let text = '';
  let runinStyle: { [key: string]: string } | null = null;

  const flush = () => {
    if (runinStyle !== null && text) {
      runs.push(['Annotated', `'${text}'`, dictionaryFromEntries(runinStyle)]);
    } else if (text) {
      runs.push(`'${text}'`);
    }
    text = '';
    runinStyle = null;
  };

  while (!parser.atEnd && !parser.match('<}>')) {
    if (parser.peek === '<{>') {
      flush();
      runs.push(parseTextRun(parser));
    } else if (parser.match('\\textbf')) {
      flush();
      runs.push(parseTextRun(parser, { fontWeight: 'bold' }));
    } else if (parser.match('\\textmd')) {
      flush();
      runs.push(parseTextRun(parser, { fontStyle: 'normal' }));
    } else if (parser.match('\\textup')) {
      flush();
      runs.push(parseTextRun(parser, { fontStyle: 'normal' }));
    } else if (parser.match('\\textsl')) {
      flush();
      runs.push(parseTextRun(parser, { fontStyle: 'italic' }));
    } else if (parser.match('\\textit')) {
      flush();
      runs.push(parseTextRun(parser, { fontStyle: 'italic' }));
    } else if (parser.match('\\texttt')) {
      flush();
      runs.push(parseTextRun(parser, { fontFamily: 'monospace' }));
    } else if (parser.match('\\textsf')) {
      flush();
      runs.push(parseTextRun(parser, { fontFamily: 'sans-serif' }));
    } else if (parser.match('\\textcolor')) {
      // Run-in style with color
      const pos = parser.index;
      const color = parser.parseStringGroup();
      if (color !== null) {
        flush();
        const body = parseTextRun(parser);
        runs.push(['Annotated', body, dictionaryFromEntries({ color })]);
      } else {
        parser.index = pos;
        text += '\\textcolor';
      }
    } else if (parser.match('\\color')) {
      // Run-in style
      const color = parser.parseStringGroup();
      if (color !== null) {
        flush();
        runinStyle = { color };
      }
    } else if (parser.match('<space>')) {
      text += ' ';
    } else if (parser.match('<$>')) {
      const index = parser.index;
      const expr = parser.parseExpression() ?? 'Nothing';
      parser.skipSpace();
      if (parser.match('<$>')) {
        flush();
        runs.push(expr);
      } else {
        // We had an opening `$` but no closing `$`
        // Restore the index and add a dollar sign
        text += '$';
        parser.index = index;
      }
    } else if (parser.match('<$$>')) {
      const index = parser.index;
      const expr = parser.parseExpression() ?? 'Nothing';
      parser.skipSpace();
      if (parser.match('<$$>')) {
        flush();
        runs.push(expr);
      } else {
        // We had an opening `$$` but no closing `$$`
        text += '$$';
        parser.index = index;
      }
    } else {
      // Note that parseChar() will handle ^^, ^^^^, \unicode, \char
      const c = parser.parseChar() ?? parser.nextToken();
      text +=
        {
          '\\enskip': '\u2002', //  en space
          '\\enspace': '\u2002', //  en space
          '\\quad': '\u2003', //  em space
          '\\qquad': '\u2003\u2003', //  2 em space
          '\\space': '\u2003', //  em space
          '\\ ': '\u2003', //  em space
          '\\;': '\u2004', //  three per em space
          '\\,': '\u2009', //  thin space
          '\\:': '\u205f', //  medium mathematical space
          '\\!': '', //  negative thin space
          '\\{': '{',
          '\\}': '}',
          '\\$': '$',
          '\\&': '&',
          '\\#': '#',
          '\\%': '%',
          '\\_': '_',
          '\\textbackslash': '\\',
          '\\textasciitilde': '~',
          '\\textasciicircum': '^',
          '\\textless': '<',
          '\\textgreater': '>',
          '\\textbar': '|',
          '\\textunderscore': '_',
          '\\textbraceleft': '{',
          '\\textbraceright': '}',
          '\\textasciigrave': '`',
          '\\textquotesingle': "'",
          '\\textquotedblleft': '“',
          '\\textquotedblright': '”',
          '\\textquotedbl': '"',
          '\\textquoteleft': '‘',
          '\\textquoteright': '’',
          '\\textbullet': '•',
          '\\textdagger': '†',
          '\\textdaggerdbl': '‡',
          '\\textsection': '§',
          '\\textparagraph': '¶',
          '\\textperiodcentered': '·',
          '\\textellipsis': '…',
          '\\textemdash': '—',
          '\\textendash': '–',
          '\\textregistered': '®',
          '\\texttrademark': '™',
          '\\textdegree': '°',
        }[c] ?? c;
    }
  }

  // Apply leftovers
  flush();

  let body: MathJsonExpression;
  if (runs.length === 1) body = runs[0];
  else {
    if (runs.every((x) => stringValue(x) !== null))
      body = "'" + runs.map((x) => stringValue(x)).join('') + "'";
    else body = ['Text', ...runs];
  }

  return style ? ['Annotated', body, dictionaryFromEntries(style)] : body;
}

function serializeLatexTokens(
  serializer: Serializer,
  expr: MathJsonExpression | null
): string {
  if (expr === null) return '';
  return joinLatex(
    mapArgs(expr, (x) => {
      const s = stringValue(x);
      if (s === null) return serializer.serialize(x);

      // If not a string, serialize the expression to LaTeX
      if (s === '<{>') return '{';
      if (s === '<}>') return '}';
      if (s === '<$>') return '$';
      if (s === '<$$>') return '$$';
      if (s === '<space>') return ' ';
      return s;
    })
  );
}

/**
 * Given a string of presumed (but possibly invalid) LaTeX, return a
 * LaTeX string with all the special characters escaped.
 */
function sanitizeLatex(s: string | null): string {
  if (s === null) return '';
  // Replace special Latex characters
  return s.replace(
    /[{}\[\]\\:\-\$%]/g,
    (c) =>
      ({
        '{': '\\lbrace ',
        '}': '\\rbrace ',
        '[': '\\lbrack ',
        ']': '\\rbrack ',
        ':': '\\colon ',
        '\\': '\\backslash ',
      })[c] ?? '\\' + c
  );
}

function errorContextAsLatex(
  serializer: Serializer,
  error: MathJsonExpression
): string {
  const arg = operand(error, 2);
  if (!arg) return '';

  if (operator(arg) === 'LatexString')
    return stringValue(operand(arg, 1)) ?? '';

  if (operator(arg) === 'Hold') return serializer.serialize(operand(arg, 1));

  return serializer.serialize(arg);
}

/**
 * Serialize an applied multi-index partial derivative in Leibniz notation, e.g.
 * `Apply(Derivative(f, 1, 0), x, y)` → `\frac{\partial}{\partial x} f(x,y)`.
 *
 * Returns `null` (so the caller falls back to Lagrange `f^{(1,0)}(…)`) unless
 * the derivative carries a genuine multi-index (two or more orders) and every
 * differentiated slot is applied to a plain symbol — Leibniz notation needs a
 * variable name for each `\partial`, which a compound argument (e.g. `x^2`)
 * cannot supply.
 */
function serializeLeibnizPartial(
  serializer: Serializer,
  expr: MathJsonExpression
): string | null {
  const deriv = operand(expr, 1); // Derivative(f, n₁, …, n_k)
  if (operator(deriv) !== 'Derivative') return null;

  const orders: number[] = [];
  for (const o of operands(deriv).slice(1)) {
    const n = machineValue(o);
    if (n === null || !Number.isInteger(n) || n < 0) return null;
    orders.push(n);
  }
  // A single order is ordinary (univariate) notation → keep Lagrange primes.
  if (orders.length < 2) return null;

  const args = operands(expr).slice(1) as MathJsonExpression[];
  if (args.length !== orders.length) return null;

  const total = orders.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const denomParts: string[] = [];
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] === 0) continue;
    if (!symbol(args[i])) return null; // can't write ∂/∂(x²)
    const v = serializer.serialize(args[i]);
    denomParts.push(
      orders[i] === 1 ? `\\partial ${v}` : `\\partial ${v}^{${orders[i]}}`
    );
  }

  const numer = total === 1 ? '\\partial' : `\\partial^{${total}}`;
  const fn = serializer.serialize(operand(deriv, 1));
  const argList = args.map((a) => serializer.serialize(a)).join(', ');
  return `\\frac{${numer}}{${denomParts.join(' ')}} ${fn}(${argList})`;
}

function parsePrime(
  parser: Parser,
  lhs: MathJsonExpression,
  order: number
): MathJsonExpression | null {
  // Accumulate additional prime marks (e.g., f''' -> order 3)
  while (!parser.atEnd) {
    if (parser.match("'") || parser.match('\\prime')) order++;
    else if (parser.match('\\doubleprime')) order += 2;
    else if (parser.match('\\tripleprime')) order += 3;
    else break;
  }

  // If the lhs is a Prime/Derivative, increase the derivation order
  const lhsh = operator(lhs);
  if (lhsh === 'Derivative' || lhsh === 'Prime') {
    const n = machineValue(operand(lhs, 2)) ?? 1;
    return [lhsh, missingIfEmpty(operand(lhs, 1)), n + order];
  }

  // If the lhs is a function, return the derivative
  // i.e. f' -> Derivative(f)

  const sym = symbol(lhs);
  const isKnownFunction =
    (sym && parser.getSymbolType(sym).matches('function')) || operator(lhs);

  // Check if followed by arguments - if so, treat as function derivative
  // This handles both known functions like sin'(x) and unknown like g'(t)
  parser.skipSpace();
  const args = parser.parseArguments('enclosure');

  if (args && args.length > 0) {
    // Infer differentiation variable from first argument (if it's a symbol)
    const firstArg = args[0];
    const variable = symbol(firstArg) ?? 'x';

    // Build function call: f(x, y, ...) -> ['f', x, y, ...]
    const fnCall =
      typeof lhs === 'string'
        ? ([lhs, ...args] as MathJsonExpression)
        : (['Apply', lhs, ...args] as MathJsonExpression);

    // Wrap with nested D for the order
    let result: MathJsonExpression = fnCall;
    for (let i = 0; i < order; i++) {
      result = ['D', result, variable] as MathJsonExpression;
    }
    return result;
  }

  // No arguments
  if (isKnownFunction) {
    // Return Derivative for known functions
    if (order === 1) return ['Derivative', lhs];
    return ['Derivative', lhs, order];
  }

  // Otherwise, if it's a number or a symbol, return a generic "Prime"
  if (order === 1) return ['Prime', missingIfEmpty(lhs)];
  return ['Prime', missingIfEmpty(lhs), order];
}

function parseParenDelimiter(
  _parser: Parser,
  body: MathJsonExpression
): MathJsonExpression | null {
  // During parsing, we keep a Delimiter expression as it captures the most
  // information (separator and fences).
  // The Delimiter canonicalization will turn it into something else if
  // appropriate (Tuple, etc...).

  // Handle `()` used for example with `f()`. This will be handled in
  // `canonicalInvisibleOperator()`
  if (isEmptySequence(body)) return ['Delimiter'];

  const h = operator(body);
  // We have a Delimiter inside parens: e.g. `(a, b, c)` with `a, b, c` the
  // Delimiter function.
  if (h === 'Delimiter' && operand(body, 2) !== null) {
    const delims = stringValue(operand(body, 2));
    if (delims?.length === 1) {
      // We have a Delimiter with a single character separator
      return [
        'Delimiter',
        operand(body, 1) ?? 'Nothing',
        { str: `(${delims})` },
      ];
    }
  }

  // @todo: does this codepath ever get hit?
  if (h === 'Matrix') {
    const delims = stringValue(operand(body, 2)) ?? '..';
    if (delims === '..') return ['Matrix', operand(body, 1)!];
  }

  return ['Delimiter', body];
}

/**
 *
 * A list in enclosed in brackets, e.g. `[1, 2, 3]`.
 *
 * It may contain:
 * - a single expression, e.g. `[1]`
 * - an empty sequence, e.g. `[]`
 * - a sequence of expressions, e.g. `[1, 2, 3]` (maybe)
 * - a sequence of expressions separated by a "," delimiter, e.g. `[1, 2, 3]`
 * - a sequence of expressions separated by a ";" delimiter,
 *    which may contain a sequence of expression with a "," delimiter
 *    e.g. `[1; 2; 3; 4]` or `[1, 2; 3, 4]`
 * - a range, e.g. `[1..10]`
 * - a range with a step, e.g. `[1, 3..10]`
 * - a linspace, e.g. `[1..10:50]` (not yet supported)
 * - a list comprehension, e.g. `[x^2 for x in 1..3 if x > 1]` (not yet supported)
 *
 */
function parseBrackets(
  parser: Parser,
  body: MathJsonExpression | null | undefined
): MathJsonExpression {
  if (isEmptySequence(body)) return ['List'];

  const h = operator(body);
  if (h === 'Range' || h === 'Linspace') return body;
  if (h === 'Sequence') {
    const elems = operands(body);
    const inferred = tryInferRangeFromElements(elems, parser);
    if (inferred) return inferred;
    return ['List', ...elems];
  }

  if (h === 'Delimiter') {
    const delim = stringValue(operand(body, 2)) ?? '...';
    if (delim === ';' || delim === '.;.') {
      return [
        'List',
        ...(operands(operand(body, 1)) ?? []).map((x) =>
          parseBrackets(parser, x)
        ),
      ];
    }
    if (delim === ',' || delim === '.,.') {
      body = operand(body, 1);
      if (operator(body) === 'Sequence') {
        const elems = operands(body);
        const inferred = tryInferRangeFromElements(elems, parser);
        if (inferred) return inferred;
        return ['List', ...elems];
      }
      return ['List', body ?? 'Nothing'];
    }
  }

  return ['List', body];
}

/**
 * Detect the inferred-step list-range form: elements ending with
 * `[..., s0, s1, ..., sk, ContinuationPlaceholder, end]`.
 *
 * If the pattern is found, returns `['Range', start, end, step]`,
 * an Error node for inconsistent/degenerate cases, or `null` to fall through.
 */
function tryInferRangeFromElements(
  elems: readonly MathJsonExpression[],
  parser: Parser
): MathJsonExpression | null {
  // Need at least 3 elements: s0, ContinuationPlaceholder, end
  if (elems.length < 3) return null;

  const penultimate = elems[elems.length - 2];
  // Check that the second-to-last element is ContinuationPlaceholder
  if (symbol(penultimate) !== 'ContinuationPlaceholder') return null;

  // samples = all elements before ContinuationPlaceholder
  // end     = the last element
  const samples = elems.slice(0, -2);
  const endExpr = elems[elems.length - 1];

  // Single-anchor continuation: `[1, ..., 10]` (no second sample to infer a
  // step). Produce the default-step `Range(start, end)`, matching `[1...10]`.
  // The `ContinuationPlaceholder` must never survive as a list element.
  if (samples.length === 1) {
    const start = machineValue(samples[0]);
    if (start === null) return null;
    return ['Range', start, endExpr];
  }

  // Need at least 2 samples to infer a step
  if (samples.length < 2) return null;

  // All samples must be numeric
  const sampleNums = samples.map(machineValue);
  if (sampleNums.some((n) => n === null)) return null;
  const nums = sampleNums as number[];

  // Step = difference between the last two samples
  const step = nums[nums.length - 1] - nums[nums.length - 2];

  // Degenerate: step is zero (or effectively zero)
  const tol = parser.options.tolerance;
  if (Math.abs(step) < tol)
    return parser.error('degenerate-range-step', parser.index);

  // Validate all consecutive sample differences equal `step` within tolerance
  for (let i = 1; i < nums.length; i++) {
    if (Math.abs(nums[i] - nums[i - 1] - step) > tol)
      return parser.error('inconsistent-range-samples', parser.index);
  }

  return ['Range', nums[0], endExpr, step];
}

/** A "List" expression can represent a collection of arbitrary elements,
 * or a system of equations.
 */
function serializeList(
  serializer: Serializer,
  expr: MathJsonExpression
): string {
  // Is it a system of equations?
  if (
    nops(expr) > 1 &&
    operands(expr).every((x) => {
      const op = operator(x);
      return isEquationOperator(op) || isInequalityOperator(op);
    })
  ) {
    return joinLatex([
      '\\begin{cases}',
      serializeOps('\\\\')(serializer, expr),
      '\\end{cases}',
    ]);
  }

  // Note: Avoid \\[ ... \\] because it is used for display math
  return joinLatex([
    '\\bigl\\lbrack',
    serializeOps(', ')(serializer, expr),
    '\\bigr\\rbrack',
  ]);
}
/**
 * A range is a sequence of numbers, e.g. `1..10`.
 * Optionally, they may include a step, e.g. `1..3..10`.
 */
function parseRange(
  parser: Parser,
  lhs: MathJsonExpression | null
): MathJsonExpression | null {
  if (lhs === null) return null;

  const second = parser.parseExpression({ minPrec: 270 });
  // This was `1..`. Don't know what to do with it. Bail.
  if (second === null) return null;

  // If we have 1..2..3, we have a range with a step, and second returned
  // ["Range", 2, 3]
  if (operator(second) === 'Range') {
    const step = operand(second, 1);
    const end = operand(second, 2);
    if (step && end) return ['Range', lhs, end, ['Subtract', step, lhs]];
    return null;
  }

  return ['Range', lhs, second];
}

export const DELIMITERS_SHORTHAND = {
  '(': '(',
  ')': ')',
  '[': '\\lbrack',
  ']': '\\rbrack',
  '\u27E6': '\\llbrack', // U+27E6 MATHEMATICAL LEFT WHITE SQUARE BRACKET
  '\u27E7': '\\rrbrack', // U+27E7 MATHEMATICAL RIGHT WHITE SQUARE BRACKET
  '{': '\\lbrace',
  '}': '\\rbrace',
  '<': '\\langle',
  '>': '\\rangle',
  // '|': '\\vert',
  '‖': '\\Vert', // U+2016 DOUBLE VERTICAL LINE
  '\\': '\\backslash',
  '⌈': '\\lceil', // ⌈ U+2308 LEFT CEILING
  '⌉': '\\rceil', // U+2309 RIGHT CEILING
  '⌊': '\\lfloor', // ⌊ U+230A LEFT FLOOR
  '⌋': '\\rfloor', // ⌋ U+230B RIGHT FLOOR
  '⌜': '\\ulcorner', // ⌜ U+231C TOP LEFT CORNER
  '⌝': '\\urcorner', // ⌝ U+231D TOP RIGHT CORNER
  '⌞': '\\llcorner', // ⌞ U+231E BOTTOM LEFT CORNER
  '⌟': '\\lrcorner', // ⌟ U+231F BOTTOM RIGHT CORNER
  '⎰': '\\lmoustache', // U+23B0 UPPER LEFT OR LOWER RIGHT CURLY BRACKET SECTION
  '⎱': '\\rmoustache', // U+23B1 UPPER RIGHT OR LOWER LEFT CURLY BRACKET SECTION
  // '⎹': '', // U+23B9 DIVIDES
  // '⎾': '', // U+23BE RIGHT PARENTHESIS UPPER HOOK
  // '⎿': '', // U+23BF RIGHT PARENTHESIS LOWER HOOK
};

export function latexToDelimiterShorthand(s: string): string | undefined {
  for (const key in DELIMITERS_SHORTHAND)
    if (DELIMITERS_SHORTHAND[key as keyof typeof DELIMITERS_SHORTHAND] === s)
      return key;

  return undefined;
}

function parseAssign(
  parser: Parser,
  lhs: MathJsonExpression,
  until?: Readonly<Terminator>
): MathJsonExpression | null {
  // In local-binding contexts (`;` blocks and `where` bindings), keep
  // simple subscripted names as compound symbols (e.g. `r_1`).
  const isLocalBindingContext = (until?.minPrec ?? 0) >= 19;

  //
  // 0/ Compound symbols: "r_1" or "a_n"
  // If the base is a known indexed collection, decompose back to Subscript
  // for sequence definitions. Otherwise keep as a compound symbol for
  // simple variable assignment (e.g. in semicolon blocks).
  //
  const lhsSymbol = symbol(lhs);
  if (lhsSymbol && lhsSymbol.includes('_')) {
    const underscoreIndex = lhsSymbol.indexOf('_');
    const baseName = lhsSymbol.substring(0, underscoreIndex);
    const subscriptStr = lhsSymbol.substring(underscoreIndex + 1);
    const subscriptNum = parseInt(subscriptStr, 10);
    const subscript: MathJsonExpression =
      !isNaN(subscriptNum) && String(subscriptNum) === subscriptStr
        ? subscriptNum
        : subscriptStr;

    const simpleSequenceLikeSubscript =
      subscript !== '' &&
      (typeof subscript === 'number' ||
        (typeof subscript === 'string' && subscript.length === 1));

    if (
      parser.getSymbolType(baseName).matches('indexed_collection') ||
      (!isLocalBindingContext && simpleSequenceLikeSubscript)
    ) {
      // Base is a collection, or this is a top-level sequence-like assignment
      lhs = ['Subscript', baseName, subscript];
    }
    // Otherwise keep lhs as the compound symbol (e.g. "r_1")
  }

  //
  // 1/ f(x,y) := ...
  //
  if (
    operator(lhs) === 'InvisibleOperator' &&
    nops(lhs) === 2 &&
    operator(operand(lhs, 2)) === 'Delimiter'
  ) {
    // We have an assignment of the form `f(x,y) := ...`
    const fn = symbol(operand(lhs, 1));
    if (!fn) return null;

    const rhs = parser.parseExpression({ ...(until ?? {}), minPrec: 20 });
    if (rhs === null) return null;

    const delimBody = operand(operand(lhs, 2), 1);
    let args: MathJsonExpression[] = [];
    if (operator(delimBody) === 'Sequence') args = [...operands(delimBody)];
    else if (delimBody) args = [delimBody!];

    return ['Assign', fn, ['Function', rhs, ...(args ?? [])]];
  }

  //
  // 2/ f_n := ... (Subscript form — base is a collection or sequence)
  //
  if (operator(lhs) === 'Subscript' && symbol(operand(lhs, 1))) {
    const fn = symbol(operand(lhs, 1))!;

    // In local-binding contexts, if the base is NOT a known collection,
    // treat simple subscripted names as compound symbols for assignment.
    if (!parser.getSymbolType(fn).matches('indexed_collection')) {
      const sub = operand(lhs, 2);
      const subStr =
        (sub !== null && typeof sub === 'string' ? sub : undefined) ??
        (sub !== null && typeof sub === 'number' ? String(sub) : undefined);
      if (subStr && isLocalBindingContext) {
        // Convert to simple symbol assignment: r_1 := expr
        const rhs = parser.parseExpression({ ...(until ?? {}), minPrec: 20 });
        if (rhs === null) return null;
        return ['Assign', fn + '_' + subStr, rhs];
      }
    }

    const rhs = parser.parseExpression({ ...(until ?? {}), minPrec: 20 });
    if (rhs === null) return null;

    const sub = operand(lhs, 2);
    //
    // 2.1 // f_\mathrm{max} := ...
    //
    if (stringValue(sub) !== null) {
      return ['Assign', lhs, rhs];
    }

    if (symbol(sub)) {
      //
      // 2.2 // f_n := ... OR a_n := a_{n-1} + 1 (sequence definition)
      // Preserve Subscript form - the Assign evaluate handler will determine
      // if this is a function definition or sequence definition based on
      // whether the RHS contains self-references.
      //
      return ['Assign', lhs, rhs];
    }

    return ['Assign', lhs, rhs];
  }

  // If this is a previously defined function, the lhs might be a
  // function application, i.e. `f(x) := ...`
  const fn = operator(lhs);
  if (fn) {
    if (fn === 'Subscript' || fn === 'Superscript') {
      // We have f_n := or f^n := ...
    }
    const args = operands(lhs);
    const rhs = parser.parseExpression({ ...(until ?? {}), minPrec: 20 });
    if (rhs === null) return null;

    return ['Assign', fn, ['Function', rhs, ...args]];
  }

  if (!symbol(lhs)) return null;

  const rhs = parser.parseExpression({ ...(until ?? {}), minPrec: 20 });
  if (rhs === null) return null;

  return ['Assign', lhs, rhs];
}

/** Parse a \begin{cases}...\end{cases} expression.
 *
 * This could be a "Which" expression, i.e. a sequence of conditions and values
 * or a system of equations (a "List" of equations or inequalities).
 *
 */
function parseCasesEnvironment(parser: Parser): MathJsonExpression | null {
  const rows: MathJsonExpression[][] | null = parser.parseTabular();
  if (!rows) return ['List'];

  //
  // 1/ Is it a system of equations?
  //
  // Single column with an equality or inequality
  //
  if (
    rows.every((row) => {
      if (row.length !== 1) return false;
      const op = operator(row[0]);
      return isInequalityOperator(op) || isEquationOperator(op);
    })
  ) {
    return ['List', ...rows.map((row) => row[0])];
  }

  //
  // 2/ It's a "Which" expression
  //
  // Each row must have 1 or 2 elements:
  // - 1 element: the default value
  // - 2 elements: the condition and the value

  // Note: return `True` for the condition, because it must be present
  // as the second element of the Tuple. Return an empty sequence for the
  // value, because it is optional
  const result: MathJsonExpression[] = [];
  for (const row of rows) {
    if (row.length === 1) {
      result.push('True');
      result.push(row[0]);
    } else if (row.length === 2) {
      const s = stringValue(row[1]);
      // If a string, probably 'else' or 'otherwise'
      result.push(s ? 'True' : (stripText(row[1]) ?? 'True'));
      result.push(row[0]);
    }
  }
  return ['Which', ...result];
}

/**
 * Relational LaTeX tokens that, when they immediately follow an `&` alignment
 * marker (`x &= y`), split a relation from its left-hand side. Mapped to the
 * corresponding MathJSON head so the row can be reassembled into a single
 * relation. Restricted to equation/inequality operators — the ones that make a
 * row of an alignment environment a member of a *system*.
 */
const ALIGNED_RELATION_TOKENS: Record<string, string> = {
  '=': 'Equal',
  '\\ne': 'NotEqual',
  '\\neq': 'NotEqual',
  '<': 'Less',
  '\\lt': 'Less',
  '>': 'Greater',
  '\\gt': 'Greater',
  '\\le': 'LessEqual',
  '\\leq': 'LessEqual',
  '\\ge': 'GreaterEqual',
  '\\geq': 'GreaterEqual',
};

function atAlignedRowEnd(parser: Parser): boolean {
  return parser.atBoundary || parser.peek === '\\\\' || parser.peek === '\\cr';
}

/**
 * Parse a single row of an alignment environment into one expression. `&` is an
 * alignment marker (not a column separator), so it is transparent: `x &= y`
 * becomes the single relation `x = y` by reattaching the accumulated left-hand
 * side `x` when a relational operator follows the `&`. A lone trailing sentence
 * punctuation (`,` `.` `;`, e.g. `... = 0,`) is dropped.
 */
function parseAlignedRow(parser: Parser): MathJsonExpression | null {
  // Stop a segment at `&`, a row break, or trailing sentence punctuation. The
  // condition is only consulted at the top level of the expression, so commas
  // *inside* a group (e.g. `f(x, y)`) are unaffected.
  const rowCondition = (p: Parser) =>
    p.peek === '&' ||
    p.peek === '\\\\' ||
    p.peek === '\\cr' ||
    p.peek === ',' ||
    p.peek === ';';

  let acc: MathJsonExpression | null = null;

  while (!atAlignedRowEnd(parser)) {
    parser.skipSpace();
    if (atAlignedRowEnd(parser)) break;

    // `&` alignment marker: transparent.
    if (parser.match('&')) continue;

    // Trailing sentence punctuation inside a row.
    if (parser.peek === ',' || parser.peek === '.' || parser.peek === ';') {
      parser.nextToken();
      continue;
    }

    // A relation right after an alignment marker (`x &= y`): reattach `acc` as
    // the left-hand side. (`parseExpression` returns null on a leading infix
    // operator, so this is reconstructed by hand.)
    const rel = ALIGNED_RELATION_TOKENS[parser.peek];
    if (rel !== undefined && acc !== null) {
      parser.nextToken();
      const rhs = parser.parseExpression({
        minPrec: 0,
        condition: rowCondition,
      });
      acc = [rel, acc, missingIfEmpty(rhs)] as MathJsonExpression;
      continue;
    }

    const seg = parser.parseExpression({ minPrec: 0, condition: rowCondition });
    if (seg === null) {
      // Unparseable token: make progress to avoid an infinite loop.
      parser.nextToken();
      continue;
    }
    acc =
      acc === null
        ? seg
        : (['InvisibleOperator', acc, seg] as MathJsonExpression);
  }
  return acc;
}

/**
 * Parse an alignment/multiline environment (`\begin{aligned}...\end{aligned}`,
 * `align`, `gather`, `split`, ...) as a *system* of equations: a `List` with
 * one entry per row. This mirrors the single-column `cases` convention (see
 * `parseCasesEnvironment`), which `Solve` accepts as a system. `&` markers are
 * alignment hints, not columns, so each row is merged back into a single
 * expression (see `parseAlignedRow`).
 */
function parseAlignedEnvironment(parser: Parser): MathJsonExpression | null {
  const result: MathJsonExpression[] = [];

  while (!parser.atBoundary) {
    const startIndex = parser.index;

    const row = parseAlignedRow(parser);
    if (row !== null) result.push(row);

    parser.skipSpace();
    if (parser.match('\\\\') || parser.match('\\cr'))
      parser.parseOptionalGroup(); // drop optional line-spacing arg, e.g. `[2pt]`

    // Safety: ensure forward progress even on unparseable input.
    if (parser.index === startIndex) {
      if (parser.atBoundary) break;
      parser.nextToken();
    }
  }

  return ['List', ...result];
}

/**
 * Try to match `{keyword}`, where `keyword` is the content between braces,
 * after the brace-introducing command (`\text` or `\keyword`) has already been
 * consumed. Handles optional surrounding spaces: `{ if }` matches "if".
 * If matched, tokens are consumed. If not, parser index is unchanged.
 */
function matchBracedKeyword(parser: Parser, keyword: string): boolean {
  const start = parser.index;

  // We expect <{> after the trigger (the trigger command was already consumed)
  if (!parser.match('<{>')) {
    parser.index = start;
    return false;
  }

  // Skip leading spaces
  while (parser.match('<space>')) {}

  // Match keyword character by character.
  // Spaces in the keyword require at least one <space> token.
  for (let i = 0; i < keyword.length; i++) {
    if (keyword[i] === ' ') {
      // Require at least one space, skip extras
      if (!parser.match('<space>')) {
        parser.index = start;
        return false;
      }
      while (parser.match('<space>')) {}
    } else {
      if (parser.peek !== keyword[i]) {
        parser.index = start;
        return false;
      }
      parser.nextToken();
    }
  }

  // Skip trailing spaces
  while (parser.match('<space>')) {}

  // Must close with <}>
  if (!parser.match('<}>')) {
    parser.index = start;
    return false;
  }

  return true;
}

/**
 * Match `\text{keyword}`, `\keyword{keyword}`, or `\operatorname{keyword}`
 * (and variants like `\mathrm{keyword}`).
 * Consumes tokens on success, leaves parser unchanged on failure.
 */
function matchKeyword(parser: Parser, keyword: string): boolean {
  const start = parser.index;
  parser.skipVisualSpace();

  // Try \text{keyword} or \keyword{keyword} — consume the brace-introducing
  // command first, then match the braced content.
  if (parser.match('\\text') || parser.match('\\keyword')) {
    if (matchBracedKeyword(parser, keyword)) return true;
    parser.index = start;
  }

  // Try \operatorname{keyword}, \mathrm{keyword}, etc.
  // parseComplexId in parse.ts handles these via parseSymbol
  const saved = parser.index;
  const sym = parser.parseSymbol();
  if (sym !== null && symbol(sym) === keyword) return true;
  parser.index = saved;

  return false;
}

/**
 * Non-consuming check: returns true if the next tokens form `keyword`
 * (via \text{keyword} or \operatorname{keyword}), without advancing.
 */
function peekKeyword(parser: Parser, keyword: string): boolean {
  const start = parser.index;
  const result = matchKeyword(parser, keyword);
  parser.index = start;
  return result;
}

/**
 * Parse the body of an if expression after the "if" keyword has been consumed.
 * Parses: condition \text{then} trueBranch \text{else} falseBranch
 */
function parseIfExpression(
  parser: Parser,
  until?: Readonly<Terminator>
): MathJsonExpression | null {
  // Ignore visual spacing between if/then/else keywords and branch expressions.
  parser.skipVisualSpace();

  // Parse condition — stop at "then" keyword
  const condition = parser.parseExpression({
    minPrec: 0,
    condition: (p) => peekKeyword(p, 'then'),
  });
  if (condition === null) return null;

  // Consume "then"
  if (!matchKeyword(parser, 'then')) return null;

  parser.skipVisualSpace();

  // Parse true branch — stop at "else" keyword
  const trueBranch = parser.parseExpression({
    minPrec: 0,
    condition: (p) => peekKeyword(p, 'else'),
  });
  if (trueBranch === null) return null;

  // Consume "else"
  if (!matchKeyword(parser, 'else')) return null;

  parser.skipVisualSpace();

  // Parse false branch — use outer terminator
  const falseBranch = parser.parseExpression(until) ?? 'Nothing';

  return ['If', condition, trueBranch, falseBranch] as MathJsonExpression;
}

/**
 * Parse a for expression after the "for" keyword has been consumed.
 * Parses: index \text{from} lower \text{to} upper \text{do} body
 * Returns: ["Loop", body, ["Element", index, ["Range", lower, upper]]]
 */
function parseForExpression(
  parser: Parser,
  until?: Readonly<Terminator>
): MathJsonExpression | null {
  // Parse index variable — stop at "from" keyword
  const indexExpr = parser.parseExpression({
    minPrec: 0,
    condition: (p) => peekKeyword(p, 'from'),
  });
  const index = indexExpr ? symbol(indexExpr) : null;
  if (!index) return null;

  // Consume "from"
  if (!matchKeyword(parser, 'from')) return null;

  // Parse lower bound — stop at "to" keyword
  const lower = parser.parseExpression({
    minPrec: 0,
    condition: (p) => peekKeyword(p, 'to'),
  });
  if (lower === null) return null;

  // Consume "to"
  if (!matchKeyword(parser, 'to')) return null;

  // Parse upper bound — stop at "do" keyword
  const upper = parser.parseExpression({
    minPrec: 0,
    condition: (p) => peekKeyword(p, 'do'),
  });
  if (upper === null) return null;

  // Consume "do"
  if (!matchKeyword(parser, 'do')) return null;

  // Parse body — use outer terminator
  const body = parser.parseExpression(until) ?? 'Nothing';

  return [
    'Loop',
    body,
    ['Element', index, ['Range', lower, upper]],
  ] as MathJsonExpression;
}

/**
 * Parse a for-comprehension after the `\operatorname{for}` keyword has
 * been consumed (lhs is the body):
 *
 *   body \operatorname{for} x = L_1, y = L_2, ...
 *
 * Produces `["Comprehension", body, ["Element", x, L_1], ["Element", y, L_2], ...]`.
 *
 * The bindings are comma-separated `name = expr` pairs. We stop at the
 * outer terminator (e.g. closing `]` of a surrounding list literal).
 *
 * Note: scope hygiene is handled by the `Comprehension` canonical form — this
 * function only produces the raw AST.
 */
function parseForComprehension(
  parser: Parser,
  lhs: MathJsonExpression,
  until?: Readonly<Terminator>
): MathJsonExpression | null {
  // Each binding's RHS must stop at top-level commas (so commas can
  // separate bindings) and at the outer terminator (e.g. `]`).
  const bindingTerminator: Terminator = {
    minPrec: 21, // Above comma (20) and ; (19), so `x = L_1` is captured whole
    condition: (p) => {
      if (until?.condition?.(p)) return true;
      const saved = p.index;
      p.skipVisualSpace();
      const isComma = p.peek === ',';
      p.index = saved;
      if (isComma) return true;
      // Stop at trailing `where`/`with` so they're processed by the
      // outer parser rather than swallowed into the binding RHS.
      // Needed because `minPrec: 21` above *admits* operators at
      // precedence 21, and `\operatorname{where}` is registered at
      // exactly 21 — without this check, `for i = R \operatorname{where}
      // n \coloneq 3` parses `R \operatorname{where} n \coloneq 3` as a
      // single binding RHS (which then fails because the result isn't
      // `Equal`/`Assign`).
      //
      // `with` is NOT a CE built-in (A4 dropped it; Desmos-style `with`
      // is registered by consumers via custom LaTeX dictionary — see
      // the GP team's `docs/COMPUTE_ENGINE.md`). It's recognized here
      // purely so consumer-registered `with` clauses compose with `for`
      // out of the box, matching how built-in `where` composes. If a
      // consumer registers an additional clause keyword that also needs
      // to compose with `for`, this list needs to grow.
      if (peekKeyword(p, 'where')) return true;
      if (peekKeyword(p, 'with')) return true;
      return false;
    },
  };

  const elements: MathJsonExpression[] = [];
  do {
    parser.skipVisualSpace();
    const binding = parser.parseExpression(bindingTerminator);
    if (binding === null) break;

    // Binding must be `Equal(name, expr)` or `Assign(name, expr)`.
    const op = operator(binding);
    if (op !== 'Equal' && op !== 'Assign') return null;

    const name = operand(binding, 1);
    const list = operand(binding, 2);
    if (!name || !list) return null;

    elements.push(['Element', name, list] as MathJsonExpression);
    parser.skipVisualSpace();
  } while (parser.match(','));

  if (elements.length === 0) return null;
  return ['Comprehension', lhs, ...elements] as MathJsonExpression;
}

/**
 * Parse the bindings after "where" has been consumed.
 * Bindings are comma-separated expressions (typically Assign).
 * Produces a Block: declarations first, then body (lhs) last.
 */
function parseWhereExpression(
  parser: Parser,
  lhs: MathJsonExpression,
  until?: Readonly<Terminator>
): MathJsonExpression | null {
  // Stop at commas so each binding is parsed separately
  const bindingTerminator: Terminator = {
    minPrec: 21, // Above comma (20) and ; (19)
    condition: (p) => {
      // Check if the outer terminator says to stop
      if (until?.condition?.(p)) return true;
      // Check for comma (skip visual spaces like \; first)
      const saved = p.index;
      p.skipVisualSpace();
      const isComma = p.peek === ',';
      p.index = saved;
      return isComma;
    },
  };

  const bindings: MathJsonExpression[] = [];
  do {
    parser.skipVisualSpace();
    const binding = parser.parseExpression(bindingTerminator);
    if (!binding) break;
    bindings.push(binding);
    parser.skipVisualSpace();
  } while (parser.match(','));

  if (bindings.length === 0) return null;

  // Lookahead for trailing \operatorname{for}. If present, consume the
  // for-clause and wrap the resulting Loop in the Block carrying the
  // where-clause bindings. This produces the canonical Block-outermost
  // shape: Block(Declare, Assign, ..., Loop(body, Element(...))).
  // matchKeyword consumes on success and rewinds on failure.
  const forStart = parser.index;
  if (matchKeyword(parser, 'for')) {
    const loop = parseForComprehension(parser, lhs, until);
    if (loop) {
      // Build Block: Declare+Assign for each binding, Loop last as body.
      const block: MathJsonExpression[] = [];
      for (const b of bindings) {
        const normalized = normalizeLocalAssign(b);
        if (operator(normalized) === 'Assign') {
          block.push(['Declare', operand(normalized, 1)!]);
          block.push(normalized);
        } else {
          block.push(normalized);
        }
      }
      block.push(loop);
      return ['Block', ...block] as MathJsonExpression;
    }
    // parseForComprehension failed mid-stream. Restore index and fall
    // through to the plain Block path.
    parser.index = forStart;
  }

  // Build Block: Declare+Assign for each binding, body (lhs) last
  const block: MathJsonExpression[] = [];
  for (const b of bindings) {
    const normalized = normalizeLocalAssign(b);
    if (operator(normalized) === 'Assign') {
      block.push(['Declare', operand(normalized, 1)!]);
      block.push(normalized);
    } else {
      block.push(normalized);
    }
  }
  block.push(lhs); // body is last in Block
  return ['Block', ...block] as MathJsonExpression;
}

/**
 * Convert a sequence of expressions to a Block, inserting Declare
 * before each Assign.
 */
function buildBlockFromSequence(seq: MathJsonExpression[]): MathJsonExpression {
  const block: MathJsonExpression[] = [];
  for (const s of seq) {
    const normalized = normalizeLocalAssign(s);
    if (operator(normalized) === 'Assign') {
      block.push(['Declare', operand(normalized, 1)!]);
    }
    block.push(normalized);
  }
  return ['Block', ...block] as MathJsonExpression;
}

function normalizeLocalAssign(expr: MathJsonExpression): MathJsonExpression {
  if (operator(expr) !== 'Assign') return expr;

  const lhs = operand(expr, 1);
  if (operator(lhs) !== 'Subscript') return expr;

  const base = symbol(operand(lhs, 1));
  if (!base) return expr;

  const sub = operand(lhs, 2);
  const subStr =
    (typeof sub === 'string' ? sub : undefined) ??
    (typeof sub === 'number' ? String(sub) : undefined);
  if (!subStr) return expr;

  return ['Assign', `${base}_${subStr}`, operand(expr, 2) ?? 'Nothing'];
}

/** A parenthesized group parses to a `Delimiter` with `(` fences. Such a
 * group is a valid indexing target (`(3,4)[1]` → `At(Tuple(3,4), 1)`).
 * A bare comma-delimiter (`a, b`) is a `Delimiter` whose fence string is a
 * lone separator (e.g. `,`) with no opening paren, and is not a group. */
function isParenGroupDelimiter(lhs: MathJsonExpression): boolean {
  if (operator(lhs) !== 'Delimiter') return false;
  // No explicit fence string: the default fences are parentheses `()`.
  if (nops(lhs) < 2) return true;
  const fence = stringValue(operand(lhs, 2));
  // The fence string is `open[+sep]+close`; a length-1 string is a bare
  // separator, not a parenthesized group.
  return typeof fence === 'string' && fence.length >= 2 && fence[0] === '(';
}

/** Compound heads that can reach `parseAt` as an LHS but are NOT function
 * applications, so they must not be indexed here. `Delimiter` and `List` are
 * accepted through their own gates; the rest are structural: a bare
 * `Sequence`, an `InvisibleOperator` juxtaposition product, an `Error`, or an
 * already-built `At` (chained indexing is unsupported, matching the symbol
 * path `x[1][2]`). */
const NON_APPLICATION_HEADS = new Set([
  'Delimiter',
  'List',
  'Sequence',
  'InvisibleOperator',
  'Error',
  'At',
]);

/** The LHS is a function application (`f(x)`, `\operatorname{sphere}(u,v)`)
 * when it is a compound expression with a symbol head that is not one of the
 * structural non-application heads. Such a call is a valid indexing target
 * (`f(x)[1]` → `At(f(x), 1)`). An undeclared juxtaposition (`g(x)`) never
 * reaches here as an application: it parses to `InvisibleOperator` and the
 * bracket binds to the inner parenthesized group instead. */
function isFunctionApplication(lhs: MathJsonExpression): boolean {
  const head = operator(lhs);
  if (typeof head !== 'string' || head === '') return false;
  return !NON_APPLICATION_HEADS.has(head);
}

function parseAt(
  ...close: string[]
): (parser: Parser, lhs: MathJsonExpression) => MathJsonExpression | null {
  // @todo: if there are no `close` symbols, parse as a subscript: either
  // a single symbol, or a group.
  return (
    parser: Parser,
    lhs: MathJsonExpression
  ): MathJsonExpression | null => {
    // The LHS must be indexable: a symbol, a List literal, a parenthesized
    // group, or a function application. A parenthesized group reaches us as a
    // `Delimiter` with `(` fences (e.g. `(3,4)` → `Delimiter(Sequence(3,4),
    // '(,)')`, `(x+1)` → `Delimiter(Add(x,1))`). A function application
    // reaches us as `[head, ...args]` (e.g. `f(x)` → `["f","x"]`,
    // `\operatorname{sphere}(u,v)` → `["Sphere","u","v"]`). Only parentheses
    // and calls can present a compound LHS here: a bare compound such as
    // `x+1[2]` binds the bracket to its last operand via precedence, so
    // `Add(x,1)` never reaches us. The Delimiter is left intact and unwrapped
    // to a `Tuple`/inner expression by canonicalization.
    if (
      !symbol(lhs) &&
      operator(lhs) !== 'List' &&
      !isParenGroupDelimiter(lhs) &&
      !isFunctionApplication(lhs)
    )
      return null;

    let rhs: MathJsonExpression | null = null;
    if (close.length === 0) {
      rhs = parser.parseGroup() ?? parser.parseExpression({ minPrec: 0 });
      if (rhs === null) return null;
    } else if (close.length > 1) {
      // `\left...\right` fenced form (e.g. `A\left[1\right]`, which Desmos
      // always emits). Bound the index expression by the closing fence.
      // Without this, `parseExpression()` over-consumes: unlike a bare `]`
      // (which terminates the expression), a `\right` token parses as an
      // error and the invisible-operator path keeps swallowing the closing
      // tokens, so the delimiter match then fails and the whole index group
      // is silently dropped.
      parser.addBoundary(close);
      rhs = parser.parseExpression({ minPrec: 0 });
      if (rhs === null || !parser.matchBoundary()) {
        parser.removeBoundary();
        return null;
      }
    } else {
      rhs = parser.parseExpression({ minPrec: 0 });
      if (rhs === null) return null;
      if (!parser.matchAll(close)) return null;
    }

    // A string index is a dictionary key (`data["x"]` → `At(data, "x")`), valid
    // only for the bracketed forms. In the close-less (subscript) mode a string
    // rhs is rejected so it falls back to `Subscript` (regression #201).
    if (close.length === 0 && stringValue(rhs) !== null) return null;

    if (operator(rhs) === 'Delimiter') rhs = operand(rhs, 1) ?? 'Nothing';
    if (operator(rhs) === 'Sequence') return ['At', lhs, ...operands(rhs)];
    return ['At', lhs, rhs];
  };
}
