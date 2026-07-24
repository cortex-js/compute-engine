import type { MathJsonExpression } from '../math-json/types.js';

import { ComputeEngine, parseCortex } from '../cortex.js';
import type { ParsingDiagnostic } from '../cortex/diagnostics.js';

import { CliUsageError, parseCheckArguments } from './arguments.js';
import { diagnosticToJson, formatDiagnostics } from './format.js';
import { readSource, type CliIo } from './io.js';

/**
 * Parse a program without evaluating it, the way `cortex check` does: a
 * LaTeX parser is injected so `$…$` islands check the same way they
 * evaluate, and a `#error` directive (which throws a FatalParsingError)
 * is reported as a diagnostic rather than crashing the caller.
 */
export function parseSource(
  source: string,
  url?: string
): { ast: MathJsonExpression | null; diagnostics: ParsingDiagnostic[] } {
  const engine = new ComputeEngine();
  const parseLatex = (latex: string) => engine.parse(latex).json;

  try {
    const [ast, diagnostics] = parseCortex(source, url, { parseLatex });
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
 * `cortex check` — parse a program and report diagnostics without
 * evaluating anything. This is the fast validation loop: syntax, string and
 * type-annotation errors, `match` shape problems. It does not catch
 * runtime problems (unknown functions, type mismatches at call sites),
 * which surface when the program runs.
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
    io.stderr.write(`${message}Try "cortex --help" for more information.\n`);
    return 2;
  }

  let source: string;
  let url: string | undefined;
  try {
    ({ source, url } = await readSource(options.eval, options.file, io));
  } catch (error) {
    io.stderr.write(
      `cortex: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }

  const { diagnostics } = parseSource(source, url);
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
