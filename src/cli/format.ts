import { serializeCortex } from '../cortex.js';
import type { ParsingDiagnostic } from '../cortex/diagnostics.js';

import type { EvaluationResult, OutputMode } from './types.js';

const ANSI = {
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
};

export function formatValue(
  result: EvaluationResult,
  mode: OutputMode
): string {
  if (result.source.trim() === '') return '';

  if (mode === 'json')
    return JSON.stringify(
      result.value.toMathJson({ fractionalDigits: 'auto' }),
      null,
      2
    );
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
