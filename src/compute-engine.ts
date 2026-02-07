// This file is the root of the `compute-engine` package
// (i.e. the `compute-engine.js` and `compute-engine.esm.js` files).
// It exports the implementations of the `ComputeEngine` class.
// The necessary types are exported from `/compute-engine/types.ts`.

export const version = '{{SDK_VERSION}}';

import { ComputeEngine } from './compute-engine/index';
export { ComputeEngine } from './compute-engine/index';

export * from './compute-engine/types';

// Export compilation types and classes for advanced users
export type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  CompilationOptions,
  CompiledExecutable,
  LanguageTarget,
  TargetSource,
  CompiledFunction,
} from './compute-engine/compilation/types';

export { JavaScriptTarget } from './compute-engine/compilation/javascript-target';
export { GLSLTarget } from './compute-engine/compilation/glsl-target';
export { BaseCompiler } from './compute-engine/compilation/base-compiler';

export { expand } from './compute-engine/boxed-expression/expand';
export { compile } from './compute-engine/compilation/compile-expression';

globalThis[Symbol.for('io.cortexjs.compute-engine')] = {
  ComputeEngine: ComputeEngine.prototype.constructor,
  version: '{{SDK_VERSION}}',
};
