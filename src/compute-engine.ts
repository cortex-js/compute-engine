// This file is the root of the `compute-engine` package
// (i.e. the `compute-engine.js` and `compute-engine.esm.js` files).
// It exports the implementations of the `ComputeEngine` class.
// The necessary types are exported from `/compute-engine/types.ts`.

export const version = '{{SDK_VERSION}}';

import { ComputeEngine } from './compute-engine/index';
export { ComputeEngine } from './compute-engine/index';

export type * from './compute-engine/types';

// Export compilation types and classes for advanced users
export type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  CompilationOptions,
  CompilationResult,
  ExecutableTarget,
  ComplexResult,
  CompiledRunner,
  ExpressionRunner,
  LambdaRunner,
  LanguageTarget,
  TargetSource,
  CompiledFunction,
} from './compute-engine/compilation/types';

export { JavaScriptTarget } from './compute-engine/compilation/javascript-target';
export { GPUShaderTarget } from './compute-engine/compilation/gpu-target';
export { GLSLTarget } from './compute-engine/compilation/glsl-target';
export { WGSLTarget } from './compute-engine/compilation/wgsl-target';
export { PythonTarget } from './compute-engine/compilation/python-target';
export { IntervalJavaScriptTarget } from './compute-engine/compilation/interval-javascript-target';
export { IntervalGLSLTarget } from './compute-engine/compilation/interval-glsl-target';
export { IntervalWGSLTarget } from './compute-engine/compilation/interval-wgsl-target';
export { BaseCompiler } from './compute-engine/compilation/base-compiler';

export type {
  Interval,
  IntervalResult,
  BoolInterval,
} from './compute-engine/interval/types';

// Free functions backed by a lazily-instantiated global engine
export {
  parse,
  simplify,
  evaluate,
  N,
  declare,
  assign,
  expand,
  expandAll,
  factor,
  solve,
  compile,
  getDefaultEngine,
} from './compute-engine/free-functions';

export {
  isExpression,
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isTensor,
  isDictionary,
  isCollection,
  isIndexedCollection,
  numericValue,
  isBoxedExpression,
  isBoxedNumber,
  isBoxedSymbol,
  isBoxedFunction,
  isBoxedString,
  isBoxedTensor,
} from './compute-engine/boxed-expression/type-guards';

export type { BoxedNumber } from './compute-engine/boxed-expression/boxed-number';
export type { BoxedSymbol } from './compute-engine/boxed-expression/boxed-symbol';
export type { BoxedFunction } from './compute-engine/boxed-expression/boxed-function';
export type { BoxedString } from './compute-engine/boxed-expression/boxed-string';
export type { BoxedTensor } from './compute-engine/boxed-expression/boxed-tensor';

globalThis[Symbol.for('io.cortexjs.compute-engine')] = {
  ComputeEngine: ComputeEngine.prototype.constructor,
  version: '{{SDK_VERSION}}',
};
