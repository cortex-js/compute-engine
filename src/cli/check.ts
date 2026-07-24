import { ComputeEngine, parseCortex } from '../cortex.js';
import type { ParsingDiagnostic } from '../cortex/diagnostics.js';

import { CliUsageError, parseCheckArguments } from './arguments.js';
import { diagnosticToJson, formatDiagnostics } from './format.js';
import { readSource, type CliIo } from './io.js';

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

  // A LaTeX parser is injected so `$…$` islands check the same way they
  // evaluate, rather than producing a spurious `latex-parsing-unavailable`.
  const engine = new ComputeEngine();
  const parseLatex = (latex: string) => engine.parse(latex).json;

  let diagnostics: ParsingDiagnostic[];
  try {
    [, diagnostics] = parseCortex(source, url, { parseLatex });
  } catch (error) {
    // A `#error` directive throws a FatalParsingError; report it as a
    // diagnostic like `executeCortex` does rather than crashing the check.
    diagnostics = [
      {
        severity: 'error',
        message: [
          'error-directive',
          error instanceof Error ? error.message : String(error),
        ],
        range: [0, 0],
      },
    ];
  }

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
