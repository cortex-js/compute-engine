// This file is the root of the `compute-engine` package
// (i.e. the `compute-engine.js` and `compute-engine.esm.js` files).
//
// It includes the MathJSON library as well as the Compute Engine.
//
// The MathJSON library is also available separately if the whole
// Compute Engine is not required.

export * from './compute-engine/public';

export { ComputeEngine } from './compute-engine/compute-engine';

export const version = '{{SDK_VERSION}}';

export { getVars } from './compute-engine/boxed-expression/utils';
