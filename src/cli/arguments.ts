import { parseArgs } from 'node:util';

import type { CliOptions, OutputMode } from './types.js';

export class CliUsageError extends Error {}

const DEFAULT_TIME_LIMIT = 10_000;

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
    color: values['no-color'] !== true && env.NO_COLOR === undefined,
    timeLimit: parseTimeLimit(timeLimit),
  };
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
