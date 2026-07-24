import { version } from '../cortex.js';

import { CliUsageError, parseCliArguments } from './arguments.js';
import { runCheck } from './check.js';
import { runDoc } from './doc.js';
import {
  diagnosticToJson,
  formatDiagnostics,
  formatValue,
  hasErrors,
} from './format.js';
import { readSource, type CliIo } from './io.js';
import { runMcp } from './mcp.js';
import { runRepl } from './repl.js';
import { makeCortexSession } from './session.js';

export type { CliIo } from './io.js';

const HELP = `Usage: cortex [options] [file]
       cortex check [options] [file]
       cortex doc [options] <name or keywords>
       cortex mcp [options]

Evaluate Cortex programs or start an interactive session.

Commands:
  check                   parse a program and report diagnostics without
                          evaluating it; "--json" prints them as JSON
  doc                     show documentation for a library symbol, or search
                          the library by keyword; "--json" for JSON,
                          "--limit <n>" for more matches
  mcp                     start a Model Context Protocol server, exposing
                          evaluate/check/doc/parse/serialize tools and the
                          language card resource; stdio is the default

Arguments:
  file                    Cortex source file (.cortex or .cx)

Options:
  -e, --eval <source>     evaluate source text
      --json              print the result as MathJSON
      --cortex            print the result as Cortex source
      --diagnostics <fmt> print diagnostics as "text" (default) or "json"
      --time-limit <ms>   evaluation deadline; 0 disables it (default: 10000)
      --transport <type>  MCP transport: "stdio" (default) or
                          "streamable-http"
      --host <address>    MCP HTTP bind address (default: 127.0.0.1)
      --port <number>     MCP HTTP port (default: 8000)
      --path <path>       MCP HTTP endpoint path (default: /mcp)
      --allow-origin <o>  allow a browser origin to call the MCP HTTP endpoint;
                          may be repeated
      --no-color          disable colored diagnostics
  -h, --help              display this help
  -v, --version           display the package version

With no file or --eval, cortex starts a REPL when stdin is a terminal and
otherwise reads a program from stdin.
`;

export async function main(
  args: readonly string[],
  io: CliIo = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  }
): Promise<number> {
  if (args[0] === 'check') return runCheck(args.slice(1), io);
  if (args[0] === 'doc') return runDoc(args.slice(1), io);
  if (args[0] === 'mcp') return runMcp(args.slice(1), io);

  let options;
  try {
    options = parseCliArguments(args, io.env);
  } catch (error) {
    const message =
      error instanceof CliUsageError && error.message
        ? `${error.message}\n`
        : '';
    io.stderr.write(`${message}Try "cortex --help" for more information.\n`);
    return 2;
  }

  if (options.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (options.version) {
    io.stdout.write(`${version}\n`);
    return 0;
  }

  const session = makeCortexSession(options.timeLimit);
  if (
    options.eval === undefined &&
    options.file === undefined &&
    io.stdin.isTTY
  )
    return runRepl(session, {
      color: options.color && Boolean(io.stdout.isTTY),
      outputMode: options.outputMode,
      input: io.stdin,
      output: io.stdout,
    });

  try {
    const { source, url } = await readSource(options.eval, options.file, io);
    const result = session.evaluate(source, url);
    if (options.diagnosticsFormat === 'json') {
      if (result.diagnostics.length > 0)
        io.stderr.write(
          `${JSON.stringify(
            result.diagnostics.map((x) => diagnosticToJson(x, source))
          )}\n`
        );
    } else {
      const diagnostics = formatDiagnostics(
        result.diagnostics,
        source,
        options.file,
        options.color && Boolean(io.stderr.isTTY)
      );
      if (diagnostics) io.stderr.write(`${diagnostics}\n`);
    }

    if (!result.diagnostics.some((x) => x.severity === 'error')) {
      const value = formatValue(result, options.outputMode);
      if (value) io.stdout.write(`${value}\n`);
    }
    return hasErrors(result) ? 1 : 0;
  } catch (error) {
    io.stderr.write(
      `cortex: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}
