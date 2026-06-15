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

import type { IComputeEngine as ComputeEngine } from '../global-types';
import type { Expr as Expression, RubiRuleDoc } from './types';
import { compileRuleDocs, type CompiledRule } from './compile';
import { RubiDriver } from './driver';

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
}

// Compiling the ~2.6k rules costs ~300 ms; cache per engine so repeated
// `loadIntegrationRules(ce)` calls (idempotent) don't recompile.
const compiledCache = new WeakMap<object, CompiledRule[]>();

/**
 * Compile the bundled Rubi rules and register them as the engine's symbolic
 * integration provider. Idempotent per engine (re-registers the provider,
 * reusing the cached compiled rules).
 */
export function loadIntegrationRules(
  ce: ComputeEngine,
  options?: IntegrationRulesLoadOptions
): IntegrationRulesLoadReport {
  let compiled = compiledCache.get(ce);
  let skipped = 0;
  if (!compiled) {
    const result = compileRuleDocs(
      ce,
      RUBI_RULES_DATA as unknown as RubiRuleDoc[]
    );
    compiled = result.rules;
    skipped = result.skipped.length;
    compiledCache.set(ce, compiled);
  }

  const driver = new RubiDriver(ce, compiled, {
    timeLimitMs: options?.timeLimitMs ?? 10_000,
  });

  ce._integrationProvider = (integrand: Expression, variable: string) => {
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
    const result = driver.int(f, variable);
    // Only a fully-closed antiderivative is usable; a residual inert
    // `Integrate` means the rules couldn't finish — defer to the built-in
    // antiderivative instead of returning a partial result.
    if (result === null || containsIntegrate(result)) return null;
    return result;
  };

  return { ruleCount: compiled.length, skipped };
}

/** True if the expression tree contains an `Integrate` node. */
function containsIntegrate(e: Expression): boolean {
  if (e.operator === 'Integrate') return true;
  return e.ops?.some(containsIntegrate) ?? false;
}
