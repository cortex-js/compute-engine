import type { MathJsonExpression } from '../math-json/types.js';

import { ComputeEngine, parseEpsil } from '../epsil.js';
import type { ParsingDiagnostic } from '../epsil/diagnostics.js';
import {
  staticDiagnostics,
  type EffectSummary,
} from '../epsil/static-diagnostics.js';

import { CliUsageError, parseCheckArguments } from './arguments.js';
import {
  diagnosticToJson,
  formatDiagnostics,
  sourceLocation,
} from './format.js';
import { readSource, type CliIo } from './io.js';

/**
 * Parse a program without evaluating it, the way `epsil check` does: a
 * LaTeX parser is injected so `$…$` islands check the same way they
 * evaluate, and a `#error` directive (which throws a FatalParsingError)
 * is reported as a diagnostic rather than crashing the caller.
 *
 * `engine` is the engine backing the LaTeX injection; callers that also need
 * one for a later phase (`checkSource()` canonicalizes with it) pass theirs in
 * so a single engine serves the whole check.
 */
export function parseSource(
  source: string,
  url?: string,
  engine: ComputeEngine = new ComputeEngine()
): { ast: MathJsonExpression | null; diagnostics: ParsingDiagnostic[] } {
  const parseLatex = (latex: string) => engine.parse(latex).json;

  try {
    const [ast, diagnostics] = parseEpsil(source, url, { parseLatex });
    return { ast, diagnostics };
  } catch (error) {
    return {
      ast: null,
      diagnostics: [
        {
          severity: 'error',
          message: [
            'error-directive',
            error instanceof Error ? error.message : String(error),
          ],
          range: [0, 0],
        },
      ],
    };
  }
}

/**
 * Parse a program and report both its parse diagnostics and the type errors
 * the engine detects when the program is *canonicalized* — the check phase
 * shared by `epsil check` and the MCP `check` tool.
 *
 * The canonicalization pass is skipped when parsing produced errors: the AST
 * of an unparseable program is a guess, and its canonical form would spray
 * follow-on noise.
 *
 * One engine serves both phases (the `$…$` LaTeX injection of the parse and
 * the canonicalization pass) — it is created here and discarded, so a check is
 * still stateless: every call starts from a clean session. The MCP `check`
 * tool runs this per request, where the second engine construction was pure
 * overhead.
 */
export function checkSource(
  source: string,
  url?: string,
  options?: { effects?: boolean }
): {
  ast: MathJsonExpression | null;
  diagnostics: ParsingDiagnostic[];
  /**
   * With `options.effects`, the effects the engine inferred for each
   * top-level function the program defines (see {@link EffectSummary}), or
   * `null` when the parse failed: the canonicalization pass that reads them
   * is skipped then, so nothing was analyzed. Absent when not requested.
   */
  effects?: EffectSummary[] | null;
} {
  const engine = new ComputeEngine();
  const { ast, diagnostics } = parseSource(source, url, engine);
  if (ast === null || diagnostics.some((x) => x.severity === 'error'))
    return { ast, diagnostics, ...(options?.effects ? { effects: null } : {}) };
  const effects: EffectSummary[] | undefined = options?.effects
    ? []
    : undefined;
  return {
    ast,
    diagnostics: [
      ...diagnostics,
      ...staticDiagnostics(engine, ast, source, [], { effects }),
    ],
    ...(effects === undefined ? {} : { effects }),
  };
}

/** One effect summary as `epsil check --effects` prints it: the name, its
 * line, and the labels — `pure` for none — with `(declared)` when the author
 * wrote the contract. */
export function formatEffectSummary(
  entry: EffectSummary,
  source: string
): string {
  const line = sourceLocation(source, entry.range[0]).line;
  const labels =
    entry.effects === undefined
      ? 'not inferred'
      : entry.effects === 'any'
        ? 'any'
        : entry.effects.length === 0
          ? 'pure'
          : entry.effects.join(', ');
  return `${entry.name} (line ${line}): ${labels}${entry.declared ? ' (declared)' : ''}`;
}

/** The JSON form of one effect summary, alongside the diagnostics in
 * `epsil check --effects --json` and the MCP `check` tool. */
export function effectSummaryToJson(
  entry: EffectSummary,
  source: string
): {
  name: string;
  /** The labels; `"any"` for an arrow that admits every effect; `null` when
   * the engine could not infer them. */
  effects: string[] | 'any' | null;
  declared: boolean;
  start: number;
  end: number;
  line: number;
  column: number;
} {
  const { line, column } = sourceLocation(source, entry.range[0]);
  return {
    name: entry.name,
    effects:
      entry.effects === undefined
        ? null
        : entry.effects === 'any'
          ? 'any'
          : [...entry.effects],
    declared: entry.declared,
    start: entry.range[0],
    end: entry.range[1],
    line,
    column,
  };
}

/**
 * `epsil check` — parse and canonicalize a program, reporting diagnostics
 * without evaluating anything. This is the fast validation loop: syntax,
 * string and type-annotation errors, `match` shape problems, and the type
 * errors the engine catches at canonicalization time (`"a" + 1`). It does not
 * catch genuinely dynamic problems (an out-of-range index, a `match` with no
 * matching case), which surface when the program runs.
 */
export async function runCheck(
  args: readonly string[],
  io: CliIo
): Promise<number> {
  let options;
  try {
    options = parseCheckArguments(args, io.env);
  } catch (error) {
    const message =
      error instanceof CliUsageError && error.message
        ? `${error.message}\n`
        : '';
    io.stderr.write(`${message}Try "epsil --help" for more information.\n`);
    return 2;
  }

  let source: string;
  let url: string | undefined;
  try {
    ({ source, url } = await readSource(options.eval, options.file, io));
  } catch (error) {
    io.stderr.write(
      `epsil: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  const { diagnostics, effects } = checkSource(source, url, {
    effects: options.effects,
  });
  const ok = !diagnostics.some((x) => x.severity === 'error');

  if (options.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ok,
          diagnostics: diagnostics.map((x) => diagnosticToJson(x, source)),
          // `null` says the analysis did not run (the parse failed); an
          // empty array says it ran and found no function definitions.
          ...(effects === undefined
            ? {}
            : {
                effects:
                  effects === null
                    ? null
                    : effects.map((x) => effectSummaryToJson(x, source)),
              }),
        },
        null,
        2
      )}\n`
    );
  } else {
    const formatted = formatDiagnostics(
      diagnostics,
      source,
      options.file,
      options.color && Boolean(io.stderr.isTTY)
    );
    if (formatted) io.stderr.write(`${formatted}\n`);
    // The report is the command's OUTPUT, so it goes to standard output;
    // diagnostics stay on standard error, as without the option. After a
    // parse failure there is no report: the diagnostic on standard error
    // already says why.
    if (effects !== undefined && effects !== null)
      io.stdout.write(
        effects.length === 0
          ? 'No top-level function definitions.\n'
          : `${effects.map((x) => formatEffectSummary(x, source)).join('\n')}\n`
      );
  }

  return ok ? 0 : 1;
}
