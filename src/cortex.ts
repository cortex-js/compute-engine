// This is the root of the package for the Cortex language.
// It include everything that's needed to parse, serialize and execute Cortex.

export * from './math-json/types.js';

// export { Expression } from './public';

//
// 1/ Compute Engine
//
export { ComputeEngine } from './compute-engine.js';

//
// 2/ The Cortex language
//
export { parseCortex } from './cortex/parse-cortex.js';
export { serializeCortex } from './cortex/serialize-cortex.js';
export { executeCortex } from './cortex/execute-cortex.js';
export type {
  ExecuteCortexOptions,
  ExecuteCortexResult,
} from './cortex/execute-cortex.js';

export const version = '{{SDK_VERSION}}';
