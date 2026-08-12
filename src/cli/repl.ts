import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  Recoverable,
  start as startNodeRepl,
  type REPLServer,
} from 'node:repl';

import { version } from '../epsil.js';
import type { ParsingDiagnostic } from '../epsil/diagnostics.js';

import {
  formatDiagnostics,
  formatRuntimeError,
  formatValue,
} from './format.js';
import type { EpsilSession, EvaluationResult, OutputMode } from './types.js';

export interface ReplOptions {
  color: boolean;
  outputMode: OutputMode;
  historyPath?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

class ReplEvaluation {
  constructor(readonly result: EvaluationResult) {}
}

export function runRepl(
  session: EpsilSession,
  options: ReplOptions
): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let outputMode = options.outputMode;
  let outputModeBeforeAst = options.outputMode;
  let showTime = false;

  output.write(`Epsil ${version}\nType .help for more information.\n\n`);

  const server = startNodeRepl({
    prompt: 'epsil> ',
    input,
    output,
    terminal: Boolean(
      (input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY
    ),
    ignoreUndefined: true,
    eval(source, _context, filename, callback) {
      const diagnostics = session.parse(source, filename);
      if (isRecoverable(source, diagnostics)) {
        callback(
          new Recoverable(new SyntaxError('Incomplete Epsil input')),
          undefined
        );
        return;
      }

      try {
        callback(null, new ReplEvaluation(session.evaluate(source, filename)));
      } catch (error) {
        callback(
          error instanceof Error ? error : new Error(String(error)),
          null
        );
      }
    },
    writer(value): string {
      if (!(value instanceof ReplEvaluation)) return String(value);
      return formatReplResult(
        value.result,
        outputMode,
        options.color,
        showTime
      );
    },
  });

  server.on('reset', () => session.reset());

  server.defineCommand('ast', {
    help: 'toggle MathJSON output',
    action() {
      if (outputMode === 'json') outputMode = outputModeBeforeAst;
      else {
        outputModeBeforeAst = outputMode;
        outputMode = 'json';
      }
      this.output.write(`Output mode: ${outputMode}\n`);
      this.displayPrompt();
    },
  });

  server.defineCommand('time', {
    help: 'toggle execution timing',
    action() {
      showTime = !showTime;
      this.output.write(`Timing: ${showTime ? 'on' : 'off'}\n`);
      this.displayPrompt();
    },
  });

  server.defineCommand('load', {
    help: 'load and execute an Epsil source file',
    action(filename) {
      loadFile(this, session, filename, outputMode, options.color, showTime);
    },
  });

  setupHistory(server, options.historyPath);

  return new Promise((resolveExit) => {
    server.once('exit', () => resolveExit(0));
  });
}

function loadFile(
  server: REPLServer,
  session: EpsilSession,
  filename: string,
  outputMode: OutputMode,
  color: boolean,
  showTime: boolean
): void {
  const path = resolve(filename.trim());
  try {
    const result = session.evaluate(readFileSync(path, 'utf8'), path);
    server.output.write(
      `${formatReplResult(result, outputMode, color, showTime)}\n`
    );
  } catch (error) {
    server.output.write(
      `error: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  server.displayPrompt();
}

function formatReplResult(
  result: EvaluationResult,
  outputMode: OutputMode,
  color: boolean,
  showTime: boolean
): string {
  const diagnostics = formatDiagnostics(
    result.diagnostics,
    result.source,
    undefined,
    color
  );
  const value = result.diagnostics.some((x) => x.severity === 'error')
    ? ''
    : outputMode === 'value'
      ? formatRuntimeError(result, undefined, color) ||
        formatValue(result, outputMode)
      : formatValue(result, outputMode);
  const timing = showTime ? `(${result.elapsedMs.toFixed(1)} ms)` : '';
  return [diagnostics, value, timing].filter(Boolean).join('\n');
}

export function isRecoverable(
  source: string,
  diagnostics: readonly ParsingDiagnostic[]
): boolean {
  const errors = diagnostics.filter((x) => x.severity === 'error');
  if (errors.length === 0) return false;

  const recoverableCodes = new Set([
    'closing-bracket-expected',
    'end-of-comment-expected',
    'multiline-string-expected',
    'multiline-whitespace-expected',
    'string-literal-closing-delimiter-expected',
    'unbalanced-verbatim-symbol',
  ]);

  if (
    errors.every((diagnostic) =>
      recoverableCodes.has(diagnosticCode(diagnostic))
    )
  )
    return true;

  return /(?:\+|-|\*|\/|\^|==|!=|<=|>=|<|>|&&|\|\||=|->|=>)\s*$/.test(source);
}

function diagnosticCode(diagnostic: ParsingDiagnostic): string {
  return Array.isArray(diagnostic.message)
    ? String(diagnostic.message[0])
    : diagnostic.message;
}

function setupHistory(server: REPLServer, configuredPath?: string): void {
  if (configuredPath === '') return;
  const historyPath =
    configuredPath ??
    process.env.EPSIL_REPL_HISTORY ??
    resolve(homedir(), '.epsil_history');

  try {
    const lastSlash = Math.max(
      historyPath.lastIndexOf('/'),
      historyPath.lastIndexOf('\\')
    );
    if (lastSlash > 0)
      mkdirSync(historyPath.slice(0, lastSlash), { recursive: true });
    server.setupHistory(historyPath, () => {});
  } catch {
    // History is a convenience. A read-only home directory should not prevent
    // the interpreter from starting.
  }
}
