import type { CompileDiagnostic, CompileMode } from './types.js';
import { isLaneMismatchError } from './diagnostics.js';

/**
 * The `mode: 'auto'` escalation: compile under the strict discipline and, if
 * that attempt declines with a lane mismatch, redo the compilation under the
 * complex discipline.
 *
 * This lives in its own module because there are TWO public routes into a
 * compilation and both owe the caller the same escalation:
 *
 * - the standalone `compile()` export (`compile-expression.ts`), and
 * - a target obtained from `ce._getCompilationTarget(name)` and invoked
 *   through its own `.compile()`, which reaches `BaseCompiler` directly and
 *   never passes through the standalone entry.
 *
 * Each target's `compile()` wraps its own compilation in this helper, so the
 * standalone entry gets the escalation by delegation rather than owning a
 * second copy of it. (The deprecated-option warnings and the
 * `complexPromotion` alias mapping are shared between the two routes the same
 * way, in `deprecation-warnings.ts`.) A separate module also
 * avoids a dependency cycle between `compile-expression.ts` and the targets.
 *
 * `attempt` performs one compilation under the mode it is given and THROWS on
 * a decline (an interpreter fallback must be built around this helper, not
 * inside it, or the mismatch of the first attempt would be swallowed into a
 * `success: false` result the retry never sees). It must start each attempt
 * from fresh per-compilation state — the built-in targets call
 * `createTarget()` per attempt, and `BaseCompiler`'s depth-0 latches (mode,
 * promotion, the mode report) are restored on the way out of every
 * compilation — or the retry would read the failed attempt's lane analysis.
 */
export function compileWithAutoEscalation<
  R extends { success: boolean; escalation?: CompileDiagnostic },
>(
  requestedMode: CompileMode | undefined,
  supportedModes: readonly CompileMode[],
  attempt: (mode: CompileMode | undefined) => R
): R {
  // `auto` is in play when it was requested or when it is the target's
  // default (nothing requested), and only where the target OFFERS it: a
  // strict-only target (the shader targets, interval-js) compiles once and
  // reports a requested `'auto'` as its own `unsupported-mode` decline.
  const auto =
    (requestedMode === undefined || requestedMode === 'auto') &&
    supportedModes.includes('auto');
  if (!auto) return attempt(requestedMode);
  try {
    return attempt(requestedMode);
  } catch (e) {
    if (!isLaneMismatchError(e)) throw e;
    const retried = attempt('complex');
    // The diagnostic of the FAILED strict attempt: it says which boundary and
    // binding made the slow way necessary. Attached only to a result that
    // carries code — a retry that declined in turn reports its own failure.
    // (For the built-in targets `attempt` throws on every decline, so the
    // non-success case here is reachable only for a third-party `attempt`
    // that reports a decline instead of throwing.)
    if (retried.success) retried.escalation = e.diagnostic;
    return retried;
  }
}
