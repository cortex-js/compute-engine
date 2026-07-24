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
const DEFAULT_MCP_HOST = '127.0.0.1';
const DEFAULT_MCP_PORT = 8000;
const DEFAULT_MCP_PATH = '/mcp';

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
        'transport': { type: 'string' },
        'host': { type: 'string' },
        'port': { type: 'string' },
        'path': { type: 'string' },
        'allow-origin': { type: 'string', multiple: true },
      },
    });
  } catch (error) {
    throw new CliUsageError(messageFromError(error));
  }

  const { values } = parsed;
  const timeLimit = values['time-limit'];
  const transport = parseMcpTransport(values.transport);
  const host = parseMcpHost(values.host);
  const port = parseMcpPort(values.port);
  const path = parseMcpPath(values.path);
  const allowedOrigins = parseMcpOrigins(values['allow-origin']);

  if (
    transport === 'stdio' &&
    (values.host !== undefined ||
      values.port !== undefined ||
      values.path !== undefined ||
      values['allow-origin'] !== undefined)
  )
    throw new CliUsageError(
      '--host, --port, --path and --allow-origin require ' +
        '"--transport streamable-http".'
    );

  return {
    timeLimit: parseTimeLimit(
      typeof timeLimit === 'string' ? timeLimit : undefined
    ),
    transport,
    host,
    port,
    path,
    allowedOrigins,
  };
}

function parseMcpTransport(value: unknown): McpOptions['transport'] {
  if (value === undefined || value === 'stdio') return 'stdio';
  if (value === 'streamable-http') return value;
  throw new CliUsageError('--transport must be "stdio" or "streamable-http".');
}

function parseMcpHost(value: unknown): string {
  if (value === undefined) return DEFAULT_MCP_HOST;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    /[/?#\s]/u.test(value)
  )
    throw new CliUsageError('--host must be a hostname or IP address.');
  return value;
}

function parseMcpPort(value: unknown): number {
  if (value === undefined) return DEFAULT_MCP_PORT;
  if (typeof value !== 'string' || !/^\d+$/u.test(value))
    throw new CliUsageError('--port must be an integer from 0 to 65535.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > 65_535)
    throw new CliUsageError('--port must be an integer from 0 to 65535.');
  return result;
}

function parseMcpPath(value: unknown): string {
  if (value === undefined) return DEFAULT_MCP_PATH;
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[?#\s]/u.test(value)
  )
    throw new CliUsageError(
      '--path must be an absolute URL path without a query or fragment.'
    );
  return value;
}

function parseMcpOrigins(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new CliUsageError('--allow-origin must be an HTTP(S) origin.');
  return value.map((origin) => {
    if (typeof origin !== 'string')
      throw new CliUsageError('--allow-origin must be an HTTP(S) origin.');
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new CliUsageError(
        `Invalid --allow-origin value: ${JSON.stringify(origin)}.`
      );
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== origin
    )
      throw new CliUsageError(
        `Invalid --allow-origin value: ${JSON.stringify(origin)}.`
      );
    return origin;
  });
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
