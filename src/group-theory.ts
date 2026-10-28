// Entry point for @cortex-js/compute-engine/group-theory.
// Load native permutation, bounded finite-group, matrix and polycyclic operations.
// The default library remains unchanged.
//
// Usage:
// import { ComputeEngine } from '@cortex-js/compute-engine';
// import { loadGroupTheory } from '@cortex-js/compute-engine/group-theory';
// const ce = new ComputeEngine();
// loadGroupTheory(ce);
// ce.box(['PermutationOrder', ['Permutation', ['List', 2, 3, 1]]]).evaluate();
//
// Loading is synchronous and idempotent per engine with equal effective options.
export const version = '{{SDK_VERSION}}';
export { loadGroupTheory } from './compute-engine/library/group-theory.js';
export type {
  GroupTheoryLoadOptions,
  GroupTheoryLoadReport,
} from './compute-engine/library/group-theory.js';
