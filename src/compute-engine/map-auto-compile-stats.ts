/**
 * Instrumentation counters for the auto-compilation of lazy-`Map` element
 * lambdas on numeric drains (implemented in `library/map-auto-compile.ts`).
 *
 * The counters live in this dependency-free module, rather than next to the
 * implementation, because `types-engine.ts` declares the engine accessor that
 * exposes them (`IComputeEngine._mapAutoCompileStats`) and the ESLint layering
 * rules forbid a `types-*.ts` file from importing anything under `library/`.
 * This module imports nothing, so it cannot participate in an import cycle.
 */

/** The shape of the auto-compile instrumentation counters. Every counter is
 * cumulative and monotonically increasing for the lifetime of the process
 * (see `_mapAutoCompileStats`).
 * @internal
 */
export interface MapAutoCompileStats {
  /** Compile attempts (initial, re-enabled, and recompiles). */
  attempts: number;
  /** Elements served by a compiled function. */
  compiledHits: number;
  /** Full dependency walks triggered by a cheap-check mismatch. */
  revalidations: number;
  /** Recompiles triggered by a genuine dependency change. */
  recompiles: number;
  /** Elements that fell back to the interpreter (non-numeric input row,
   * ABI failure). */
  elementFallbacks: number;
  /** Compiled results that were NaN (or complex with a NaN part) and were
   * re-evaluated through the interpreter (review 14). */
  nanDoubleChecks: number;
}

/**
 * The auto-compile counters. Every path through the `Map` drain
 * auto-compilation bumps one, so a caller can tell whether a drain compiled,
 * re-validated its dependency snapshot, recompiled, or fell back to the
 * interpreter.
 *
 * The counters are **process-global and cumulative**, not per-engine: the
 * compile cache they instrument is a module-level `WeakMap` shared by every
 * engine in the process, so splitting the counters per engine would not
 * describe what the cache actually does. Nothing resets them automatically, so
 * a caller measures a single drain by reading the counters before and after it
 * and taking the difference. `_resetMapAutoCompileStats()` zeroes them, which
 * is what the test suites use between cases.
 */
export const _mapAutoCompileStats: MapAutoCompileStats = {
  attempts: 0,
  compiledHits: 0,
  revalidations: 0,
  recompiles: 0,
  elementFallbacks: 0,
  nanDoubleChecks: 0,
};

export function _resetMapAutoCompileStats(): void {
  _mapAutoCompileStats.attempts = 0;
  _mapAutoCompileStats.compiledHits = 0;
  _mapAutoCompileStats.revalidations = 0;
  _mapAutoCompileStats.recompiles = 0;
  _mapAutoCompileStats.elementFallbacks = 0;
  _mapAutoCompileStats.nanDoubleChecks = 0;
}
