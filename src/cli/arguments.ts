import { parseArgs } from 'node:util';

import type {
  CheckOptions,
  CliOptions,
  DiagnosticsFormat,
  DocOptions,
  McpOptions,
  OutputMode,
} from './types.js';

export class CliUsageError extends Error {}

const DEFAULT_TIME_LIMIT = 10_000;
const DEFAULT_DOC_LIMIT = 10;

export function parseCliArguments(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): CliOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        'eval': { type: 'string', short: 'e' },
        'help': { type: 'boolean', short: 'h' },
        'version': { type: 'boolean', short: 'v' },
        'json': { type: 'boolean' },
        'cortex': { type: 'boolean' },
        'diagnostics': { type: 'string' },
        'no-color': { type: 'boolean' },
        'time-limit': { type: 'string' },
      },
    });
  } catch (error) {
    throw new CliUsageError(messageFromError(error));
  }

  const { values, positionals } = parsed;
  const evalSource = typeof values.eval === 'string' ? values.eval : undefined;
  const timeLimit =
    typeof values['time-limit'] === 'string' ? values['time-limit'] : undefined;
  if (positionals.length > 1)
    throw new CliUsageError('Expected at most one Cortex source file.');
  if (evalSource !== undefined && positionals.length > 0)
    throw new CliUsageError('The --eval option cannot be used with a file.');
  if (values.json === true && values.cortex === true)
    throw new CliUsageError(
      'The --json and --cortex output options are mutually exclusive.'
    );

  const outputMode: OutputMode =
    values.json === true ? 'json' : values.cortex === true ? 'cortex' : 'value';

  return {
    eval: evalSource,
    file: positionals[0],
    help: values.help === true,
    version: values.version === true,
    outputMode,
    diagnosticsFormat: parseDiagnosticsFormat(values.diagnostics),
    color: values['no-color'] !== true && env.NO_COLOR === undefined,
    timeLimit: parseTimeLimit(timeLimit),
  };
}

export function parseCheckArguments(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): CheckOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        'eval': { type: 'string', short: 'e' },
        'json': { type: 'boolean' },
        'no-color': { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new CliUsageError(messageFromError(error));
  }

  const { values, positionals } = parsed;
  const evalSource = typeof values.eval === 'string' ? values.eval : undefined;
  if (positionals.length > 1)
    throw new CliUsageError('Expected at most one Cortex source file.');
  if (evalSource !== undefined && positionals.length > 0)
    throw new CliUsageError('The --eval option cannot be used with a file.');

  return {
    eval: evalSource,
    file: positionals[0],
    json: values.json === true,
    color: values['no-color'] !== true && env.NO_COLOR === undefined,
  };
}

export function parseDocArguments(args: readonly string[]): DocOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        limit: { type: 'string' },
      },
    });
  } catch (error) {
    throw new CliUsageError(messageFromError(error));
  }

  const { values, positionals } = parsed;
  const query = positionals.join(' ').trim();
  if (query.length === 0)
    throw new CliUsageError(
      'Expected a symbol name or search keywords, e.g. "cortex doc Sin".'
    );

  return {
    query,
    json: values.json === true,
    limit: parseDocLimit(
      typeof values.limit === 'string' ? values.limit : undefined
    ),
  };
}

export function parseMcpArguments(args: readonly string[]): McpOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: false,
      strict: true,
      options: {
        'time-limit': { type: 'string' },
      },
    });
  } catch (error) {
    throw new CliUsageError(messageFromError(error));
  }

  const timeLimit = parsed.values['time-limit'];
  return {
    timeLimit: parseTimeLimit(
      typeof timeLimit === 'string' ? timeLimit : undefined
    ),
  };
}

function parseDiagnosticsFormat(value: unknown): DiagnosticsFormat {
  if (value === undefined) return 'text';
  if (value === 'text' || value === 'json') return value;
  throw new CliUsageError('--diagnostics must be "text" or "json".');
}

function parseDocLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_DOC_LIMIT;
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw new CliUsageError('--limit must be a positive integer.');
  return Math.min(Number(value), 100);
}

function parseTimeLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TIME_LIMIT;
  if (!/^\d+$/.test(value))
    throw new CliUsageError('--time-limit must be a non-negative integer.');

  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new CliUsageError('--time-limit is too large.');
  return result;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
