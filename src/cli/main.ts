import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { version } from '../cortex.js';

import { CliUsageError, parseCliArguments } from './arguments.js';
import { formatDiagnostics, formatValue, hasErrors } from './format.js';
import { runRepl } from './repl.js';
import { makeCortexSession } from './session.js';

export interface CliIo {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  env: NodeJS.ProcessEnv;
}

const HELP = `Usage: cortex [options] [file]

Evaluate Cortex programs or start an interactive session.

Arguments:
  file                    Cortex source file (.cortex or .cx)

Options:
  -e, --eval <source>     evaluate source text
      --json              print the result as MathJSON
      --cortex            print the result as Cortex source
      --time-limit <ms>   evaluation deadline; 0 disables it (default: 10000)
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
    const diagnostics = formatDiagnostics(
      result.diagnostics,
      source,
      options.file,
      options.color && Boolean(io.stderr.isTTY)
    );
    if (diagnostics) io.stderr.write(`${diagnostics}\n`);

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

async function readSource(
  inline: string | undefined,
  file: string | undefined,
  io: CliIo
): Promise<{ source: string; url?: string }> {
  if (inline !== undefined) return { source: inline };
  if (file !== undefined && file !== '-') {
    return {
      source: await readFile(file, 'utf8'),
      url: pathToFileURL(file).href,
    };
  }

  let source = '';
  io.stdin.setEncoding('utf8');
  for await (const chunk of io.stdin) source += chunk;
  return { source };
}
