import { serializeEpsil } from '../epsil.js';
import { DISPLAY_MATERIALIZATION } from '../compute-engine/boxed-expression/abstract-boxed-expression.js';
import {
  toAsciiMath,
  type AsciiMathSerializer,
} from '../compute-engine/boxed-expression/ascii-math.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isObject,
  isSymbol,
} from '../compute-engine/boxed-expression/type-guards.js';
import type { Expression } from '../compute-engine/types-expression.js';
import type {
  DiagnosticNote,
  ParsingDiagnostic,
} from '../epsil/diagnostics.js';
import { epsilDiagnosticMessage } from '../epsil/diagnostic-message.js';
import { explainErrorCode } from '../epsil/error-explanations.js';
import { describeError, errorCode } from '../epsil/static-diagnostics.js';

import type { EvaluationResult, OutputMode } from './types.js';

const ANSI = {
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
};

/** Maximum number of collection elements materialized in `--json` output.
 * Beyond the cap, the output carries a `ContinuationPlaceholder` marker. */
const JSON_MATERIALIZATION_CAP = 10_000;

export function formatValue(
  result: EvaluationResult,
  mode: OutputMode,
  options?: { fancySymbols?: boolean }
): string {
  if (result.source.trim() === '') return '';

  if (mode === 'json') {
    let value = result.value;
    // A lazy pipeline result (`Range`, `Map`, a loop-built `Join` chain)
    // serializes structurally — the recipe, not the elements. For display,
    // materialize finite collections (recursively: a tuple holding a lazy
    // `Take` materializes too). Infinite or indeterminate collections keep
    // their structural form.
    if (value.isCollection && value.isFiniteCollection === true) {
      try {
        value = value.evaluate({
          materialization: [JSON_MATERIALIZATION_CAP, 0],
        });
      } catch {
        // Materialization is best-effort: fall back to the structural form.
      }
    }
    return JSON.stringify(value.toMathJson({ digits: 'auto' }), null, 2);
  }
  // The MathJSON export prettifies `Power(x, 2)` into `Square(x)`, a head
  // meant for LaTeX display: Epsil source spells a square `x ^ 2` (or `x²` in
  // fancy-symbol mode), so that one rewrite is excluded here. The other
  // prettifier rewrites produce ordinary Epsil (`1 / x`, `Exp(x)`) and stay.
  // A library name is written with its Epsil spelling (`sin(x)`), unless the
  // session binds the spelling (`let sin = 3` in an earlier cell): then the
  // MathJSON name is kept, so the printed text reads back as the value.
  if (mode === 'epsil') {
    const engine = result.value.engine;
    return serializeEpsil(
      result.value.toMathJson({
        digits: 'auto',
        exclude: ['Square'],
      }),
      {
        fancySymbols: options?.fancySymbols === true,
        isBound: (name) => engine.lookupDefinition(name) !== undefined,
      }
    );
  }
  // A `Nothing` result is not echoed in the human-facing mode: a program
  // whose last statement is a `print(…)` (or a declaration, or a loop)
  // produces Nothing, and printing the word after the program's own output
  // is noise (the Python REPL treats None the same way). The machine modes
  // above keep the value — their consumers asked for the value itself. The
  // LaTeX mode is for display, and suppresses it too.
  if (isSymbol(result.value, 'Nothing')) return '';
  if (mode === 'latex') return result.value.latex;
  return epsilValueText(result.value);
}

/** The Epsil words of the constants that the engine's textual form quotes.
 * A null prototype, so that a symbol named `constructor` is not found. */
const LITERAL_WORDS: Readonly<Record<string, string>> = {
  __proto__: null as never,
  True: 'true',
  False: 'false',
  Nothing: 'nothing',
  Missing: 'missing',
};

/** The functions that the value mode writes as a call, not in the notation of
 * the engine's textual form. */
const CALL_FORM_FUNCTIONS = ['Abs', 'Norm', 'Root'] as const;

/**
 * The text of a number literal with an explicit product where the textual
 * form writes an implicit one that Epsil does not read back: `3/2 * sqrt(2)`,
 * `sqrt(3)/2 * i`, `2sqrt(2) * i`, `(1 - 3/2 * i)`. Epsil reads `3/2sqrt(2)`
 * and `sqrt(3)/2i` as `3/(2sqrt(2))` and `sqrt(3)/(2i)`, because an implicit
 * product binds tighter than `/`, and does not read `sqrt(2)i`. For another
 * number the result is `undefined`, and the number keeps the default form
 * (`2i`, `(1 + 2.5i)`, `2sqrt(3)`).
 */
function explicitProductText(
  expr: Expression,
  serialize: AsciiMathSerializer
): string | undefined {
  const json = expr.json;
  if (!Array.isArray(json) || json[0] !== 'Complex' || json.length !== 3) {
    // A real exact number is `rational · sqrt(radical)`, written
    // `p/qsqrt(r)` when the rational is not an integer and its numerator is
    // not ±1. A part of the rational can have an exponent (`5e+24/7`).
    if (!isNumber(expr) || !expr.isExact) return undefined;
    const num = expr.numericValue;
    if (typeof num === 'number') return undefined;
    const text = num.toString();
    const explicit = text.replace(
      /^(-?\d+(?:e\+\d+)?\/\d+(?:e\+\d+)?)(sqrt\()/,
      '$1 * $2'
    );
    return explicit === text ? undefined : explicit;
  }
  const ce = expr.engine;
  const im = serialize(ce.box(json[2]));
  // An integer or a decimal before `i` reads back: `2i`, `-2.5i`, `i`.
  if (/^-?\d+(\.\d+)?$/.test(im)) return undefined;
  const imText = `${im} * i`;
  const re = ce.box(json[1]);
  if (re.isSame(0)) return imText;
  if (imText.startsWith('-')) return `(${serialize(re)} - ${imText.slice(1)})`;
  return `(${serialize(re)} + ${imText})`;
}

/**
 * The text of a value in the human-facing value mode: the engine's textual
 * form (`toString()`), with the symbols written as Epsil writes them. The
 * textual form puts a symbol of more than one character in quotes, so `True`
 * and the string `"True"` would print the same; here `True` is `true`, a
 * library constant has its Epsil spelling (`integers`), and another symbol is
 * written as Epsil writes it (`a1`). A symbol that the textual form does not
 * quote (`x`, `pi`) keeps its form, and so does the name of a function,
 * which the textual form does not quote (`QuotientRing(integers, 3)`). An
 * absolute value, a norm and a root are calls (`abs(a)`, `norm(M, 3)`,
 * `root(2, 3)`), not the `|a|` and `||M||` of the textual form. A number
 * has an explicit product where Epsil does not read the implicit one back
 * (`sqrt(3)/2 * i` and `3/2 * sqrt(2)`, not `sqrt(3)/2i` and `3/2sqrt(2)`).
 * A lazy collection shows the same preview as `toString()`.
 */
export function epsilValueText(value: Expression): string {
  try {
    let shown = value;
    if (value.isLazyCollection && !isSymbol(value)) {
      const materialized = value.evaluate({
        materialization: DISPLAY_MATERIALIZATION,
      });
      if (!materialized.isLazyCollection) shown = materialized;
    }
    const engine = value.engine;
    // A symbol or a function name whose Epsil spelling the session binds keeps
    // its MathJSON name, so that the text reads back as the value.
    const spelling = {
      isBound: (name: string) => engine.lookupDefinition(name) !== undefined,
    };
    // A null prototype, so that a symbol named `__proto__` is a key.
    const symbols: Record<string, string> = Object.create(null);
    // Every place that `toAsciiMath` prints a symbol from: the operands of a
    // function, the values of a dictionary and the slots of an object. The
    // set of visited nodes stops the walk at a cycle of objects.
    const visited = new Set<Expression>();
    const collect = (node: Expression): void => {
      if (visited.has(node)) return;
      visited.add(node);
      if (isSymbol(node)) {
        const name = node.symbol;
        if (Object.hasOwn(symbols, name)) return;
        if (!toAsciiMath(node).startsWith('"')) return;
        symbols[name] = LITERAL_WORDS[name] ?? serializeEpsil(name, spelling);
      } else if (isFunction(node)) node.ops.forEach(collect);
      else if (isDictionary(node)) node.values.forEach(collect);
      else if (isObject(node)) node._slots.forEach(collect);
    };
    collect(shown);
    // The textual form writes `Abs` as `|a|`, `Norm` as `||M||` (without its
    // second operand) and `Root` as `root(3)(2)`, which Epsil cannot read;
    // here each is a call with the Epsil spelling of its name.
    const functions: Record<string, string> = {};
    for (const name of CALL_FORM_FUNCTIONS)
      functions[name] = serializeEpsil(name, spelling);
    return toAsciiMath(shown, {
      symbols,
      functions,
      numbers: explicitProductText,
    });
  } catch {
    // `toString()` never throws and turns a failure into a message.
    return value.toString();
  }
}

export function formatDiagnostics(
  diagnostics: readonly ParsingDiagnostic[],
  source: string,
  url: string | undefined,
  color: boolean
): string {
  return diagnostics
    .map((diagnostic) => formatDiagnostic(diagnostic, source, url, color))
    .join('\n\n');
}

export function hasErrors(result: EvaluationResult): boolean {
  return (
    result.diagnostics.some((x) => x.severity === 'error') ||
    result.value.errors.length > 0
  );
}

/**
 * A machine-readable diagnostic: the structured counterpart of the text
 * format produced by `formatDiagnostics()`. Offsets are 0-based character
 * offsets into the source; `line`/`column` are 1-based and derived from the
 * diagnostic's position (the same location the text format points at).
 */
export interface JsonDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  args: string[];
  message: string;
  start: number;
  end: number;
  line: number;
  column: number;
  fixits?: { start: number; end: number; value: string }[];
  /** Supplementary explanations (see `DiagnosticNote`). A note's `start`/`end`
   * — and the `line`/`column` derived from `start` — are present only when it
   * points at a second place in the source, such as the definition of the
   * function whose call failed. */
  notes?: {
    message: string;
    start?: number;
    end?: number;
    line?: number;
    column?: number;
  }[];
}

export function diagnosticToJson(
  diagnostic: ParsingDiagnostic,
  source: string
): JsonDiagnostic {
  const parts = Array.isArray(diagnostic.message)
    ? diagnostic.message
    : [diagnostic.message];
  const [code, ...args] = parts;
  const offset = diagnostic.range[2] ?? diagnostic.range[0];
  const { line, column } = sourceLocation(source, offset);

  const result: JsonDiagnostic = {
    severity: diagnostic.severity,
    code: String(code),
    args: args.map(String),
    message: epsilDiagnosticMessage(diagnostic),
    start: diagnostic.range[0],
    end: diagnostic.range[1],
    line,
    column,
  };
  if (diagnostic.fixits && diagnostic.fixits.length > 0)
    result.fixits = diagnostic.fixits.map(([start, end, value]) => ({
      start,
      end,
      value,
    }));
  if (diagnostic.notes && diagnostic.notes.length > 0)
    result.notes = diagnostic.notes.map((note) => {
      if (note.range === undefined) return { message: note.message };
      const at = sourceLocation(source, note.range[0]);
      return {
        message: note.message,
        start: note.range[0],
        end: note.range[1],
        line: at.line,
        column: at.column,
      };
    });
  return result;
}

function formatDiagnostic(
  diagnostic: ParsingDiagnostic,
  source: string,
  url: string | undefined,
  color: boolean
): string {
  return renderAnnotation(
    diagnostic.severity,
    epsilDiagnosticMessage(diagnostic),
    diagnostic.range,
    source,
    url,
    color,
    diagnostic.fixits,
    diagnosticDocCode(diagnostic),
    diagnostic.notes
  );
}

/**
 * The code advertised by a diagnostic's `note:` footer — the most SPECIFIC
 * code with an extended-doc entry: for the wrapper codes (`runtime-error`,
 * `static-type-error`) the engine error code they carry, falling back to
 * the wrapper itself; for everything else, the diagnostic code. `undefined`
 * when nothing has an entry (no footer — never a dead-end reference).
 */
function diagnosticDocCode(diagnostic: ParsingDiagnostic): string | undefined {
  const parts = Array.isArray(diagnostic.message)
    ? diagnostic.message
    : [diagnostic.message];
  const [code, ...args] = parts.map(String);
  const candidates =
    code === 'runtime-error'
      ? [args[2], code]
      : code === 'static-type-error'
        ? [args[2], code]
        : [code];
  return candidates.find(
    (x) => x !== undefined && explainErrorCode(x) !== undefined
  );
}

/**
 * Render an error-valued program RESULT as an annotated block, anchored at
 * the statement that produced it (`valueRange`).
 *
 * Presentation-layer only, by design: `executeEpsil` deliberately reports no
 * diagnostic for the final statement — a program may legitimately *author*
 * an `Error` value (errors are values) — so the raw value stays available to
 * every host, and the CLI translates it only when printing for a human.
 */
export function formatRuntimeError(
  result: EvaluationResult,
  url: string | undefined,
  color: boolean
): string {
  const error = result.value.errors[0];
  if (error === undefined) return '';

  // The breadcrumb chain is deliberately NOT rendered: the caret already
  // points at the innermost source-mapped frame, more clearly. The chain
  // stays available in the machine-readable diagnostic data.
  const message = `Runtime error: ${describeError(error.json)}`;

  const code = errorCode(error.json);
  const docCode = [code, 'runtime-error'].find(
    (x) => explainErrorCode(x) !== undefined
  );

  const [start, end] = result.valueRange ?? [0, result.source.length];
  return renderAnnotation(
    'error',
    message,
    [start, end, start],
    result.source,
    url,
    color,
    undefined,
    docCode,
    result.valueNotes
  );
}

/** Column at which a rendered annotation wraps its prose lines. */
const WRAP_COLUMN = 80;

/**
 * One annotated source block, in the style popularized by Elm and rustc: the
 * message first, then the location, the offending line with its span
 * underlined, and — when the diagnostic carries fixits that fit on that
 * line — a `help:` line showing the corrected source.
 *
 *     error: Unexpected symbol "+"
 *      --> example.epsil:1:3
 *       |
 *     1 | 1 +
 *       |   ^
 *       = help: …
 *
 * The excerpt is the line holding the diagnostic's position (its explicit
 * `position`, or the span start); a span reaching past that line is
 * underlined to the end of the line.
 *
 * A diagnostic's `notes` (see `DiagnosticNote`) follow: a note without a range
 * is a wrapped `= note:` line under the excerpt, and a note WITH one gets a
 * sub-block of its own — its message, its location, and its own excerpt — so
 * that "`foo` is defined here" points at the definition the way the primary
 * block points at the call:
 *
 *     error: Runtime error: a required argument is missing
 *      --> example.epsil:3:1
 *       |
 *     3 | foo("hello")
 *       | ^^^^^^^^^^^^
 *       = note: `foo` has signature `(x: string, n: integer) -> string`; …
 *
 *     note: `foo` is defined here
 *      --> example.epsil:1:10
 *       |
 *     1 | function foo(x: string, n: integer) { x }
 *       |          ^^^
 *
 * The `epsil doc …` footer stays last, so it reads as a footer for the whole
 * report rather than for the final sub-block.
 */
function renderAnnotation(
  severity: 'error' | 'warning',
  message: string,
  range: ParsingDiagnostic['range'],
  source: string,
  url: string | undefined,
  color: boolean,
  fixits?: ParsingDiagnostic['fixits'],
  docCode?: string,
  notes?: readonly DiagnosticNote[]
): string {
  const paint = (code: string, s: string) =>
    color ? `${code}${s}${ANSI.reset}` : s;
  const label = severity === 'error' ? 'error' : 'warning';
  const labelColor = severity === 'error' ? ANSI.red : ANSI.yellow;

  const head = `${paint(labelColor, `${label}:`)} ${message}`;
  const excerpt = renderExcerpt(range, source, url, paint, labelColor);
  const { pad } = excerpt;

  if (excerpt.body === '') return `${head}\n${excerpt.arrow}`;

  const suggestion = fixitSuggestion(fixits, excerpt.lineStart, excerpt.text);
  const help =
    suggestion === ''
      ? ''
      : `\n${pad} ${paint(ANSI.blue, '=')} help: ${suggestion}`;

  // A ranged note is a second annotated block; a bare one is a `= note:` line
  // under the primary excerpt.
  let inlineNotes = '';
  let siteBlocks = '';
  for (const note of notes ?? []) {
    if (note.range === undefined) {
      inlineNotes += `\n${noteLines(note.message, pad, paint)}`;
      continue;
    }
    const site = renderExcerpt(
      [note.range[0], note.range[1], note.range[0]],
      source,
      url,
      paint,
      ANSI.blue
    );
    siteBlocks += `\n\n${paint(ANSI.blue, 'note:')} ${note.message}\n${site.arrow}${site.body}`;
  }

  const docNote =
    docCode === undefined
      ? ''
      : `\n${pad} ${paint(ANSI.blue, '=')} ${paint(
          ANSI.dim,
          `note: \`epsil doc ${docCode}\` explains this ${label}`
        )}`;

  return `${head}\n${excerpt.arrow}${excerpt.body}${help}${inlineNotes}${siteBlocks}${docNote}`;
}

/**
 * The location line and source excerpt of one span — everything below an
 * annotation's message. Shared by the primary block and by each ranged note's
 * sub-block, so a "defined here" note is rendered exactly like the error it
 * explains (`caretColor` is the only difference: a secondary span underlines
 * in blue, not in the severity's color).
 *
 * `body` is empty when the anchor falls past the end of the source (nothing to
 * excerpt); the caller then prints the location alone.
 */
function renderExcerpt(
  range: ParsingDiagnostic['range'],
  source: string,
  url: string | undefined,
  paint: (code: string, s: string) => string,
  caretColor: string
): {
  arrow: string;
  body: string;
  pad: string;
  text: string;
  lineStart: number;
} {
  const anchor = range[2] ?? range[0];
  const { line, column, text, lineStart } = sourceLocation(source, anchor);
  const location = `${url ? `${url}:` : ''}${line}:${column}`;
  const pad = ' '.repeat(String(line).length);
  const arrow = `${pad}${paint(ANSI.blue, '-->')} ${paint(ANSI.dim, location)}`;

  if (text === undefined) return { arrow, body: '', pad, text: '', lineStart };

  const bar = paint(ANSI.blue, `${pad} |`);
  const codeLine = `${paint(ANSI.blue, `${line} |`)} ${text}`;

  // The span's intersection with the excerpt line; when empty (the position
  // sits outside its own span, e.g. at the end of the input), a single caret
  // at the position.
  const from = Math.max(0, Math.min(range[0] - lineStart, text.length));
  const to = Math.max(from, Math.min(range[1] - lineStart, text.length));
  const [mark, width] =
    to > from
      ? [from, to - from]
      : [Math.max(0, Math.min(column - 1, text.length)), 1];
  const underline = `${bar} ${' '.repeat(mark)}${paint(caretColor, '^'.repeat(width))}`;

  return {
    arrow,
    body: `\n${bar}\n${codeLine}\n${underline}`,
    pad,
    text,
    lineStart,
  };
}

/** A `= note:` footer, wrapped at {@link WRAP_COLUMN} with its continuation
 * lines hanging under the note's text column. */
function noteLines(
  message: string,
  pad: string,
  paint: (code: string, s: string) => string
): string {
  const prefix = `${pad} = note: `;
  const indent = ' '.repeat(prefix.length);
  const [first, ...rest] = wrapText(message, WRAP_COLUMN - prefix.length);
  const head = `${pad} ${paint(ANSI.blue, '=')} note: ${first}`;
  return [head, ...rest.map((x) => `${indent}${x}`)].join('\n');
}

/**
 * Greedy word wrap. A word longer than `width` (a long type, a URL) overflows
 * rather than being broken: splitting it would break the thing the reader most
 * needs to copy.
 *
 * A backtick-quoted span is one unbreakable word even though it contains
 * spaces — these messages quote types and signatures that way
 * (`` `(x: string, n: integer) -> string` ``), and a line break inside one
 * reads as two mangled types instead of one.
 */
function wrapText(text: string, width: number): string[] {
  const words = text.match(/(?:`[^`]*`|\S)+/g) ?? [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length === 0 ? [''] : lines;
}

/**
 * The excerpt line with the diagnostic's fixits applied — the "did you
 * mean" suggestion — or `''` when there are none or they reach beyond the
 * line (a multi-line rewrite does not render in a one-line hint).
 */
function fixitSuggestion(
  fixits: ParsingDiagnostic['fixits'],
  lineStart: number,
  text: string
): string {
  if (!fixits || fixits.length === 0) return '';
  const lineEnd = lineStart + text.length;
  if (!fixits.every(([s, e]) => s >= lineStart && e <= lineEnd)) return '';

  let fixed = text;
  for (const [s, e, value] of [...fixits].sort((a, b) => b[0] - a[0]))
    fixed = fixed.slice(0, s - lineStart) + value + fixed.slice(e - lineStart);
  fixed = fixed.replaceAll(/\s+/g, ' ').trim();
  return fixed === '' ? '' : `did you mean \`${fixed}\`?`;
}

/**
 * The 1-based line/column of `offset` in `source`, with the full text of that
 * line and its starting offset. Clamps `offset` into range. Recognizes every
 * line break the language does (CRLF, LF, lone CR, U+2028, U+2029) — exported
 * so the editor's language server quotes and numbers lines by the same rules
 * that produced the diagnostic's own `line`.
 */
export function sourceLocation(
  source: string,
  offset: number
): { line: number; column: number; text?: string; lineStart: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lines = before.split(/\r\n|[\n\r\u2028\u2029]/);
  const allLines = source.split(/\r\n|[\n\r\u2028\u2029]/);
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  return {
    line,
    column,
    text: allLines[line - 1],
    lineStart: clamped - (column - 1),
  };
}
