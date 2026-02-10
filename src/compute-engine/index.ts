import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import {
  Type,
  TypeResolver,
  TypeString,
} from '../common/type/types';
import { BoxedType } from '../common/type/boxed-type';
import { typeToString } from '../common/type/serialize';

import type { OneOf } from '../common/one-of';
import { hidePrivateProperties } from '../common/utils';

import type { ConfigurationChangeListener } from '../common/configuration-change';

import type {
  Expression,
  MathJsonSymbol,
  MathJsonNumberObject,
} from '../math-json/types';

import {
  MACHINE_PRECISION,
  MAX_BIGINT_DIGITS,
  SMALL_INTEGER,
} from './numerics/numeric';

import type {
  ValueDefinition,
  OperatorDefinition,
  AngularUnit,
  AssignValue,
  AssumeResult,
  BoxedExpression,
  BoxedRule,
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  Metadata,
  Rule,
  Scope,
  EvalContext,
  SemiBoxedExpression,
  IComputeEngine,
  BoxedDefinition,
  SymbolDefinition,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
  LibraryDefinition,
} from './global-types';

import type {
  LatexDictionaryEntry,
  LatexString,
  LibraryCategory,
  ParseLatexOptions,
} from './latex-syntax/types';
import {
  type IndexedLatexDictionary,
} from './latex-syntax/dictionary/definitions';
import { parse } from './latex-syntax/parse';
import { asLatexString, isLatexString } from './latex-syntax/utils';

import { getStandardLibrary } from './library/library';

import { DEFAULT_COST_FUNCTION } from './cost-function';

import type { BigNum, Rational } from './numerics/types';
import { isMachineRational, isRational } from './numerics/rationals';
import {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from './numeric-value/types';
import { ExactNumericValue } from './numeric-value/exact-numeric-value';
import { BigNumericValue } from './numeric-value/big-numeric-value';
import { MachineNumericValue } from './numeric-value/machine-numeric-value';

import { box, boxFunction, formToInternal } from './boxed-expression/box';
import type { FormOption } from './types-serialization';
import { isValueDef, isOperatorDef } from './boxed-expression/utils';
import { boxRules } from './boxed-expression/rules';
import { validatePattern } from './boxed-expression/boxed-patterns';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedFunction } from './boxed-expression/boxed-function';
import { _BoxedExpression } from './boxed-expression/abstract-boxed-expression';
import { _BoxedOperatorDefinition } from './boxed-expression/boxed-operator-definition';
import {
  HARMONIZATION_RULES,
  UNIVARIATE_ROOTS,
} from './boxed-expression/solve';
import {
  factor,
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
} from './boxed-expression/factor';

// To avoid circular dependencies, serializeToJson is forward declared. Type
// to import it.
import './boxed-expression/serialize';
import { SIMPLIFY_RULES } from './symbolic/simplify-rules';

import { bigint } from './numerics/bigint';

import {
  lookupDefinition as lookupDefinitionImpl,
  declareSymbolValue as declareSymbolValueImpl,
  declareSymbolOperator as declareSymbolOperatorImpl,
  getSymbolValue as getSymbolValueImpl,
  setSymbolValue as setSymbolValueImpl,
  setCurrentContextValue as setCurrentContextValueImpl,
  declareType as declareTypeImpl,
  declareFn as declareFnImpl,
  assignFn as assignFnImpl,
} from './engine-declarations';

import {
  pushScope as pushScopeImpl,
  popScope as popScopeImpl,
  pushEvalContext as pushEvalContextImpl,
  popEvalContext as popEvalContextImpl,
  inScope as inScopeImpl,
  printStack as printStackImpl,
  lookupContext as lookupContextImpl,
  swapContext as swapContextImpl,
} from './engine-scope';

import {
  ask as askImpl,
  verify as verifyImpl,
  assumeFn as assumeFnImpl,
  forget as forgetImpl,
} from './engine-assumptions';

import {
  declareSequence as declareSequenceImpl,
  getSequenceStatus as getSequenceStatusImpl,
  getSequence as getSequenceImpl,
  listSequences as listSequencesImpl,
  isSequence as isSequenceImpl,
  clearSequenceCache as clearSequenceCacheImpl,
  getSequenceCache as getSequenceCacheImpl,
  getSequenceTerms as getSequenceTermsImpl,
  lookupOEIS as lookupOEISImpl,
  checkSequenceOEIS as checkSequenceOEISImpl,
} from './engine-sequences';
import { EngineCacheStore } from './engine-cache';
import {
  type CommonSymbolTable,
  resetCommonSymbols,
} from './engine-common-symbols';
import { CompilationTargetRegistry } from './engine-compilation-targets';
import { EngineConfigurationLifecycle } from './engine-configuration-lifecycle';
import {
  type CommonNumberTable,
  createNumberExpression,
  createSymbolExpression,
} from './engine-expression-entrypoints';
import {
  getLatexDictionaryForDomain,
} from './engine-library-bootstrap';
import { EngineLatexDictionaryState } from './engine-latex-dictionary-state';
import { SimplificationRuleStore } from './engine-simplification-rules';
import { EngineNumericConfiguration } from './engine-numeric-configuration';
import { EngineRuntimeState } from './engine-runtime-state';
import { EngineStartupCoordinator } from './engine-startup-coordinator';
import { createTypeResolver } from './engine-type-resolver';

export * from './global-types';

export { validatePattern };

// Export polynomial factoring functions for advanced users
export {
  factor,
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
};

// Export expression expansion functions
export { expand, expandAll } from './boxed-expression/expand';

// Export compilation types and classes for advanced users
export type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  CompilationOptions,
  CompilationResult,
  LanguageTarget,
  TargetSource,
  CompiledFunction,
} from './compilation/types';

export { JavaScriptTarget } from './compilation/javascript-target';
export { GLSLTarget } from './compilation/glsl-target';
export { PythonTarget } from './compilation/python-target';
export { IntervalJavaScriptTarget } from './compilation/interval-javascript-target';
export { IntervalGLSLTarget } from './compilation/interval-glsl-target';
export { BaseCompiler } from './compilation/base-compiler';

// Import for internal use
import type { LanguageTarget } from './compilation/types';
import { compile as _compile } from './compilation/compile-expression';
import { fu as _fu } from './symbolic/fu';

/**
 *
 * To use the Compute Engine, create a `ComputeEngine` instance:
 *
 * ```js
 * ce = new ComputeEngine();
 * ```
 *
 * If using a mathfield, use the default Compute Engine instance from the
 * `MathfieldElement` class:
 *
 * ```js
 * ce = MathfieldElement.computeEngine
 * ```
 *
 * Use the instance to create boxed expressions with `ce.parse()` and `ce.box()`.
 *
 * ```js
 * const ce = new ComputeEngine();
 *
 * let expr = ce.parse("e^{i\\pi}");
 * console.log(expr.N().latex);
 * // ➔ "-1"
 *
 * expr = ce.box(["Expand", ["Power", ["Add", "a", "b"], 2]]);
 * console.log(expr.evaluate().latex);
 * // ➔ "a^2 +  2ab + b^2"
 * ```
 *
 * @category Compute Engine
 *
 */
export class ComputeEngine implements IComputeEngine {
  // Common symbols
  readonly True: BoxedExpression;
  readonly False: BoxedExpression;
  readonly Pi: BoxedExpression;
  readonly E: BoxedExpression;
  readonly Nothing: BoxedExpression;

  // Common numbers
  readonly Zero: BoxedExpression;
  readonly One: BoxedExpression;
  readonly Half: BoxedExpression;
  readonly NegativeOne: BoxedExpression;
  readonly Two: BoxedExpression;
  readonly I: BoxedExpression;
  readonly NaN: BoxedExpression;
  readonly PositiveInfinity: BoxedExpression;
  readonly NegativeInfinity: BoxedExpression;
  readonly ComplexInfinity: BoxedExpression;

  /** The symbol separating the whole part of a number from its fractional
   *  part in a LaTeX string.
   *
   * Commonly a period (`.`) in English, but a comma (`,`) in many European
   * languages. For the comma, use `"{,}"` so that the spacing is correct.
   *
   * Note that this is a LaTeX string and is used when parsing or serializing
   * LaTeX. MathJSON always uses a period.
  *
  * */
  decimalSeparator: LatexString = '.';

  /** @internal */
  private _numericConfiguration: EngineNumericConfiguration;

  /** @internal */
  private _cacheStore = new EngineCacheStore();

  /** @internal Runtime execution limits and verification mode state */
  private _runtimeState = new EngineRuntimeState();

  /** @internal Configuration change generation/tracking lifecycle */
  private _configurationLifecycle = new EngineConfigurationLifecycle();

  /** @internal */
  private _cost?: (expr: BoxedExpression) => number;

  /** @internal Backing state for simplificationRules */
  private _simplificationRules = new SimplificationRuleStore([
    ...SIMPLIFY_RULES,
  ]);

  /** @internal Registry of compilation targets */
  private _compilationTargets = new CompilationTargetRegistry();

  /** @internal Fu trigonometric simplification algorithm */
  _fuAlgorithm = _fu;

  /** @internal */
  private _commonSymbols: CommonSymbolTable = {
    Pi: null,

    True: null,
    False: null,

    All: null,
    Nothing: null,
    None: null,
    Undefined: null,

    ImaginaryUnit: null,
    ExponentialE: null,
  };

  /** @internal */
  private _commonNumbers: CommonNumberTable = {
    '-5': null,
    '-4': null,
    '-3': null,
    '-2': null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
    7: null,
    8: null,
    9: null,
    10: null,
    11: null,
    12: null,
    36: null,
  };

  /**
   * The stack of evaluation contexts.
   *
   * An **evaluation context** contains bindings of symbols to their
   * values, assumptions, and the matching scope.
   *
   */
  _evalContextStack: EvalContext[] = [];

  /** The current evaluation context */
  get context(): EvalContext {
    return this._evalContextStack[this._evalContextStack.length - 1];
  }

  get contextStack(): ReadonlyArray<EvalContext> {
    return [...this._evalContextStack];
  }

  set contextStack(stack: ReadonlyArray<EvalContext>) {
    this._evalContextStack = [...stack];
  }

  /** @internal */
  get _BIGNUM_NAN(): Decimal {
    return this._numericConfiguration.bignumNaN;
  }

  /** @internal */
  get _BIGNUM_ZERO(): Decimal {
    return this._numericConfiguration.bignumZero;
  }

  /** @internal */
  get _BIGNUM_ONE(): Decimal {
    return this._numericConfiguration.bignumOne;
  }

  /** @internal */
  get _BIGNUM_TWO(): Decimal {
    return this._numericConfiguration.bignumTwo;
  }

  /** @internal */
  get _BIGNUM_HALF(): Decimal {
    return this._numericConfiguration.bignumHalf;
  }

  /** @internal */
  get _BIGNUM_PI(): Decimal {
    return this._numericConfiguration.bignumPi;
  }

  /** @internal */
  get _BIGNUM_NEGATIVE_ONE(): Decimal {
    return this._numericConfiguration.bignumNegativeOne;
  }

  /** @internal */
  get _typeResolver(): TypeResolver {
    return createTypeResolver(this);
  }

  /**
   * Declare a new type in the current scope.
   *
   * By default, types are nominal. To declare a structural type, set
   * `alias` to `true`.
   */
  declareType(
    name: string,
    type: BoxedType | Type | TypeString,
    options?: { alias?: boolean }
  ): void {
    declareTypeImpl(this, name, type, options);
  }

  /**
   * A list of the function calls to the current evaluation context,
   * most recent first.
   */
  get trace(): ReadonlyArray<string> {
    return this._evalContextStack
      .map((ctx) => ctx.name)
      .filter((x) => x !== undefined)
      .reverse();
  }

  /**
   * The generation is incremented each time the context changes.
   * It is used to invalidate caches.
   * @internal
   */
  get _generation(): number {
    return this._configurationLifecycle.generation;
  }

  set _generation(value: number) {
    this._configurationLifecycle.generation = value;
  }

  /** In strict mode (the default) the Compute Engine performs
   * validation of domains and signature and may report errors.
   *
   * These checks may impact performance
   *
   * When strict mode is off, results may be incorrect or generate JavaScript
   * errors if the input is not valid.
   *
   */
  strict: boolean;

  /**
   * Return symbol tables suitable for the specified categories, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A symbol table defines how to evaluate and manipulate symbols.
   *
   */

  /** @internal */
  private _latexDictionaryState = new EngineLatexDictionaryState(() =>
    ComputeEngine.getLatexDictionary()
  );

  static getStandardLibrary(
    categories?: LibraryCategory[] | LibraryCategory | 'all'
  ): readonly LibraryDefinition[] {
    return getStandardLibrary(categories);
  }

  /**
   * Return a LaTeX dictionary suitable for the specified category, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A LaTeX dictionary is needed to translate between LaTeX and MathJSON.
   *
   * Each entry in the dictionary indicate how a LaTeX token (or string of
   * tokens) should be parsed into a MathJSON expression.
   *
   * For example an entry can define that the `\pi` LaTeX token should map to the
   * symbol `"Pi"`, or that the token `-` should map to the function
   * `["Negate",...]` when in a prefix position and to the function
   * `["Subtract", ...]` when in an infix position.
   *
   * Furthermore, the information in each dictionary entry is used to serialize
   * the LaTeX string corresponding to a MathJSON expression.
   *
   * Use with `ce.latexDictionary` to set the dictionary. You can complement
   * it with your own definitions, for example with:
   *
   * ```ts
   * ce.latexDictionary = [
   *  ...ce.getLatexDictionary("all"),
   *  {
   *    kind: "function",
   *    symbolTrigger: "concat",
   *    parse: "Concatenate"
   *  }
   * ];
   * ```
   */

  static getLatexDictionary(
    domain?: LibraryCategory | 'all'
  ): readonly Readonly<LatexDictionaryEntry>[] {
    return getLatexDictionaryForDomain(domain);
  }

  /**
   * Construct a new `ComputeEngine` instance.
   *
   * Symbols tables define functions, constants and variables (in `options.ids`).
   * If no table is provided the MathJSON Standard Library is used (`ComputeEngine.getStandardLibrary()`)
   *
   * The LaTeX syntax dictionary is defined in `options.latexDictionary`.
   *
   * The order of the dictionaries matter: the definitions from the later ones
   * override the definitions from earlier ones. The first dictionary should
   * be the `'core'` dictionary which include basic definitions that are used
   * by later dictionaries.
   *
   *
   * @param options.precision Specific how many digits of precision
   * for the numeric calculations. Default is 300.
   *
   * @param options.tolerance If the absolute value of the difference of two
   * numbers is less than `tolerance`, they are considered equal. Used by
   * `chop()` as well.
   */
  constructor(options?: {
    libraries?: readonly (string | LibraryDefinition)[];
    precision?: number | 'machine';
    tolerance?: number | 'auto';
  }) {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Unexpected argument');

    this.strict = true;

    this._numericConfiguration = new EngineNumericConfiguration({
      precision: options?.precision,
      tolerance: options?.tolerance ?? 'auto',
      angularUnit: 'rad',
    });

    const startup = new EngineStartupCoordinator(this);
    const commonNumbers = startup.initializeCommonNumbers();

    this.Zero = commonNumbers.Zero;
    this.One = commonNumbers.One;
    this.Half = commonNumbers.Half;
    this.NegativeOne = commonNumbers.NegativeOne;
    this.Two = commonNumbers.Two;
    this.NaN = commonNumbers.NaN;
    this.PositiveInfinity = commonNumbers.PositiveInfinity;
    this.NegativeInfinity = commonNumbers.NegativeInfinity;
    this.I = commonNumbers.I;
    this.ComplexInfinity = commonNumbers.ComplexInfinity;

    // Reset the caches/create (precision-dependent) numeric constants
    this._reset();

    // Create the system scope (top-level scope)
    this.pushScope(undefined, 'system');

    // Declare the standard types
    this.declareType('limits', 'expression<Limits>');

    startup.bootstrapLibraries(options?.libraries);

    const commonSymbols = startup.initializeCommonSymbolBindings(
      this._commonSymbols
    );
    this.True = commonSymbols.True;
    this.False = commonSymbols.False;
    this.Pi = commonSymbols.Pi;
    this.E = commonSymbols.E;
    this.Nothing = commonSymbols.Nothing;

    // Push a fresh scope to protect system definitions:
    // this will be the "global" scope
    this.pushScope(undefined, 'global');

    // Register default compilation targets
    this._compilationTargets.registerDefaults();

    hidePrivateProperties(this);
  }

  toJSON() {
    return '[ComputeEngine]';
  }

  [Symbol.toStringTag]: string = 'ComputeEngine';

  get latexDictionary(): Readonly<LatexDictionaryEntry[]> {
    return this._latexDictionaryState.dictionary;
  }

  set latexDictionary(dic: Readonly<LatexDictionaryEntry[]>) {
    this._latexDictionaryState.dictionary = dic;
  }

  get _indexedLatexDictionary(): IndexedLatexDictionary {
    return this._latexDictionaryState.indexedDictionary;
  }

  /** After the configuration of the engine has changed, clear the caches
   * so that new values can be recalculated.
   *
   * This needs to happen for example when the numeric precision changes.
   *
   * @internal
   */
  _reset(): void {
    this._configurationLifecycle.reset({
      refreshNumericConstants: () => this._numericConfiguration.refreshConstants(),
      resetCommonSymbols: () => resetCommonSymbols(this._commonSymbols),
      purgeCaches: () => this._cacheStore.purgeValues(),
    });
  }

  /** @internal */
  listenToConfigurationChange(
    tracker: ConfigurationChangeListener
  ): () => void {
    return this._configurationLifecycle.listen(tracker);
  }

  /**
   * Register a custom compilation target.
   *
   * This allows you to compile mathematical expressions to different target
   * languages beyond the built-in JavaScript and GLSL targets.
   *
   * @param name - The name of the target (e.g., 'python', 'wgsl', 'matlab')
   * @param target - The LanguageTarget implementation
   *
   * @example
   * ```typescript
   * import { ComputeEngine, GLSLTarget } from '@cortex-js/compute-engine';
   *
   * const ce = new ComputeEngine();
   *
   * // Register a custom target
   * class PythonTarget implements LanguageTarget {
   *   // Implementation...
   * }
   *
   * ce.registerCompilationTarget('python', new PythonTarget());
   *
   * // Use the custom target
   * const expr = ce.parse('x^2 + y^2');
   * const code = compile(expr, { to: 'python' });
   * ```
   */
  registerCompilationTarget(
    name: string,
    target: LanguageTarget<BoxedExpression>
  ): void {
    this._compilationTargets.register(name, target);
  }

  /**
   * Get a registered compilation target by name.
   *
   * @param name - The name of the target (e.g., 'javascript', 'glsl', 'python')
   * @returns The LanguageTarget implementation, or undefined if not found
   */
  getCompilationTarget(
    name: string
  ): LanguageTarget<BoxedExpression> | undefined {
    return this._compilationTargets.get(name);
  }

  /**
   * Return the names of all registered compilation targets.
   *
   * @example
   * ```typescript
   * const ce = new ComputeEngine();
   * console.log(ce.listCompilationTargets());
   * // → ['javascript', 'glsl', 'interval-js', 'interval-glsl']
   * ```
   */
  listCompilationTargets(): string[] {
    return this._compilationTargets.list();
  }

  /**
   * Remove a registered compilation target.
   *
   * @param name - The name of the target to remove
   */
  unregisterCompilationTarget(name: string): void {
    this._compilationTargets.unregister(name);
  }

  /** @internal Compile a boxed expression. */
  _compile(
    expr: BoxedExpression,
    options?: Parameters<typeof _compile>[1]
  ): ReturnType<typeof _compile> {
    return _compile(expr, options);
  }

  get precision(): number {
    return this._numericConfiguration.precision;
  }

  /** The precision, or number of significant digits, of numeric
   * calculations.
   *
   * To make calculations using more digits, at the cost of expanded memory
   * usage and slower computations, set the `precision` higher.
   *
   * Trigonometric operations are accurate for precision up to 1,000.
   *
   * If the precision is set to `machine`, floating point numbers
   * are represented internally as a 64-bit floating point number (as
   * per IEEE 754-2008), with a 52-bit mantissa, which gives about 15
   * digits of precision.
   *
  * If the precision is set to `auto`, the precision is set to a default value.
  *
  */
  set precision(p: number | 'machine' | 'auto') {
    if (!this._numericConfiguration.setPrecision(p)) return;
    this._reset();
  }

  /**
   * The unit used for unitless angles in trigonometric functions.
   *
   * - `rad`: radian, $2\pi$ radians is a full circle
   * - `deg`: degree, 360 degrees is a full circle
   * - `grad`: gradians, 400 gradians is a full circle
   * - `turn`: turn, 1 turn is a full circle
   *
  * Default is `"rad"` (radians).
  */
  get angularUnit(): AngularUnit {
    return this._numericConfiguration.angularUnit;
  }

  set angularUnit(u: AngularUnit) {
    if (!this._numericConfiguration.setAngularUnit(u)) return;
    this._reset();
  }

  /** Throw a `CancellationError` when the duration of an evaluation exceeds
   * the time limit.
   *
   * Time in milliseconds, default 2000 ms = 2 seconds.
   *
   */
  get timeLimit(): number {
    return this._runtimeState.timeLimit;
  }

  set timeLimit(t: number) {
    this._runtimeState.timeLimit = t;
  }

  /** Absolute time beyond which evaluation should not proceed.
   * @internal
   */
  get deadline(): number | undefined {
    return this._runtimeState.deadline;
  }

  set deadline(value: number | undefined) {
    this._runtimeState.deadline = value;
  }

  /** The time after which the time limit has been exceeded */
  get _deadline(): number | undefined {
    return this._runtimeState.deadline;
  }

  set _deadline(value: number | undefined) {
    this._runtimeState.deadline = value;
  }

  get _timeRemaining(): number {
    return this._runtimeState.timeRemaining;
  }

  /** Throw `CancellationError` `iteration-limit-exceeded` when the iteration limit
   * in a loop is exceeded. Default: no limits.
   *
   * @experimental
   */
  get iterationLimit(): number {
    return this._runtimeState.iterationLimit;
  }
  set iterationLimit(t: number) {
    this._runtimeState.iterationLimit = t;
  }

  /** Signal `recursion-depth-exceeded` when the recursion depth for this
   * scope is exceeded.
   *
   * @experimental
   */
  get recursionLimit(): number {
    return this._runtimeState.recursionLimit;
  }
  set recursionLimit(t: number) {
    this._runtimeState.recursionLimit = t;
  }

  /**
   * Flag to prevent infinite recursion in the verify/ask/equality checking cycle.
   *
   * **The Problem:**
   * When verifying equality predicates, a recursion loop can occur:
   * 1. `verify(Equal(x, 0))` evaluates the expression
   * 2. `Equal.evaluate()` calls `eq(x, 0)` to check equality
   * 3. `eq()` calls `ask(['NotEqual', x, 0])` to check assumptions
   * 4. `ask()` calls `verify(NotEqual(x, 0))` as a fallback
   * 5. `verify()` evaluates, calling `eq()` again → infinite loop
   *
   * **The Solution:**
   * - Set `_isVerifying = true` when entering `verify()`
   * - `ask()` skips the `verify()` fallback when `_isVerifying` is true
   * - `Equal/NotEqual` evaluate handlers check this flag to preserve 3-valued
   *   logic in verification mode while still returning False/True in normal mode
   *
   * @see verify() in index.ts
  * @see ask() in index.ts
  * @see eq() in compare.ts
  * @see Equal/NotEqual operators in relational-operator.ts
  */
  /** @internal */
  get _isVerifying(): boolean {
    return this._runtimeState.isVerifying;
  }

  set _isVerifying(value: boolean) {
    this._runtimeState.isVerifying = value;
  }

  /**
   * @internal
   * Indicates whether we're currently inside a verify() call.
   * Used to prevent recursion and to enable 3-valued logic in verification mode.
   */
  get isVerifying(): boolean {
    return this._runtimeState.isVerifying;
  }

  get tolerance(): number {
    return this._numericConfiguration.tolerance;
  }
  /**
   * Values smaller than the tolerance are considered to be zero for the
  * purpose of comparison, i.e. if `|b - a| <= tolerance`, `b` is considered
  * equal to `a`.
  */
  set tolerance(val: number | 'auto') {
    this._numericConfiguration.setTolerance(val);
  }

  /** Replace a number that is close to 0 with the exact integer 0.
   *
   * How close to 0 the number has to be to be considered 0 is determined by {@linkcode tolerance}.
   */
  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex {
    const tolerance = this._numericConfiguration.tolerance;
    if (typeof n === 'number') {
      if (Math.abs(n) <= tolerance) return 0;
      return n;
    }

    if (n instanceof Decimal) {
      if (n.isPositive() && n.lte(this._numericConfiguration.bignumTolerance))
        return 0;
      if (n.isNegative() && n.gte(this._numericConfiguration.negBignumTolerance))
        return 0;
      if (n.isZero()) return 0;
      return n;
    }

    if (
      n instanceof Complex &&
      Math.abs(n.re) <= tolerance &&
      Math.abs(n.im) <= tolerance
    )
      return 0;

    return n;
  }

  /** Create an arbitrary precision number. 
   * 
   * The return value is an object with methods to perform arithmetic
   * operations:
   * - `toNumber()`: convert to a JavaScript `number` with potential loss of precision
   * - `add()`
   * - `sub()`
   * - `neg()` (unary minus)
   * - `mul()`
   * - `div()`
   * - `pow()`
   * - `sqrt()` (square root)
   * - `cbrt()` (cube root)
   * - `exp()`  (e^x)
   * - `log()` 
   * - `ln()` (natural logarithm)
   * - `mod()`

   * - `abs()`
   * - `ceil()`
   * - `floor()`
   * - `round()`

   * - `equals()`
   * - `gt()`
   * - `gte()`
   * - `lt()`
   * - `lte()`
   * 
   * - `cos()`
   * - `sin()`
   * - `tanh()`
   * - `acos()`
   * - `asin()`
   * - `atan()`
   * - `cosh()`
   * - `sinh()`
   * - `acosh()`
   * - `asinh()`
   * - `atanh()`
   * 
   * - `isFinite()`
   * - `isInteger()`
   * - `isNaN()`
   * - `isNegative()`
   * - `isPositive()`
   * - `isZero()`
  * - `sign()` (1, 0 or -1)
  * 
  */
  bignum(a: Decimal.Value | bigint): Decimal {
    return this._numericConfiguration.bignum(a);
  }

  /** Create a complex number.
   * The return value is an object with methods to perform arithmetic
   * operations:
   * - `re` (real part, as a JavaScript `number`)
   * - `im` (imaginary part, as a JavaScript `number`)
   * - `add()`
   * - `sub()`
   * - `neg()` (unary minus)
   * - `mul()`
   * - `div()`
   * - `pow()`
   * - `sqrt()` (square root)
   * - `exp()`  (e^x)
   * - `log()` 
   * - `ln()` (natural logarithm)
   * - `mod()`

   * - `abs()`
   * - `ceil()`
   * - `floor()`
   * - `round()`

   * - `arg()` the angle of the complex number
   * - `inverse()` the inverse of the complex number 1/z
   * - `conjugate()` the conjugate of the complex number

   * - `equals()`
   * 
   * - `cos()`
   * - `sin()`
   * - `tanh()`
   * - `acos()`
   * - `asin()`
   * - `atan()`
   * - `cosh()`
   * - `sinh()`
   * - `acosh()`
   * - `asinh()`
   * - `atanh()`
   * 
   * - `isFinite()`
   * - `isNaN()`
   * - `isZero()`
   * - `sign()` (1, 0 or -1)
   */
  complex(a: number | Decimal | Complex, b?: number | Decimal): Complex {
    if (a instanceof Decimal) a = a.toNumber();
    if (b instanceof Decimal) b = b.toNumber();
    return new Complex(a, b);
  }

  /**
   *
   * Create a Numeric Value.
   *
   * @internal
   */
  _numericValue(
    value:
      | number
      | bigint
      | Complex
      | OneOf<[BigNum | NumericValueData | ExactNumericValueData]>
  ): NumericValue {
    // Convert to an ExactNumericValue if possible
    if (value instanceof NumericValue) return value.asExact ?? value;

    const bignum = (x) => this.bignum(x);
    const makeNumericValue =
      this._numericConfiguration.precision > MACHINE_PRECISION
        ? (x) => new BigNumericValue(x, bignum)
        : (x) => new MachineNumericValue(x, bignum);

    if (typeof value === 'number') {
      if (Number.isInteger(value))
        return new ExactNumericValue(value, makeNumericValue, bignum);
      return makeNumericValue(value);
    }

    if (typeof value === 'bigint')
      return new ExactNumericValue(value, makeNumericValue, bignum);

    if (isRational(value))
      return new ExactNumericValue(
        { rational: value },
        makeNumericValue,
        bignum
      );

    if (value instanceof Decimal) {
      if (value.isInteger() && value.e <= MAX_BIGINT_DIGITS) {
        const n = bigint(value.toString());
        if (n !== null)
          return new ExactNumericValue(n, makeNumericValue, bignum);
      }
      return makeNumericValue(value);
    }

    if (value instanceof Complex) {
      if (value.im === 0) return this._numericValue(value.re);
      return makeNumericValue({ re: value.re, im: value.im });
    }

    //
    // We have a NumericValueData
    //

    if ('im' in value || 're' in value) {
      if (value.im !== undefined && value.im !== 0)
        return makeNumericValue(value);

      // Check if decimal part is an integer
      // console.assert(value.rational === undefined);
      if (value.re instanceof Decimal && value.re.isInteger())
        return new ExactNumericValue(
          {
            rational: [bigint(value.re.toString())!, BigInt(1)],
            // radical: value.radical,
          },
          makeNumericValue,
          bignum
        );
      if (typeof value.re === 'number' && Number.isInteger(value.re))
        return new ExactNumericValue(
          {
            rational: [value.re, 1],
            // radical: value.radical
          },
          makeNumericValue,
          bignum
        );
      return makeNumericValue(value);
    }

    if ('radical' in value || 'rational' in value) {
      // Validate radical part
      if (
        value.radical !== undefined &&
        (!Number.isInteger(value.radical) || value.radical >= SMALL_INTEGER)
      ) {
        throw Error('Unexpected value for radical part:' + value.radical);
      }

      // Validate rational part

      if (value.rational) {
        if (isMachineRational(value.rational)) {
          if (
            !Number.isInteger(value.rational[0]) ||
            !Number.isInteger(value.rational[1])
          )
            // @fixme: this may never happen
            return makeNumericValue(value);
        }
      }

      return new ExactNumericValue(value, makeNumericValue, bignum);
    }
    throw Error('Unexpected value');
  }

  /**
   * The cost function is used to determine the "cost" of an expression. For example, when simplifying an expression, the simplification that results in the lowest cost is chosen.
   */
  get costFunction(): (expr: BoxedExpression) => number {
    return this._cost ?? DEFAULT_COST_FUNCTION;
  }

  set costFunction(fn: ((expr: BoxedExpression) => number) | undefined) {
    if (typeof fn !== 'function') this._cost = DEFAULT_COST_FUNCTION;
    this._cost = fn;
  }

  /**
   * The rules used by `.simplify()` when no explicit `rules` option is passed.
   * Initialized to a copy of the built-in simplification rules.
   *
   * Add custom rules with `push()`:
   * ```ts
   * ce.simplificationRules.push({
   *   match: ['Power', ['Sin', '_x'], 2],
   *   replace: ['Subtract', 1, ['Power', ['Cos', '_x'], 2]],
   * });
   * ```
   *
   * Or replace entirely:
   * ```ts
   * ce.simplificationRules = myCustomRules;
   * ```
   */
  get simplificationRules(): Rule[] {
    return this._simplificationRules.rules;
  }

  set simplificationRules(rules: Rule[]) {
    this._simplificationRules.rules = rules;
    // Invalidate the cached boxed rule set
    this._cacheStore.invalidate('standard-simplification-rules');
  }

  /**
   * Return definition matching the symbol, starting with the current
   * lexical scope and going up the scope chain.
   */
  lookupDefinition(id: MathJsonSymbol): undefined | BoxedDefinition {
    return lookupDefinitionImpl(this, id);
  }

  /**
   * Associate a new definition to a symbol in the current context.
   *
   * For internal use. Use `ce.declare()` instead.
   *
   * @internal
   */
  _declareSymbolValue(
    name: MathJsonSymbol,
    def: Partial<ValueDefinition>,
    scope?: Scope
  ): BoxedDefinition {
    return declareSymbolValueImpl(this, name, def, scope);
  }

  /**
   * Associate a new OperatorDefinition to a function in the current context.
   *
   * For internal use. Use `ce.declare()` instead.
   *
   * @internal
   */
  _declareSymbolOperator(
    name: string,
    def: OperatorDefinition,
    scope?: Scope
  ): BoxedDefinition {
    return declareSymbolOperatorImpl(this, name, def, scope);
  }

  /**
   *
   * Create a new lexical scope and matching evaluation context and add it
   * to the evaluation context stack.
   *
   */
  pushScope(scope?: Scope, name?: string): void {
    pushScopeImpl(this, scope, name);
  }

  /**
   * Remove the most recent scope from the scope stack.
   */
  popScope(): void {
    popScopeImpl(this);
  }

  /** @internal */
  _pushEvalContext(scope: Scope, name?: string): void {
    pushEvalContextImpl(this, scope, name);
  }

  /** @internal */
  _popEvalContext(): void {
    popEvalContextImpl(this);
  }

  /** @internal */
  _inScope<T>(scope: Scope | undefined, f: () => T): T {
    return inScopeImpl(this, scope, f);
  }

  /** @internal */
  _printStack(options?: { details?: boolean; maxDepth?: number }): void {
    printStackImpl(this, options);
  }

  /**
   * Use `ce.box(name)` instead
   * @internal */
  _getSymbolValue(id: MathJsonSymbol): BoxedExpression | undefined {
    return getSymbolValueImpl(this, id);
  }

  /**
   * For internal use. Use `ce.assign(name, value)` instead.
   * @internal
   */
  _setSymbolValue(
    id: MathJsonSymbol,
    value: BoxedExpression | boolean | number | undefined
  ): void {
    setSymbolValueImpl(this, id, value);
  }

  /**
   * Set a value directly in the current context's values map.
   * This is used for assumptions so that the value is scoped to the current
   * evaluation context and is automatically removed when the scope is popped.
   * @internal
   */
  _setCurrentContextValue(
    id: MathJsonSymbol,
    value: BoxedExpression | boolean | number | undefined
  ): void {
    setCurrentContextValueImpl(this, id, value);
  }

  /**
   * Declare a symbol in the current lexical scope: specify their type and
   * other attributes, including optionally a value.
   *
   * Once the type of a symbol has been declared, it cannot be changed.
   * The type information is used to calculate the canonical form of
   * expressions and ensure they are valid. If the type could be changed
   * after the fact, previously valid expressions could become invalid.
   *
   * Set the type to `unknown` if the type is not known yet: it will be
   * inferred based on usage. Use `any` for a very generic type.
   *
   *
   */
  declare(
    id: string,
    def: Type | TypeString | Partial<SymbolDefinition>,
    scope?: Scope
  ): IComputeEngine;
  declare(symbols: {
    [id: string]: Type | TypeString | Partial<SymbolDefinition>;
  }): IComputeEngine;
  declare(
    arg1:
      | string
      | {
          [id: string]: Type | TypeString | Partial<SymbolDefinition>;
        },
    arg2?: Type | TypeString | Partial<SymbolDefinition>,
    scope?: Scope
  ): IComputeEngine {
    return declareFnImpl(this, arg1, arg2, scope);
  }

  /**
   * Declare a sequence with a recurrence relation.
   *
   * @example
   * ```typescript
   * // Fibonacci sequence
   * ce.declareSequence('F', {
   *   base: { 0: 0, 1: 1 },
   *   recurrence: 'F_{n-1} + F_{n-2}',
   * });
   * ce.parse('F_{10}').evaluate();  // → 55
   * ```
   */
  declareSequence(name: string, def: SequenceDefinition): IComputeEngine {
    return declareSequenceImpl(this, name, def);
  }

  /**
   * Get the status of a sequence definition.
   *
   * @example
   * ```typescript
   * ce.parse('F_0 := 0').evaluate();
   * ce.getSequenceStatus('F');
   * // → { status: 'pending', hasBase: true, hasRecurrence: false, baseIndices: [0] }
   * ```
   */
  getSequenceStatus(name: string): SequenceStatus {
    return getSequenceStatusImpl(this, name);
  }

  /**
   * Get information about a defined sequence.
   * Returns `undefined` if the symbol is not a sequence.
   */
  getSequence(name: string): SequenceInfo | undefined {
    return getSequenceImpl(this, name);
  }

  /**
   * List all defined sequences.
   */
  listSequences(): string[] {
    return listSequencesImpl(this);
  }

  /**
   * Check if a symbol is a defined sequence.
   */
  isSequence(name: string): boolean {
    return isSequenceImpl(this, name);
  }

  /**
   * Clear the memoization cache for a sequence.
   * If no name is provided, clears caches for all sequences.
   */
  clearSequenceCache(name?: string): void {
    clearSequenceCacheImpl(this, name);
  }

  /**
   * Get the memoization cache for a sequence.
   * Returns a Map of index → value, or `undefined` if not a sequence or memoization is disabled.
   *
   * For single-index sequences, keys are numbers.
   * For multi-index sequences, keys are comma-separated strings (e.g., '5,2').
   */
  getSequenceCache(
    name: string
  ): Map<number | string, BoxedExpression> | undefined {
    return getSequenceCacheImpl(this, name);
  }

  /**
   * Generate a list of sequence terms from start to end (inclusive).
   *
   * @param name - The sequence name
   * @param start - Starting index (inclusive)
   * @param end - Ending index (inclusive)
   * @param step - Step size (default: 1)
   * @returns Array of BoxedExpressions, or undefined if not a sequence
   *
   * @example
   * ```typescript
   * ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
   * ce.getSequenceTerms('F', 0, 10);
   * // → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
   * ```
   */
  getSequenceTerms(
    name: string,
    start: number,
    end: number,
    step?: number
  ): BoxedExpression[] | undefined {
    return getSequenceTermsImpl(this, name, start, end, step);
  }

  /**
   * Look up sequences in OEIS by their terms.
   *
   * @param terms - Array of sequence terms to search for
   * @param options - Optional configuration (timeout, maxResults)
   * @returns Promise resolving to array of matching sequences
   *
   * @example
   * ```typescript
   * const results = await ce.lookupOEIS([0, 1, 1, 2, 3, 5, 8, 13]);
   * // → [{ id: 'A000045', name: 'Fibonacci numbers', ... }]
   * ```
   */
  lookupOEIS(
    terms: (number | BoxedExpression)[],
    options?: OEISOptions
  ): Promise<OEISSequenceInfo[]> {
    return lookupOEISImpl(this, terms, options);
  }

  /**
   * Check if a defined sequence matches an OEIS sequence.
   *
   * @param name - Name of the defined sequence
   * @param count - Number of terms to check (default: 10)
   * @param options - Optional configuration
   * @returns Promise with match results including OEIS matches and generated terms
   *
   * @example
   * ```typescript
   * ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
   * const result = await ce.checkSequenceOEIS('F', 10);
   * // → { matches: [{ id: 'A000045', name: 'Fibonacci numbers', ... }], terms: [0, 1, 1, ...] }
   * ```
   */
  checkSequenceOEIS(
    name: string,
    count?: number,
    options?: OEISOptions
  ): Promise<{ matches: OEISSequenceInfo[]; terms: number[] }> {
    return checkSequenceOEISImpl(this, name, count, options);
  }

  /**
   * Return an evaluation context in which the symbol is defined.
   */
  lookupContext(id: MathJsonSymbol): EvalContext | undefined {
    return lookupContextImpl(this, id);
  }

  /**  Find the context in the stack frame, and set the stack frame to
   * it. This is used to evaluate expressions in the context of
   * a different scope.
   */
  _swapContext(context: EvalContext): void {
    swapContextImpl(this, context);
  }

  /**
   * Assign a value to a symbol in the current scope.
   * Use `undefined` to reset the symbol to no value.
   *
   * The symbol should be a valid MathJSON symbol not a LaTeX string.
   *
   * If the symbol was not previously declared, it will be declared as a
   * symbol of a type inferred from its value.
   *
   * To more precisely define the type of the symbol, use `ce.declare()`
   * instead, which allows you to specify the type, value and other
   * attributes of the symbol.
   */
  assign(id: string, value: AssignValue): IComputeEngine;
  assign(ids: { [id: string]: AssignValue }): IComputeEngine;
  assign(
    arg1: string | { [id: string]: AssignValue },
    arg2?: AssignValue
  ): IComputeEngine {
    return assignFnImpl(this, arg1, arg2);
  }

  /**
   * Return false if the execution should stop.
   *
   * This can occur if:
   * - an error has been signaled
   * - the time limit or memory limit has been exceeded
   *
  * @internal
  */
  _shouldContinueExecution(): boolean {
    return this._runtimeState.shouldContinueExecution();
  }

  /** @internal */
  _checkContinueExecution(): void {
    if (!this._shouldContinueExecution()) {
      // @todo: should capture stack
      throw new Error('timeout');
    }
  }

  // assert(
  //   condition: boolean,
  //   expr: BoxedExpression,
  //   msg: string,
  //   code?: SignalMessage
  // ) {
  //   if (!condition) this.signal(expr, msg, code);
  // }

  /** @internal */
  _cache<T>(
    cacheName: string,
    build: () => T,
    purge?: (t: T) => T | undefined
  ): T {
    return this._cacheStore.getOrBuild(cacheName, build, purge);
  }

  /** Return a boxed expression from a number, string or semiboxed expression.
   * Calls `ce.function()`, `ce.number()` or `ce.symbol()` as appropriate.
   */
  box(
    expr: NumericValue | SemiBoxedExpression,
    options?: {
      form?: FormOption;
      scope?: Scope | undefined;
    }
  ): BoxedExpression {
    const { canonical, structural } = formToInternal(options?.form);
    return box(this, expr, { canonical, structural, scope: options?.scope });
  }

  function(
    name: string,
    ops: ReadonlyArray<BoxedExpression> | ReadonlyArray<Expression>,
    options?: {
      metadata?: Metadata;
      form?: FormOption;
      scope?: Scope | undefined;
    }
  ): BoxedExpression {
    const { canonical, structural } = formToInternal(options?.form);
    return boxFunction(this, name, ops, {
      metadata: options?.metadata,
      canonical,
      structural,
      scope: options?.scope,
    });
  }

  /**
   *
   * Shortcut for `this.box(["Error",...])`.
   *
   * The result is canonical.
   */
  error(message: string | string[], where?: string): BoxedExpression {
    let msg: BoxedExpression;
    if (typeof message === 'string') msg = this.string(message);
    else
      msg = this.function(
        'ErrorCode',
        message.map((x) => this.string(x))
      );

    let whereExpr: BoxedExpression | undefined = undefined;
    if (where && isLatexString(where)) {
      whereExpr = this.function('LatexString', [
        this.string(asLatexString(where)!),
      ]);
    } else if (typeof where === 'string' && where.length > 0) {
      whereExpr = this.string(where);
    }

    const ops = [this.box(msg)];
    if (whereExpr) ops.push(whereExpr);

    return this.function('Error', ops);
  }

  typeError(
    expected: Type,
    actual: undefined | Type | BoxedType,
    where?: string
  ): BoxedExpression {
    if (actual)
      return this.error(
        ['incompatible-type', typeToString(expected), actual.toString()],
        where
      );
    return this.error(['incompatible-type', typeToString(expected)], where);
  }

  /**
   * Add a `["Hold"]` wrapper to `expr`.
   */
  hold(expr: SemiBoxedExpression): BoxedExpression {
    return this._fn('Hold', [this.box(expr, { form: 'raw' })]);
  }

  /** Shortcut for `this.box(["Tuple", ...])`
   *
   * The result is canonical.
   */
  tuple(...elements: ReadonlyArray<number>): BoxedExpression;
  tuple(...elements: ReadonlyArray<BoxedExpression>): BoxedExpression;
  tuple(...elements: ReadonlyArray<number | BoxedExpression>): BoxedExpression {
    return new BoxedFunction(
      this,
      'Tuple',
      elements.map((x) =>
        typeof x === 'number' ? this.number(x) : x.canonical
      ),
      { canonical: true }
    );
  }

  type(type: Type | TypeString | BoxedType): BoxedType {
    if (type instanceof BoxedType) return type;
    return new BoxedType(type, this._typeResolver);
  }

  string(s: string, metadata?: Metadata): BoxedExpression {
    return new BoxedString(this, s, metadata);
  }

  /** Create a boxed symbol */
  symbol(
    name: string,
    options?: { canonical?: CanonicalOptions; metadata?: Metadata }
  ): BoxedExpression {
    return createSymbolExpression(this, this._commonSymbols, name, options);
  }

  /**
   * This function tries to avoid creating a boxed number if `num` corresponds
   * to a common value for which we have a shared instance (-1, 0, NaN, etc...)
   */
  number(
    value:
      | number
      | bigint
      | string
      | NumericValue
      | MathJsonNumberObject
      | Decimal
      | Complex
      | Rational,
    options?: { metadata: Metadata; canonical: CanonicalOptions }
  ): BoxedExpression {
    return createNumberExpression(this, this._commonNumbers, value, options);
  }

  rules(
    rules:
      | Rule
      | ReadonlyArray<Rule | BoxedRule>
      | BoxedRuleSet
      | undefined
      | null,
    options?: { canonical?: boolean }
  ): BoxedRuleSet {
    return boxRules(this, rules, options);
  }

  /**
   * Return a set of built-in rules.
   */
  getRuleSet(id?: string): BoxedRuleSet | undefined {
    id ??= 'standard-simplification';

    if (id === 'standard-simplification') {
      // Invalidate cache if rules array was mutated (e.g. via push/splice)
      if (this._simplificationRules.hasMutatedSinceLastCache()) {
        this._cacheStore.invalidate('standard-simplification-rules');
      }

      const result = this._cache('standard-simplification-rules', () =>
        boxRules(this, this._simplificationRules.rules, { canonical: true })
      );
      this._simplificationRules.markCached();
      return result;
    }

    if (id === 'solve-univariate')
      return this._cache('univariate-roots-rules', () =>
        boxRules(this, UNIVARIATE_ROOTS)
      );

    if (id === 'harmonization')
      return this._cache('harmonization-rules', () =>
        boxRules(this, HARMONIZATION_RULES)
      );

    return undefined;
  }

  /**
   * Return a function expression, but the caller is responsible for making
   * sure that the arguments are canonical.
   *
   * Unlike `ce.function()`, the operator of the result is the name argument.
   * Calling this function directly is potentially unsafe, as it bypasses
   * the canonicalization of the arguments.
   *
   * For example:
   *
   * - `ce._fn('Multiply', [1, 'x'])` returns `['Multiply', 1, 'x']` as a
   *   canonical expression, even though it doesn't follow the canonical form
   * - `ce.function('Multiply', [1, 'x']` returns `'x'` which is the correct
   *    canonical form
   *
   * @internal */
  _fn(
    name: MathJsonSymbol,
    ops: ReadonlyArray<BoxedExpression>,
    options?: { metadata?: Metadata; canonical?: boolean; scope?: Scope }
  ): BoxedExpression {
    const canonical = options?.canonical ?? true;

    return new BoxedFunction(this, name, ops, { ...options, canonical });
  }

  /**
   * Parse a string of LaTeX and return a corresponding `BoxedExpression`.
   *
   * If the `form` option is set to `'canonical'` (the default), the result
   * will be canonical.
   *
   */
  parse(
    latex: null,
    options?: Partial<ParseLatexOptions> & { form?: FormOption }
  ): null;
  parse(
    latex: LatexString,
    options?: Partial<ParseLatexOptions> & { form?: FormOption }
  ): BoxedExpression;
  parse(
    latex: LatexString | null,
    options?: Partial<ParseLatexOptions> & { form?: FormOption }
  ): BoxedExpression | null {
    if (latex === null || latex === undefined) return null;
    if (typeof latex !== 'string')
      throw Error('ce.parse(): expected a LaTeX string');

    const defaultOptions: ParseLatexOptions = {
      imaginaryUnit: '\\imaginaryI',

      positiveInfinity: '\\infty',
      negativeInfinity: '-\\infty',
      notANumber: '\\operatorname{NaN}',

      decimalSeparator: this.decimalSeparator,

      digitGroup: 3,
      digitGroupSeparator: '\\,', // for thousands, etc...

      exponentProduct: '\\cdot',
      beginExponentMarker: '10^{', // could be 'e'
      endExponentMarker: '}',

      truncationMarker: '\\ldots',

      repeatingDecimal: 'auto', // auto will accept any notation

      strict: true,
      skipSpace: true,
      parseNumbers: 'auto',
      getSymbolType: (id) => {
        // This handler is called by the parser when encountering a symbol
        // It should return the type of the symbol
        const def = this.lookupDefinition(id);
        if (!def) return BoxedType.unknown;
        if (isOperatorDef(def)) return def.operator.signature;
        if (isValueDef(def)) return def.value.type;

        return BoxedType.unknown;
      },
      hasSubscriptEvaluate: (id) => {
        // Check if the symbol has a custom subscript evaluation handler
        const def = this.lookupDefinition(id);
        if (isValueDef(def) && def.value.subscriptEvaluate) return true;
        return false;
      },
      parseUnexpectedToken: (_lhs, _parser) => null,
      preserveLatex: false,
      quantifierScope: 'tight',
      timeDerivativeVariable: 't',
    };

    const result = parse(
      asLatexString(latex) ?? latex,
      this._indexedLatexDictionary,
      { ...defaultOptions, ...options }
    );
    if (result === null) throw Error('Failed to parse LaTeX string');
    const { canonical } = formToInternal(options?.form);
    return box(this, result, { canonical });
  }

  /**
   * Return a list of all the assumptions that match a pattern.
   *
   * ```js
   *  ce.assume(['Element', 'x', 'PositiveIntegers');
   *  ce.ask(['Greater', 'x', '_val'])
   *  //  -> [{'val': 0}]
   * ```
   */
  ask(pattern: BoxedExpression): BoxedSubstitution[] {
    return askImpl(this, pattern);
  }

  /**
   * Answer a query based on the current assumptions.
   *
   */

  verify(query: BoxedExpression): boolean | undefined {
    return verifyImpl(this, query);
  }

  /**
   * Add an assumption.
   *
   * Note that the assumption is put into canonical form before being added.
   *
   * Returns:
   * - `contradiction` if the new assumption is incompatible with previous
   * ones.
   * - `tautology` if the new assumption is redundant with previous ones.
   * - `ok` if the assumption was successfully added to the assumption set.
   *
   *
   */
  assume(predicate: BoxedExpression): AssumeResult {
    return assumeFnImpl(this, predicate);
  }

  /**
   * Remove all assumptions about one or more symbols.
   *
   * `ce.forget()` will remove all assumptions.
   *
   * Note that assumptions are scoped, so when exiting the current lexical
   * scope, the previous assumptions will be restored.
   *
   * */
  forget(symbol: undefined | MathJsonSymbol | MathJsonSymbol[]): void {
    forgetImpl(this, symbol);
  }
}
