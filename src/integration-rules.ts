// Entry point for the `@cortex-js/compute-engine/integration-rules` sub-path.
// An opt-in symbolic-integration rule driver ported from the Rubi corpus
// (Chapter 1: algebraic functions). Once loaded, the engine's `Integrate`
// evaluator consults the rules before its built-in antiderivative.
//
// Usage:
// ```ts
// import { ComputeEngine } from '@cortex-js/compute-engine';
// import { loadIntegrationRules } from '@cortex-js/compute-engine/integration-rules';
//
// const ce = new ComputeEngine();
// loadIntegrationRules(ce);
// ce.parse('\\int x\\sqrt{1+x}\\,dx').evaluate();
// ```
//
// The loader is synchronous and idempotent per engine.

export const version = '{{SDK_VERSION}}';

export { loadIntegrationRules } from './compute-engine/rubi/loader';

export type {
  IntegrationRulesLoadOptions,
  IntegrationRulesLoadReport,
} from './compute-engine/rubi/loader';
