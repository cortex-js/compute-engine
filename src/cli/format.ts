import { serializeCortex } from '../cortex.js';
import type { ParsingDiagnostic } from '../cortex/diagnostics.js';

import type { EvaluationResult, OutputMode } from './types.js';

const ANSI = {
  red: '\u001b[31m',
  yellow: '\u001b[33m',
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
  if (mode === 'cortex')
    return serializeCortex(
      result.value.toMathJson({ fractionalDigits: 'auto' })
    );
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
    .join('\n');
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
}

export function diagnosticToJson(
  diagnostic: ParsingDiagnostic,
  source: string
): JsonDiagnostic {
  const parts = Array.isArray(diagnostic.message)
    ? diagnostic.message
    : [diagnostic.message];
  const [code, ...args] = parts;
  const offset = diagnostic.range[2] ?? diagnostic.range[1];
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
  return result;
}

function formatDiagnostic(
  diagnostic: ParsingDiagnostic,
  source: string,
  url: string | undefined,
  color: boolean
): string {
  const message = diagnosticMessage(diagnostic);
  const offset = diagnostic.range[2] ?? diagnostic.range[1];
  const { line, column, text } = sourceLocation(source, offset);
  const label = diagnostic.severity === 'error' ? 'error' : 'warning';
  const labelColor = diagnostic.severity === 'error' ? ANSI.red : ANSI.yellow;
  const location = `${url ? `${url}:` : ''}${line}:${column}`;
  const prefix = color
    ? `${ANSI.dim}${location}${ANSI.reset} ${labelColor}${label}${ANSI.reset}`
    : `${location} ${label}`;

  if (text === undefined) return `${prefix}: ${message}`;

  const gutter = `${line} | `;
  const caret = `${' '.repeat(gutter.length + Math.max(column - 1, 0))}^`;
  return `${prefix}: ${message}\n${gutter}${text}\n${caret}`;
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
      return `There is no "${args[0]}" function: a program's output is the value of its last statement`;
    case 'assign-in-argument':
      return `"=" in an argument is assignment; use "==" for an equation or comparison`;
    case 'zero-index':
      return `Indexing is 1-based: xs[1] is the first element (index 0 yields NaN)`;
    case 'floor-division-comment':
      return `"//" starts a comment, not floor division; use Floor(a / b) for the integer quotient`;
    case 'runtime-error':
      return `Runtime error: ${args[0]}`;
    case 'evaluation-canceled':
      return `Evaluation canceled (${args[0]}): ${args[1]}`;
    case 'host-pragma-disabled':
      return `Host pragma "${args[0]}" is disabled`;
    case 'closing-bracket-expected':
      return `Expected closing bracket "${args[0]}"`;
    case 'string-literal-closing-delimiter-expected':
      return `Expected closing string delimiter ${JSON.stringify(args[0])}`;
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

function sourceLocation(
  source: string,
  offset: number
): { line: number; column: number; text?: string } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lines = before.split(/\r\n|[\n\r\u2028\u2029]/);
  const allLines = source.split(/\r\n|[\n\r\u2028\u2029]/);
  const line = lines.length;
  return {
    line,
    column: (lines.at(-1)?.length ?? 0) + 1,
    text: allLines[line - 1],
  };
}
