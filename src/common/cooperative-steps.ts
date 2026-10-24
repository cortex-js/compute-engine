/**
 * Long numeric work written as a generator of steps, run on the calling
 * thread either at once or in slices that give the event loop a turn.
 *
 * A step function (`function*`) yields at the points where it can stop for a
 * while: between two grid points of a search, between two iterations of a
 * solver. `runStepsSync()` runs it to its end without stopping, which is what
 * a synchronous evaluation does. `runStepsAsync()` runs it in slices of about
 * `sliceMs` milliseconds and, between two slices, waits for a macrotask
 * (`yieldToEventLoop()`): timers, input and rendering run there, so a page
 * stays responsive and an `AbortSignal` that a timer aborts is seen at the
 * next check of the work. A microtask (`await` of a resolved promise) is not
 * enough: the event loop runs no timer until the microtask queue is empty.
 */

/** A step function: it yields (with no value) at each point where it can
 * stop, and returns its result. */
export type Steps<T> = Generator<void, T, void>;

/** Run `steps` to its end on the calling thread, without stopping. */
export function runStepsSync<T>(steps: Steps<T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * Wait for a macrotask turn of the event loop, through the fastest channel
 * the host has: `setImmediate` (Node, Bun), a `MessageChannel` (browsers and
 * web workers; a nested `setTimeout(0)` waits at least 4 ms there), or else
 * `setTimeout(0)`.
 */
export const yieldToEventLoop: () => Promise<void> = (() => {
  const g = globalThis as {
    setImmediate?: (cb: () => void) => unknown;
    MessageChannel?: new () => {
      port1: { onmessage: ((e: unknown) => void) | null; close?: () => void };
      port2: { postMessage: (m: unknown) => void; close?: () => void };
    };
  };
  if (typeof g.setImmediate === 'function') {
    const setImmediate = g.setImmediate;
    return () => new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (typeof g.MessageChannel === 'function') {
    const Channel = g.MessageChannel;
    // One channel per wait, closed when its message arrives: an open port
    // with a listener can keep a host process alive after the work ends.
    return () =>
      new Promise<void>((resolve) => {
        const channel = new Channel();
        channel.port1.onmessage = () => {
          channel.port1.close?.();
          channel.port2.close?.();
          resolve();
        };
        channel.port2.postMessage(undefined);
      });
  }
  return () => new Promise<void>((resolve) => setTimeout(resolve, 0));
})();

/** The default length of a slice of `runStepsAsync()`, in milliseconds:
 * half a frame at 60 frames per second. */
export const DEFAULT_SLICE_MS = 8;

/**
 * Tells a long computation on the calling thread when to give the event loop
 * a turn: `pace()` waits for a macrotask when at least `sliceMs`
 * milliseconds of work ran since the last wait (or since the pacer was
 * made), and returns at once otherwise. Several step functions run one after
 * the other can share one pacer, so that the slices do not restart at each.
 */
export class EventLoopPacer {
  private last = Date.now();
  /** How many times `pace()` waited for the event loop. */
  yields = 0;

  constructor(readonly sliceMs: number = DEFAULT_SLICE_MS) {}

  /** True when a slice is over: the next `pace()` waits. */
  get due(): boolean {
    return Date.now() - this.last >= this.sliceMs;
  }

  async pace(): Promise<void> {
    if (!this.due) return;
    await yieldToEventLoop();
    this.yields += 1;
    this.last = Date.now();
  }
}

/**
 * Run `steps` to its end on the calling thread, in slices: after a step,
 * when the slice of `pacer` is over, wait for a macrotask before the next
 * step. `inStep` wraps each step (a call of `next()`): it puts in place the
 * engine state the steps need, which an engine field cannot hold across the
 * wait (see `runWithEvaluationEffects` in
 * `compute-engine/effects-registry.ts`).
 */
export async function runStepsAsync<T>(
  steps: Steps<T>,
  pacer: EventLoopPacer,
  inStep: <R>(f: () => R) => R = (f) => f()
): Promise<T> {
  for (;;) {
    const step = inStep(() => steps.next());
    if (step.done) return step.value;
    await pacer.pace();
  }
}
