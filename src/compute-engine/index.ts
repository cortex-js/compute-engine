import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import {
  BLUE,
  BOLD,
  CYAN,
  GREY,
  INVERSE_RED,
  RESET,
  YELLOW,
} from '../common/ansi-codes';

import { isValidSymbol, validateSymbol } from '../math-json/symbols';

import {
  Type,
  TypeReference,
  TypeResolver,
  TypeString,
} from '../common/type/types';
import { isValidType, isValidTypeName, widen } from '../common/type/utils';
import { parseType } from '../common/type/parse';
import { BoxedType } from '../common/type/boxed-type';
import { typeToString } from '../common/type/serialize';

import type { OneOf } from '../common/one-of';
import { hidePrivateProperties } from '../common/utils';

import {
  ConfigurationChangeTracker,
  ConfigurationChangeListener,
} from '../common/configuration-change';

import type {
  Expression,
  MathJsonSymbol,
  MathJsonNumberObject,
} from '../math-json/types';

import {
  DEFAULT_PRECISION,
  DEFAULT_TOLERANCE,
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
  SymbolDefinitions,
  Metadata,
  Rule,
  Scope,
  EvalContext,
  SemiBoxedExpression,
  ComputeEngine as IComputeEngine,
  BoxedDefinition,
  SymbolDefinition,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
} from './global-types';

import type {
  LatexDictionaryEntry,
  LatexString,
  LibraryCategory,
  ParseLatexOptions,
} from './latex-syntax/types';
import {
  type IndexedLatexDictionary,
  getLatexDictionary,
  indexLatexDictionary,
} from './latex-syntax/dictionary/definitions';
import { parse } from './latex-syntax/parse';
import { asLatexString, isLatexString } from './latex-syntax/utils';

import { setSymbolDefinitions, getStandardLibrary } from './library/library';

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

import { box, boxFunction } from './boxed-expression/box';
import { ExpressionMap } from './boxed-expression/expression-map';
import {
  isValidOperatorDef,
  isValidValueDef,
  isValueDef,
  isOperatorDef,
  updateDef,
} from './boxed-expression/utils';
import { boxRules } from './boxed-expression/rules';
import {
  validatePattern,
  isWildcard,
  wildcardName,
} from './boxed-expression/boxed-patterns';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedNumber, canonicalNumber } from './boxed-expression/boxed-number';
import { _BoxedValueDefinition } from './boxed-expression/boxed-value-definition';
import { BoxedFunction } from './boxed-expression/boxed-function';
import { BoxedSymbol } from './boxed-expression/boxed-symbol';
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
import { canonicalFunctionLiteral, lookup } from './function-utils';

import { assume, getInequalityBoundsFromAssumptions } from './assume';
import {
  createSequenceHandler,
  validateSequenceDefinition,
  getSequenceStatus as getSequenceStatusImpl,
  getSequenceInfo as getSequenceInfoImpl,
  listSequences as listSequencesImpl,
  isSequence as isSequenceImpl,
  clearSequenceCache as clearSequenceCacheImpl,
  getSequenceCache as getSequenceCacheImpl,
  generateSequenceTerms as generateSequenceTermsImpl,
} from './sequence';

import {
  lookupSequence as lookupSequenceImpl,
  checkSequence as checkSequenceImpl,
} from './oeis';

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
} from './compilation/types';

export { JavaScriptTarget } from './compilation/javascript-target';
export { GLSLTarget } from './compilation/glsl-target';
export { BaseCompiler } from './compilation/base-compiler';

// Import for internal use
import type { LanguageTarget } from './compilation/types';
import { JavaScriptTarget as _JavaScriptTarget } from './compilation/javascript-target';
import { GLSLTarget as _GLSLTarget } from './compilation/glsl-target';

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
  _BIGNUM_NAN: Decimal;

  /** @internal */
  _BIGNUM_ZERO: Decimal;

  /** @internal */
  _BIGNUM_ONE: Decimal;

  /** @internal */
  _BIGNUM_TWO: Decimal;

  /** @internal */
  _BIGNUM_HALF: Decimal;

  /** @internal */
  _BIGNUM_PI: Decimal;

  /** @internal */
  _BIGNUM_NEGATIVE_ONE: Decimal;

  /** @internal */
  private _precision: number;

  /** @ internal */
  private _angularUnit: AngularUnit;

  /** @internal */
  private _tolerance: number;
  /** @internal */
  private _bignumTolerance: Decimal;
  private _negBignumTolerance: Decimal;

  /** @internal */
  private __cache: {
    [key: string]: {
      value: any;
      build: () => any;
      purge?: (v: unknown) => void;
    };
  } = {};

  private _configurationChangeTracker = new ConfigurationChangeTracker();

  /** @internal */
  private _cost?: (expr: BoxedExpression) => number;

  /** @internal Registry of compilation targets */
  private _compilationTargets: Map<string, LanguageTarget> = new Map();

  /** @internal */
  private _commonSymbols: { [symbol: string]: null | BoxedExpression } = {
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
  private _commonNumbers: { [num: number]: null | BoxedExpression } = {
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
  get _typeResolver(): TypeResolver {
    const ce = this; // capture this
    return {
      get names() {
        // Return all known type names as a string array
        const types: string[] = [];
        let scope: Scope | null = ce.context.lexicalScope;
        while (scope) {
          if (scope.types) types.push(...Object.keys(scope.types));
          scope = scope.parent;
        }
        return types;
      },

      resolve: (name: string) => {
        // Go up the scope chain until we find a definition
        let scope: Scope | null = ce.context.lexicalScope;
        while (scope) {
          if (scope.types?.[name]) return scope.types[name];
          scope = scope.parent;
        }

        return undefined;
      },

      // If no definition was found, but this is a forward lookup, return
      // a new definition
      forward: (name: string) => {
        const ref = {
          kind: 'reference',
          name,
          alias: false,
          def: undefined,
        } as TypeReference;
        ce.context.lexicalScope.types ??= {};
        ce.context.lexicalScope.types[name] = ref;
        return ref;
      },
    };
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
    { alias }: { alias?: boolean } = {}
  ): void {
    if (!isValidTypeName(name))
      throw Error(`The type name "${name}" is invalid`);

    // Is the type already defined in this scope?
    const scope = this.context.lexicalScope;
    if (scope.types?.[name])
      throw Error(`The type "${name}" is already defined in the current scope`);

    scope.types ??= {};

    alias ??= false; // Nominal by default

    // First, add a placeholder record to allow recursive types
    scope.types[name] = { kind: 'reference', name, alias, def: undefined };

    // Parse the type (which may reference itself)
    const def =
      type instanceof BoxedType
        ? type.type
        : typeof type === 'string'
          ? parseType(type, this._typeResolver)
          : type;

    // Adjust the definition (the type references in the type will point to
    // the placeholder record)
    scope.types[name].def = def;
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
  _generation: number = 0;

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

  /** Absolute time beyond which evaluation should not proceed.
   * @internal
   */
  deadline?: number;

  /**
   * Return symbol tables suitable for the specified categories, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A symbol table defines how to evaluate and manipulate symbols.
   *
   */

  /** @internal */
  private _latexDictionaryInput: Readonly<LatexDictionaryEntry[]>;

  /** @internal */
  __indexedLatexDictionary: IndexedLatexDictionary;

  /** @internal */
  _bignum: Decimal.Constructor;

  static getStandardLibrary(
    categories: LibraryCategory[] | LibraryCategory | 'all' = 'all'
  ): readonly SymbolDefinitions[] {
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
    domain: LibraryCategory | 'all' = 'all'
  ): readonly Readonly<LatexDictionaryEntry>[] {
    return getLatexDictionary(domain);
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
    ids?: readonly SymbolDefinitions[];
    precision?: number | 'machine';
    tolerance?: number | 'auto';
  }) {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Unexpected argument');

    this.strict = true;

    // Set the default precision for calculations
    let precision = options?.precision ?? DEFAULT_PRECISION;
    if (precision === 'machine') precision = Math.floor(MACHINE_PRECISION);
    this._bignum = Decimal.clone({ precision });
    this._precision = precision;

    this.tolerance = options?.tolerance ?? 'auto';

    this._angularUnit = 'rad';

    this.Zero = new BoxedNumber(this, 0);
    this.One = new BoxedNumber(this, 1);
    this.Half = new BoxedNumber(this, { rational: [1, 2] });
    this.NegativeOne = new BoxedNumber(this, -1);
    this.Two = new BoxedNumber(this, 2);
    this.NaN = new BoxedNumber(this, Number.NaN);
    this.PositiveInfinity = new BoxedNumber(this, Number.POSITIVE_INFINITY);
    this.NegativeInfinity = new BoxedNumber(this, Number.NEGATIVE_INFINITY);
    this.I = new BoxedNumber(this, { im: 1 });
    this.ComplexInfinity = new BoxedNumber(this, {
      re: Infinity,
      im: Infinity,
    });

    // Reset the caches/create (precision-dependent) numeric constants
    this._reset();

    // Create the system scope (top-level scope)
    this.pushScope(undefined, 'system');

    // Declare the standard types
    this.declareType('limits', 'expression<Limits>');

    for (const table of ComputeEngine.getStandardLibrary('domains'))
      setSymbolDefinitions(this, table);

    const tables = options?.ids ?? ComputeEngine.getStandardLibrary();
    for (const table of tables) setSymbolDefinitions(this, table);

    // Populate the table of common symbols
    // (they should be in the global context)
    for (const sym of Object.keys(this._commonSymbols)) {
      this._commonSymbols[sym] = new BoxedSymbol(this, sym, {
        def: this.lookupDefinition(sym),
      });
    }

    this.True = this._commonSymbols.True!;
    this.False = this._commonSymbols.False!;
    this.Pi = this._commonSymbols.Pi!;
    this.E = this._commonSymbols.ExponentialE!;
    this.Nothing = this._commonSymbols.Nothing!;

    // Push a fresh scope to protect system definitions:
    // this will be the "global" scope
    this.pushScope(undefined, 'global');

    // Register default compilation targets
    this._compilationTargets.set('javascript', new _JavaScriptTarget());
    this._compilationTargets.set('glsl', new _GLSLTarget());

    hidePrivateProperties(this);
  }

  toJSON() {
    return '[ComputeEngine]';
  }

  [Symbol.toStringTag]: string = 'ComputeEngine';

  get latexDictionary(): Readonly<LatexDictionaryEntry[]> {
    return this._latexDictionaryInput ?? ComputeEngine.getLatexDictionary();
  }

  set latexDictionary(dic: Readonly<LatexDictionaryEntry[]>) {
    this._latexDictionaryInput = dic;
    this.__indexedLatexDictionary = indexLatexDictionary(dic, (sig) => {
      throw Error(
        typeof sig.message === 'string' ? sig.message : sig.message.join(',')
      );
    });
  }

  get _indexedLatexDictionary(): IndexedLatexDictionary {
    this.__indexedLatexDictionary ??= indexLatexDictionary(
      this.latexDictionary,
      (sig) => console.error(sig)
    );
    return this.__indexedLatexDictionary;
  }

  /** After the configuration of the engine has changed, clear the caches
   * so that new values can be recalculated.
   *
   * This needs to happen for example when the numeric precision changes.
   *
   * @internal
   */
  _reset(): void {
    console.assert(this._bignum);

    this._generation += 1;

    // Recreate the bignum constants (they depend on the engine's precision)
    this._BIGNUM_NEGATIVE_ONE = this.bignum(-1);
    this._BIGNUM_NAN = this.bignum(NaN);
    this._BIGNUM_ZERO = this.bignum(0);
    this._BIGNUM_ONE = this.bignum(1);
    this._BIGNUM_TWO = this.bignum(2);
    this._BIGNUM_HALF = this._BIGNUM_ONE.div(this._BIGNUM_TWO);
    this._BIGNUM_PI = this._BIGNUM_NEGATIVE_ONE.acos();

    // Reset all the common  expressions (probably not necessary)
    for (const d of Object.values(this._commonSymbols)) d?.reset();

    // Purge any caches
    for (const k of Object.keys(this.__cache))
      if (this.__cache[k].value) {
        if (!this.__cache[k].purge) delete this.__cache[k];
        else
          this.__cache[k].value = this.__cache[k].purge!(this.__cache[k].value);
      }

    // Notify all the listeners that the configuration has changed. This
    // includes all the value and operator definitions
    this._configurationChangeTracker.notifyNow();
  }

  /** @internal */
  listenToConfigurationChange(
    tracker: ConfigurationChangeListener
  ): () => void {
    return this._configurationChangeTracker.listen(tracker);
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
   * const code = expr.compile({ to: 'python' });
   * ```
   */
  registerCompilationTarget(name: string, target: LanguageTarget): void {
    this._compilationTargets.set(name, target);
  }

  /**
   * Get a registered compilation target by name.
   *
   * @param name - The name of the target (e.g., 'javascript', 'glsl')
   * @returns The LanguageTarget implementation, or undefined if not found
   *
   * @internal
   */
  _getCompilationTarget(name: string): LanguageTarget | undefined {
    return this._compilationTargets.get(name);
  }

  get precision(): number {
    return this._precision;
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
    if (p === 'machine') p = MACHINE_PRECISION;
    if (p === 'auto') p = DEFAULT_PRECISION;
    const currentPrecision = this._precision;

    if (p === currentPrecision) return;

    if (typeof p !== 'number' || p <= 0)
      throw Error('Expected "machine" or a positive number');

    // Set the display precision as requested.
    // It may be less than the effective precision, which is never less than 15

    this._precision = Math.max(p, MACHINE_PRECISION);

    this._bignum = this._bignum.config({ precision: this._precision });

    // Reset the tolerance
    this.tolerance = 'auto';

    // Reset the caches
    // (the values in the cache depend on the current precision)
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
    return this._angularUnit;
  }

  set angularUnit(u: AngularUnit) {
    if (u === this._angularUnit) return;

    if (typeof u !== 'string') throw Error('Expected a string');

    this._angularUnit = u;
    this._reset();
  }

  /** Throw a `CancellationError` when the duration of an evaluation exceeds
   * the time limit.
   *
   * Time in milliseconds, default 2000 ms = 2 seconds.
   *
   */
  get timeLimit(): number {
    return this._timeLimit;
  }

  set timeLimit(t: number) {
    if (t <= 0) t = Number.POSITIVE_INFINITY;
    this._timeLimit = t;
  }

  private _timeLimit: number = 2000;

  /** The time after which the time limit has been exceeded */
  _deadline: number | undefined = undefined;

  get _timeRemaining(): number {
    if (this.deadline === undefined) return Number.POSITIVE_INFINITY;
    return this.deadline - Date.now();
  }

  /** Throw `CancellationError` `iteration-limit-exceeded` when the iteration limit
   * in a loop is exceeded. Default: no limits.
   *
   * @experimental
   */
  get iterationLimit(): number {
    return this._iterationLimit;
  }
  set iterationLimit(t: number) {
    if (t <= 0) t = Number.POSITIVE_INFINITY;
    this._iterationLimit = t;
  }

  private _iterationLimit: number = 1024;

  /** Signal `recursion-depth-exceeded` when the recursion depth for this
   * scope is exceeded.
   *
   * @experimental
   */
  get recursionLimit(): number {
    return this._recursionLimit;
  }
  set recursionLimit(t: number) {
    if (t <= 0) t = Number.POSITIVE_INFINITY;
    this._recursionLimit = t;
  }

  private _recursionLimit: number = 1024;

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
  private _isVerifying: boolean = false;

  /**
   * @internal
   * Indicates whether we're currently inside a verify() call.
   * Used to prevent recursion and to enable 3-valued logic in verification mode.
   */
  get isVerifying(): boolean {
    return this._isVerifying;
  }

  get tolerance(): number {
    return this._tolerance;
  }
  /**
   * Values smaller than the tolerance are considered to be zero for the
   * purpose of comparison, i.e. if `|b - a| <= tolerance`, `b` is considered
   * equal to `a`.
   */
  set tolerance(val: number | 'auto') {
    if (val === 'auto') val = DEFAULT_TOLERANCE;

    if (!Number.isFinite(val) || val < 0)
      val = Math.pow(10, -this._precision + 2);

    this._tolerance = val;
    this._bignumTolerance = this.bignum(val);
    this._negBignumTolerance = this.bignum(-val);
  }

  /** Replace a number that is close to 0 with the exact integer 0.
   *
   * How close to 0 the number has to be to be considered 0 is determined by {@linkcode tolerance}.
   */
  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex {
    if (typeof n === 'number') {
      if (Math.abs(n) <= this._tolerance) return 0;
      return n;
    }

    if (n instanceof Decimal) {
      if (n.isPositive() && n.lte(this._bignumTolerance)) return 0;
      if (n.isNegative() && n.gte(this._negBignumTolerance)) return 0;
      if (n.isZero()) return 0;
      return n;
    }

    if (
      n instanceof Complex &&
      Math.abs(n.re) <= this._tolerance &&
      Math.abs(n.im) <= this._tolerance
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
    if (typeof a === 'bigint') return new this._bignum(a.toString());
    try {
      return new this._bignum(a);
    } catch (e) {
      console.error(e.message);
    }
    return this._BIGNUM_NAN;
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
      this._precision > MACHINE_PRECISION
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
      if (value.isInteger() && value.e <= MAX_BIGINT_DIGITS)
        return new ExactNumericValue(
          bigint(value.toString())!,
          makeNumericValue,
          bignum
        );
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
   * Return definition matching the symbol, starting with the current
   * lexical scope and going up the scope chain.
   */
  lookupDefinition(id: MathJsonSymbol): undefined | BoxedDefinition {
    return lookup(id, this.context.lexicalScope);
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
    scope ??= this.context.lexicalScope;

    // Insert a placeholder in the bindings to handle recursive calls
    // (the value could be a function that references itself)
    scope.bindings.set(name, {
      value: new _BoxedValueDefinition(this, name, {
        type: 'unknown',
        inferred: true,
      }),
    });

    const boxedDef = scope.bindings.get(name)!;
    updateDef(this, name, boxedDef, def);

    // If we are modifying the current scope, and we have a value,
    // set the value in the evaluation context
    if (
      scope === this.context.lexicalScope &&
      isValueDef(boxedDef) &&
      boxedDef.value.value &&
      !boxedDef.value.isConstant
    ) {
      this.context.values[name] = boxedDef.value.value;
    }

    this._generation += 1;

    return boxedDef;
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
    scope ??= this.context.lexicalScope;
    // Insert a placeholder in the bindings to handle recursive calls
    // (the function is not yet defined)
    scope.bindings.set(name, {
      value: new _BoxedValueDefinition(this, name, { type: 'function' }),
    });

    const boxedDef = scope.bindings.get(name)!;
    updateDef(this, name, boxedDef, def);

    this._generation += 1;

    return boxedDef;
  }

  /**
   *
   * Create a new lexical scope and matching evaluation context and add it
   * to the evaluation context stack.
   *
   */
  pushScope(scope?: Scope, name?: string): void {
    this._pushEvalContext(
      scope ?? {
        parent: this.context?.lexicalScope,
        bindings: new Map(),
      },
      name
    );
  }

  /**
   * Remove the most recent scope from the scope stack.
   */
  popScope(): void {
    this._popEvalContext();
  }

  /** @internal */
  _pushEvalContext(scope: Scope, name?: string): void {
    if (!name) {
      const l = this._evalContextStack.length;
      if (l === 0) name = 'system';
      if (l === 1) name = 'global';
      name ??= `anonymous_${l - 1}`;
    }

    //
    // The values in the evaluation context are all the non-constant symbols
    // in the scope.
    //
    const values: { [id: string]: BoxedExpression | undefined } = {};
    for (const [id, def] of scope.bindings.entries()) {
      if (isValueDef(def) && !def.value.isConstant)
        values[id] = def.value.value;
    }

    this._evalContextStack.push({
      lexicalScope: scope,
      name,
      assumptions: new ExpressionMap(this.context?.assumptions ?? []),
      values,
    });
  }

  /** @internal */
  _popEvalContext(): void {
    this._evalContextStack.pop();
  }

  /** @internal */
  _inScope<T>(scope: Scope | undefined, f: () => T): T {
    if (!scope) return f();

    // Push a dummy context (@todo: we could just have a lexical scope chain instead)
    this._evalContextStack.push({
      lexicalScope: scope,
      name: '',
      assumptions: new ExpressionMap([]),
      values: {},
    });

    try {
      return f();
    } finally {
      this._evalContextStack.pop();
    }
  }

  /** @internal */
  _printStack(options?: { details?: boolean; maxDepth?: number }): void {
    if (options) {
      options = { ...options };
      options.maxDepth ??= 1;
      options.details ??= false;
    } else options = { details: false, maxDepth: -2 };

    if (options.maxDepth !== undefined && options.maxDepth < 0)
      options.maxDepth = this._evalContextStack.length + options.maxDepth;

    options.maxDepth = Math.min(
      this._evalContextStack.length - 1,
      options.maxDepth!
    );

    let depth = 0;

    while (depth <= options.maxDepth) {
      const context =
        this._evalContextStack[this._evalContextStack.length - 1 - depth];
      if (depth === 0) console.group(`${BOLD}${BLUE}${context.name}${RESET}`);
      else
        console.groupCollapsed(
          `${BOLD}${BLUE}${context.name}${RESET} ${GREY}(${depth})${RESET}`
        );

      //
      // Display assumptions
      //
      const assumptions = [...context.assumptions.entries()].map(
        ([k, v]) => `${k}: ${v}`
      );
      if (assumptions.length > 0) {
        console.groupCollapsed(
          `${BOLD}${assumptions.length} assumptions${RESET}`
        );
        for (const a of assumptions) console.info(a);
        console.groupEnd();
      }

      //
      // Display values
      //

      const bindings = Object.entries(context.values);
      if (bindings.length + context.lexicalScope.bindings.size === 0) {
        console.groupEnd();
        depth += 1;
        continue;
      }

      for (const [k, b] of bindings) {
        if (context.lexicalScope.bindings.has(k)) {
          console.info(
            defToString(k, context.lexicalScope.bindings.get(k)!, b)
          );
        } else if (b === undefined) {
          console.info(`${CYAN}${k}${RESET}: ${GREY}undefined${RESET}`);
        } else {
          console.info(`${CYAN}${k}${RESET}: ${GREY}${b.toString()}${RESET}`);
        }
      }

      //
      // Display the lexical scope entries without a matching value
      //
      for (const [k, def] of context.lexicalScope.bindings)
        if (!(k in context.values)) console.info(defToString(k, def));

      console.groupEnd();

      // Next execution context
      depth += 1;
    }
  }

  /**
   * Use `ce.box(name)` instead
   * @internal */
  _getSymbolValue(id: MathJsonSymbol): BoxedExpression | undefined {
    // Iterate over all the frames, starting with the most recent
    // and going back to the root frame
    const l = this._evalContextStack.length - 1;
    if (l < 0) return undefined;
    for (let j = l; j >= 0; j--) {
      const frame = this._evalContextStack[j].values;
      if (id in frame) return frame[id];
    }
    return undefined;
  }

  /**
   * For internal use. Use `ce.assign(name, value)` instead.
   * @internal
   */
  _setSymbolValue(
    id: MathJsonSymbol,
    value: BoxedExpression | boolean | number | undefined
  ): void {
    // Iterate over all the frames, starting with the most recent
    // and going back to the root frame
    const l = this._evalContextStack.length - 1;
    if (l < 0) throw new Error(`Unknown symbol "${id}"`);

    if (typeof value === 'number') value = this.number(value);
    else if (typeof value === 'boolean') value = value ? this.True : this.False;

    for (let j = l; j >= 0; j--) {
      const values = this._evalContextStack[j].values;
      if (id in values) {
        values[id] = value;
        this._generation += 1;
        return;
      }
    }

    // If we reach here, the symbol is not defined in any frame
    // Add it to the frame that has the declaration for it.
    // Note: this code path can happen if we have a symbol declared as a
    // function/operator, and we are assigning a value to it: ordinarily
    // there would be an entry in the `values` map if it it had been declared
    // as a value, but it is not the case here.
    const ctx = this.lookupContext(id);
    if (!ctx) throw new Error(`Unknown symbol "${id}"`);
    ctx.values[id] = value;
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
    const l = this._evalContextStack.length - 1;
    if (l < 0) throw new Error(`No evaluation context`);

    if (typeof value === 'number') value = this.number(value);
    else if (typeof value === 'boolean') value = value ? this.True : this.False;

    this._evalContextStack[l].values[id] = value;
    this._generation += 1;
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
    //
    // If the argument is an object literal, call `declare` for each entry
    //
    if (typeof arg1 !== 'string') {
      for (const [id, def] of Object.entries(arg1)) this.declare(id, def);
      return this;
    }

    const id = arg1;

    // The special id `Nothing` can never be redeclared.
    // It is also used to indicate that a symbol should be ignored,
    // so it's valid, but it doesn't do anything.
    if (id === 'Nothing') return this;

    // Can't "undeclare" (set to `undefined`/`null`) a symbol either
    // (but its value can be set to `undefined` with `ce.assign()`)
    if (arg2 === undefined || arg2 === null)
      throw Error(`Expected a definition or type for "${id}"`);

    // Check the id is valid
    if (typeof id !== 'string' || id.length === 0 || !isValidSymbol(id)) {
      throw new Error(`Invalid symbol "${id}": ${validateSymbol(id)}`);
    }

    scope ??= this.context.lexicalScope;

    //
    // Check the id is not already declared in the current scope
    //
    const bindings = scope.bindings;
    if (bindings.has(id))
      throw new Error(`The symbol "${id}" is already declared in this scope`);

    //
    // Declaring a symbol or function with a definition or type
    //

    const def = arg2;

    if (isValidValueDef(def)) {
      this._declareSymbolValue(id, def, scope);
      return this;
    }

    if (isValidOperatorDef(def)) {
      this._declareSymbolOperator(id, def, scope);
      return this;
    }

    //
    // Declaring a symbol with a type
    // `ce.declare("f", "number -> number")`
    // `ce.declare("z", "complex")`
    // `ce.declare("n", "integer")`
    //
    {
      const type = parseType(def, this._typeResolver);
      if (!isValidType(type)) {
        throw Error(
          [
            `Invalid argument for "${id}"`,
            JSON.stringify(def, undefined, 4),
            `Use a type, a \`OperatorDefinition\` or a \`ValueDefinition\``,
          ].join('\n|   ')
        );
      }

      this._declareSymbolValue(id, { type }, scope);
    }

    return this;
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
    // Validate basic requirements (without parsing)
    if (!def.base || Object.keys(def.base).length === 0) {
      throw new Error(`Sequence "${name}" requires at least one base case`);
    }
    if (!def.recurrence) {
      throw new Error(`Sequence "${name}" requires a recurrence relation`);
    }

    // Declare the symbol first with a placeholder handler
    // This ensures the symbol exists when we parse the recurrence
    this.declare(name, {
      subscriptEvaluate: () => undefined,
    });

    // Now validate and create the actual handler
    const validation = validateSequenceDefinition(this, name, def);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Create the full subscriptEvaluate handler
    const handler = createSequenceHandler(this, name, def);

    // Update the symbol's subscriptEvaluate handler
    // We need to access the internal definition to update it
    const boxedDef = this.lookupDefinition(name);
    if (boxedDef && isValueDef(boxedDef)) {
      boxedDef.value.subscriptEvaluate = handler;
    }

    return this;
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
    return getSequenceInfoImpl(this, name);
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
    return generateSequenceTermsImpl(this, name, start, end, step);
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
    return lookupSequenceImpl(this, terms, options);
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
    return checkSequenceImpl(this, name, count, options);
  }

  /**
   * Return an evaluation context in which the symbol is defined.
   */
  lookupContext(id: MathJsonSymbol): EvalContext | undefined {
    if (id.length === 0 || !isValidSymbol(id))
      throw Error(`Invalid symbol "${id}": ${validateSymbol(id)}}`);

    // Iterate over all the frames, starting with the most recent
    // and going back to the root frame
    const l = this._evalContextStack.length - 1;
    if (l < 0) return undefined;
    for (let j = l; j >= 0; j--) {
      const context = this._evalContextStack[j];
      if (context.lexicalScope.bindings.has(id)) return context;
    }

    return undefined;
  }

  /**  Find the context in the stack frame, and set the stack frame to
   * it. This is used to evaluate expressions in the context of
   * a different scope.
   */
  _swapContext(context: EvalContext): void {
    while (
      this._evalContextStack.length > 0 &&
      this._evalContextStack[this._evalContextStack.length - 1] !== context
    )
      this._evalContextStack.pop();

    // This is unlikely to happen, but just in case...
    if (this._evalContextStack.length === 0) this._evalContextStack = [context];
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
    //
    // If the first argument is an object literal, call `assign()` for each key
    //
    if (typeof arg1 === 'object') {
      console.assert(arg2 === undefined);
      for (const [id, def] of Object.entries(arg1)) this.assign(id, def);
      return this;
    }

    const id = arg1;

    // Cannot set the value of 'Nothing'
    // @todo: could have a 'locked' attribute on the definition
    if (id === 'Nothing') return this;

    const def = this.lookupDefinition(id);

    if (isOperatorDef(def)) {
      const value = assignValueAsValue(this, arg2);
      if (value) throw Error(`Cannot change the operator "${id}" to a value`);

      // Update the operator definition.
      // Note: this is a potentially dangerous operation, since the
      // operator may be used in other expressions that are not
      // re-canonicalized. However, it might be desirable to override the
      // evaluation of an operator in a specific context, even a system
      // operator.
      // However, it is preferable to use `ce.declare()` to create a new
      // operator.
      const fnDef = assignValueAsOperatorDef(this, arg2);
      if (!fnDef) throw Error(`Cannot change the operator "${id}" to a value`);
      updateDef(this, id, def, fnDef);
      return this;
    }

    //
    // 1/ We were given a value
    //
    const value = assignValueAsValue(this, arg2);
    if (value !== undefined) {
      if (!def) {
        // No previous definition: create a new one
        this._declareSymbolValue(id, { value });
        return this;
      }
      if (def.value.isConstant)
        throw Error(`Cannot assign a value to the constant "${id}"`);

      // We have a value definition, update the inferred type...
      if (def.value.inferredType)
        def.value.type = this.type(widen(def.value.type.type, value.type.type));

      // ... and set the value
      this._setSymbolValue(id, value);

      return this;
    }

    //
    // 2/ We were given an operator definition
    //
    const fnDef = assignValueAsOperatorDef(this, arg2);
    if (fnDef === undefined)
      throw Error(`Invalid definition for symbol "${id}"`);

    if (def) {
      // If we get here, the previous definition was a value definition.
      // We can update it to an operator definition.
      console.assert(isValueDef(def));
      updateDef(this, id, def, fnDef);

      // Remove the value associated with the previous definition
      this._setSymbolValue(id, undefined);
    } else {
      // No previous definition: create a new one
      this.declare(id, fnDef);
    }

    return this;
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
    return this.deadline === undefined || this.deadline >= Date.now();
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
    if (this.__cache[cacheName] === undefined) {
      try {
        this.__cache[cacheName] = { build, purge, value: build() };
      } catch (e) {
        console.error(
          `Fatal error building cache "${cacheName}":\n\t ${e.toString()}`
        );
      }
    }

    return this.__cache[cacheName]?.value;
  }

  /** Return a boxed expression from a number, string or semiboxed expression.
   * Calls `ce.function()`, `ce.number()` or `ce.symbol()` as appropriate.
   */
  box(
    expr: NumericValue | SemiBoxedExpression,
    options?: {
      canonical?: CanonicalOptions;
      structural?: boolean;
      scope?: Scope | undefined;
    }
  ): BoxedExpression {
    return box(this, expr, options);
  }

  function(
    name: string,
    ops: ReadonlyArray<BoxedExpression> | ReadonlyArray<Expression>,
    options?: {
      metadata?: Metadata;
      canonical?: CanonicalOptions;
      structural?: boolean;
      scope?: Scope | undefined;
    }
  ): BoxedExpression {
    return boxFunction(this, name, ops, options);
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
    return this._fn('Hold', [this.box(expr, { canonical: false })]);
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
    const canonical = options?.canonical ?? true;
    const metadata = options?.metadata;

    // Symbols should use the Unicode NFC canonical form
    name = name.normalize();

    // These are not valid symbols, but we allow them
    const lcName = name.toLowerCase();
    if (lcName === 'infinity' || lcName === '+infinity')
      return this.PositiveInfinity;
    if (lcName === '-infinity') return this.NegativeInfinity;

    if (this.strict && !isValidSymbol(name))
      return this.error(['invalid-symbol', validateSymbol(name)], name);

    if (!canonical) return new BoxedSymbol(this, name, { metadata });

    const result = this._commonSymbols[name];
    if (result) return result;

    // Is there a value definition for this name?
    let def = this.lookupDefinition(name);

    if (isValueDef(def) && def.value.holdUntil === 'never')
      return def.value.value ?? this.Nothing;

    if (def) return new BoxedSymbol(this, name, { metadata, def });

    // There was no definition for this name, so we create a new one
    def = this._declareSymbolValue(name, { type: 'unknown', inferred: true });
    return new BoxedSymbol(this, name, { metadata, def });
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
    const metadata = options?.metadata;
    let canonical = false;
    if (!options || options.canonical === undefined) canonical = true;
    else if (options.canonical === 'Number' || options.canonical === true)
      canonical = true;
    else if (
      Array.isArray(options.canonical) &&
      options.canonical.includes('Number')
    )
      canonical = true;

    // We have been asked for a non-canonical rational...
    if (!canonical && isRational(value)) {
      return this._fn(
        'Rational',
        [this.number(value[0]), this.number(value[1])],
        { ...metadata, canonical: false }
      );
    }

    // If not a rational, it's always canonical
    value = canonicalNumber(this, value);

    //
    // Is this number eligible to be a cached number expression?
    // (i.e. it has no associated metadata)
    //
    if (metadata === undefined) {
      if (typeof value === 'number') {
        const n = value;
        if (n === 1) return this.One;
        if (n === 0) return this.Zero;
        if (n === -1) return this.NegativeOne;
        if (n === 2) return this.Two;

        if (Number.isInteger(n) && this._commonNumbers[n] !== undefined) {
          this._commonNumbers[n] ??= new BoxedNumber(this, value);
          return this._commonNumbers[n];
        }

        if (Number.isNaN(n)) return this.NaN;

        if (!Number.isFinite(n))
          return n < 0 ? this.NegativeInfinity : this.PositiveInfinity;
      } else if (value instanceof NumericValue) {
        if (value.isZero) return this.Zero;
        if (value.isOne) return this.One;
        if (value.isNegativeOne) return this.NegativeOne;
        if (value.isNaN) return this.NaN;
        if (value.isNegativeInfinity) return this.NegativeInfinity;
        if (value.isPositiveInfinity) return this.PositiveInfinity;
      }
    }

    return new BoxedNumber(this, value, { metadata });
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

    if (id === 'standard-simplification')
      return this._cache('standard-simplification-rules', () =>
        boxRules(this, SIMPLIFY_RULES, { canonical: true })
      );

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
   * If the `canonical` option is set to `true`, the result will be canonical
   *
   */
  parse(
    latex: null,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): null;
  parse(
    latex: LatexString,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): BoxedExpression;
  parse(
    latex: LatexString | null,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
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
    return this.box(result, { canonical: options?.canonical ?? true });
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
    const pat = this.box(pattern, { canonical: false });
    const result: BoxedSubstitution[] = [];

    const patternHasWildcards = (expr: BoxedExpression): boolean => {
      if (expr.operator?.startsWith('_')) return true;
      if (isWildcard(expr)) return true;
      if (expr.ops) return expr.ops.some(patternHasWildcards);
      return false;
    };

    const pushResult = (m: BoxedSubstitution) => {
      const keys = Object.keys(m).sort();
      for (const prev of result) {
        const prevKeys = Object.keys(prev).sort();
        if (prevKeys.length !== keys.length) continue;
        let same = true;
        for (let i = 0; i < keys.length; i++) {
          if (prevKeys[i] !== keys[i]) {
            same = false;
            break;
          }
          const k = keys[i]!;
          if (!m[k]!.isSame(prev[k]!)) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      result.push(m);
    };

    const assumptions = this.context.assumptions;

    const candidatesFromAssumptions = (): string[] => {
      const candidates = new Set<string>();
      for (const [assumption, val] of assumptions) {
        if (val !== true) continue;
        for (const s of assumption.symbols) candidates.add(s);
      }
      return [...candidates];
    };

    const normalizedInequalityPatterns = (
      expr: BoxedExpression
    ): Array<{ pattern: BoxedExpression; matchPermutations?: boolean }> => {
      const op = expr.operator;
      if (
        op !== 'Less' &&
        op !== 'LessEqual' &&
        op !== 'Greater' &&
        op !== 'GreaterEqual'
      )
        return [{ pattern: expr }];

      const lhs =
        op === 'Greater' || op === 'GreaterEqual' ? expr.op2 : expr.op1;
      const rhs =
        op === 'Greater' || op === 'GreaterEqual' ? expr.op1 : expr.op2;
      const normalizedOp =
        op === 'Less' || op === 'Greater' ? 'Less' : 'LessEqual';

      // Normalize to Less/LessEqual with RHS = 0, matching how assumptions are stored:
      //   Greater(a, b) -> Less(b - a, 0)
      //   Less(a, b)    -> Less(a - b, 0)
      const diff = this.box(['Add', lhs, ['Negate', rhs]], {
        canonical: false,
      });
      return [
        { pattern: expr },
        // For the normalized form, disable permutations: for commutative
        // subexpressions (notably Add), allowing permutations can lead to
        // ambiguous wildcard bindings and duplicate, surprising matches.
        {
          pattern: this.box([normalizedOp, diff, 0], { canonical: false }),
          matchPermutations: false,
        },
      ];
    };

    // B1: Element(x, _T) can be answered from the declared/inferred type of x
    if (pat.operator === 'Element' && pat.op1?.symbol && isWildcard(pat.op2)) {
      const typeWildcard = wildcardName(pat.op2);
      if (typeWildcard && !typeWildcard.startsWith('__')) {
        const symbolType = this.box(pat.op1.symbol).type;
        if (!symbolType.isUnknown) {
          pushResult({
            [typeWildcard]: this.box(symbolType.toString(), {
              canonical: false,
            }),
          });
        }
      }
    }

    // B2: Inequality bound queries, e.g. Greater(x, _k) -> {_k: lowerBound}
    if (
      (pat.operator === 'Greater' ||
        pat.operator === 'GreaterEqual' ||
        pat.operator === 'Less' ||
        pat.operator === 'LessEqual') &&
      isWildcard(pat.op2)
    ) {
      const boundWildcard = wildcardName(pat.op2);
      if (boundWildcard && !boundWildcard.startsWith('__')) {
        const isLower =
          pat.operator === 'Greater' || pat.operator === 'GreaterEqual';
        const isStrict = pat.operator === 'Greater' || pat.operator === 'Less';

        // Symbol on LHS: Greater(x, _k)
        if (pat.op1?.symbol) {
          const bounds = getInequalityBoundsFromAssumptions(
            this,
            pat.op1.symbol
          );
          const bound = isLower ? bounds.lowerBound : bounds.upperBound;
          const strictOk = isLower ? bounds.lowerStrict : bounds.upperStrict;
          if (bound !== undefined && (!isStrict || strictOk === true))
            pushResult({ [boundWildcard]: bound });
        }

        // Wildcard on LHS: Greater(_x, _k)
        if (isWildcard(pat.op1)) {
          const symbolWildcard = wildcardName(pat.op1);
          if (symbolWildcard && !symbolWildcard.startsWith('__')) {
            for (const s of candidatesFromAssumptions()) {
              const bounds = getInequalityBoundsFromAssumptions(this, s);
              const bound = isLower ? bounds.lowerBound : bounds.upperBound;
              const strictOk = isLower
                ? bounds.lowerStrict
                : bounds.upperStrict;
              if (bound === undefined || (isStrict && strictOk !== true))
                continue;
              pushResult({
                [symbolWildcard]: this.box(s, { canonical: true }),
                [boundWildcard]: bound,
              });
            }
          }
        }
      }
    }

    const patternsToTry = normalizedInequalityPatterns(pat);
    for (const [assumption, val] of assumptions) {
      if (val !== true) continue;
      for (const { pattern: p, matchPermutations } of patternsToTry) {
        const m = assumption.match(p, {
          useVariations: true,
          matchPermutations,
        });
        if (m !== null) pushResult(m);
      }
    }

    // B3: For closed predicates (no wildcards), fall back to verify().
    // This makes `ask()` useful for "is this known?" queries even when the
    // fact is not explicitly stored in the assumptions DB (e.g. declarations).
    //
    // IMPORTANT: Skip this if we're already inside a verify() call to prevent
    // infinite recursion. The recursion occurs when:
    //   verify(Equal(x,0)) → Equal.evaluate() → eq() → ask(NotEqual(x,0)) → verify()
    // By checking _isVerifying, we break this cycle.
    if (
      result.length === 0 &&
      !patternHasWildcards(pat) &&
      !this._isVerifying
    ) {
      // Use the canonical form so symbol declarations/definitions are visible
      // to the evaluator.
      const verified = this.verify(this.box(pattern, { canonical: true }));
      if (verified === true) pushResult({});
    }

    return result;
  }

  /**
   * Answer a query based on the current assumptions.
   *
   */

  verify(query: BoxedExpression): boolean | undefined {
    // Prevent recursive verify() -> ask() -> verify() loops
    if (this._isVerifying) return undefined;

    this._isVerifying = true;
    try {
      const boxed = isLatexString(query)
        ? this.parse(query, { canonical: false })
        : this.box(query, { canonical: false });

      const expr = boxed.evaluate();
      if (expr.symbol === 'True') return true;
      if (expr.symbol === 'False') return false;

      const op = expr.operator;

      if (op === 'Not') {
        const result = this.verify(expr.op1);
        if (result === undefined) return undefined;
        return !result;
      }

      if (op === 'And') {
        // Kleene 3-valued logic:
        // - if any operand is false, the result is false
        // - if all operands are true, the result is true
        // - otherwise the result is unknown
        let hasUnknown = false;
        for (const x of expr.ops ?? []) {
          const r = this.verify(x);
          if (r === false) return false;
          if (r === undefined) hasUnknown = true;
        }
        return hasUnknown ? undefined : true;
      }

      if (op === 'Or') {
        // Kleene 3-valued logic:
        // - if any operand is true, the result is true
        // - if all operands are false, the result is false
        // - otherwise the result is unknown
        let hasUnknown = false;
        for (const x of expr.ops ?? []) {
          const r = this.verify(x);
          if (r === true) return true;
          if (r === undefined) hasUnknown = true;
        }
        return hasUnknown ? undefined : false;
      }

      return undefined;
    } finally {
      this._isVerifying = false;
    }
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
    try {
      const pred = isLatexString(predicate)
        ? this.parse(predicate, { canonical: false })
        : this.box(predicate, { canonical: false });

      // The new assumption could affect existing expressions
      this._generation += 1;

      return assume(pred);
    } catch (e) {
      console.error(e.message.toString());
      throw e;
    }
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
    //
    // ## THEORY OF OPERATIONS
    //
    // When forgeting we need to preserve existing definitions for symbols,
    // as some expressions may be pointing to them. Instead, we
    // reset the value of those definitions, but don't change the domain.
    //

    if (symbol === undefined) {
      this.context.assumptions?.clear();

      // The removed assumptions could affect existing expressions
      this._generation += 1;

      return;
    }

    if (Array.isArray(symbol)) {
      for (const x of symbol) this.forget(x);
      return;
    }

    if (typeof symbol === 'string') {
      // Remove any assumptions that make a reference to this symbol
      // (note that when a scope is created, any assumptions from the
      // parent scope are copied over, so this effectively removes any
      // reference to this symbol, even if there are assumptions about
      // it in a parent scope. However, when the current scope exits,
      // any previous assumptions about the symbol will be restored).
      for (const [assumption, _val] of this.context.assumptions) {
        if (assumption.has(symbol)) this.context.assumptions.delete(assumption);
      }

      // Also clear any values that were set for this symbol in the evaluation context.
      // Values can be stored in any frame of the context stack, so we need to check all of them.
      for (const ctx of this._evalContextStack) {
        if (symbol in ctx.values) {
          delete ctx.values[symbol];
        }
      }
    }
    // The removed assumptions could affect existing expressions
    this._generation += 1;
  }
}

function assignValueAsValue(
  ce: ComputeEngine,
  value: AssignValue
): BoxedExpression | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'function') return undefined;

  if (typeof value === 'boolean') return value ? ce.True : ce.False;
  if (typeof value === 'number' || typeof value === 'bigint')
    return ce.number(value);
  const expr = ce.box(value);
  // Explicit function expressions should always be treated as operator definitions
  if (expr.operator === 'Function') return undefined;
  if (expr.unknowns.some((s) => s.startsWith('_'))) {
    // If the expression has wildcards, it should be treated as a function
    // E.g. ["Add", "_", 1] or ["Add", "_x", 1]
    // Note: Regular unknowns (e.g., "x", "a", "b") are fine in values
    return undefined;
  }
  return expr;
}

function assignValueAsOperatorDef(
  ce: ComputeEngine,
  value: AssignValue
): OperatorDefinition | undefined {
  if (typeof value === 'function')
    return { evaluate: value, signature: 'function' };

  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return undefined;

  const body = canonicalFunctionLiteral(ce.box(value));
  if (body === undefined) return undefined;

  // Don't set an explicit signature - let it be inferred from the body.
  // This ensures inferredSignature = true, which allows the return type
  // to be properly narrowed during type checking (e.g., in Add operands).
  return { evaluate: body };
}

function defToString(
  name: string,
  def: BoxedDefinition,
  v?: BoxedExpression
): string {
  let result = '';
  if (isValueDef(def)) {
    const tags: string[] = [];
    if (def.value.holdUntil === 'never') tags.push('(hold never)');
    if (def.value.holdUntil === 'N') tags.push('(hold until N)');

    if (def.value.inferredType) tags.push('inferred');

    const allTags = tags.length > 0 ? ` ${tags.join(' ')}` : '';

    result = `${CYAN}${name}${RESET}:${allTags}`;

    if (def.value.isConstant) {
      result += ` const ${def.value.type.toString()}`;
      if (def.value.value !== undefined)
        result += ` = ${def.value.value?.toString()}`;
      console.assert(v === undefined);
    } else result += ` ${def.value.type.toString()}`;
  } else if (isOperatorDef(def)) {
    const tags: string[] = [];
    if (def.operator.inferredSignature) tags.push('(inferred)');

    const allTags = tags.length > 0 ? ` (${tags.join(' ')})` : '';

    result = `${CYAN}${name}${RESET}:${allTags} ${def.operator.signature.toString()}`;

    const details: string[] = [];

    if (def.operator.lazy) details.push('lazy');
    if (def.operator.scoped) details.push('scoped');
    if (def.operator.broadcastable) details.push('broadcastable');
    if (def.operator.associative) details.push('associative');
    if (def.operator.commutative) details.push('commutative');
    if (def.operator.idempotent) details.push('idempotent');
    if (def.operator.involution) details.push('involution');
    if (!def.operator.pure) details.push('not pure');

    const allDetails = details.map((x) => `${GREY}${x}${RESET}`).join(' ');
    if (allDetails.length > 0) result += `\n   \u2514 ${allDetails}`;
  } else result = 'unknown';

  if (v) {
    if (!v.isValid) {
      result += ` = ${INVERSE_RED}${v.toString()}${RESET} (not valid)`;
    } else if (!v.isCanonical) {
      result += ` = ${YELLOW}${v.toString()}${RESET} (not canonical)`;
    } else {
      result += ` = ${GREY}${v.toString()}${RESET}`;
    }
  }

  return result;
}
