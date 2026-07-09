// Entry point for the `@cortex-js/compute-engine/identities` sub-path.
// Curated mathematical identities and special values (Fungrim corpus,
// Phase 1) loadable as simplification/solve rules into a ComputeEngine.
//
// Usage:
// ```ts
// import { ComputeEngine } from '@cortex-js/compute-engine';
// import { loadIdentities } from '@cortex-js/compute-engine/identities';
//
// const ce = new ComputeEngine();
// const report = loadIdentities(ce, { topics: ['gamma'] });
// ce.parse('\\Gamma(\\frac12)').simplify(); // → √π
// ```
//
// The loader is synchronous and idempotent per engine. It only uses the
// public engine API (the engine instance is passed as an argument), so this
// bundle shares no engine code with the main entry point.

export const version = '{{SDK_VERSION}}';

export {
  loadIdentities,
  FUNGRIM_CORE,
} from './compute-engine/fungrim/loader.js';

export type {
  // Public-facing aliases
  IdentitiesLoadOptions,
  IdentitiesLoadReport,
  IdentitiesRuleData,
  IdentitiesGuardUndecidedHandler,
  // Internal (fungrim-named) types, exported for completeness
  FungrimLoadOptions,
  FungrimLoadReport,
  FungrimRuleData,
  FungrimGuardUndecidedHandler,
  FungrimManifest,
  FungrimShellDeclaration,
  FungrimRuleClass,
  FungrimRuleTarget,
  FungrimMathJson,
  CompiledFungrimRule,
  GuardSpec,
} from './compute-engine/fungrim/types.js';
