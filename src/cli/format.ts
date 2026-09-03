import { serializeEpsil } from '../epsil.js';
import { isSymbol } from '../compute-engine/boxed-expression/type-guards.js';
import type {
  DiagnosticNote,
  ParsingDiagnostic,
} from '../epsil/diagnostics.js';
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
  mode: OutputMode
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
    return JSON.stringify(
      value.toMathJson({ fractionalDigits: 'auto' }),
      null,
      2
    );
  }
  if (mode === 'epsil')
    return serializeEpsil(
      result.value.toMathJson({ fractionalDigits: 'auto' })
    );
  // A `Nothing` result is not echoed in the human-facing mode: a program
  // whose last statement is a `print(…)` (or a declaration, or a loop)
  // produces Nothing, and printing the word after the program's own output
  // is noise (the Python REPL treats None the same way). The machine modes
  // above keep the value — their consumers asked for the value itself.
  if (isSymbol(result.value, 'Nothing')) return '';
  return result.value.toString();
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
    message: diagnosticMessage(diagnostic),
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
    diagnosticMessage(diagnostic),
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

function diagnosticMessage(diagnostic: ParsingDiagnostic): string {
  const parts = Array.isArray(diagnostic.message)
    ? diagnostic.message
    : [diagnostic.message];
  const [code, ...args] = parts;

  switch (code) {
    case 'unknown-function':
      return `Unknown function "${args[0]}"; did you mean "${args[1]}"?`;
    case 'print-not-available':
      return `There is no "${args[0]}" function; did you mean "print"?`;
    case 'type-not-callable':
      return `"${args[0]}" is a type, not a function: types have no constructor; annotate instead, e.g. "const p: ${args[0]} = …"`;
    case 'type-declaration-not-top-level':
      return `The type "${args[0]}" is declared inside a block: types are global, so type declarations are only allowed at the top level of a program`;
    case 'type-redefinition':
      return `The type "${args[0]}" is declared twice in this program; a name may only be declared once per program (re-running an edited declaration in a later program still replaces it)`;
    case 'object-type-not-inline':
      return `An "object{…}" type may only be the definition of a named type: object types are nominal, so declare one with "type Person = object{…}" (not "type alias"), then use "Person" here`;
    case 'protocol-redefinition':
      return `The protocol "${args[0]}" is declared twice in this program; a name may only be declared once per program (re-running an edited declaration in a later program still replaces it)`;
    case 'function-redefinition':
      return `Two clauses of "${args[0]}" in this program have the same parameter list, so the second would silently replace the first; give them different parameter lists to dispatch between them (re-running an edited definition in a later program still replaces it)`;
    case 'protocol-declaration-not-top-level':
      return `The protocol "${args[0]}" is declared inside a block: protocols are global, so protocol declarations are only allowed at the top level of a program`;
    case 'protocol-name-expected':
      return `Expected a protocol name after "protocol"`;
    case 'protocol-member-keyword-missing':
      return `The protocol member "${args[0]}" needs a keyword; did you mean "readonly ${args[0]}" or "readwrite ${args[0]}"?`;
    case 'protocol-member-signature-expected':
      return `Expected a member of the "${args[0]}" protocol: "function name(self: Self, …) -> type", "readonly name: type" or "readwrite name: type"`;
    case 'protocol-implementation-pending':
      return args[2]
        ? `The conformance "type ${args[0]} is ${args[1]}" is not satisfied: ${args[2]}`
        : `The conformance "type ${args[0]} is ${args[1]}" has no implementation yet; provide one with "type ${args[0]} is ${args[1]} { … }"`;
    case 'protocol-property-not-callable':
      return `"${args[0]}" is a property of the "${args[1]}" protocol, not a function: read it with a dot, e.g. "x.${args[0]}" (only "function" members are called)`;
    case 'protocol-in-type-position':
      return `"${args[0]}" is a protocol, not a type. Use a constrained variable: "where T is ${args[0]}"`;
    case 'type-variables-unsupported':
      return `Generic type aliases are not supported yet: "type ${args[0]}<…>" is reserved syntax`;
    case 'empty-type-parameter-clause':
      return `"function ${args[0]}<>" declares no type variable; write "function ${args[0]}<T>(…)" or drop the "<>"`;
    case 'duplicate-type-parameter':
      return `The type variable "${args[0]}" is declared more than once`;
    case 'duplicate-type-parameter-clause':
      return `"${args[0]}" declares its type variables twice: "function ${args[0]}<T>(…)" and "… where T" are the same binding site, so use one or the other`;
    case 'generic-clause-unsupported':
      return `"${args[0]}" is generic; generic functions are single-clause — they cannot use literal parameters or be extended with more clauses`;
    case 'control-outside-loop':
      return `"${args[0]}" is only valid inside a "while" or "for" body; the loop context resets at every function and lambda boundary`;
    case 'assign-in-condition':
      return `":=" in a condition assigns, and the assigned value becomes the test; use "==" to compare, or assign on its own line first`;
    case 'chained-assignment':
      return `"=" only assigns as a whole statement — the second "=" here compares, so this assigns a boolean; write "a := b := 5" to chain the assignment, or parenthesize if the comparison was meant`;
    case 'parameter-shadows-constant':
      return `The parameter "${args[0]}" shadows the constant of the same name: inside the body, "${args[0]}" is the argument, not the constant. Rename the parameter, or use the constant's value directly`;
    case 'zero-index':
      return `Indexing is 1-based: xs[1] is the first element (index 0 yields NaN)`;
    case 'pattern-binding-expected':
      return `A destructuring pattern binds names by position: each element must be a name, "_" to skip the position, or a nested "(…)" pattern. To match against a value, use a "match" expression`;
    case 'pattern-element-annotation':
      return `A destructuring pattern position binds a name and states no type; drop the annotation (write "((p, q)) => …") or take the tuple as one named parameter and unpack it in the body`;
    case 'range-pattern-bounds':
      return `Range pattern bounds must be numeric literals; use a guard (e.g. "n if n >= lo && n <= hi => …") to test against a computed bound`;
    case 'range-pattern-step':
      return `A stepped range is not a pattern; write "lo..hi" (two numeric bounds), or use a guard`;
    case 'range-pattern-empty':
      return `Range pattern "${args[0]}..${args[1]}" is empty (the lower bound is greater than the upper bound); this case can never match`;
    case 'floor-division-comment':
      return `"//" starts a comment, not floor division; use Floor(a / b) for the integer quotient`;
    case 'runtime-error':
      // `%1` (the breadcrumb frame chain, engine design §2a) is deliberately
      // not rendered: the caret already points at the innermost source-mapped
      // frame. It stays in the diagnostic data for machine consumers.
      return `Runtime error: ${args[0]}`;
    case 'static-type-error': {
      // The canonicalization walk collects more than type errors (`missing`,
      // `unexpected-argument`, …), so the label follows the error code
      // (`args[2]`) instead of claiming "Type error" for all of them. The
      // diagnostic *code* stays `static-type-error` for consumer stability.
      const label =
        args[2] === 'incompatible-type' ? 'Type error' : 'Static error';
      return args[1]
        ? `${label}: ${args[0]} in \`${args[1]}\``
        : `${label}: ${args[0]}`;
    }
    case 'evaluation-canceled':
      return `Evaluation canceled (${args[0]}): ${args[1]}`;
    case 'host-pragma-disabled':
      return `Host pragma "${args[0]}" is disabled`;
    case 'closing-bracket-expected':
      return `Expected closing bracket "${args[0]}"`;
    case 'string-literal-closing-delimiter-expected':
      return `Expected closing string delimiter ${JSON.stringify(args[0])}`;
    case 'match-case-separator':
      return `Match cases are separated by a newline or ";", not a comma`;
    case 'if-let-equal-expected':
      return `Expected "=" after the "if let" pattern, followed by the value to match`;
    case 'if-let-irrefutable':
      return `The pattern "${args[0]}" matches every value, so this "if let" cannot fail (an "else" branch would never run); use "let" to bind unconditionally`;
    case 'while-let-equal-expected':
      return `Expected "=" after the "while let" pattern, followed by the value to match`;
    case 'while-let-irrefutable':
      return `The pattern "${args[0]}" matches every value, so this "while let" can only end on a "break" in its body; write "while true" with a "let" in the body instead`;
    case 'conditional-if-line-start':
      return `An "if" at the start of a line begins a new if-statement; for a conditional expression ("a if c else b"), keep "if" on the same line as the value before it`;
    case 'mapsto-arrow-expected':
      return `"->" pairs a key with a value (and the key must be a string); to write a function, use the mapsto arrow "=>"`;
    case 'mapsto-arrow-legacy':
      return `"|->" is the old spelling of the mapsto arrow; write "=>"`;
    case 'parameter-name-mismatch':
      return `The parameter is named "${args[0]}" in the lambda but "${args[1]}" in the type annotation; a parameter name binds wherever it is written, so the two must agree — rename one side, or leave the annotation's parameters unnamed`;
    case 'unexpected-symbol':
      return `Unexpected symbol "${args[0]}"`;
    default: {
      const description = String(code).replaceAll('-', ' ');
      return args.length === 0
        ? description
        : `${description}: ${args.map(String).join(', ')}`;
    }
  }
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
