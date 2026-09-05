// This is the root of the package for the Epsil language.
// It include everything that's needed to parse, serialize and execute Epsil.

export * from './math-json/types.js';

// export { Expression } from './public';

//
// 1/ Compute Engine
//
export { ComputeEngine } from './compute-engine.js';

//
// 2/ The Epsil language
//
export { parseEpsil } from './epsil/parse-epsil.js';
export { serializeEpsil } from './epsil/serialize-epsil.js';
export { executeEpsil } from './epsil/execute-epsil.js';
export { resolveLibraryNames } from './epsil/resolve-library-names.js';
export {
  canonicalLibraryName,
  epsilLibraryNames,
  epsilNameOf,
} from './epsil/library-names.js';
export type {
  ExecuteEpsilOptions,
  ExecuteEpsilResult,
} from './epsil/execute-epsil.js';
export type { CancellationCause } from './common/interruptible.js';

export const version = '{{SDK_VERSION}}';
