import { MathJsonExpression } from '../math-json/types.js';
import { Origin } from '../common/debug.js';

import { ParsingDiagnostic } from './diagnostics.js';
import { Parser } from './parser.js';

/**
 * `7 // 2` is `7` followed by a line comment — the Python floor-division
 * reflex, which silently truncates the statement. Warn when code precedes
 * `//` on the same line and the comment text is pure arithmetic (digits,
 * operators, and parentheses only, with at least one digit). Prose comments
 * (`// the 2nd item`) and expected-output annotations (`// ➔ 21`) contain
 * other characters and never match.
 */
function lintFloorDivisionComments(
  source: string,
  diagnostics: ParsingDiagnostic[]
): void {
  const suspicious =
    /^(.*?[^\s/])[ \t]*\/\/(?!\/)[ \t]*[\d+\-*/(). \t]*\d[\d+\-*/(). \t]*$/;
  let offset = 0;
  for (const line of source.split('\n')) {
    const m = suspicious.exec(line);
    if (m !== null) {
      const commentStart = line.indexOf('//', m[1].length);
      diagnostics.push({
        severity: 'warning',
        message: ['floor-division-comment'],
        range: [offset + commentStart, offset + line.length],
      });
    }
    offset += line.length + 1;
  }
}

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
 * Parse an Epsil source string into a MathJSON expression and a list of
 * diagnostics.
 *
 * The parser never throws (it accumulates diagnostics and recovers) with a
 * single exception: a `#error` pragma throws a `FatalParsingError`. It is
 * propagated to the caller (`executeEpsil` catches it and turns it into a
 * diagnostic, so a notebook cell never throws to the host — plan §5).
 *
 * `options.allowHostPragmas` (default `false`) gates the host-state pragmas
 * `#env`/`#navigator`: when off they emit a `host-pragma-disabled` diagnostic
 * instead of reading the host environment.
 *
 * `options.typeNames` seeds the type names an annotation may refer to (the
 * host's already-declared types — `executeEpsil` passes the engine's). A
 * `type` statement in the program extends the set. A name in neither is still a
 * parse-time `type-annotation-error`, so typos are caught early.
 *
 * `options.protocolNames` seeds the PROTOCOL names the engine knows. They are
 * deliberately NOT type names (ruling P8): the set is consulted only on the
 * unknown-type path, where a name it holds is reported as
 * `protocol-in-type-position` — with the constrained-variable spelling that was
 * meant — instead of a generic `Unknown type`.
 *
 * `options.sumVariants` maps each already-declared sum VARIANT name to the sum
 * that declared it. It is what keeps the sum-sugar trigger stable across
 * re-runs: `type X = red | green` is the sugar the first time (no arm names a
 * type), and the second time only because `red` and `green` are recognized as
 * X's own variants rather than as two unrelated known types.
 */
export function parseEpsil(
  source: string,
  url?: string,
  options?: {
    parseLatex?: (latex: string) => MathJsonExpression;
    allowHostPragmas?: boolean;
    typeNames?: readonly string[];
    protocolNames?: readonly string[];
    sumVariants?: Readonly<Record<string, string>>;
  }
): [MathJsonExpression, ParsingDiagnostic[]] {
  const parser = new Parser(source, {
    url,
    parseLatex: options?.parseLatex,
    allowHostPragmas: options?.allowHostPragmas,
    typeNames: options?.typeNames,
    protocolNames: options?.protocolNames,
    sumVariants: options?.sumVariants,
  });

  const value: MathJsonExpression | null = parser.parseProgram();

  lintFloorDivisionComments(source, parser.diagnostics);

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
