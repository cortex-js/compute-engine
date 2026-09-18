import type {
  ConsoleHandler,
  EffectHandlerOverrides,
  EffectHandlers,
  EntropyHandler,
} from './types-effects.js';

// The host capability registry — the value behind `ce.effects`
// (`docs/EFFECTS-MODEL.md`, "Host capabilities"). This module holds the
// default handlers and the function that derives a new registry from
// overrides. It imports no engine code, so the library and the evaluation
// driver can both use it.

/** The capability names a registry holds. A derived registry rejects any
 * other key: a misspelled capability would otherwise be accepted and then
 * ignored. */
const CAPABILITY_NAMES: ReadonlyArray<keyof EffectHandlers> = [
  'console',
  'entropy',
];

/**
 * The default `console` handler: the real console of the host.
 *
 * `log` reaches the console through `globalThis` and a method reference, never
 * as a direct `console.log(...)` call. The production build declares
 * `console.log` pure (`scripts/build.mjs`, the esbuild `pure:` option) and the
 * minifier deletes such calls, so the direct spelling would make `Print` do
 * nothing in the published bundles while every test, run from source, passes.
 * On a host without a console, `log` does nothing.
 *
 * The console is looked up on each call, not when the handler is created, so
 * a host that replaces `globalThis.console` later is respected.
 */
const DEFAULT_CONSOLE_HANDLER: ConsoleHandler = Object.freeze({
  log(line: string): void {
    const console_ = globalThis.console;
    const log = console_?.log;
    if (typeof log === 'function') log.call(console_, line);
  },
  readLine: hostReadLine,
});

/** The default `entropy` handler: the host's `Math.random`. */
const DEFAULT_ENTROPY_HANDLER: EntropyHandler = Object.freeze({
  random: (): number => Math.random(),
});

/** The registry of a new engine: every capability with a default has its
 * default handler. */
export const DEFAULT_EFFECT_HANDLERS: EffectHandlers = Object.freeze({
  console: DEFAULT_CONSOLE_HANDLER,
  entropy: DEFAULT_ENTROPY_HANDLER,
});

/**
 * Thrown by engine code that draws from a host capability on behalf of an
 * operator and finds the handler denied (`null`), where the code returns a
 * plain value and cannot return an error expression — `ce._random()` returns
 * a number. The evaluation driver converts it to the
 * `Error("capability-denied", capability)` value of the operator being
 * evaluated (`handlerThrowToErrorValue`, `boxed-function.ts`). It escapes
 * only from compiled code, which has no error-value channel.
 */
export class CapabilityDeniedError extends Error {
  constructor(readonly capability: keyof EffectHandlers) {
    super(`The host denies the "${capability}" capability`);
    this.name = 'CapabilityDeniedError';
  }
}

/**
 * Return the registry that results from applying `overrides` to `current`.
 * The result is a new frozen object; `current` is not changed.
 *
 * A `null` override is kept as `null` (a denial). An `undefined` override, or
 * an absent key, keeps the handler of `current`.
 *
 * Throws on a key that is not a capability name and on a handler that does not
 * have the methods of its interface: both are mistakes of the embedding
 * program, and accepting them would fail much later, inside an evaluation.
 */
export function deriveEffectHandlers(
  current: EffectHandlers,
  overrides: EffectHandlerOverrides
): EffectHandlers {
  if (overrides === null || typeof overrides !== 'object')
    throw new TypeError('Expected an object of effect handlers');

  for (const key of Object.keys(overrides)) {
    if (!(CAPABILITY_NAMES as ReadonlyArray<string>).includes(key))
      throw new TypeError(
        `Unknown effect handler "${key}". The available handlers are: ${CAPABILITY_NAMES.join(', ')}`
      );
  }

  const console_ = overrides.console;
  if (console_ !== undefined && console_ !== null) {
    if (
      typeof console_.log !== 'function' ||
      typeof console_.readLine !== 'function'
    )
      throw new TypeError(
        'The "console" effect handler must have a `log` method and a `readLine` method'
      );
  }
  const entropy = overrides.entropy;
  if (entropy !== undefined && entropy !== null) {
    if (typeof entropy.random !== 'function')
      throw new TypeError(
        'The "entropy" effect handler must have a `random` method'
      );
  }

  return Object.freeze({
    console: console_ === undefined ? current.console : console_,
    entropy: entropy === undefined ? current.entropy : entropy,
  });
}

/**
 * Run the synchronous `fn` as part of the evaluation that captured `effects`,
 * and return its result.
 *
 * For a synchronous segment of asynchronous evaluation code that runs AFTER
 * an `await`: the evaluation driver publishes the captured registry in the
 * engine slot only for the synchronous start of an `evaluateAsync()` call and
 * of a handler call. A synchronous `evaluate()` started after an `await`
 * would find the slot empty and capture whichever registry is installed at
 * that moment — possibly one installed for a different, concurrent
 * evaluation. This puts the right one in the slot for the duration of `fn`,
 * and takes it out again before control returns.
 */
export function runWithEvaluationEffects<T>(
  engine: { _evaluationEffects: EffectHandlers | undefined },
  effects: EffectHandlers,
  fn: () => T
): T {
  const enclosing = engine._evaluationEffects;
  engine._evaluationEffects = effects;
  try {
    return fn();
  } finally {
    engine._evaluationEffects = enclosing;
  }
}

/**
 * Wrap a generator so that every step of it runs as part of the evaluation
 * that captured `effects`.
 *
 * For an `evaluateAsync` operator handler that drives a generator with
 * `runAsync` when the generator's steps call the synchronous `evaluate()` — a
 * loop body, the terms of a sum. `runAsync` suspends the handler between time
 * slices. The evaluation driver publishes the captured registry in the engine
 * slot only for the synchronous START of a handler, so a step that runs after
 * a suspension would find the slot empty, and the synchronous evaluation it
 * starts would capture whichever registry is installed at that moment —
 * possibly one installed for a different, concurrent evaluation. This puts
 * the right registry in the slot around each step, and takes it out again
 * before control returns to `runAsync`.
 */
export function* withEvaluationEffects<T, R, N>(
  engine: { _evaluationEffects: EffectHandlers | undefined },
  effects: EffectHandlers,
  gen: Generator<T, R, N>
): Generator<T, R, N> {
  let sent: N | undefined = undefined;
  for (;;) {
    const step = runWithEvaluationEffects(engine, effects, () =>
      gen.next(sent as N)
    );
    if (step.done) return step.value;
    sent = yield step.value;
  }
}

/**
 * Read one line of text from the host, synchronously — the default
 * `readLine` of the `console` handler.
 *
 * Returns the line with its trailing newline (and `\r`) removed; `null` at
 * end-of-input or a canceled browser dialog; `undefined` when the host
 * offers no interactive input at all (no Node stdin, no `prompt()`), so
 * `Input` can stay unevaluated.
 *
 * In a Node-compatible host, reads the controlling terminal (`/dev/tty`)
 * when stdin is one: reading fd 0 directly can fail with `EAGAIN` when
 * another consumer — a REPL's readline, say — has switched stdin to
 * non-blocking mode, and `/dev/tty` is a blocking view of the same
 * terminal. Piped (non-tty) stdin reads fd 0, so `echo 5 | epsil program`
 * works. The `node:fs` module is reached through `process.getBuiltinModule`
 * rather than an import so this module stays loadable in browsers. That API
 * needs Node ≥ 22.3, the package's `engines` floor (raised for this, user
 * ruling 2026-08-18); the guard still degrades gracefully — input reported
 * unavailable — on an unsupported older host.
 */
function hostReadLine(prompt?: string): string | null | undefined {
  const g = globalThis as Record<string, any>;
  const proc = g.process;
  if (proc?.stdin && typeof proc.getBuiltinModule === 'function') {
    const fs = proc.getBuiltinModule('node:fs');
    if (!fs) return undefined;
    if (prompt) proc.stdout?.write?.(prompt);
    let fd: number = proc.stdin.fd ?? 0;
    let ownFd = false;
    if (proc.stdin.isTTY) {
      try {
        fd = fs.openSync('/dev/tty', 'rs');
        ownFd = true;
      } catch {
        // No /dev/tty (e.g. Windows): read fd 0 directly.
      }
    }
    try {
      const bytes: number[] = [];
      const buf = new Uint8Array(1);
      const eagainWait = new Int32Array(new SharedArrayBuffer(4));
      let eof = false;
      for (;;) {
        let n = 0;
        try {
          n = fs.readSync(fd, buf, 0, 1, null);
        } catch (e) {
          const code = (e as { code?: string }).code;
          // Windows reports end-of-input on a terminal as an `EOF` error.
          if (code === 'EOF') {
            eof = true;
            break;
          }
          // `EAGAIN` is a non-blocking descriptor with no data YET — not
          // end-of-input (it can occur when reading fd 0 directly after the
          // `/dev/tty` bypass was unavailable). Wait briefly and retry
          // rather than misreporting a pending line as `Nothing` — or
          // truncating one mid-read. `Atomics.wait` is the only synchronous
          // sleep available; this branch is Node-only, where blocking the
          // main thread is permitted.
          if (code === 'EAGAIN') {
            Atomics.wait(eagainWait, 0, 0, 10);
            continue;
          }
          throw e;
        }
        if (n === 0) {
          eof = true;
          break;
        }
        if (buf[0] === 0x0a) break;
        bytes.push(buf[0]);
      }
      if (eof && bytes.length === 0) return null;
      if (bytes[bytes.length - 1] === 0x0d) bytes.pop();
      return new TextDecoder().decode(new Uint8Array(bytes));
    } finally {
      if (ownFd) fs.closeSync(fd);
    }
  }
  // Browser: the modal `prompt()` dialog. Returns `null` on cancel.
  if (typeof g.prompt === 'function') return g.prompt(prompt ?? '');
  return undefined;
}
