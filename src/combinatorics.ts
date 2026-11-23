// Entry point for @cortex-js/compute-engine/combinatorics.
// Load combinatorial statistics over the engine's own lists: a permutation is
// its one-line list, an integer partition a list of non-increasing parts. The
// default library remains unchanged.
//
// Usage:
// import { ComputeEngine } from '@cortex-js/compute-engine';
// import { loadCombinatorics } from '@cortex-js/compute-engine/combinatorics';
// const ce = new ComputeEngine();
// loadCombinatorics(ce, { areas: ['permutations'] });
// ce.expr(['MajorIndex', ['List', 3, 1, 2]]).evaluate(); // 1
//
// Loading is synchronous and idempotent per engine. Importing has no side effects.
export const version = '{{SDK_VERSION}}';
export { loadCombinatorics } from './compute-engine/combinatorics/loader.js';
export type {
  CombinatoricsArea,
  CombinatoricsLoadOptions,
  CombinatoricsLoadReport,
} from './compute-engine/combinatorics/loader.js';
