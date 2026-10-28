// Full package entry point — re-exports all sub-paths + convenience free functions
// `@cortex-js/compute-engine`

export const version = '{{SDK_VERSION}}';

// ── Core engine ─────────────────────────────────────────────────────
import { ComputeEngine as ComputeEngineImpl } from './compute-engine/index.js';
import type { IComputeEngine } from './compute-engine/types.js';

/** The constructor (and statics) of {@link ComputeEngine}. */
export interface ComputeEngineConstructor {
  new (
    options?: ConstructorParameters<typeof ComputeEngineImpl>[0]
  ): ComputeEngine;
  getStandardLibrary: typeof ComputeEngineImpl.getStandardLibrary;
}

/**
 * The `ComputeEngine` value is the engine constructor; the `ComputeEngine`
 * type is the structural `IComputeEngine` interface. Exporting the interface
 * (rather than the class, whose private fields make its type nominal) keeps
 * `new ComputeEngine()` and `expr.engine` mutually assignable without casts.
 */
export const ComputeEngine: ComputeEngineConstructor = ComputeEngineImpl;
export type ComputeEngine = IComputeEngine;

export type * from './compute-engine/types.js';

// ── LaTeX syntax ────────────────────────────────────────────────────
import { LatexSyntax } from './compute-engine/latex-syntax/latex-syntax.js';
export {
  LatexSyntax,
  parse as parseLatex,
  serialize as serializeLatex,
} from './compute-engine/latex-syntax/latex-syntax.js';

// ── Wire up LatexSyntax so all ComputeEngine instances can lazily create one ──
ComputeEngineImpl._latexSyntaxFactory = () => new LatexSyntax();

import {
  _setDefaultEngineFactory,
  compile,
} from './compute-engine/free-functions.js';

// ── Wire up the default engine factory with LatexSyntax ─────────────

_setDefaultEngineFactory(
  () => new ComputeEngineImpl({ latexSyntax: new LatexSyntax() })
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
// Thrown when an evaluation exceeds a `ce.withTimeLimit` span or `ce.iterationLimit`
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
  RunnerListInput,
  StorageBufferBinding,
  StorageBufferLayout,
  CompiledColor,
  CompiledColorSpace,
  CompiledValue,
  CompiledRunner,
  ExpressionRunner,
  LambdaRunner,
  LanguageTarget,
  TargetSource,
  CompiledFunction,
  FieldFunctionOptions,
  FieldFunctionParameter,
  FieldFunctionResult,
  CompileDiagnostic,
  CompileDiagnosticKind,
  StorageHint,
  StorageKind,
} from './compute-engine/compilation/types.js';

export { JavaScriptTarget } from './compute-engine/compilation/javascript-target.js';
export { GPUShaderTarget } from './compute-engine/compilation/gpu-target.js';
export { GLSLTarget } from './compute-engine/compilation/glsl-target.js';
export { WGSLTarget } from './compute-engine/compilation/wgsl-target.js';
export { PythonTarget } from './compute-engine/compilation/python-target.js';
export { IntervalJavaScriptTarget } from './compute-engine/compilation/interval-javascript-target.js';
export { BaseCompiler } from './compute-engine/compilation/base-compiler.js';

// The engine module knows only `javascript` and `interval-js`
// (`engine-compilation-targets.ts` says why: the `./core` entry must not
// carry the GPU and Python targets). This full entry adds the three others to
// the program-wide table of defaults, which every engine reads on each
// lookup: every engine of the program, one made earlier from `./core`
// included (such as the default engine the free functions cache), and every
// engine of `./epsil` and of the CLI, has all five targets from here on. The
// source-only Python target produces `.code` and no `run`.
import { addDefaultCompilationTarget } from './compute-engine/engine-compilation-targets.js';
import { GLSLTarget as _GLSLTarget } from './compute-engine/compilation/glsl-target.js';
import { WGSLTarget as _WGSLTarget } from './compute-engine/compilation/wgsl-target.js';
import { PythonTarget as _PythonTarget } from './compute-engine/compilation/python-target.js';
addDefaultCompilationTarget('glsl', () => new _GLSLTarget());
addDefaultCompilationTarget('wgsl', () => new _WGSLTarget());
addDefaultCompilationTarget('python', () => new _PythonTarget());

// ── Interval types ──────────────────────────────────────────────────
export type {
  Interval,
  IntervalResult,
  BoolInterval,
} from './compute-engine/interval/types.js';

// ── Batch evaluation of compiled functions (`result.broadcast()`) ───
export {
  INTERVAL_KIND,
  type IntervalKindCode,
} from './compute-engine/compilation/broadcast.js';
export type {
  BroadcastInputs,
  BroadcastOptions,
  BroadcastAsyncOptions,
  BroadcastAsyncReason,
  BroadcastAsyncResult,
  BroadcastAsyncRoute,
} from './compute-engine/compilation/types.js';

// ── Worker pool for `result.broadcastAsync()` (`ce.workers`) ────────
export {
  createKernelPool,
  defaultPoolSize,
  type KernelPool,
  type KernelPoolOptions,
  type WorkerLike,
} from './compute-engine/kernel-pool.js';

// ── Free functions (accept string | MathJSON | Expression) ─────
// `compile` is also imported as a value so it can be placed on the global
// registration slot below — bundle-external consumers (which may only
// `import type` from this package) need the standalone wrapper, not just
// `ce.compile()`, because the escalation retry, deprecation warnings and
// alias normalization live in the wrapper.
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
  factorDetailed,
  solve,
  compile,
  getDefaultEngine,
} from './compute-engine/free-functions.js';
export type { FreeFunctionOptions } from './compute-engine/free-functions.js';
export type {
  FactorOptions,
  FactorizationResult,
  FactorStatistics,
} from './compute-engine/factoring-types.js';

// ── Explanations (see `expr.explain()`) ─────────────────────────────
export {
  registerStepLabels,
  labelFor,
} from './compute-engine/boxed-expression/explain-labels.js';
export type { StepLabel } from './compute-engine/boxed-expression/explain-labels.js';

// ── Binder authoring (the `scoped` binding-site selectors) ──────────
// The vocabulary an operator definition uses to declare which of its operands
// are its bound variables. See `OperatorDefinitionFlags.scoped`; the
// `BindingSite`/`BindingSiteSelector` types come from `./types.js` above.
export {
  operandSites,
  operandsFrom,
  indexingSetSites,
  limitsIndexSites,
  lambdaParamSites,
} from './compute-engine/boxed-expression/binding-sites.js';

// ── Value kinds (the `arithmetic` field of an operator definition) ──
// A cache for the hooks of a value kind: the payload of a kind value (a call
// of its head) is decoded once for each boxed expression.
export { decodedPayload } from './compute-engine/boxed-expression/decoded-payload.js';

// ── Type guards ─────────────────────────────────────────────────────
import {
  isExpression,
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isCharacter,
  isTensor,
  isDictionary,
  isObject,
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
  isCharacter,
  isTensor,
  isDictionary,
  isObject,
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
export type { BoxedCharacter } from './compute-engine/boxed-expression/boxed-character.js';
export type { BoxedObject } from './compute-engine/boxed-expression/boxed-object.js';

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
// ones should not change meaning or be removed. The documented, typed form of
// this contract is `ComputeEngineGlobal` below.
const COMPUTE_ENGINE_GLOBAL: ComputeEngineGlobal = {
  ComputeEngine,
  version: '{{SDK_VERSION}}',
  LatexSyntax,
  LATEX_DICTIONARY,
  // Runtime type guards (structural — safe across bundle copies)
  isExpression,
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isCharacter,
  isTensor,
  isDictionary,
  isObject,
  isCollection,
  isIndexedCollection,
  numericValue,
  sym,
  // Standalone `compile()` wrapper (escalation retry, deprecation warnings,
  // alias normalization — none of which exist on the `ce.getCompilationTarget()`
  // route). Same category as `LatexSyntax`: a value export a bundle-external
  // consumer must discover at runtime.
  compile,
};

/**
 * The object that this bundle stores on `globalThis` under the key
 * `Symbol.for('io.cortexjs.compute-engine')` when it loads. A page that
 * loads the Compute Engine with a `<script>` tag, next to a component built
 * against another copy of the bundle, can find the engine through this slot
 * without importing it:
 *
 * ```ts
 * const ce = (globalThis as any)[Symbol.for('io.cortexjs.compute-engine')] as
 *   ComputeEngineGlobal | undefined;
 * const engine = ce ? new ce.ComputeEngine() : undefined;
 * ```
 *
 * The contract is additive: a later version can add a member, but a member
 * keeps its meaning and is not removed. Test each member you use before
 * calling it, since an older bundle can lack a newer one. When several copies
 * of the bundle load, the last one to load owns the slot. The main entry
 * point (`@cortex-js/compute-engine`) stores it, and so does the Epsil entry
 * point (`/epsil`), which re-exports it; `/core` and the other entry points
 * do not.
 *
 * The interface is written out, rather than derived from the stored object,
 * so that a change to the object cannot change the public contract by
 * accident. `ComputeEngine` has the public constructor type, so the engine
 * it makes has the type `ComputeEngine` (the `IComputeEngine` interface).
 */
export interface ComputeEngineGlobal {
  ComputeEngine: ComputeEngineConstructor;
  version: string;
  LatexSyntax: typeof LatexSyntax;
  LATEX_DICTIONARY: typeof LATEX_DICTIONARY;
  isExpression: typeof isExpression;
  isNumber: typeof isNumber;
  isSymbol: typeof isSymbol;
  isFunction: typeof isFunction;
  isString: typeof isString;
  isCharacter: typeof isCharacter;
  isTensor: typeof isTensor;
  isDictionary: typeof isDictionary;
  isObject: typeof isObject;
  isCollection: typeof isCollection;
  isIndexedCollection: typeof isIndexedCollection;
  numericValue: typeof numericValue;
  sym: typeof sym;
  compile: typeof compile;
}

(globalThis as Record<symbol, unknown>)[
  Symbol.for('io.cortexjs.compute-engine')
] = COMPUTE_ENGINE_GLOBAL;
