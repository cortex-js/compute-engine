// This file is the root of the `compute-engine` package
// (i.e. the `compute-engine.js` and `compute-engine.esm.js` files).
//
// It includes the MathJSON library as well as the Compute Engine.
//
// The MathJSON library is also available separately if the whole
// Compute Engine is not required.

export * from './compute-engine/public';

export const version = '{{SDK_VERSION}}';

import { ComputeEngine } from './compute-engine/compute-engine';
export { ComputeEngine } from './compute-engine/compute-engine';

export { terminal } from './common/terminal';
export {
  highlightCodeSpan,
  highlightCodeBlock,
} from './common/syntax-highlighter';

globalThis[Symbol.for('io.cortexjs.compute-engine')] = {
  ComputeEngine: ComputeEngine.prototype.constructor,
  version: '{{SDK_VERSION}}',
};
