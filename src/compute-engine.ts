// Full package entry point — re-exports all sub-paths + convenience free functions
// `@cortex-js/compute-engine`

export const version = '{{SDK_VERSION}}';

// ── Core engine ─────────────────────────────────────────────────────
import { ComputeEngine } from './compute-engine/index.js';
export { ComputeEngine } from './compute-engine/index.js';

export type * from './compute-engine/types.js';

// ── LaTeX syntax ────────────────────────────────────────────────────
import { LatexSyntax } from './compute-engine/latex-syntax/latex-syntax.js';
export {
  LatexSyntax,
  parse as parseLatex,
  serialize as serializeLatex,
} from './compute-engine/latex-syntax/latex-syntax.js';

// ── Wire up LatexSyntax so all ComputeEngine instances can lazily create one ──
ComputeEngine._latexSyntaxFactory = () => new LatexSyntax();

// ── Wire up the default engine factory with LatexSyntax ─────────────
import { _setDefaultEngineFactory } from './compute-engine/free-functions.js';
_setDefaultEngineFactory(
  () => new ComputeEngine({ latexSyntax: new LatexSyntax() })
);

export {
  LATEX_DICTIONARY,
  CORE_DICTIONARY,
  SYMBOLS_DICTIONARY,
  ALGEBRA_DICTIONARY,
  ARITHMETIC_DICTIONARY,
  COMPLEX_DICTIONARY,
  TRIGONOMETRY_DICTIONARY,
  CALCULUS_DICTIONARY,
  LINEAR_ALGEBRA_DICTIONARY,
  STATISTICS_DICTIONARY,
  LOGIC_DICTIONARY,
  SETS_DICTIONARY,
  INEQUALITIES_DICTIONARY,
  UNITS_DICTIONARY,
  OTHERS_DICTIONARY,
  PHYSICS_DICTIONARY,
} from './compute-engine/latex-syntax/dictionary/default-dictionary.js';

// ── Arbitrary-precision arithmetic ──────────────────────────────────
export { BigDecimal } from './big-decimal/index.js';

// ── Execution constraints ───────────────────────────────────────────
// Thrown when an evaluation exceeds `ce.timeLimit` or `ce.iterationLimit`
export { CancellationError } from './common/interruptible.js';

// ── Compilation targets ─────────────────────────────────────────────
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

export { JavaScriptTarget } from './compute-engine/compilation/javascript-target.js';
export { GPUShaderTarget } from './compute-engine/compilation/gpu-target.js';
export { GLSLTarget } from './compute-engine/compilation/glsl-target.js';
export { WGSLTarget } from './compute-engine/compilation/wgsl-target.js';
export { PythonTarget } from './compute-engine/compilation/python-target.js';
export { IntervalJavaScriptTarget } from './compute-engine/compilation/interval-javascript-target.js';
export { BaseCompiler } from './compute-engine/compilation/base-compiler.js';

// ── Interval types ──────────────────────────────────────────────────
export type {
  Interval,
  IntervalResult,
  BoolInterval,
} from './compute-engine/interval/types.js';

// ── Free functions (accept string | MathJSON | BoxedExpression) ─────
export {
  parse,
  expr,
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
} from './compute-engine/free-functions.js';
export type { FreeFunctionOptions } from './compute-engine/free-functions.js';

// ── Explanations (see `expr.explain()`) ─────────────────────────────
export {
  registerStepLabels,
  labelFor,
} from './compute-engine/boxed-expression/explain-labels.js';
export type { StepLabel } from './compute-engine/boxed-expression/explain-labels.js';

// ── Type guards ─────────────────────────────────────────────────────
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
} from './compute-engine/boxed-expression/type-guards.js';

// ── Boxed expression types ──────────────────────────────────────────
export type { BoxedNumber } from './compute-engine/boxed-expression/boxed-number.js';
export type { BoxedSymbol } from './compute-engine/boxed-expression/boxed-symbol.js';
export type { BoxedFunction } from './compute-engine/boxed-expression/boxed-function.js';
export type { BoxedString } from './compute-engine/boxed-expression/boxed-string.js';
export type { BoxedTensor } from './compute-engine/boxed-expression/boxed-tensor.js';

export type {
  FunctionProperties,
  FunctionPropertyRecord,
} from './compute-engine/function-properties/index.js';

// ── Global registration ─────────────────────────────────────────────
(globalThis as Record<symbol, unknown>)[
  Symbol.for('io.cortexjs.compute-engine')
] = {
  ComputeEngine: ComputeEngine.prototype.constructor,
  version: '{{SDK_VERSION}}',
};
