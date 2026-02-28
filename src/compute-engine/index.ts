import { Complex } from 'complex-esm';
import { BigDecimal } from '../big-decimal';

import { Type, TypeResolver, TypeString } from '../common/type/types';
import { BoxedType } from '../common/type/boxed-type';

import type { OneOf } from '../common/one-of';
import { hidePrivateProperties } from '../common/utils';

import type { ConfigurationChangeListener } from '../common/configuration-change';

import type {
  MathJsonExpression,
  MathJsonSymbol,
  MathJsonNumberObject,
} from '../math-json/types';

import {
  MACHINE_PRECISION,
  SMALL_INTEGER,
} from './numerics/numeric';

import type {
  ValueDefinition,
  OperatorDefinition,
  AngularUnit,
  AssignValue,
  AssumeResult,
  Expression,
  BoxedRule,
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  Metadata,
  Rule,
  Scope,
  EvalContext,
  ExpressionInput,
  IComputeEngine,
  ILatexSyntax,
  BoxedDefinition,
  SymbolDefinition,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
  LibraryDefinition,
} from './global-types';

import type { LibraryCategory, ParseLatexOptions } from './latex-syntax/types';
import { isOperatorDef, isValueDef } from './boxed-expression/utils';

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
import { boxRules } from './boxed-expression/rules';
import { validatePattern } from './boxed-expression/boxed-patterns';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedFunction } from './boxed-expression/boxed-function';
import { _BoxedExpression } from './boxed-expression/abstract-boxed-expression';
import './boxed-expression/init-lazy-refs';
import { _BoxedOperatorDefinition } from './boxed-expression/boxed-operator-definition';
import {
  HARMONIZATION_RULES,
  UNIVARIATE_ROOTS,
} from './boxed-expression/solve';
import {
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
import { SimplificationRuleStore } from './engine-simplification-rules';
import { EngineNumericConfiguration } from './engine-numeric-configuration';
import { EngineRuntimeState } from './engine-runtime-state';
import { EngineStartupCoordinator } from './engine-startup-coordinator';
import { createTypeResolver } from './engine-type-resolver';
import {
  createErrorExpression,
  createTypeErrorExpression,
} from './engine-validation-entrypoints';

export type * from './global-types';

// Free functions backed by a lazily-instantiated global engine
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
} from './free-functions';
import { _setDefaultEngineFactory } from './free-functions';

export { validatePattern };

// Export specialized polynomial factoring functions for advanced users
export {
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
};

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
 * Use the instance to create boxed expressions with `ce.expr()`.
 *
 * ```js
 * const ce = new ComputeEngine();
 *
 * let expr = ce.expr(["Power", "ExponentialE", ["Multiply", "ImaginaryUnit", "Pi"]]);
 * console.log(expr.N().toString());
 * // ➔ "-1"
 *
 * expr = ce.expr(["Expand", ["Power", ["Add", "a", "b"], 2]]);
 * console.log(expr.evaluate().toString());
 * // ➔ "a^2 + 2ab + b^2"
 * ```
 *
 * @category Compute Engine
 *
 */
export class ComputeEngine implements IComputeEngine {
  /** @internal Factory for creating LatexSyntax instances. Registered by the
   *  full entry point (compute-engine.ts). When set, `new ComputeEngine()`
   *  lazily creates a LatexSyntax if none was provided in options. */
  static _latexSyntaxFactory: (() => ILatexSyntax) | null = null;

  // Common symbols
  readonly True: Expression;
  readonly False: Expression;
  readonly Pi: Expression;
  readonly E: Expression;
  readonly Nothing: Expression;

  // Common numbers
  readonly Zero: Expression;
  readonly One: Expression;
  readonly Half: Expression;
  readonly NegativeOne: Expression;
  readonly Two: Expression;
  readonly I: Expression;
  readonly NaN: Expression;
  readonly PositiveInfinity: Expression;
  readonly NegativeInfinity: Expression;
  readonly ComplexInfinity: Expression;

  /** @internal */
  private _numericConfiguration: EngineNumericConfiguration;

  /** @internal */
  private _cacheStore = new EngineCacheStore();

  /** @internal Runtime execution limits and verification mode state */
  private _runtimeState = new EngineRuntimeState();

  /** @internal Configuration change generation/tracking lifecycle */
  private _configurationLifecycle = new EngineConfigurationLifecycle();

  /** @internal */
  private _cost?: (expr: Expression) => number;

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
   * An **evaluation context** tracks the current lexical scope and
   * assumptions. Symbol values are stored in their definitions, not here.
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

  static getStandardLibrary(
    categories?: LibraryCategory[] | LibraryCategory | 'all'
  ): readonly LibraryDefinition[] {
    return getStandardLibrary(categories);
  }

  /**
   * Construct a new `ComputeEngine` instance.
   *
   * Symbols tables define functions, constants and variables (in `options.ids`).
   * If no table is provided the MathJSON Standard Library is used (`ComputeEngine.getStandardLibrary()`)
   *
   * @param options.precision Specific how many digits of precision
   * for the numeric calculations. Default is 300.
   *
   * @param options.tolerance If the absolute value of the difference of two
   * numbers is less than `tolerance`, they are considered equal. Used by
   * `chop()` as well.
   *
   * @param options.libraries Optional standard/custom library list.
   * Custom library entries are validated during startup (name, dependencies,
   * definitions, and LaTeX dictionary shape).
   */
  constructor(options?: {
    libraries?: readonly (string | LibraryDefinition)[];
    precision?: number | 'machine';
    tolerance?: number | 'auto';
    latexSyntax?: ILatexSyntax;
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

    // Store the injected LatexSyntax instance (if any)
    if (options?.latexSyntax) this._latexSyntax = options.latexSyntax;

    hidePrivateProperties(this);
  }

  toJSON() {
    return '[ComputeEngine]';
  }

  [Symbol.toStringTag]: string = 'ComputeEngine';

  /** After the configuration of the engine has changed, clear the caches
   * so that new values can be recalculated.
   *
   * This needs to happen for example when the numeric precision changes.
   *
   * @internal
   */
  _reset(): void {
    this._configurationLifecycle.reset({
      refreshNumericConstants: () => {
        // BigDecimal constants are static/frozen — nothing to refresh
      },
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

  /** @internal Compile a boxed expression. */
  _compile(
    expr: Expression,
    options?: Parameters<typeof _compile>[1]
  ): ReturnType<typeof _compile> {
    return _compile(expr, options);
  }

  /** @internal Get a registered compilation target by name. */
  getCompilationTarget(name: string): LanguageTarget<Expression> | undefined {
    return this._compilationTargets.get(name);
  }

  /** @internal Return the names of all registered compilation targets. */
  listCompilationTargets(): string[] {
    return this._compilationTargets.list();
  }

  /** @internal Register a compilation target. */
  registerCompilationTarget(
    name: string,
    target: LanguageTarget<Expression>
  ): void {
    this._compilationTargets.register(name, target);
  }

  /** @internal Remove a registered compilation target. */
  unregisterCompilationTarget(name: string): void {
    this._compilationTargets.unregister(name);
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
  chop(n: BigDecimal): BigDecimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | BigDecimal | Complex): number | BigDecimal | Complex {
    const tolerance = this._numericConfiguration.tolerance;
    if (typeof n === 'number') {
      if (Math.abs(n) <= tolerance) return 0;
      return n;
    }

    if (n instanceof BigDecimal) {
      if (n.isPositive() && n.lte(this._numericConfiguration.bignumTolerance))
        return 0;
      if (
        n.isNegative() &&
        n.gte(this._numericConfiguration.negBignumTolerance)
      )
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
  bignum(a: string | number | bigint | BigDecimal): BigDecimal {
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
  complex(a: number | BigDecimal | Complex, b?: number | BigDecimal): Complex {
    if (a instanceof BigDecimal) a = a.toNumber();
    if (b instanceof BigDecimal) b = b.toNumber();
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

    const makeNumericValue =
      this._numericConfiguration.precision > MACHINE_PRECISION
        ? (x) => new BigNumericValue(x)
        : (x) => new MachineNumericValue(x);

    if (typeof value === 'number') {
      if (Number.isInteger(value))
        return new ExactNumericValue(value, makeNumericValue);
      return makeNumericValue(value);
    }

    if (typeof value === 'bigint')
      return new ExactNumericValue(value, makeNumericValue);

    if (isRational(value))
      return new ExactNumericValue(
        { rational: value },
        makeNumericValue
      );

    if (value instanceof BigDecimal) {
      if (value.isInteger()) {
        const n = bigint(value.toString());
        if (n !== null)
          return new ExactNumericValue(n, makeNumericValue);
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
      if (value.re instanceof BigDecimal && value.re.isInteger())
        return new ExactNumericValue(
          {
            rational: [bigint(value.re.toString())!, BigInt(1)],
            // radical: value.radical,
          },
          makeNumericValue
        );
      if (typeof value.re === 'number' && Number.isInteger(value.re))
        return new ExactNumericValue(
          {
            rational: [value.re, 1],
            // radical: value.radical
          },
          makeNumericValue
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

      return new ExactNumericValue(value, makeNumericValue);
    }
    throw Error('Unexpected value');
  }

  /**
   * The cost function is used to determine the "cost" of an expression. For example, when simplifying an expression, the simplification that results in the lowest cost is chosen.
   */
  get costFunction(): (expr: Expression) => number {
    return this._cost ?? DEFAULT_COST_FUNCTION;
  }

  set costFunction(fn: ((expr: Expression) => number) | undefined) {
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
   * Push a new lexical scope (and its evaluation context) onto the stack.
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
   * Use `ce.expr(name)` instead
   * @internal */
  _getSymbolValue(id: MathJsonSymbol): Expression | undefined {
    return getSymbolValueImpl(this, id);
  }

  /**
   * For internal use. Use `ce.assign(name, value)` instead.
   * @internal
   */
  _setSymbolValue(
    id: MathJsonSymbol,
    value: Expression | boolean | number | undefined
  ): void {
    setSymbolValueImpl(this, id, value);
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
  getSequenceCache(name: string): Map<number | string, Expression> | undefined {
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
  ): Expression[] | undefined {
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
    terms: (number | Expression)[],
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
  //   expr: Expression,
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

  /** Return a boxed expression from a number, string or expression input.
   * Calls `ce.function()`, `ce.number()` or `ce.symbol()` as appropriate.
   */
  expr(
    expr: NumericValue | ExpressionInput,
    options?: {
      form?: FormOption;
      scope?: Scope | undefined;
    }
  ): Expression {
    const { canonical, structural } = formToInternal(options?.form);
    return box(this, expr, { canonical, structural, scope: options?.scope });
  }

  /** @deprecated Use `expr()` instead. */
  box(
    expr: NumericValue | ExpressionInput,
    options?: {
      form?: FormOption;
      scope?: Scope | undefined;
    }
  ): Expression {
    return this.expr(expr, options);
  }

  /** @internal LatexSyntax instance for parse/serialize. */
  private _latexSyntax?: ILatexSyntax;

  /** The LatexSyntax instance, lazily created if a factory is registered.
   *  `undefined` only when no LatexSyntax was provided and no factory exists. */
  get latexSyntax(): ILatexSyntax | undefined {
    if (!this._latexSyntax && ComputeEngine._latexSyntaxFactory)
      this._latexSyntax = ComputeEngine._latexSyntaxFactory();
    return this._latexSyntax;
  }

  /** @internal Returns the LatexSyntax instance, lazily creating one
   *  if a factory is registered. Throws if no LatexSyntax is available. */
  _requireLatexSyntax(): ILatexSyntax {
    if (!this._latexSyntax && ComputeEngine._latexSyntaxFactory)
      this._latexSyntax = ComputeEngine._latexSyntaxFactory();
    if (!this._latexSyntax)
      throw new Error(
        'LatexSyntax not available. Pass a LatexSyntax instance to the ComputeEngine constructor.'
      );
    return this._latexSyntax;
  }

  /**
   * Parse a LaTeX string and return a boxed expression.
   *
   * Uses the engine's symbol definitions for accurate parsing
   * (e.g., recognizing `f` as a function).
   */
  parse(
    latex: string | null,
    options?: Partial<ParseLatexOptions> & { form?: FormOption }
  ): Expression | null {
    if (latex === null || latex === undefined) return null;
    if (typeof latex !== 'string')
      throw Error('ce.parse(): expected a LaTeX string');

    const syntax = this._requireLatexSyntax();

    const { form, ...parseOpts } = options ?? {};

    const result = syntax.parse(latex, {
      decimalSeparator: '.',
      getSymbolType: (id) => {
        const def = this.lookupDefinition(id);
        if (!def) return BoxedType.unknown;
        if (isOperatorDef(def)) return def.operator.signature;
        if (isValueDef(def)) return def.value.type;
        return BoxedType.unknown;
      },
      hasSubscriptEvaluate: (id) => {
        const def = this.lookupDefinition(id);
        return !!(isValueDef(def) && def.value.subscriptEvaluate);
      },
      ...parseOpts,
    });

    if (result === null) return null;

    const { canonical, structural } = formToInternal(form);
    return box(this, result, { canonical, structural });
  }

  function(
    name: string,
    ops: ReadonlyArray<Expression> | ReadonlyArray<MathJsonExpression>,
    options?: {
      metadata?: Metadata;
      form?: FormOption;
      scope?: Scope | undefined;
    }
  ): Expression {
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
   * Shortcut for `this.expr(["Error",...])`.
   *
   * The result is canonical.
   */
  error(message: string | string[], where?: string): Expression {
    return createErrorExpression(this, message, where);
  }

  typeError(
    expected: Type,
    actual: undefined | Type | BoxedType,
    where?: string
  ): Expression {
    return createTypeErrorExpression(this, expected, actual, where);
  }

  /**
   * Add a `["Hold"]` wrapper to `expr`.
   */
  hold(expr: ExpressionInput): Expression {
    return this._fn('Hold', [this.expr(expr, { form: 'raw' })]);
  }

  /** Shortcut for `this.expr(["Tuple", ...])`
   *
   * The result is canonical.
   */
  tuple(...elements: ReadonlyArray<number>): Expression;
  tuple(...elements: ReadonlyArray<Expression>): Expression;
  tuple(...elements: ReadonlyArray<number | Expression>): Expression {
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

  string(s: string, metadata?: Metadata): Expression {
    return new BoxedString(this, s, metadata);
  }

  /** Create a boxed symbol */
  symbol(
    name: string,
    options?: { canonical?: CanonicalOptions; metadata?: Metadata }
  ): Expression {
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
      | BigDecimal
      | Complex
      | Rational,
    options?: { metadata: Metadata; canonical: CanonicalOptions }
  ): Expression {
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
    ops: ReadonlyArray<Expression>,
    options?: { metadata?: Metadata; canonical?: boolean; scope?: Scope }
  ): Expression {
    const canonical = options?.canonical ?? true;

    return new BoxedFunction(this, name, ops, { ...options, canonical });
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
  ask(pattern: Expression): BoxedSubstitution[] {
    return askImpl(this, pattern);
  }

  /**
   * Answer a query based on the current assumptions.
   *
   */

  verify(query: Expression): boolean | undefined {
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
  assume(predicate: Expression): AssumeResult {
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

// Register a factory with the free-functions module so it can lazily
// instantiate a default engine without importing back from this file.
// Note: this factory does NOT inject LatexSyntax. The full entry point
// (compute-engine.ts) registers a factory that includes LatexSyntax.
_setDefaultEngineFactory(() => new ComputeEngine());
