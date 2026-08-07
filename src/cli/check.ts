import type { MathJsonExpression } from '../math-json/types.js';

import { ComputeEngine, parseEpsil } from '../epsil.js';
import type { ParsingDiagnostic } from '../epsil/diagnostics.js';
import { staticDiagnostics } from '../epsil/static-diagnostics.js';

import { CliUsageError, parseCheckArguments } from './arguments.js';
import { diagnosticToJson, formatDiagnostics } from './format.js';
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
  url?: string
): { ast: MathJsonExpression | null; diagnostics: ParsingDiagnostic[] } {
  const engine = new ComputeEngine();
  const { ast, diagnostics } = parseSource(source, url, engine);
  if (ast === null || diagnostics.some((x) => x.severity === 'error'))
    return { ast, diagnostics };
  return {
    ast,
    diagnostics: [...diagnostics, ...staticDiagnostics(engine, ast, source)],
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

  const { diagnostics } = checkSource(source, url);
  const ok = !diagnostics.some((x) => x.severity === 'error');

  if (options.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ok,
          diagnostics: diagnostics.map((x) => diagnosticToJson(x, source)),
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
  }

  return ok ? 0 : 1;
}
