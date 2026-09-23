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
 *  - `budgets`: the step budgets of the active spans that have one,
 *    outermost first (see `StepBudget`).
 */
export interface DeadlineFrame {
  at: number;
  owner?: string;
  spans: string[];
  budgets?: StepBudget[];
  /**
   * Scratch counter for a strided deadline check (`checkDeadlineEvery`, and
   * the canonicalization walk in `boxed-expression/box.ts`). Several walks
   * share it; each checks when the counter reaches a multiple of its stride,
   * and every stride is a power of two.
   *
   * It lives on the FRAME rather than in a module-level variable so the stride
   * counts the nodes of the span that armed it, and only those. A module-level
   * counter is shared by every engine in the process, so a nested
   * canonicalization on a DIFFERENT engine — reachable because a canonical
   * handler runs arbitrary caller code — consumes stride boundaries while the
   * engine being checked at that moment has no frame armed. The check is then
   * a no-op and the engine that DOES have a budget waits up to another full
   * stride, so the residual overrun is not the one stride the walk claims.
   * A frame is created per span (`withTimeLimit`, `_withBudget`), so
   * per-frame ticking makes that bound exact, at the cost of one property
   * access.
   */
  tick?: number;
}

/**
 * A budget of steps, armed by an internal span (`engine._withBudget`).
 *
 * A wall-clock budget makes a result depend on the speed and the load of the
 * machine: the same integral closes on a fast machine and stays unevaluated on
 * a slow one. A step budget does not. Each call of `checkDeadline` with a
 * frame that holds this budget is one step, so the same computation on the
 * same engine state spends the same number of steps on every machine.
 *
 * A nested span shares the object with its parent, so a step counts against
 * every budget that is active. When `left` goes below zero, `checkDeadline`
 * throws a timeout `CancellationError` with the budget's `owner` as its
 * attribution, the same error the expiry of a labelled `withTimeLimit` span
 * gives. So the code that armed the budget can catch it and fall back, and
 * every other catch block lets it through (`throwIfCallerCancellation`).
 * Once spent, a budget stays spent: each later check throws again.
 */
export interface StepBudget {
  left: number;
  readonly owner?: string;
  readonly spans: string[];
}

/** Has the time of `frame` passed, or has one of its step budgets been
 * spent? Reads the budgets without counting a step. */
export function frameExpired(frame: DeadlineFrame | undefined): boolean {
  if (frame === undefined) return false;
  if (Date.now() >= frame.at) return true;
  return frame.budgets?.some((b) => b.left < 0) ?? false;
}

/**
 * How many `iteration-limit-exceeded` cancellations have been RAISED over the
 * life of the process. Monotonic; only ever compared before and after a
 * computation, to answer "did this computation give up because of
 * `engine.iterationLimit`?". An answer produced under a breached limit is
 * limit-DEGRADED — a different `iterationLimit` could produce a different
 * answer — so a memo must not freeze it (the collection-facet memo's
 * settled-only gate consumes this, exactly like `cycleDetectionCount()`).
 * Counted at the single raise site (the constructor below) rather than at the
 * scattered catch sites that convert the error to an "unknown" answer.
 */
let _iterationLimitCancellations = 0;

/** See {@link _iterationLimitCancellations}. */
export function iterationLimitCancellationCount(): number {
  return _iterationLimitCancellations;
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
    if (cause === 'iteration-limit-exceeded') _iterationLimitCancellations += 1;
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
 * amortize the cost with `checkDeadlineEvery(ce._deadlineFrame, 0x3ff)`,
 * which keeps its counter on the frame (a module-level counter would make
 * the step count of a step budget depend on earlier work).
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
  if (typeof deadline === 'number' || deadline.budgets === undefined) return;
  // One step against every active budget. When more than one is spent, the
  // outermost one owns the error, as the earliest deadline does for time.
  let spent: StepBudget | undefined;
  for (const b of deadline.budgets) {
    b.left -= 1;
    if (b.left < 0 && spent === undefined) spent = b;
  }
  if (spent !== undefined)
    throw new CancellationError({
      cause: 'timeout',
      message: 'Step budget exhausted',
      attribution: spent.owner,
      // All the spans active now, as for an expired time.
      spans: deadline.spans,
    });
}

/**
 * Call `checkDeadline(frame)` once every `mask + 1` calls (`mask` is a power
 * of two minus one, such as `0x3ff`), to amortize its cost in a hot loop.
 *
 * The counter is the frame's `tick`, not a module-level variable. A frame is
 * created per span, so the checks fall at the same points of the work of a
 * span whatever ran before it. That keeps the step count of a step budget
 * (`StepBudget`) the same on every run of the same computation.
 */
export function checkDeadlineEvery(
  frame: DeadlineFrame | undefined,
  mask: number
): void {
  if (
    frame !== undefined &&
    ((frame.tick = (frame.tick ?? 0) + 1) & mask) === 0
  )
    checkDeadline(frame);
}

/**
 * True when `e` is a `CancellationError` raised by an expired time budget
 * (`cause: 'timeout'`), as opposed to an abort signal, an iteration-limit or
 * recursion-depth breach, or any other error.
 *
 * Only an expired time budget licenses a caller to convert a throw into a
 * partial, in-band result; every other cancellation must propagate.
 *
 * Identified by NAME (and `cause`), never `instanceof`: plugin bundles
 * re-bundle engine code, so a `CancellationError` crossing a bundle boundary
 * is not an instance of the host's class.
 */
export function isTimeoutCancellation(e: unknown): boolean {
  return (
    e instanceof Error &&
    e.name === 'CancellationError' &&
    (e as { cause?: unknown }).cause === 'timeout'
  );
}

/**
 * Throw when `e` is a cancellation that the caller must receive.
 *
 * Call this at the start of a `catch` block that changes an error into a
 * fallback result. Only the timeout of a time budget that the failed code
 * owns can become a fallback (see `isTimeoutCancellation`). So:
 *
 * - A `CancellationError` that is not a timeout (an abort signal, an
 *   iteration limit, a recursion-depth limit) is thrown again. The error is
 *   identified by its name, not by `instanceof`, because a plugin bundle has
 *   its own copy of the class.
 * - A timeout is thrown when `frame` has expired. `frame` is the deadline
 *   frame in effect around the code that failed (`engine._deadlineFrame`,
 *   read in the `catch` block, after any inner span has closed). Then the
 *   timeout belongs to the enclosing span (the caller), and `checkDeadline`
 *   throws the cancellation of that frame, with its attribution. An
 *   unlabelled span gives an error with no attribution, so the attribution of
 *   `e` alone cannot identify the caller's span. The expiry time of the frame
 *   can.
 *
 * In all other cases (an error that is not a cancellation, or a timeout
 * while `frame` has not expired) this returns, and the caller continues with
 * its fallback.
 */
export function throwIfCallerCancellation(
  e: unknown,
  frame: DeadlineFrame | undefined
): void {
  if (!(e instanceof Error && e.name === 'CancellationError')) return;
  if (!isTimeoutCancellation(e)) throw e;
  // Read the frame first: `checkDeadline` counts a step against its budgets,
  // which a test of the frame must not do.
  if (frameExpired(frame)) checkDeadline(frame);
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
 *
 * The deadline is an absolute timestamp or a `DeadlineFrame`. A frame keeps
 * the label of its `withTimeLimit` span, so a nested call that finds the
 * deadline expired throws a `CancellationError` with that label, as a call
 * given the frame directly does.
 */
let ambientDeadline: number | DeadlineFrame | undefined = undefined;

export function getAmbientDeadline(): number | DeadlineFrame | undefined {
  return ambientDeadline;
}

/** Run `fn` with the ambient deadline set to `deadline`. */
export function withAmbientDeadline<T>(
  deadline: number | DeadlineFrame | undefined,
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
  gen: Generator<T, any, any>,
  timeLimitMs: number,
  signal?: AbortSignal,
  attribution?: DeadlineFrame | { owner?: string; spans?: string[] }
): Promise<Exclude<T, PromiseLike<unknown>>> {
  // eslint-disable-next-line no-restricted-globals
  const startTime = performance.now();

  // The value handed back to the generator by the next `gen.next(...)`: the
  // settled value of a thenable it yielded (see below), `undefined` otherwise.
  let sent: unknown = undefined;

  while (true) {
    // eslint-disable-next-line no-restricted-globals
    const chunkStart = performance.now();
    const chunkDurationMs = 16; // Maximum chunk duration in milliseconds

    // Process a chunk of iterations
    // eslint-disable-next-line no-restricted-globals
    while (performance.now() - chunkStart < chunkDurationMs) {
      const { done, value } = gen.next(sent);
      sent = undefined;

      if (done) return value; // Exit successfully

      // A generator that must AWAIT in the middle of its work — a fold whose
      // per-term callback is asynchronous — yields the promise and receives
      // its settled value from the next `gen.next(...)`; the synchronous
      // `run` driver never sees one, because a synchronous callback never
      // returns a promise. The abort signal and the time limit are checked
      // after the await as after any other step.
      if (isThenable(value)) sent = await value;

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

// Both drivers answer the generator's yield type minus any thenable: the
// asynchronous driver consumes a yielded thenable (awaits it and hands the
// settled value back to the generator), and a generator run by the
// synchronous driver never yields one, so a thenable is never the value.

/** Whether `x` is a thenable — a promise, or an object with a `then` method. */
export function isThenable(x: unknown): x is PromiseLike<unknown> {
  return (
    x !== null &&
    (typeof x === 'object' || typeof x === 'function') &&
    typeof (x as { then?: unknown }).then === 'function'
  );
}

export function run<T>(
  gen: Generator<T, any, any>,
  timeLimitMs: number,
  attribution?: DeadlineFrame | { owner?: string; spans?: string[] }
): Exclude<T, PromiseLike<unknown>> {
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
