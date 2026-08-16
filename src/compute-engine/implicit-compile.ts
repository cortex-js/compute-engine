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

/**
 * `implicitCompile` for a caller that needs a NUMERIC function of its
 * variables (`NDSolve` right-hand sides, the nonlinear-fit model): the
 * compiled `run` projected to a real number — a plain `number` passes;
 * anything else (a `{re, im}` `ComplexResult` with a non-zero imaginary part,
 * a boolean, a collection) is `NaN`. No chop: the compiled runner's result
 * convention already returns a value whose imaginary part is exactly zero as
 * a `number` (the transcendental kernels chop their own roundoff dust), so a
 * `{re, im}` here is a genuine domain escape.
 *
 * Returns `undefined` when the expression does not compile (same contract as
 * `implicitCompile`). Replaces the former `realOnly: true` option at these
 * call sites (`docs/plans/2026-08-16-compile-complex-mode.md` §5).
 */
export function implicitCompileNumeric(
  ce: IComputeEngine,
  expr: Expression
): ((vars: Record<string, number>) => number) | undefined {
  const compiled = implicitCompile(ce, expr);
  if (!compiled?.success || typeof compiled.run !== 'function')
    return undefined;
  const run = compiled.run as (vars: Record<string, number>) => unknown;
  return (vars) => {
    const v = run(vars);
    return typeof v === 'number' ? v : NaN;
  };
}
