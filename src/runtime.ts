// Entry point for the `@cortex-js/compute-engine/runtime` sub-path.
//
// The runtime for compiled JavaScript, with no engine behind it: run the
// `code` of a `JavaScriptTarget` compilation result anywhere (a page, a
// worker, a server) with only the numerics it calls.

export const version = '{{SDK_VERSION}}';

export {
  createJavaScriptRuntime,
  RUNTIME_VERSION as runtimeVersion,
} from './compute-engine/compilation/javascript-runtime.js';

export type {
  JavaScriptRuntime,
  JavaScriptRuntimeOptions,
  RuntimeFrameInput,
  StoredJavaScript,
} from './compute-engine/compilation/javascript-runtime.js';

export type { RandomSeedFrame } from './compute-engine/numerics/random.js';
