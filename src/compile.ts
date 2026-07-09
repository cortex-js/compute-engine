// Entry point for the `@cortex-js/compute-engine/compile` sub-path.
// Compilation targets for mathematical expressions.

export const version = '{{SDK_VERSION}}';

// The compile() function — takes a BoxedExpression and produces code
export { compile } from './compute-engine/compilation/compile-expression.js';

// Built-in compilation targets
export { JavaScriptTarget } from './compute-engine/compilation/javascript-target.js';
export { GPUShaderTarget } from './compute-engine/compilation/gpu-target.js';
export { GLSLTarget } from './compute-engine/compilation/glsl-target.js';
export { WGSLTarget } from './compute-engine/compilation/wgsl-target.js';
export { PythonTarget } from './compute-engine/compilation/python-target.js';
export { IntervalJavaScriptTarget } from './compute-engine/compilation/interval-javascript-target.js';
export { IntervalGLSLTarget } from './compute-engine/compilation/interval-glsl-target.js';
export { BaseCompiler } from './compute-engine/compilation/base-compiler.js';

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
} from './compute-engine/compilation/types.js';
