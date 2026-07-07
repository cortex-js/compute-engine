import { MathJsonExpression } from '../math-json/types';
import { Origin } from '../common/debug';

import { FatalParsingError, ParsingDiagnostic } from './diagnostics';
import { Parser } from './parser';

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
 * single exception: a `#error` pragma throws a `FatalParsingError`, caught
 * here.
 */
export function parseCortex(
  source: string,
  url?: string
): [MathJsonExpression, ParsingDiagnostic[]] {
  const parser = new Parser(source, { url });

  let value: MathJsonExpression | null;
  try {
    value = parser.parseProgram();
  } catch (e) {
    if (e instanceof FatalParsingError) return ['Nothing', []];
    throw e;
  }

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
