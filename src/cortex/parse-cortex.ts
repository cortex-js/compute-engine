import { MathJsonExpression } from '../math-json/types.js';
import { Origin } from '../common/debug.js';

import { ParsingDiagnostic } from './diagnostics.js';
import { Parser } from './parser.js';

/** Analyze the reported errors and combine them when possible */
export function analyzeErrors(
  errors: ParsingDiagnostic[]
): ParsingDiagnostic[] {
  const result: ParsingDiagnostic[] = [...errors];
  // @todo: could combine a 'string-literal-closing-delimiter-expected'
  // followed by a 'string-literal-opening-delimiter-expected'
  return result;
}

/**
 * Parse a Cortex source string into a MathJSON expression and a list of
 * diagnostics.
 *
 * The parser never throws (it accumulates diagnostics and recovers) with a
 * single exception: a `#error` pragma throws a `FatalParsingError`. It is
 * propagated to the caller (`executeCortex` catches it and turns it into a
 * diagnostic, so a notebook cell never throws to the host — plan §5).
 *
 * `options.allowHostPragmas` (default `false`) gates the host-state pragmas
 * `#env`/`#navigator`: when off they emit a `host-pragma-disabled` diagnostic
 * instead of reading the host environment.
 */
export function parseCortex(
  source: string,
  url?: string,
  options?: {
    parseLatex?: (latex: string) => MathJsonExpression;
    allowHostPragmas?: boolean;
  }
): [MathJsonExpression, ParsingDiagnostic[]] {
  const parser = new Parser(source, {
    url,
    parseLatex: options?.parseLatex,
    allowHostPragmas: options?.allowHostPragmas,
  });

  const value: MathJsonExpression | null = parser.parseProgram();

  const diagnostics = analyzeErrors(parser.diagnostics);
  if (diagnostics.length === 0) return [value ?? 'Nothing', []];

  // Convert the offset-based ranges to line/column origins (as before).
  const origin = new Origin(source, url);
  return [
    value ?? 'Nothing',
    diagnostics.map((x) => ({
      ...x,
      origin: origin.signalOrigin(x.range[2] ?? x.range[1]),
    })),
  ];
}
