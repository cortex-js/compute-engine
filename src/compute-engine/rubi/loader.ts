// Loader for the opt-in Rubi integration rule driver. `loadIntegrationRules`
// compiles the bundled Chapter-1 corpus and registers a rule-driven
// integration provider on the engine; thereafter `ce.parse('\\int…').evaluate()`
// consults the Rubi rules before the built-in antiderivative (which still
// covers what the rules don't, e.g. Gaussian/Fresnel integrals).
//
// Usage:
// ```ts
// import { ComputeEngine } from '@cortex-js/compute-engine';
// import { loadIntegrationRules } from '@cortex-js/compute-engine/integration-rules';
//
// const ce = new ComputeEngine();
// loadIntegrationRules(ce);
// ce.parse('\\int x \\sqrt{1+x} \\, dx').evaluate();
// ```

import RUBI_RULES_DATA from './rubi-rules-data.json';

import type {
  IComputeEngine as ComputeEngine,
  RuleSteps,
} from '../global-types.js';
import type { Expr as Expression, RubiRuleDoc } from './types.js';
import { compileRuleDocs, type CompileResult } from './compile.js';
import { RubiDriver, type IntStepRecord } from './driver.js';

export interface IntegrationRulesLoadOptions {
  /** Per-integral wall-clock budget for the rule driver, in milliseconds.
   * Default 10000. Bounds each `Integrate` call so a pathological integrand
   * cannot hang. */
  timeLimitMs?: number;
}

export interface IntegrationRulesLoadReport {
  /** Number of compiled (match-ready) rules registered. */
  ruleCount: number;
  /** Number of corpus rules skipped at compile time. */
  skipped: number;
  /** The skipped corpus rules, each with the reason it could not compile
   * (e.g. `slots folded away by canonicalization`). Reported honestly on
   * cached (idempotent re-load) calls too — the compile result is cached, so
   * the reasons are not lost after the first call. */
  skippedRules: { id: string; reason: string }[];
}

// Compiling the ~2.6k rules costs ~300 ms; cache the full compile result
// (rules + skip reasons) per engine so repeated `loadIntegrationRules(ce)`
// calls (idempotent) don't recompile AND still report the honest skip count.
const compiledCache = new WeakMap<object, CompileResult>();

/**
 * Compile the bundled Rubi rules and register them as the engine's symbolic
 * integration provider. Idempotent per engine (re-registers the provider,
 * reusing the cached compiled rules).
 */
export function loadIntegrationRules(
  ce: ComputeEngine,
  options?: IntegrationRulesLoadOptions
): IntegrationRulesLoadReport {
  let result = compiledCache.get(ce);
  if (!result) {
    result = compileRuleDocs(ce, RUBI_RULES_DATA as unknown as RubiRuleDoc[]);
    compiledCache.set(ce, result);
  }
  const compiled = result.rules;
  const skipped = result.skipped;

  const driver = new RubiDriver(ce, compiled, {
    timeLimitMs: options?.timeLimitMs ?? 10_000,
  });

  ce._integrationProvider = (
    integrand: Expression,
    variable: string,
    trace?: RuleSteps
  ) => {
    // The `Integrate` evaluator passes the integrand wrapped in
    // `Function`/`Block`/`Delimiter` scaffolding; the rule driver wants the
    // bare integrand (the built-in antiderivative unwraps these too).
    let f = integrand;
    while (
      f.operator === 'Function' ||
      f.operator === 'Block' ||
      f.operator === 'Delimiter'
    )
      f = f.op1!; // Function/Block/Delimiter always have a first operand
    // Only accumulate a step trace when `explain('Integrate')` asked for one.
    const records: IntStepRecord[] | undefined = trace ? [] : undefined;
    const result = driver.int(f, variable, records);
    // Only a fully-closed antiderivative is usable; a residual inert
    // `Integrate` means the rules couldn't finish — defer to the built-in
    // antiderivative instead of returning a partial result.
    if (result === null || containsIntegrate(result)) return null;
    if (trace && records) {
      // Replay the recorded steps into whole-state steps, then close with the
      // driver's returned antiderivative (the caller de-duplicates it if it
      // already equals the last state).
      for (const s of driver.replayTrace(records)) trace.push(s);
      trace.push({ value: result, because: 'integrate.simplify' });
    }
    return result;
  };

  return {
    ruleCount: compiled.length,
    skipped: skipped.length,
    skippedRules: skipped,
  };
}

/** True if the expression tree contains an `Integrate` node. */
function containsIntegrate(e: Expression): boolean {
  if (e.operator === 'Integrate') return true;
  return e.ops?.some(containsIntegrate) ?? false;
}
