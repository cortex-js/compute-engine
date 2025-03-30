// This file is the root of the `compute-engine` package
// (i.e. the `compute-engine.js` and `compute-engine.esm.js` files).
// It exports the implementations of the `ComputeEngine` class.
// The necessary types are exported from `/compute-engine/types.ts`.

export const version = '{{SDK_VERSION}}';

import { ComputeEngine } from './compute-engine/index';
export { ComputeEngine } from './compute-engine/index';

export * from './compute-engine/types';

globalThis[Symbol.for('io.cortexjs.compute-engine')] = {
  ComputeEngine: ComputeEngine.prototype.constructor,
  version: '{{SDK_VERSION}}',
};
