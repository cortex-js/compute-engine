// Entry point for the `@cortex-js/compute-engine/compile` sub-path.
// Compilation targets for mathematical expressions.

export const version = '{{SDK_VERSION}}';

// The compile() function — takes a BoxedExpression and produces code
export { compile } from './compute-engine/compilation/compile-expression';

// Built-in compilation targets
export { JavaScriptTarget } from './compute-engine/compilation/javascript-target';
export { GPUShaderTarget } from './compute-engine/compilation/gpu-target';
export { GLSLTarget } from './compute-engine/compilation/glsl-target';
export { WGSLTarget } from './compute-engine/compilation/wgsl-target';
export { PythonTarget } from './compute-engine/compilation/python-target';
export { IntervalJavaScriptTarget } from './compute-engine/compilation/interval-javascript-target';
export { BaseCompiler } from './compute-engine/compilation/base-compiler';

// Types
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
