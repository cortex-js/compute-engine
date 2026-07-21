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

import { LATEX_DICTIONARY } from './compute-engine/latex-syntax/dictionary/default-dictionary.js';
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
export type { CancellationCause } from './common/interruptible.js';

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
import {
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
  sym,
} from './compute-engine/boxed-expression/type-guards.js';
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
  sym,
} from './compute-engine/boxed-expression/type-guards.js';

// ── Boxed expression types ──────────────────────────────────────────
export type { BoxedNumber } from './compute-engine/boxed-expression/boxed-number.js';
export type { BoxedSymbol } from './compute-engine/boxed-expression/boxed-symbol.js';
export type { BoxedFunction } from './compute-engine/boxed-expression/boxed-function.js';
export type { BoxedString } from './compute-engine/boxed-expression/boxed-string.js';

export type {
  FunctionProperties,
  FunctionPropertyRecord,
} from './compute-engine/function-properties/index.js';

// ── Global registration ─────────────────────────────────────────────
// The self-registration slot is the only discovery channel that works with
// zero host cooperation (a page that just script-tags the bundle next to a
// standalone consumer element). It carries not just the constructor but the
// value exports a consumer needs to work with boxed expressions from a copy of
// the bundle it did not itself import: the structural type guards, `LatexSyntax`
// and `LATEX_DICTIONARY`. The guards are structural (`_kind` checks, no
// `instanceof`), so a slot-discovered guard from one copy is safe on
// expressions from another. Treat this object's shape as an additive contract —
// consumers feature-detect each name, so new entries can be added but existing
// ones should not change meaning or be removed.
(globalThis as Record<symbol, unknown>)[
  Symbol.for('io.cortexjs.compute-engine')
] = {
  ComputeEngine: ComputeEngine.prototype.constructor,
  version: '{{SDK_VERSION}}',
  LatexSyntax,
  LATEX_DICTIONARY,
  // Runtime type guards (structural — safe across bundle copies)
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
  sym,
};
