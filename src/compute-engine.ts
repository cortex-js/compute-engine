// This file is the root of the `compute-engine` package
// (i.e. the `compute-engine.js` and `compute-engine.esm.js` files)
// It includes the MathJSON library as well as the Compute Engine.
// The MathJSON library is also available separately if the whole
// Compute Engine i s not required.

export * from './public';

export { LatexSyntax, parse, serialize } from './math-json';

// Compute Engine
export {
  ComputeEngine,
  format,
  evaluate,
} from './compute-engine/compute-engine';
export { match, substitute } from './compute-engine/patterns';

export const version = '{{SDK_VERSION}}';
