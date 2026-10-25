import type { EventEmitter } from 'node:events';
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
import type {
  EpsilSession,
  EvaluationResult,
  InputFormat,
  OutputMode,
} from './types.js';

export interface ReplOptions {
  color: boolean;
  outputMode: OutputMode;
  /** With `'latex'`, each entry is a LaTeX expression (`.load` still reads
   * an Epsil file). */
  inputFormat?: InputFormat;
  /** See `CliOptions.fancySymbols`. Applies whenever the output mode is
   * `epsil`, including after `.ast` has toggled JSON output on and off. */
  fancySymbols?: boolean;
  historyPath?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** The source of the `'SIGINT'` event that stops the entry that runs, when
   * the session has a kernel pool (default: `process`). */
  interrupts?: Pick<EventEmitter, 'on' | 'off'>;
}

class ReplEvaluation {
  constructor(readonly result: EvaluationResult) {}
}

/** The result of an entry or a `.load` that Ctrl-C stopped. */
const INTERRUPTED = Symbol('interrupted');

const INTERRUPTED_MESSAGE = 'error: the entry was interrupted (Ctrl-C)';

/** Run an asynchronous evaluation with an abort signal that Ctrl-C
 * triggers. The result is `INTERRUPTED` when the signal stopped it. */
type Interruptible = <T>(
  run: (signal: AbortSignal) => Promise<T>
) => Promise<T | typeof INTERRUPTED>;

export function runRepl(
  session: EpsilSession,
  options: ReplOptions
): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let outputMode = options.outputMode;
  let outputModeBeforeAst = options.outputMode;
  let showTime = false;
  // With a kernel pool, an entry runs asynchronously (`evaluateAsync`). The
  // entries still run one after the other, in the order they were typed: a
  // program must not start on the engine while another one waits.
  let previous: Promise<unknown> = Promise.resolve();
  const evaluateInOrder = <T>(run: () => Promise<T>): Promise<T> => {
    const result = previous.then(run);
    previous = result.catch(() => undefined);
    return result;
  };

  const terminal = Boolean(
    (input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY
  );

  // With a kernel pool, Ctrl-C stops the entry (or the `.load`) that runs:
  // the evaluation rejects, the REPL writes a message and shows the prompt.
  // The declarations of the session stay. The entries that wait in the queue
  // run after it, each in its turn. Without an entry that runs, Ctrl-C does
  // what it does in the Node REPL.
  //
  // In a terminal, the REPL reads the input in raw mode, where Ctrl-C is a
  // character of the input and not a signal. While an entry runs, the input
  // is paused, so that character would not be read. Thus raw mode is off
  // while the entry runs: the terminal then sends SIGINT to the process for
  // Ctrl-C. The Node REPL does the same while it evaluates JavaScript with
  // `breakEvalOnSigint`. The listener is added before raw mode goes off, so
  // that a SIGINT never finds the process with no listener (which would end
  // the process).
  //
  // An entry can fail to stop after the abort, for example during long
  // synchronous work, which also keeps a listener from running. So the first
  // Ctrl-C aborts the entry and removes the listener: a second Ctrl-C while
  // the same entry runs gets the default action of the operating system,
  // which ends the process at once (a shell reports the exit code 130).
  //
  // When the REPL closes (`.exit`, or the end of the input), the entry that
  // runs is aborted, the entries that wait in the queue do not run, and raw
  // mode is not turned on again, because the REPL no longer reads the input.
  const interrupts = options.interrupts ?? process;
  let closed = false;
  let active: AbortController | undefined;
  const interruptible: Interruptible = async (run) => {
    if (closed) return INTERRUPTED;
    const controller = new AbortController();
    active = controller;
    const onInterrupt = () => {
      interrupts.off('SIGINT', onInterrupt);
      controller.abort(new Error('Interrupted'));
    };
    interrupts.on('SIGINT', onInterrupt);
    const tty = input as NodeJS.ReadStream;
    let rawModeChanged = false;
    try {
      if (terminal && tty.isRaw === true) {
        tty.setRawMode(false);
        rawModeChanged = true;
      }
      return await run(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return INTERRUPTED;
      throw error;
    } finally {
      if (active === controller) active = undefined;
      if (rawModeChanged && !closed) tty.setRawMode(true);
      interrupts.off('SIGINT', onInterrupt);
    }
  };

  output.write(`Epsil ${version}\nType .help for more information.\n\n`);

  const server = startNodeRepl({
    prompt: 'epsil> ',
    input,
    output,
    terminal,
    ignoreUndefined: true,
    eval(source, _context, filename, callback) {
      if (options.inputFormat === 'latex') {
        try {
          callback(null, new ReplEvaluation(session.evaluateLatex(source)));
        } catch (error) {
          callback(
            error instanceof Error ? error : new Error(String(error)),
            null
          );
        }
        return;
      }
      // With a kernel pool, the check for incomplete input also waits in the
      // queue. The check parses the source, and the parse of a LaTeX block
      // uses the engine, which must do no other work while the previous
      // program waits in `evaluateAsync`. The input is paused until the
      // check is done: if the entry is incomplete, the REPL must add the next
      // line to it, and that line must not arrive before the answer.
      if (session.workers !== undefined) {
        server.pause();
        evaluateInOrder(async () =>
          isRecoverable(source, session.parse(source, filename))
            ? undefined
            : interruptible((signal) =>
                session.evaluateAsync(source, filename, signal)
              )
        ).then(
          (result) => {
            // A closed REPL writes nothing more.
            if (closed) return;
            server.resume();
            if (result === undefined)
              callback(
                new Recoverable(new SyntaxError('Incomplete Epsil input')),
                undefined
              );
            else if (result === INTERRUPTED) {
              output.write(`${INTERRUPTED_MESSAGE}\n`);
              callback(null, undefined);
            } else callback(null, new ReplEvaluation(result));
          },
          (error: unknown) => {
            if (closed) return;
            server.resume();
            callback(
              error instanceof Error ? error : new Error(String(error)),
              null
            );
          }
        );
        return;
      }

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
        options.fancySymbols === true,
        options.color,
        showTime
      );
    },
  });

  // With a kernel pool, a reset waits in the same queue as the entries and
  // the `.load` commands. Thus a `.clear` that follows a `.load` clears the
  // engine after the file has run, not before.
  server.on('reset', () => {
    if (session.workers === undefined) session.reset();
    else
      void evaluateInOrder(async () => {
        session.reset();
      });
  });

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
      const load = () =>
        loadFile(
          this,
          session,
          filename,
          outputMode,
          options.fancySymbols === true,
          options.color,
          showTime,
          interruptible,
          () => closed
        );
      if (session.workers === undefined) {
        void load();
        return;
      }
      // With a kernel pool, the input is paused while the file runs, as it
      // is while an entry runs. Thus the terminal does not echo the input a
      // second time in cooked mode, and a `.exit` typed during the load
      // closes the REPL only after the file has run.
      this.pause();
      void evaluateInOrder(load).finally(() => {
        if (!closed) this.resume();
      });
    },
  });

  setupHistory(server, options.historyPath);

  server.once('exit', () => {
    closed = true;
    active?.abort(new Error('The REPL was closed'));
  });

  return new Promise((resolveExit) => {
    server.once('exit', () => resolveExit(0));
  });
}

/** Run an Epsil file in the REPL session and write its result. With a kernel
 * pool, the file runs asynchronously (`evaluateAsync`), and Ctrl-C stops it
 * (`interruptible`); without one, it runs synchronously, and the result is
 * written before the function returns. When `isClosed()` is true after the
 * file has run, the REPL was closed during the load: nothing is written. */
async function loadFile(
  server: REPLServer,
  session: EpsilSession,
  filename: string,
  outputMode: OutputMode,
  fancySymbols: boolean,
  color: boolean,
  showTime: boolean,
  interruptible: Interruptible,
  isClosed: () => boolean
): Promise<void> {
  const path = resolve(filename.trim());
  try {
    const source = readFileSync(path, 'utf8');
    const result =
      session.workers === undefined
        ? session.evaluate(source, path)
        : await interruptible((signal) =>
            session.evaluateAsync(source, path, signal)
          );
    if (isClosed()) return;
    server.output.write(
      result === INTERRUPTED
        ? `${INTERRUPTED_MESSAGE}\n`
        : `${formatReplResult(result, outputMode, fancySymbols, color, showTime)}\n`
    );
  } catch (error) {
    if (isClosed()) return;
    server.output.write(
      `error: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  server.displayPrompt();
}

function formatReplResult(
  result: EvaluationResult,
  outputMode: OutputMode,
  fancySymbols: boolean,
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
        formatValue(result, outputMode, { fancySymbols })
      : formatValue(result, outputMode, { fancySymbols });
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

  return /(?:\+|-|\*|\/|\^|==|!=|<=|>=|<|>|&&|\|\||==>|=>)\s*$/.test(source);
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
