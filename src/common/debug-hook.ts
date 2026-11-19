import { beginPause, endPause, type PauseClock } from './interruptible.js';

/**
 * Debugger statement hook.
 *
 * When set, `evaluateStatements()` (`compute-engine/function-utils.ts` — the
 * statement sequencer behind `Block` bodies, lambda bodies and `If` branch
 * blocks) calls the hook before evaluating each statement that carries
 * `sourceOffsets` (i.e. statements that originated from Epsil source; engine
 * -internal blocks carry none and never fire).
 *
 * The hook is deliberately **synchronous and module-global**:
 *  - synchronous, because a debugger pauses by BLOCKING inside the hook
 *    (`Atomics.wait` on a worker thread) — threading an async hook through
 *    every evaluation path would be invasive engine surgery for no benefit;
 *  - module-global rather than per-engine, because a debugger owns its
 *    engine process outright (the VS Code debug adapter runs the debuggee in
 *    a dedicated worker). It is NOT part of the public engine API.
 *
 * The statement is an `Expression`; the type here is `unknown` so this
 * module imports nothing from the engine layers (it sits in `common/`, below
 * them). Consumers cast.
 *
 * Re-entrancy is the CONSUMER's concern: evaluating an expression from
 * inside the hook (a watch, a debug-console entry) re-enters
 * `evaluateStatements`, so the consumer must suppress its own hook for the
 * duration or it will pause recursively.
 *
 * A host that cannot block a thread (a browser page) uses the asynchronous
 * hooks of `executeEpsilAsync()` instead (`ExecuteEpsilAsyncOptions.debug`,
 * `EpsilDebugHooks` in `compute-engine/types-debug.ts`): a hook returns a
 * promise, and the run waits until it settles.
 */
export type DebugStatementHook = (statement: unknown) => void;

/** Live binding read by `evaluateStatements` — `undefined` (the default)
 * costs one comparison per statement. */
export let debugStatementHook: DebugStatementHook | undefined = undefined;

export function setDebugStatementHook(
  hook: DebugStatementHook | undefined
): void {
  debugStatementHook = hook;
}

/**
 * Fired AFTER a source-mapped statement evaluates, with its result. The
 * debugger's "break on error value" exception filter is built on this:
 * Epsil's runtime problems are `["Error", …]` VALUES, never throws, so
 * "break on exception" means pausing when a statement produced one. Same
 * contract as {@linkcode DebugStatementHook}: synchronous, may block,
 * consumer handles re-entrancy.
 */
export type DebugStatementResultHook = (
  statement: unknown,
  result: unknown
) => void;

export let debugStatementResultHook: DebugStatementResultHook | undefined =
  undefined;

export function setDebugStatementResultHook(
  hook: DebugStatementResultHook | undefined
): void {
  debugStatementResultHook = hook;
}

// A debugger command can unwind evaluation. Program continuation must not turn
// an exception from a host hook into an ordinary statement error.
const HOOK_FAILURES = new WeakSet<object>();
export function invokeDebugHook(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    throw hookFailure(error);
  }
}
/** As `invokeDebugHook()`, for a hook that can return a promise (the hooks
 * of `executeEpsilAsync()`, `ExecuteEpsilAsyncOptions.debug`): a throw and a
 * rejection are both hook failures.
 *
 * When the hook returns a promise, the run is paused from the return of the
 * hook until the promise settles, and `clock` (the `PauseClock` of the run,
 * `common/interruptible.ts`) leaves that time out of the time limits of the
 * run. A hook that returns no promise is running time. */
export async function invokeDebugHookAsync(
  fn: () => void | PromiseLike<void>,
  clock?: PauseClock
): Promise<void> {
  let paused = false;
  try {
    const result = fn();
    if (
      clock !== undefined &&
      result !== null &&
      result !== undefined &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      // From the time the hook returned its promise: the synchronous part
      // of the hook (a watch it evaluates) is running time.
      beginPause(clock, Date.now());
      paused = true;
    }
    await result;
  } catch (error) {
    throw hookFailure(error);
  } finally {
    if (paused) endPause(clock!);
  }
}
function hookFailure(error: unknown): object {
  const failure =
    error !== null && (typeof error === 'object' || typeof error === 'function')
      ? error
      : new Error('Debugger hook threw', { cause: error });
  HOOK_FAILURES.add(failure);
  return failure;
}
export function isDebugHookFailure(error: unknown): boolean {
  return (
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    HOOK_FAILURES.has(error)
  );
}
