import type { Expression, IComputeEngine } from './global-types.js';
import { CancellationError } from '../common/interruptible.js';

/**
 * Compile `expr` for an **implicit** (engine-initiated) code-generation path —
 * the auto-compiled `Map` drains, the numeric quadrature/derivative/limit
 * kernels (`NIntegrate`, `ND`, `NLimit`, the `Integrate`/`Limit` numeric
 * fallbacks), the `NDSolve` right-hand sides, the solve-domain enumeration
 * sieve, the stochastic-equality probes, and the compiled `Reduce` fast path —
 * honoring the `ce.jit` flag (D7 of the Map auto-compile design):
 *
 * - `ce.jit === 'off'` → no attempt, return `undefined`: a strict-CSP host
 *   that sets the flag up front generates zero violation reports.
 * - An environment-level failure to *construct* a function (a CSP
 *   `EvalError` — distinct from an ordinary compile failure) **latches
 *   `ce.jit = 'off'` engine-wide** — detect once, not per call site — so all
 *   subsequent implicit paths interpret silently, capping violation reports
 *   at one.
 * - A `CancellationError` (deadline expiry during the compile) propagates: it
 *   reflects the moment's budget, not the expression.
 * - Any other compile failure returns `undefined` **silently** (no
 *   "Compilation fallback" warning): the caller interprets instead.
 *
 * Explicit `compile()` calls must NOT go through this helper — a direct user
 * request keeps failing loudly with the environment's own error, regardless
 * of the flag.
 */
export function implicitCompile(
  ce: IComputeEngine,
  expr: Expression,
  options?: Record<string, unknown>
): ReturnType<IComputeEngine['_compile']> | undefined {
  if (ce.jit === 'off') return undefined;
  try {
    return ce._compile(expr, { ...options, fallback: false });
  } catch (e) {
    if (e instanceof EvalError) {
      ce.jit = 'off';
      return undefined;
    }
    if (e instanceof CancellationError) throw e;
    return undefined;
  }
}
