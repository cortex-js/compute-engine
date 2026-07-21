/**
 * Machine-readable reason a `CancellationError` was thrown.
 *
 * These are the engine's own cap-breach codes; the union is intentionally
 * **extendable** (new caps add a member). An `AbortSignal`-driven cancellation
 * instead carries the signal's `reason` through `cause`, which may be any
 * value, so consumers should treat an unrecognized `cause` as opaque.
 *
 *  - `'timeout'`: an enclosing `ce.withTimeLimit(...)` span's deadline was
 *    exceeded.
 *  - `'iteration-limit-exceeded'`: a loop/iterator exceeded
 *    `engine.iterationLimit`.
 *  - `'recursion-depth-exceeded'`: user-function recursion exceeded
 *    `engine.recursionLimit`.
 */
export type CancellationCause =
  | 'timeout'
  | 'iteration-limit-exceeded'
  | 'recursion-depth-exceeded';

/**
 * The engine's deadline state.
 *
 * A deadline is armed only by entering a span (`ce.withTimeLimit(...)`). The
 * frame is immutable: entering a span creates a new frame; exiting restores
 * the saved previous frame object.
 *
 *  - `at`: absolute ms timestamp beyond which execution should not proceed.
 *  - `owner`: label of the span whose deadline is the EFFECTIVE one (i.e. the
 *    span that owns `at`). `undefined` for an unlabelled span.
 *  - `spans`: labels of all active spans, outermost first. Unlabelled spans
 *    contribute nothing.
 */
export interface DeadlineFrame {
  at: number;
  owner?: string;
  spans: string[];
}

export class CancellationError<T = unknown> extends Error {
  /**
   * Machine-readable reason for the cancellation. Engine cap breaches set one
   * of the {@linkcode CancellationCause} codes; an `AbortSignal` abort carries
   * the signal's `reason` through instead (arbitrary value).
   */
  cause: CancellationCause | unknown;
  value?: T;

  /**
   * The label (`owner`) of the span whose deadline fired. Answers "was this my
   * budget or my caller's?" — compare directly against the label passed to
   * `withTimeLimit`. `undefined` for an unlabelled span.
   */
  attribution?: string;

  /** All active span labels when the deadline fired, outermost first. */
  spans?: string[];

  constructor({
    message,
    value,
    cause,
    attribution,
    spans,
  }: {
    message?: string;
    value?: T;
    cause?: CancellationCause | unknown;
    attribution?: string;
    spans?: string[];
  } = {}) {
    super(message ?? 'Operation canceled');
    if (value) this.value = value;
    this.cause = cause;
    if (attribution !== undefined) this.attribution = attribution;
    if (spans !== undefined) this.spans = spans;
    this.name = 'CancellationError';
  }
}

/**
 * Throw a `CancellationError` if `deadline` (an absolute timestamp in
 * milliseconds, or a `DeadlineFrame`, i.e. `engine._deadline` /
 * `engine._deadlineFrame`) has passed.
 *
 * When passed a `DeadlineFrame`, the thrown error carries `attribution`
 * (the frame's `owner`) and `spans` so the catching code can tell which
 * budget fired.
 *
 * Call this periodically from long-running loops that cannot be expressed
 * as generators (where `run()`/`runAsync()` would apply). In tight loops,
 * amortize the `Date.now()` cost with a stride counter:
 *
 *    if ((++count & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
 */
export function checkDeadline(
  deadline: number | DeadlineFrame | undefined
): void {
  if (deadline === undefined) return;
  const at = typeof deadline === 'number' ? deadline : deadline.at;
  if (Date.now() >= at) {
    if (typeof deadline === 'number')
      throw new CancellationError({
        cause: 'timeout',
        message: 'Timeout exceeded',
      });
    throw new CancellationError({
      cause: 'timeout',
      message: 'Timeout exceeded',
      attribution: deadline.owner,
      spans: deadline.spans,
    });
  }
}

/**
 * Ambient deadline for nested numeric routines.
 *
 * Compiled functions (`_SYS.integrate`, `_SYS.limit`, …) have no access to
 * the engine, so a deadline cannot be threaded through them explicitly. A
 * deadline-bounded numeric routine (Monte Carlo quadrature, Richardson
 * extrapolation) publishes its deadline here while it runs; a nested call
 * reached through compiled code inherits it. Single-threaded execution
 * makes the save/restore discipline safe.
 */
let ambientDeadline: number | undefined = undefined;

export function getAmbientDeadline(): number | undefined {
  return ambientDeadline;
}

/** Run `fn` with the ambient deadline set to `deadline`. */
export function withAmbientDeadline<T>(
  deadline: number | undefined,
  fn: () => T
): T {
  const saved = ambientDeadline;
  ambientDeadline = deadline;
  try {
    return fn();
  } finally {
    ambientDeadline = saved;
  }
}

/**
 * Executes a generator asynchronously with timeout and abort signal support.
 *
 * @param gen - The generator to execute.
 * @param timeLimitMs - The maximum time (in milliseconds) allowed for execution.
 * @param signal - An AbortSignal to cancel execution prematurely.
 * @returns The final value produced by the generator.
 * @throws CancellationError if the operation is canceled or times out.
 */
export async function runAsync<T>(
  gen: Generator<T>,
  timeLimitMs: number,
  signal?: AbortSignal,
  attribution?: DeadlineFrame | { owner?: string; spans?: string[] }
): Promise<T> {
  // eslint-disable-next-line no-restricted-globals
  const startTime = performance.now();

  while (true) {
    // eslint-disable-next-line no-restricted-globals
    const chunkStart = performance.now();
    const chunkDurationMs = 16; // Maximum chunk duration in milliseconds

    // Process a chunk of iterations
    // eslint-disable-next-line no-restricted-globals
    while (performance.now() - chunkStart < chunkDurationMs) {
      const { done, value } = gen.next();

      if (done) return value; // Exit successfully

      // Check for abort signal within the chunk
      if (signal?.aborted)
        throw new CancellationError({ value, cause: (signal as any).reason });

      // Check overall time limit
      // eslint-disable-next-line no-restricted-globals
      if (performance.now() - startTime >= timeLimitMs)
        throw new CancellationError({
          value,
          cause: 'timeout',
          message: `Timeout exceeded (${timeLimitMs}ms)`,
          attribution: attribution?.owner,
          spans: attribution?.spans,
        });
    }

    // Allow event loop to process other tasks
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function run<T>(
  gen: Generator<T>,
  timeLimitMs: number,
  attribution?: DeadlineFrame | { owner?: string; spans?: string[] }
): T {
  const startTime = Date.now();

  while (true) {
    const { done, value } = gen.next();

    if (done) return value; // Return the result if generator is done

    // Check for timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= timeLimitMs) {
      throw new CancellationError({
        value,
        cause: 'timeout',
        message: `Timeout exceeded (${timeLimitMs}ms)`,
        attribution: attribution?.owner,
        spans: attribution?.spans,
      });
    }
  }
}

// Example usage
/*
function* factorial(n: number): Generator<number> {
  if (n === 0) return 1;
  
  for (let i = n - 1; i > 1; i--) {
    n *= i;
    yield n;
  }
  return n;
}

const controller = new AbortController();
(async () => {
  const signal = controller.signal;

  try {
    const result = await runAsync(factorial(200), 300, signal);
    console.log('Result:', result);
  } catch (error) {
    if (error instanceof CancellationError) {
      console.error('Cancelled:', error.message);
      console.error('Reason:', error.cause);
      console.error('Partial result:', error.value);
    } else if (error instanceof Error) {
      console.error('Error:', error.message);
    }
  }
})();

// Simulate an interruption after 200ms (less than the 300ms timeout)
setTimeout(() => {
  controller.abort('user canceled');
}, 200);

// Wait for 2000ms
await new Promise((resolve) => setTimeout(resolve, 2000));



*/
