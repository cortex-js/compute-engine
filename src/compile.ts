// Entry point for the `@cortex-js/compute-engine/compile` sub-path.
// The compilation of mathematical expressions.

export const version = '{{SDK_VERSION}}';

// The compile() function — takes an Expression and produces code
export {
  compile,
  canCompile,
} from './compute-engine/compilation/compile-expression.js';
export type { CanCompileResult } from './compute-engine/compilation/compile-expression.js';

// Types
export type {
  CompilationOptions,
  CompilationResult,
  ComplexResult,
  RunnerListInput,
  CompiledColor,
  CompiledColorSpace,
  CompiledValue,
  CompiledRunner,
  ExpressionRunner,
  LambdaRunner,
  CompileDiagnostic,
  CompileDiagnosticKind,
  ParallelLoopFallbackReason,
  StorageHint,
  StorageKind,
} from './compute-engine/compilation/types.js';
