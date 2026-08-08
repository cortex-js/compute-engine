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
 * The statement is a `BoxedExpression`; the type here is `unknown` so this
 * module has zero imports (it sits in `common/`, below the engine layers).
 * Consumers cast.
 *
 * Re-entrancy is the CONSUMER's concern: evaluating an expression from
 * inside the hook (a watch, a debug-console entry) re-enters
 * `evaluateStatements`, so the consumer must suppress its own hook for the
 * duration or it will pause recursively.
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
