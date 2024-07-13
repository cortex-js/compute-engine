import Complex from 'complex.js';
import { Decimal } from 'decimal.js';

import {
  MathJsonIdentifier,
  MathJsonNumber,
} from '../math-json/math-json-format';

import type {
  LibraryCategory,
  LatexDictionaryEntry,
  LatexString,
  ParseLatexOptions,
} from './latex-syntax/public';

import { assume } from './assume';

import { MACHINE_PRECISION, NUMERIC_TOLERANCE } from './numerics/numeric';

import {
  AssumeResult,
  BoxedFunctionDefinition,
  BoxedSymbolDefinition,
  IComputeEngine,
  IdentifierDefinitions,
  ExpressionMapInterface,
  NumericMode,
  RuntimeScope,
  Scope,
  SymbolDefinition,
  BoxedRuleSet,
  Rule,
  ComputeEngineStats,
  Metadata,
  BoxedDomain,
  DomainExpression,
  FunctionDefinition,
  BoxedSubstitution,
  AssignValue,
  DomainLiteral,
  ArrayValue,
  AngularUnit,
  CanonicalOptions,
} from './public';

import { box, boxFunction, boxNumber } from './boxed-expression/box';

import {
  setIdentifierDefinitions,
  getStandardLibrary,
  isSymbolDefinition,
  isFunctionDefinition,
} from './library/library';

import { DEFAULT_COST_FUNCTION } from './cost-function';
import { ExpressionMap } from './boxed-expression/expression-map';
import { asLatexString, bignumPreferred } from './boxed-expression/utils';
import { boxRules } from './rules';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedNumber } from './boxed-expression/boxed-number';
import { _BoxedSymbolDefinition } from './boxed-expression/boxed-symbol-definition';
import { canonicalPower } from './library/arithmetic-power';
import { BoxedFunction } from './boxed-expression/boxed-function';
import { evalMultiply } from './library/arithmetic-multiply';
import { evalDivide } from './library/arithmetic-divide';
import {
  BoxedSymbol,
  makeCanonicalSymbol,
} from './boxed-expression/boxed-symbol';
import { _BoxedDomain, isDomain } from './boxed-expression/boxed-domain';
import { _BoxedExpression } from './boxed-expression/abstract-boxed-expression';
import { isValidIdentifier, validateIdentifier } from '../math-json/utils';
import {
  makeFunctionDefinition,
  _BoxedFunctionDefinition,
} from './boxed-expression/boxed-function-definition';
import { Rational, inverse, isRational, isOne } from './numerics/rationals';
import { negate } from './symbolic/negate';
import { flattenOps, flattenSequence } from './symbolic/flatten';
import { bigint } from './numerics/numeric-bigint';
import { parseFunctionSignature } from './function-utils';
import { CYAN, INVERSE_RED, RESET, YELLOW } from '../common/ansi-codes';
import {
  DOMAIN_ALIAS,
  DOMAIN_CONSTRUCTORS,
  isDomainLiteral,
} from './library/domains';
import { canonical } from './symbolic/utils';
import { domainToSignature } from './domain-utils';
import {
  IndexedLatexDictionary,
  getLatexDictionary,
  indexLatexDictionary,
} from './latex-syntax/dictionary/definitions';
import { parse } from './latex-syntax/parse';
import {
  BoxedExpression,
  SemiBoxedExpression,
} from './boxed-expression/public';

// To avoid circular dependencies, serializeToJson is forward declared. Type
// to import it.
import './boxed-expression/serialize';
import { SIMPLIFY_RULES } from './simplify-rules';
import { HARMONIZATION_RULES, UNIVARIATE_ROOTS } from './solve';
import { NumericValue } from './numeric-value/public';
import {
  ExactNumericValue,
  ExactNumericValueData,
} from './numeric-value/exact-numeric-value';
import {
  asFloat,
  asMachineInteger,
  asRational,
} from './boxed-expression/numerics';
import { factor } from './boxed-expression/factor';
import { Terms } from './numerics/terms';

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
  // Common domains
  readonly Anything: BoxedDomain;
  readonly Void: BoxedDomain;
  readonly Strings: BoxedDomain;
  readonly Booleans: BoxedDomain;
  readonly Numbers: BoxedDomain;

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
  readonly I: BoxedExpression;
  readonly NaN: BoxedExpression;
  readonly PositiveInfinity: BoxedExpression;
  readonly NegativeInfinity: BoxedExpression;
  readonly ComplexInfinity: BoxedExpression;

  /** The symbol separating the whole part of a number from its fractional
   *  part.
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
  _NUMERIC_VALUE_ZERO: NumericValue;
  _NUMERIC_VALUE_ONE: NumericValue;
  _NUMERIC_VALUE_NEGATIVE_ONE: NumericValue;

  /** @internal */
  private _precision: number;

  /** @internal */
  private _numericMode: NumericMode;

  /** @ internal */
  private _angularUnit: AngularUnit;

  /** @internal */
  private _tolerance: number;
  /** @internal */
  private _bignumTolerance: Decimal;

  /** @internal */
  private _cache: {
    [key: string]: {
      value: any;
      build: () => any;
      purge?: (v: unknown) => void;
    };
  } = {};

  /** @internal */
  private _stats: ComputeEngineStats & { [key: string]: unknown };

  /** @internal */
  private _cost?: (expr: BoxedExpression) => number;

  /** @internal */
  private _commonSymbols: { [symbol: string]: null | BoxedExpression } = {
    True: null,
    False: null,

    All: null,
    Nothing: null,
    None: null,
    Undefined: null,
    // Function: null,

    Pi: null,
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

  /** @internal */
  private _commonDomains: Partial<{
    [dom in DomainLiteral]: null | BoxedDomain;
  }> = {
    Anything: null,
    Void: null,
    NothingDomain: null,
    Booleans: null,
    Strings: null,
    Domains: null,
    Symbols: null,
    Integers: null,
    RationalNumbers: null,
    AlgebraicNumbers: null,
    RealNumbers: null,
    ExtendedRealNumbers: null,
    ImaginaryNumbers: null,
    ComplexNumbers: null,
    ExtendedComplexNumbers: null,
    Numbers: null,
    PositiveIntegers: null,
    TranscendentalNumbers: null,
    PositiveNumbers: null,
    Functions: null, // (Anything*) -> Anything
    NumericFunctions: null, // (Numbers+) -> Numbers
    RealFunctions: null, // (ExtendedRealNumbers+) -> ExtendRealNumbers
    LogicOperators: null, // (Booleans+) -> Boolean
    Predicates: null, // (Anything+) -> Booleans
  };

  /**
   * The current scope.
   *
   * A **scope** stores the definition of symbols and assumptions.
   *
   * Scopes form a stack, and definitions in more recent
   * scopes can obscure definitions from older scopes.
   *
   * The `ce.context` property represents the current scope.
   *
   */
  context: RuntimeScope | null;

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
   * Return identifier tables suitable for the specified categories, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * An identifier table defines how the symbols and function names in a
   * MathJSON expression should be interpreted, i.e. how to evaluate and
   * manipulate them.
   *
   */

  /** @private */
  private _latexDictionaryInput: Readonly<LatexDictionaryEntry[]>;
  /** @private */
  _indexedLatexDictionary: IndexedLatexDictionary;

  static getStandardLibrary(
    categories: LibraryCategory[] | LibraryCategory | 'all' = 'all'
  ): readonly IdentifierDefinitions[] {
    return getStandardLibrary(categories);
  }

  /**
   * Construct a new `ComputeEngine` instance.
   *
   * Identifier tables define functions and symbols (in `options.ids`).
   * If no table is provided the MathJSON Standard Library is used (`ComputeEngine.getStandardLibrary()`)
   *
   * The LaTeX syntax dictionary is defined in `options.latexDictionary`.
   *
   * The order of the dictionaries matter: the definitions from the later ones
   * override the definitions from earlier ones. The first dictionary should
   * be the `'core'` dictionary which include some basic definitions such
   * as domains (`Booleans`, `Numbers`, etc...) that are used by later
   * dictionaries.
   *
   * @param options.numericMode The default mode is `"auto"`. Use `"machine"`
   * to perform numeric calculations using 64-bit floats. Use `"bignum"` to
   * perform calculations using arbitrary precision floating point numbers.
   * Use `"auto"` or `"complex"` to allow calculations on complex numbers.
   *
   * @param options.numericPrecision Specific how many digits of precision
   * for the numeric calculations. Default is 100.
   *
   * @param options.tolerance If the absolute value of the difference of two
   * numbers is less than `tolerance`, they are considered equal. Used by
   * `chop()` as well.
   */
  constructor(options?: {
    ids?: readonly IdentifierDefinitions[];
    numericMode?: NumericMode;
    numericPrecision?: number;
    tolerance?: number;
  }) {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Unexpected argument');

    this.strict = true;

    this._stats = {
      highwaterMark: 0,
      symbols: new Set<BoxedExpression>(),
      expressions: new Set<BoxedExpression>(),
    };

    // Set the default precision for `bignum` calculations
    this._numericMode = options?.numericMode ?? 'auto';
    this._precision = Math.max(
      options?.numericPrecision ?? 100,
      Math.floor(MACHINE_PRECISION)
    );

    this._bignum = Decimal.clone({ precision: this._precision });

    this.tolerance = options?.tolerance ?? NUMERIC_TOLERANCE;

    this._angularUnit = 'rad';

    this.Zero = new BoxedNumber(this, 0);
    this.One = new BoxedNumber(this, 1);
    this.Half = new BoxedNumber(this, [1, 2]);
    this.NegativeOne = new BoxedNumber(this, -1);
    this.NaN = new BoxedNumber(this, Number.NaN);
    this.PositiveInfinity = new BoxedNumber(this, Number.POSITIVE_INFINITY);
    this.NegativeInfinity = new BoxedNumber(this, Number.NEGATIVE_INFINITY);
    this.I = new BoxedNumber(this, Complex.I);
    this.ComplexInfinity = new BoxedNumber(this, Complex.INFINITY);

    // Reset the caches/create numeric constants
    this.reset();

    //
    // The first, topmost, scope contains additional info
    //
    this.context = {
      assumptions: new ExpressionMap(),
      timeLimit: 2.0, // execution time limit: 2.0 seconds
      memoryLimit: 1.0, // memory limit: 1.0 megabyte
      recursionLimit: 1024,
      iterationLimit: Number.POSITIVE_INFINITY,
    } as RuntimeScope;

    for (const table of ComputeEngine.getStandardLibrary('domains'))
      setIdentifierDefinitions(this, table);

    // Patch-up any missing definitions (domains that were
    // 'forward-declared')
    for (const d of Object.keys(this._commonDomains)) {
      if (this._commonDomains[d] && !this._commonDomains[d]!.symbolDefinition)
        this._commonDomains[d]!.bind();
      else {
        this._commonDomains[d] = new _BoxedDomain(
          this,
          DOMAIN_ALIAS[d] ?? (d as DomainLiteral)
        );
      }
    }

    this.Anything = this._commonDomains.Anything!;
    this.Void = this._commonDomains.Void!;
    this.Strings = this._commonDomains.Strings!;
    this.Booleans = this._commonDomains.Booleans!;
    this.Numbers = this._commonDomains.Numbers!;

    const tables = options?.ids ?? ComputeEngine.getStandardLibrary();
    for (const table of tables) setIdentifierDefinitions(this, table);

    // Populate the table of common symbols
    // (they should be in the global context)
    for (const sym of Object.keys(this._commonSymbols)) {
      const boxedSymbol = new BoxedSymbol(this, sym, { canonical: true });
      boxedSymbol.bind();
      this._commonSymbols[sym] = boxedSymbol;
    }

    this.True = this._commonSymbols.True!;
    this.False = this._commonSymbols.False!;
    this.Pi = this._commonSymbols.Pi!;
    this.E = this._commonSymbols.ExponentialE!;
    this.Nothing = this._commonSymbols.Nothing!;

    // Push a fresh scope to protect global definitions:
    // this will be the "user" scope
    this.pushScope();
  }

  get latexDictionary(): Readonly<LatexDictionaryEntry[]> {
    return this._latexDictionaryInput ?? ComputeEngine.getLatexDictionary();
  }

  set latexDictionary(dic: Readonly<LatexDictionaryEntry[]>) {
    this._latexDictionaryInput = dic;
    this._indexedLatexDictionary = indexLatexDictionary(dic, (sig) => {
      throw Error(
        typeof sig.message === 'string' ? sig.message : sig.message.join(',')
      );
    });
  }

  get indexedLatexDictionary(): IndexedLatexDictionary {
    this._indexedLatexDictionary ??= indexLatexDictionary(
      this.latexDictionary,
      (sig) => console.error(sig)
    );
    return this._indexedLatexDictionary;
  }

  /** After the configuration of the engine has changed, clear the caches
   * so that new values can be recalculated.
   *
   * This needs to happen for example when the numeric precision changes.
   *
   * @internal
   */
  reset(): void {
    console.assert(this._bignum);

    // Recreate the bignum constants (they depend on the engine's precision)
    this._BIGNUM_NEGATIVE_ONE = this.bignum(-1);
    this._BIGNUM_NAN = this.bignum(NaN);
    this._BIGNUM_ZERO = this.bignum(0);
    this._BIGNUM_ONE = this.bignum(1);
    this._BIGNUM_TWO = this.bignum(2);
    this._BIGNUM_HALF = this._BIGNUM_ONE.div(this._BIGNUM_TWO);
    this._BIGNUM_PI = this._BIGNUM_NEGATIVE_ONE.acos();

    // Recreate the numeric values
    this._NUMERIC_VALUE_NEGATIVE_ONE = new ExactNumericValue({
      rational: [-1, 1],
    });
    this._NUMERIC_VALUE_ZERO = new ExactNumericValue({
      rational: [0, 1],
    });
    this._NUMERIC_VALUE_ONE = new ExactNumericValue({
      rational: [1, 1],
    });

    // Reset all the known expressions/symbols
    const symbols = this._stats.symbols.values();
    const expressions = this._stats.expressions!.values();
    this._stats.symbols = new Set<BoxedExpression>();
    this._stats.expressions = new Set<BoxedExpression>();
    for (const s of symbols) s.reset();
    for (const s of expressions) s.reset();

    // Reset all the common  expressions (probably not necessary)
    for (const d of Object.values(this._commonDomains)) d?.reset();
    for (const d of Object.values(this._commonSymbols)) d?.reset();

    // Reset all the definitions
    let scope = this.context;
    while (scope) {
      if (scope.ids) for (const [_k, v] of scope.ids) v.reset();

      // @todo purge assumptions
      scope = scope.parentScope ?? null;
    }

    // Purge any caches
    for (const k of Object.keys(this._cache))
      if (this._cache[k].value) {
        if (!this._cache[k].purge) delete this._cache[k];
        else this._cache[k].value = this._cache[k].purge!(this._cache[k].value);
      }
  }

  /** @internal */
  _register(_expr: BoxedExpression): void {
    // @debug
    // if (this._stats.expressions === null) return;
    // if (expr.symbol) {
    //   console.assert(!this._stats.symbols.has(expr));
    //   this._stats.symbols.add(expr);
    // } else {
    //   console.assert(!this._stats.expressions.has(expr));
    //   this._stats.expressions.add(expr);
    // }

    this._stats.highwaterMark += 1;
  }

  /** @internal */
  _unregister(_expr: BoxedExpression): void {
    // @debug
    // if (this._stats.expressions === null) return;
    // if (expr.symbol) {
    //   console.assert(this._stats.symbols.has(expr));
    //   this._stats.symbols.delete(expr);
    // } else {
    //   console.assert(this._stats.expressions.has(expr));
    //   this._stats.expressions.delete(expr);
    // }
  }

  /** @internal */
  get stats(): ComputeEngineStats {
    const expressions = this._stats.expressions;
    this._stats.expressions = null;

    // @debug-begin
    // const uniques = new Map<string, number>();
    // for (const x of expressions!) {
    //   const latex = x.toJSON();
    //   uniques.set(latex, (uniques.get(latex) ?? 0) + 1);
    // }

    // const top10 = [...uniques.entries()]
    //   .sort(([_k1, c1], [_k2, c2]) => c2 - c1)
    //   .slice(0, 30);

    // const dupes = new Map<string, number>();
    // for (const x of this._stats.symbols)
    //   dupes.set(x.symbol!, (dupes.get(x.symbol!) ?? 0) + 1);

    // const topDupes = [...dupes.entries()]
    //   .sort(([_k1, c1], [_k2, c2]) => c2 - c1)
    //   .filter(([_k, c]) => c > 1)
    //   .slice(0, 30);

    // @debug-end

    this._stats.expressions = expressions;

    return {
      ...this._stats,
      // _dupeSymbols: topDupes,
      // _popularExpressions: top10,
    } as ComputeEngineStats;
  }

  /** @internal */
  _bignum: Decimal.Constructor;

  get precision(): number {
    if (this._numericMode === 'machine' || this._numericMode === 'complex')
      return Math.floor(MACHINE_PRECISION);
    return this._precision;
  }

  /** The precision, or number of significant digits, of numeric
   * calculations when the numeric mode is `"auto"` or `"bignum"`.
   *
   * To make calculations using more digits, at the cost of expanded memory
   * usage and slower computations, set the `precision` higher.
   *
   * If the numeric mode is not `"auto"` or `"bignum"`, it is set to `"auto"`.
   *
   * Trigonometric operations are accurate for precision up to 1,000.
   *
   */
  set precision(p: number | 'machine') {
    if (p === 'machine') p = Math.floor(MACHINE_PRECISION);
    const currentPrecision = this._precision;

    if (p === currentPrecision) return;

    if (typeof p !== 'number' || p <= 0)
      throw Error('Expected "machine" or a positive number');

    // Set the display precision as requested.
    // It may be less than the effective precision, which is never less than 15

    this._precision = Math.max(p, Math.floor(MACHINE_PRECISION));

    if (
      this._numericMode !== 'auto' &&
      this._numericMode !== 'bignum' &&
      this._precision > Math.floor(MACHINE_PRECISION)
    )
      this._numericMode = 'auto';

    this._bignum = this._bignum.config({ precision: this._precision });

    // Reset the caches
    // (the values in the cache depend on the current precision)
    this.reset();
  }

  get numericMode(): NumericMode {
    return this._numericMode;
  }

  /** {@inheritDoc  NumericMode} */
  set numericMode(f: NumericMode) {
    if (f === this._numericMode) return;

    if (typeof f !== 'string') throw Error('Expected a string');

    this._numericMode = f;
    if (f === 'complex' || f === 'machine')
      this._precision = Math.floor(MACHINE_PRECISION);

    // Reset the caches: the values in the cache depend on the numeric mode)
    this.reset();
  }

  /**
   * The unit used for angles in trigonometric functions.
   * Default is `"rad"` (radians).
   */
  get angularUnit(): AngularUnit {
    return this._angularUnit;
  }

  set angularUnit(u: AngularUnit) {
    if (u === this._angularUnit) return;

    if (typeof u !== 'string') throw Error('Expected a string');

    this._angularUnit = u;
    this.reset();
  }

  /** @experimental */
  get timeLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.timeLimit !== undefined) return scope.timeLimit;
      scope = scope.parentScope ?? null;
    }
    return 2.0; // 2s
  }
  /** @experimental */
  get iterationLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.iterationLimit !== undefined) return scope.iterationLimit;
      scope = scope.parentScope ?? null;
    }
    return 1024;
  }
  /** @experimental */
  get recursionLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.recursionLimit !== undefined) return scope.recursionLimit;
      scope = scope.parentScope ?? null;
    }
    return 1024;
  }

  get tolerance(): number {
    return this._tolerance;
  }
  /**
   * Values smaller than the tolerance are considered to be zero for the
   * purpose of comparison, i.e. if `|b - a| <= tolerance`, `b` is considered
   * equal to `a`.
   */
  set tolerance(val: number) {
    if (typeof val === 'number' && Number.isFinite(val))
      this._tolerance = Math.max(val, 0);
    else this._tolerance = NUMERIC_TOLERANCE;
    this._bignumTolerance = this.bignum(this._tolerance);
  }

  /** Replace a number that is close to 0 with the exact integer 0.
   *
   * How close to 0 the number has to be to be considered 0 is determined by {@linkcode tolerance}.
   */
  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex {
    if (typeof n === 'number' && Math.abs(n) <= this._tolerance) return 0;

    if (n instanceof Decimal && n.abs().lte(this._bignumTolerance)) return 0;

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
      console.error(e);
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

  isBignum(a: unknown): a is Decimal {
    return a instanceof Decimal;
  }

  isComplex(a: unknown): a is Complex {
    return a instanceof Complex;
  }

  _numericValue(
    value: number | Rational | Decimal | Complex | { re?: number; im?: number }
  ): NumericValue {
    // if (bignumPreferred(this))
    // @fixme: handle other Numeric Values, i.e. PreciseExactNumericValue

    if (value === 1) return this._NUMERIC_VALUE_ONE;
    if (value === -1) return this._NUMERIC_VALUE_NEGATIVE_ONE;
    if (value === 0) return this._NUMERIC_VALUE_ZERO;

    let machineValue: Partial<ExactNumericValueData>;
    if (typeof value === 'number') machineValue = { re: value };
    else if (isRational(value))
      machineValue = { rational: value as [number, number] };
    else if (value instanceof Decimal) machineValue = { re: value.toNumber() };
    else if (value instanceof Complex)
      machineValue = { re: value.re, im: value.im };
    else machineValue = value as Partial<ExactNumericValueData>;

    if (machineValue.re && (machineValue.re as any) instanceof Decimal)
      machineValue.re = (machineValue.re as any as Decimal).toNumber();

    // Convert BigRational to Rational
    if (machineValue.rational)
      machineValue.rational = [
        Number(machineValue.rational[0]),
        Number(machineValue.rational[1]),
      ];
    return new ExactNumericValue(machineValue);
  }

  /**
   * Attempt to factor a numeric coefficient `c` and a `rest` out of a
   * canonical expression `expr` such that `ce.mul(c, rest)` is equal to `expr`.
   *
   * Attempts to make `rest` a positive value (i.e. pulls out negative sign).
   *
   * For example:
   *
   * ['Multiply', 2, 'x', 3, 'a']
   *    -> [NumericValue(6), ['Multiply', 'x', 'a']]
   *
   * ['Divide', ['Multiply', 2, 'x'], ['Multiply', 3, 'y', 'a']]
   *    -> [NumericValue({rational: [2, 3]}), ['Divide', 'x', ['Multiply, 'y', 'a']]]
   */

  _toNumericValue(expr: BoxedExpression): [NumericValue, BoxedExpression] {
    console.assert(expr.isCanonical);

    if (expr.symbol === 'ImaginaryUnit')
      return [this._numericValue({ im: 1 }), this.One];
    if (expr.symbol === 'PositiveInfinity')
      return [this._numericValue(Infinity), this.One];
    if (expr.symbol === 'NegativeInfinity')
      return [this._numericValue(-Infinity), this.One];
    if (expr.symbol === 'NaN') return [this._numericValue(NaN), this.One];

    if (expr.head === 'Complex') {
      return [
        this._numericValue({
          re: asFloat(expr.op1) ?? 0,
          im: asFloat(expr.op2) ?? 0,
        }),
        this.One,
      ];
    }

    //
    // Add
    //
    //  use factor() to factor out common factors
    if (expr.head === 'Add') expr = factor(expr);

    //
    // Negate
    //
    if (expr.head === 'Negate') {
      const [coef, rest] = this._toNumericValue(expr.op1);
      return [coef.neg(), rest];
    }

    //
    // Multiply
    //
    if (expr.head === 'Multiply') {
      const rest: BoxedExpression[] = [];
      let coef = this._NUMERIC_VALUE_ONE;
      for (const arg of expr.ops!) {
        const [c, r] = this._toNumericValue(arg);
        coef = coef.mul(c);
        if (!r.isOne) rest.push(r);
      }
      if (rest.length === 0) return [coef, this.One];
      if (rest.length === 1) return [coef, rest[0]];
      return [coef, this.function('Multiply', rest)];
    }

    //
    // Divide
    //
    if (expr.head === 'Divide') {
      const [coef1, numer] = this._toNumericValue(expr.op1);
      const [coef2, denom] = this._toNumericValue(expr.op2);
      const coef = coef1.div(coef2);
      if (denom.isOne) return [coef, numer];
      return [coef, this.function('Divide', [numer, denom])];
    }

    //
    // Power
    //
    if (expr.head === 'Power') {
      // We can only extract a coef if the exponent is a literal
      if (expr.op2.numericValue === null)
        return [this._NUMERIC_VALUE_ONE, expr];

      // eslint-disable-next-line prefer-const
      let [coef, base] = this._toNumericValue(expr.op1);
      if (coef.isOne) return [coef, expr];

      const exponent = asMachineInteger(expr.op2);
      if (exponent !== null)
        return [coef.pow(exponent), this.function('Power', [base, expr.op2])];

      if (asFloat(expr.op2) === 0.5)
        return [coef.sqrt(), this.function('Sqrt', [base])];

      return [this._NUMERIC_VALUE_ONE, expr];
    }

    if (expr.head === 'Sqrt') {
      const [coef, rest] = this._toNumericValue(expr.op1);
      return [coef.sqrt(), this.function('Sqrt', [rest])];
    }

    //
    // Abs
    //
    if (expr.head === 'Abs') {
      const [coef, rest] = this._toNumericValue(expr.op1);
      return [coef.abs(), this.function('Abs', [rest])];
    }
    console.assert(expr.head !== 'Complex');
    console.assert(expr.head !== 'Exp');
    console.assert(expr.head !== 'Root');

    // @todo:  could consider others.. `Ln`, trig functions

    //
    // Literal
    //

    // Make the part positive if the real part is negative
    const v = expr.numericValue;
    if (typeof v === 'number' || isRational(v) || v instanceof Decimal)
      return [this._numericValue(v), this.One];
    if (v instanceof Complex) return [this._numericValue(v), this.One];

    const r = asRational(expr);
    return r
      ? [this._numericValue(r), this.One]
      : [this._NUMERIC_VALUE_ONE, expr];
  }

  _fromNumericValue(
    coeff: NumericValue,
    expr?: BoxedExpression
  ): BoxedExpression {
    if (coeff.isZero) return this.Zero;
    if (expr?.isOne) expr = undefined;
    if (coeff.isOne) return expr ?? this.One;
    if (coeff.isNegativeOne) return expr ? expr.neg() : this.NegativeOne;

    if (!expr && coeff.radical === 1 && isOne(coeff.rational) && coeff.im === 0)
      return this.number(coeff.bignumRe ?? coeff.re);

    const terms: BoxedExpression[] = expr ? [expr] : [];

    let sign = 1;

    if (coeff.sign !== 0) {
      // There is some real part
      if (!coeff.isExact) {
        // The real part is a floating point number
        terms.push(this.number(coeff.bignumRe ?? coeff.re));
      } else {
        // The real part is a rational and/or radical
        if (coeff.sign < 0) sign = -1;

        if (coeff.radical === 1) {
          // No radical, but a rational part
          if (!isOne(coeff.rational)) terms.push(this.number(coeff.rational));
        } else {
          // At least a radical, maybe a rational as well.
          const radical = this._fn('Sqrt', [this.number(coeff.radical)]);
          if (isOne(coeff.rational)) terms.push(radical);
          else {
            const [n, d] = coeff.rational;
            if (d === 1) {
              if (n === 1) terms.push(radical);
              else terms.push(this._fn('Multiply', [this.number(n), radical]));
            } else {
              if (n === 1)
                terms.push(this._fn('Divide', [radical, this.number(d)]));
              else
                terms.push(
                  this._fn('Divide', [
                    this._fn('Multiply', [this.number(n), radical]),
                    this.number(d),
                  ])
                );
            }
          }
        }
      }
    }

    let result: BoxedExpression;
    if (coeff.im === 0) {
      if (terms.length === 0) return this.Zero;
      result = terms.length === 1 ? terms[0] : this.function('Multiply', terms);
      if (sign < 0) return result.neg();
      return result;
    }

    if (terms.length === 0) return this.number(this.complex(0, coeff.im));

    result = terms.length === 1 ? terms[0] : this.function('Multiply', terms);
    if (sign < 0) return result.neg();
    return this.function('Add', [
      result,
      this.number(this.complex(0, coeff.im)),
    ]);
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
   *    identifierTrigger: "concat",
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
   * Return a matching symbol definition, starting with the current
   * scope and going up the scope chain. Prioritize finding a match by
   * wikidata, if provided.
   */
  lookupSymbol(
    symbol: string,
    wikidata?: string,
    scope?: RuntimeScope
  ): undefined | BoxedSymbolDefinition {
    // @fastpath
    if (!this.strict) {
      scope ??= this.context ?? undefined;
      while (scope) {
        const def = scope.ids?.get(symbol);
        if (def && def instanceof _BoxedSymbolDefinition) return def;
        scope = scope.parentScope;
      }
      return undefined;
    }

    if (typeof symbol !== 'string') throw Error('Expected a string');

    if (symbol.length === 0 || !this.context) return undefined;

    const rootScope = scope ?? this.context;

    // Try to find a match by wikidata
    if (wikidata) {
      scope = rootScope;
      while (scope) {
        if (scope.ids)
          for (const [_, d] of scope.ids) {
            if (d instanceof _BoxedSymbolDefinition && d.wikidata === wikidata)
              return d;
          }
        scope = scope.parentScope;
      }
    }
    // Match by name
    scope = rootScope;
    while (scope) {
      const def = scope.ids?.get(symbol);
      if (def instanceof _BoxedSymbolDefinition) return def;
      scope = scope.parentScope;
    }
    return undefined;
  }

  /**
   * Return the definition for a function matching this head.
   *
   * Start looking in the current context, than up the scope chain.
   *
   * This is a very rough lookup, since it doesn't account for the domain
   * of the argument or the codomain. However, it is useful during parsing
   * to differentiate between symbols that might represent a function application, e.g. `f` vs `x`.
   */
  lookupFunction(
    head: string | BoxedExpression,
    scope?: RuntimeScope | null
  ): undefined | BoxedFunctionDefinition {
    if (typeof head !== 'string') return undefined;

    if (!this.context) return undefined;

    scope ??= this.context;
    while (scope) {
      const def = scope.ids?.get(head);
      if (def instanceof _BoxedFunctionDefinition) return def;
      scope = scope.parentScope;
    }
    return undefined;
  }

  /**
   * Associate a new definition to a symbol in the current context.
   *
   * If a definition existed previously, it is replaced.
   *
   *
   * For internal use. Use `ce.declare()` instead.
   *
   * @internal
   */
  defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition {
    if (!this.context)
      throw Error('Symbol cannot be defined: no scope available');

    if (name.length === 0 || !isValidIdentifier(name))
      throw Error(`Invalid identifier "${name}": ${validateIdentifier(name)}}`);

    return this._defineSymbol(name, def);
  }

  _defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition {
    this.context!.ids ??= new Map();

    const boxedDef = new _BoxedSymbolDefinition(this, name, def);
    if (boxedDef.name) this.context!.ids.set(boxedDef.name, boxedDef);

    return boxedDef;
  }

  /**
   * Associate a new delookupSymbolfinition to a function in the current context.
   *
   * If a definition existed previously, it is replaced.
   *
   * For internal use. Use `ce.declare()` instead.
   *
   * @internal
   */
  defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition {
    if (!this.context)
      throw Error('Function cannot be defined: no scope available');
    if (name.length === 0 || !isValidIdentifier(name))
      throw Error(`Invalid identifier "${name}": ${validateIdentifier(name)}}`);

    return this._defineFunction(name, def);
  }

  _defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition {
    this.context!.ids ??= new Map();

    const boxedDef = makeFunctionDefinition(this, name, def);

    if (boxedDef.name) this.context!.ids.set(boxedDef.name, boxedDef);

    return boxedDef;
  }

  /**
   *
   * Create a new scope and add it to the top of the scope stack
   *
   * The `scope` argument can be used to specify custom precision,
   * etc... for this scope
   *
   *
   */
  pushScope(scope?: Partial<Scope>): ComputeEngine {
    if (this.context === null) throw Error('No parent scope available');
    this.context = {
      timeLimit: this.context.timeLimit,
      memoryLimit: this.context.memoryLimit,
      recursionLimit: this.context.recursionLimit,
      iterationLimit: this.context.iterationLimit,
      ...(scope ?? {}),
      parentScope: this.context,
      // We always copy the current assumptions in the new scope.
      // This make is much easier to deal with 'inherited' assumptions
      // (and potentially modifying them later) without having to walk back
      // into parent contexts. In other words, calling `ce.forget()` will
      // forget everything **in the current scope**. When exiting the scope,
      // the previous assumptions are restored.
      assumptions: new ExpressionMap(this.context.assumptions),
    };
    return this;
  }

  /** Remove the most recent scope from the scope stack, and set its
   *  parent scope as current. */
  popScope(): ComputeEngine {
    if (!this.context) throw Error('No scope available');

    this.context = this.context.parentScope ?? null;

    if (!this.context) debugger;

    console.assert(this.context);
    return this;
  }

  /** Set the current scope, return the previous scope. */
  swapScope(scope: RuntimeScope | null): RuntimeScope | null {
    const oldScope = this.context;
    this.context = scope;
    if (!this.context) debugger;
    console.assert(this.context);
    return oldScope;
  }

  /**
   * Reset the value of any identifiers that have been assigned a value
   * in the current scope.
   * @internal */
  resetContext(): void {
    // Iterate over all the identifiers of the current scope
    // and reset them
    if (!this.context) return;
    for (const [_, def] of this.context.ids ?? []) {
      if (def instanceof _BoxedSymbolDefinition) {
        if (!def.constant) def.value = undefined;
      } else if (def instanceof _BoxedFunctionDefinition) {
        const sig = def.signature;
        def.signature = {
          ...sig,
          evaluate: undefined,
          N: undefined,
          simplify: undefined,
          canonical: undefined,
        };
      }
    }
  }

  /** @internal */
  _printScope(
    options?: { details?: boolean; maxDepth?: number },
    scope?: RuntimeScope | null,
    depth = 0
  ): RuntimeScope | null {
    options ??= { details: false, maxDepth: 1 };
    scope ??= this.context;
    if (!scope) return null;
    if (options.maxDepth && depth > options.maxDepth) return null;
    const undef = `${YELLOW}[undefined]${RESET}`;
    if (depth === 0) {
      console.group('current scope - level 0');
    } else {
      console.groupCollapsed(
        !scope.parentScope
          ? `root scope - level ${depth}`
          : `scope - level ${depth}`
      );
    }
    if (scope.ids) {
      let count = 0;
      for (const [k, v] of scope.ids) {
        const id = `${CYAN}${k}${RESET}`;
        try {
          if (v instanceof _BoxedSymbolDefinition) {
            const val = v.value?.isValid
              ? v.value.toString()
              : v.value
                ? `${INVERSE_RED}${v.value!.toString()}${RESET}`
                : undef;
            console.info(`${id}: ${v.domain?.toString() ?? undef} = ${val}`);
          } else if (v instanceof _BoxedFunctionDefinition) {
            if (typeof v.signature.evaluate === 'function')
              console.info(
                `${id}(): ${
                  options.details
                    ? v.signature.evaluate.toString()
                    : '[native-code]'
                }`
              );
            else if (v.signature.evaluate === undefined)
              console.info(`${id}(): ${undef}`);
            else console.info(`${id}(): ${v.toString()}`);
          }
          if (count === 11)
            console.groupCollapsed(`... and ${scope.ids.size - count} more`);
          count += 1;
        } catch (err) {
          console.info(`${id}: ${INVERSE_RED}${err.message}${RESET}`);
        }
      }
      if (count >= 11) console.groupEnd();
    }
    if (scope.assumptions) {
      const assumptions = [...scope.assumptions.entries()].map(
        ([k, v]) => `${k}: ${v}`
      );
      if (assumptions.length > 0) {
        console.groupCollapsed(`${assumptions.length} assumptions)`);
        for (const a of assumptions) console.info(a);
        console.groupEnd();
      }
    }
    if (scope.parentScope)
      this._printScope(options, scope.parentScope, depth + 1);

    console.groupEnd();

    return this.context;
  }

  /**
   * Declare an identifier: specify their domain, and other attributes,
   * including optionally a value.
   *
   * Once the domain of an identifier has been declared, it cannot be changed.
   * The domain information is used to calculate the canonical form of
   * expressions and ensure they are valid. If the domain could be changed
   * after the fact, previously valid expressions could become invalid.
   *
   * Use the `Anyting` domain for a very generic domain.
   *
   */
  declare(
    id: string,
    def: BoxedDomain | DomainExpression | SymbolDefinition | FunctionDefinition
  ): ComputeEngine;
  declare(identifiers: {
    [id: string]:
      | BoxedDomain
      | DomainExpression
      | SymbolDefinition
      | FunctionDefinition;
  }): ComputeEngine;
  declare(
    arg1:
      | string
      | {
          [id: string]:
            | BoxedDomain
            | DomainExpression
            | SymbolDefinition
            | FunctionDefinition;
        },
    arg2?:
      | BoxedDomain
      | DomainExpression
      | SymbolDefinition
      | FunctionDefinition
  ): ComputeEngine {
    //
    // If we got an object literal, call `declare` for each entry
    //
    if (typeof arg1 !== 'string' || arg2 === undefined) {
      for (const [id, def] of Object.entries(arg1)) this.declare(id, def);
      return this;
    }

    //
    // Declare a single symbol
    //

    // Function signatures are not valid with `ce.declare`, it must
    // be a plain identifier.
    const [id, args] = parseFunctionSignature(arg1);
    if (args !== undefined) {
      // ce.declare("f(x)", ["Add", "x", 1]) is not valid: the second argument
      // should be a domain or a definition. Use ce.assign() instead.
      throw Error(
        `Unexpected arguments with ${arg1}. Use 'ce.assign()' instead to assign a value, or a use a function definition with 'ce.declare()'.`
      );
    }

    // The special id `Nothing` can never be redeclared.
    // It is also used to indicate that a symbol should be ignored.
    if (id === 'Nothing') return this;

    if (this.context?.ids?.get(id)) {
      const def = this.context.ids.get(id);
      if (def instanceof _BoxedSymbolDefinition && def.inferredDomain) {
        // The domain of this symbol was inferred: it can be redeclared
        // with a different domain

        // Don't replace the def, since other expressions may already be
        // referencing it, but update it.
        if (isSymbolDefinition(arg2)) def.update(arg2);
        else {
          // @todo: could check that the new domain is compatible
          def.domain = this.domain(arg2 as DomainExpression);
          def.inferredDomain = false;
        }
        return this;
      }
      // Note: can't redeclare a symbol as other expressions might reference it
      // now and changing the definition might make them invalid (i.e. not
      // canonical)
      throw Error(
        `Symbol "${id}" has already been declared in the current scope`
      );
    }

    // Can't "undeclare" (set to undefined/null) a symbol either
    const def = arg2;
    if (!def) throw Error(`Expected a definition for ${id}`);

    //
    // Declaring a symbol or function with a definition
    //
    if (isSymbolDefinition(def)) {
      this.defineSymbol(id, def);
      return this;
    }

    if (isFunctionDefinition(def)) {
      this.defineFunction(id, def as FunctionDefinition);
      return this;
    }

    //
    // Declaring an identifier with a domain
    // `ce.declare("f", ["FunctionOf", "Numbers", "Numbers"])`
    // `ce.declare("z", "ComplexNumbers")`
    // `ce.declare("n", ce.Integers)`
    //
    {
      const dom = this.domain(def);
      if (dom.isValid) {
        if (dom.isFunction) {
          this.defineFunction(id, { signature: domainToSignature(dom) });
        } else {
          if (args) throw Error(`Unexpected arguments with domain for "${id}"`);
          this.defineSymbol(id, { domain: dom });
        }
      } else {
        throw Error(
          `Invalid argument for "${id}": use a domain, a FunctionDefinition or a SymbolDefinition`
        );
      }
    }

    return this;
  }

  /** Assign a value to an identifier in the current scope.
   * Use `undefined` to reset the identifier to no value.
   *
   * The identifier should be a valid MathJSON identifier
   * not a LaTeX string.
   *
   * The identifier can take the form "f(x, y") to create a function
   * with two parameters, "x" and "y".
   *
   * If the id was not previously declared, an automatic declaration
   * is done. The domain of the identifier is inferred from the value.
   * To more precisely define the domain of the identifier, use `ce.declare()`
   * instead, which allows you to specify the domain, value and other
   * attributes of the identifier.
   */
  assign(id: string, value: AssignValue): ComputeEngine;
  assign(ids: { [id: string]: AssignValue }): ComputeEngine;
  assign(
    arg1: string | { [id: string]: AssignValue },
    arg2?: AssignValue
  ): ComputeEngine {
    //
    // If we got an object literal, call `assign` for each entry
    //
    if (typeof arg1 === 'object') {
      console.assert(arg2 === undefined);
      for (const [id, def] of Object.entries(arg1)) this.assign(id, def);
      return this;
    }

    const [id, args] = parseFunctionSignature(arg1 as string);

    // Cannot set the value of 'Nothing'
    if (id === 'Nothing') return this;

    let value = arg2 as AssignValue;

    if (typeof value === 'boolean') value = value ? this.True : this.False;

    //
    // Is the value a LaTeX string (starts/ends with $ or $$)?
    // Parse it, as a non-canonical expression.
    // If we parse it as canonical, any unknowns will be auto-declared.
    //
    if (typeof value === 'string') {
      const latex = value.trim();
      if (latex.startsWith('$') && latex.endsWith('$')) {
        value = this.parse(latex.slice(1, -1), { canonical: false });
      } else if (latex.startsWith('$$') && latex.endsWith('$$')) {
        value = this.parse(latex.slice(2, -2), { canonical: false });
      } else {
        // Not a LaTeX string? interpret as a plain string (not a symbol)
        value = this.string(value);
      }
    }

    //
    // 1. The identifier was declared as a symbol in this scope
    //    or a parent scope
    //
    const symDef = this.lookupSymbol(id);
    if (symDef) {
      if (symDef.constant)
        throw Error(`Cannot assign a value to the constant "${id}"`);

      if (!symDef.inferredDomain && isFunctionValue(value))
        throw Error(`Cannot assign a function to symbol "${id}"`);

      // Remove the def to avoid circular references.
      const scope = symDef.scope;
      scope?.ids?.delete(symDef.name!);

      // Make sure the value is not a function
      if (!args && !isFunctionValue(value)) {
        if (value === undefined || value === null) symDef.value = undefined;
        else symDef.value = this.box(value as BoxedExpression);

        // Reinsert the def in the scope
        scope?.ids?.set(symDef.name!, symDef);

        return this;
      }
    }

    //
    // 2. The identifier was declared as a function in this scope or
    //    a parent scope
    //
    const fnDef = this.lookupFunction(id);
    if (fnDef) {
      // Remove the def to avoid circular references.
      const scope = fnDef.scope;
      scope?.ids?.delete(fnDef.name!);

      if (value === undefined || value === null) return this;

      // Will replace definition if it already exists
      if (typeof value === 'function') {
        // Make sure defineFunction acts on the correct scope
        const previousScope = this.swapScope(scope!);
        this.defineFunction(id, { signature: { evaluate: value } });
        this.swapScope(previousScope);
        return this;
      }
      // If it's a function value, it should not have args,
      // since the args are part of the function value
      if (args && isFunctionValue(value))
        throw Error(`Unexpected arguments for "${id}"`);

      // Box value in the current scope
      const val = args
        ? this.box(['Function', value, ...args])
        : this.box(value);

      const previousScope = this.swapScope(scope!);
      this.defineFunction(id, { signature: { evaluate: val } });
      this.swapScope(previousScope);

      return this;
    }

    //
    // 3. The identifier has not been declared yet.
    //

    if (value === undefined || value === null) {
      // If we don't have a value, let type inference or explicit
      // declaration handle it.
      // We still want to reserve a spot for this value, so we declare it.
      this.declare(id, { inferred: true, domain: this.Anything });
      return this;
    }

    //
    // Is it a JS function?
    //
    if (typeof value === 'function') {
      this.defineFunction(id, { signature: { evaluate: value } });
      return this;
    }

    //
    // Is it a function expression?
    //
    if (
      value instanceof _BoxedExpression &&
      value.domain?.base === 'Functions'
    ) {
      this.defineFunction(id, { signature: { evaluate: value } });
      return this;
    }

    //
    // Is it an expression using anonymous parameters or unknowns,
    // or where there arguments declared?
    //
    if (Array.isArray(value) || value instanceof _BoxedExpression || args) {
      // This is a semi-boxed function expression i.e.
      // - a function: `["Add", "x", 1]` or `["Add", "_", 1]`
      // - or a value: ["Add", 1, 2]`

      // Get a non-canonical version: we don't want to have unknowns declared
      // as a side effect of canonicalization.
      let expr = this.box(value, { canonical: false });

      if (expr.head === 'Function') {
        // If no arguments are specified in the signature, add the 'args'
        expr = this.box([
          'Function',
          ...expr.ops!,
          ...(args ?? []).map((x) => this.symbol(x)),
        ]);
        this.defineFunction(id, {
          signature: { evaluate: expr },
        });
        return this;
      }

      const unknowns = [...expr.unknowns].sort();
      if (unknowns.length === 0) {
        // This is a value, not a function: define a symbol
        const value = expr.evaluate();
        this.defineSymbol(id, { value });
        return this;
      }

      // Probably an anonymous function. The unknowns are the parameters.

      // Check if unknowns includes "_" or "_n" where n is a digit
      if (unknowns.some((x) => /\_[\d]+/.test(x))) {
        // This is a function
        expr = this.box(['Function', expr]);
        this.defineFunction(id, { signature: { evaluate: expr } });
        return this;
      }

      // We had some unknowns, but they are not anonymous parameters
      if (args && args.length > 0) {
        this.pushScope();
        expr = this.box(['Function', expr, ...args]);
        this.popScope();
        this.defineFunction(id, {
          signature: { evaluate: expr },
        });
        return this;
      }

      // This is a value, not a function: define a symbol
      // e.g `ce.assign("f", ["Add", "x", 1]))` : no argument declared
      // use `ce.assign("f(x)", ["Add", "x", 1]))` instead
      // or `ce.assign("f", ["Function", ["Add", "x", 1], "x"])`
      this.pushScope();
      value = expr.evaluate();
      this.popScope();
    }

    // It's not a function, it's a symbol
    this.defineSymbol(id, { value });

    return this;
  }

  /**
   * Same as assign(), but for internal use:
   * - skips validity checks
   * - does not auto-declare
   * - if assigning to a function, must pass a JS function
   *
   * @internal
   */

  _assign(id: string, value: AssignValue): ComputeEngine {
    const symDef = this.lookupSymbol(id);
    if (symDef) {
      console.assert(typeof value !== 'function');
      symDef.value = this.box(value as SemiBoxedExpression).evaluate();
      return this;
    }
    const fnDef = this.lookupFunction(id);
    if (fnDef) {
      console.assert(typeof value == 'function');
      const sig = fnDef.signature;
      fnDef.signature = {
        ...sig,
        N: undefined,
        simplify: undefined,
        canonical: undefined,
        evaluate: value as any as () => any,
      };
      return this;
    }

    console.assert(false, `Cannot assign to undeclared symbol "${id}"`);
    return this;
  }

  get assumptions(): ExpressionMapInterface<boolean> {
    if (!this.context) throw Error('No scope available');
    if (this.context.assumptions) return this.context.assumptions;
    // When creating a new context, the assumptions of this context
    // are a copy of all the previous assumptions
    // (as a result, there's no need to check parent assumptions,
    // and it solves the assumptions in a scope that could be contradictory
    // or complementary to previous assumptions).
    this.context.assumptions = new ExpressionMap<boolean>();
    return this.context.assumptions;
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
  shouldContinueExecution(): boolean {
    return this.deadline === undefined || this.deadline >= Date.now();
  }

  /** @internal */
  checkContinueExecution(): void {
    if (!this.shouldContinueExecution()) {
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
  cache<T>(
    cacheName: string,
    build: () => T,
    purge?: (t: T) => T | undefined
  ): T {
    if (this._cache[cacheName] === undefined) {
      try {
        this._cache[cacheName] = { build, purge, value: build() };
      } catch (e) {
        console.error(
          `Fatal error building cache "${cacheName}":\n\t ${e.toString()}`
        );
      }
    }

    return this._cache[cacheName]?.value;
  }

  /** Return a boxed expression from a number, string or semiboxed expression.
   * Calls `ce.function()`, `ce.number()` or `ce.symbol()` as appropriate.
   */
  box(
    expr:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    return box(this, expr, options);
  }

  function(
    head: string,
    ops: SemiBoxedExpression[],
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression {
    return boxFunction(this, head, ops, options);
  }

  /**
   *
   * Shortcut for `this.box(["Error",...])`.
   *
   * The result is canonical.
   */
  // error(
  //   message:
  //     | MathJsonIdentifier
  //     | [MathJsonIdentifier, ...SemiBoxedExpression[]],
  //   where?: SemiBoxedExpression
  // ): BoxedExpression;
  error(
    message:
      | MathJsonIdentifier
      | [MathJsonIdentifier, ...SemiBoxedExpression[]],
    where?: SemiBoxedExpression
  ): BoxedExpression {
    if (where instanceof _BoxedExpression) {
      where = where.json;
    } else if (where && Array.isArray(where) && where[0] === 'LatexString') {
      if (where[1] === undefined || !where[1]) where = '';
      if (typeof where[1] === 'object' && 'str' in where[1] && !where[1].str)
        where = '';
    }

    let msg: BoxedExpression | undefined = undefined;
    if (typeof message === 'string') msg = this.string(message);

    if (!msg && typeof message !== 'string')
      msg = new BoxedFunction(this, 'ErrorCode', [
        this.string(message[0]),
        ...message.slice(1).map((x) => {
          // console.assert(typeof x !== 'string' || isValidIdentifier(x));
          console.assert(typeof x !== 'string'); // For safety, require wrapped symbols or strings
          return this.box(x, { canonical: false });
        }),
      ]);

    if (!where)
      return new BoxedFunction(this, 'Error', [msg!], { canonical: false });

    return new BoxedFunction(
      this,
      'Error',
      [msg!, this.box(where, { canonical: false })],
      { canonical: false }
    );
  }

  domainError(
    expectedDomain: BoxedDomain | DomainLiteral,
    actualDomain: undefined | BoxedDomain,
    where?: SemiBoxedExpression
  ): BoxedExpression {
    const expected = isDomain(expectedDomain)
      ? this.domain(expectedDomain)
      : this.symbol(expectedDomain);

    const actual = actualDomain ? actualDomain : this.symbol('Undefined');

    return this.error(['incompatible-domain', expected, actual], where);
  }

  /**
   * Add a`["Hold"]` wrapper to `expr.
   */
  hold(expr: SemiBoxedExpression): BoxedExpression {
    return this._fn('Hold', [this.box(expr, { canonical: false })]);
  }

  /**
   * Shortcut for `this.box(["Add", ...]).evaluate()`.
   *
   */
  add(...ops: BoxedExpression[]): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    ops = flattenOps(flattenSequence(ops), 'Add').map((x) => x.evaluate());
    return new Terms(this, ops).asExpression();
  }

  /**
   *
   * Shortcut for `this.box(["Multiply", ...]).evaluate()`
   *
   */
  evalMul(...ops: ReadonlyArray<BoxedExpression>): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    const flatOps = flattenOps(flattenSequence(ops), 'Multiply');
    return evalMultiply(this, flatOps);
  }

  /**
   *
   * Shortcut for `this.box(["Divide", num, denom]).evaluate()`
   *
   * The result is canonical.
   */
  div(num: BoxedExpression, denom: BoxedExpression): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    return evalDivide(this, num.canonical, denom.canonical);
  }

  /**
   *
   * Shortcut for `this.box(["Power", base, exponent]).evaluate()`
   *
   */
  pow(
    base: BoxedExpression,
    exponent: number | Rational | BoxedExpression
  ): BoxedExpression {
    // Short path. Note that arguments are **not** validated.

    if (typeof exponent === 'number' || isRational(exponent))
      exponent = this.number(exponent);

    return canonicalPower(base, exponent);
  }

  /**
   *
   * Shortcut for `this.box(["Divide", 1, expr]).evaluate()`
   *
   */
  inv(expr: BoxedExpression): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    if (expr.isOne) return this.One;
    if (expr.isNegativeOne) return this.NegativeOne;
    if (expr.isInfinity) return this.Zero;
    const n = expr.numericValue;
    if (n !== null) {
      if (isRational(n)) return this.number(inverse(n));
      if (typeof n === 'number' && Number.isInteger(n))
        return this.number([1, n]);

      if (n instanceof Decimal && n.isInteger())
        return this.number([BigInt(1), bigint(n)]);
      return this._fn('Divide', [this.One, expr]);
    }

    if (expr.head === 'Sqrt') return this._fn('Sqrt', [this.inv(expr.op1)]);

    if (expr.head === 'Divide') return this._fn('Divide', [expr.op1, expr.op2]);

    // Inverse(expr) -> expr^{-1}
    let e = this.NegativeOne;

    if (expr.head === 'Power') {
      // Inverse(x^{-1}) -> x
      if (expr.op2.isNegativeOne) return expr.op1;

      // Inverse(x^n) -> x^{-n}
      e = expr.op2.neg();
      expr = expr.op1;
    }
    if (e.isNegativeOne) return this._fn('Divide', [this.One, expr]);
    return this._fn('Power', [expr, e]);
  }

  /** Shortcut for `this.box(["Pair", ...])`
   *
   * The result is canonical.
   */
  pair(
    first: BoxedExpression,
    second: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path
    return new BoxedFunction(
      this,
      'Tuple',
      [first.canonical, second.canonical],
      {
        metadata,
        canonical: true,
      }
    );
  }

  /** Shortcut for `this.box(["Tuple", ...])`
   *
   * The result is canonical.
   */
  tuple(elements: number[], metadata?: Metadata): BoxedExpression;
  tuple(elements: BoxedExpression[], metadata?: Metadata): BoxedExpression;
  tuple(
    elements: (number | BoxedExpression)[],
    metadata?: Metadata
  ): BoxedExpression {
    // Short path
    return new BoxedFunction(
      this,
      'Tuple',
      canonical(
        elements.map((x) =>
          typeof x === 'number' ? this.number(x) : x.canonical
        )
      ),
      {
        metadata,
        canonical: true,
      }
    );
  }

  array(
    elements: ArrayValue[] | ArrayValue[][],
    metadata?: Metadata
  ): BoxedExpression {
    // @todo
    // return new BoxedFunction(this, 'List', canonical(elements), {
    //   metadata,
    //   canonical: true,
    // });
    return this.Nothing;
  }

  string(s: string, metadata?: Metadata): BoxedExpression {
    return new BoxedString(this, s, metadata);
  }

  /** Return a boxed symbol */
  symbol(
    name: string,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;

    // Identifiers such as symbol names should use the Unicode NFC canonical form
    name = name.normalize();

    // These three are not symbols (some of them are not even valid
    // identifiers) but they're a common type
    if (name === 'NaN') return this.NaN;
    if (
      name === 'Infinity' ||
      name === '+Infinity' ||
      name === 'PositiveInfinity'
    )
      return this.PositiveInfinity;
    if (name === '-Infinity' || name === 'NegativeInfinity')
      return this.NegativeInfinity;

    // `Half` is a synonym for the rational 1/2
    if (name === 'Half') return this.Half;

    if (this.strict && !isValidIdentifier(name)) {
      const where = options?.metadata?.latex;
      const nameStr = `'${name}'`;
      return this.error(
        ['invalid-identifier', { str: validateIdentifier(name) }],
        where ? ['LatexString', `'${where}'`] : nameStr
      );
    }

    // If there is some LaTeX metadata provided, we can't use the
    // `_commonSymbols` cache, as their LaTeX metadata may not match.
    if (options?.metadata?.latex !== undefined && options.canonical !== true)
      return new BoxedSymbol(this, name, options);

    const result = this._commonSymbols[name];
    // Only use the cache if there is no metadata or it matches
    if (
      result &&
      (!options?.metadata?.wikidata ||
        !result.wikidata ||
        result.wikidata === options.metadata.wikidata)
    )
      return result;

    if (options.canonical === true) return makeCanonicalSymbol(this, name);
    return new BoxedSymbol(this, name, options);
  }

  /** Return a canonical boxed domain.
   *
   * If the domain is invalid, may return an `["Error"]` expression
   *
   */
  domain(
    domain: BoxedDomain | DomainExpression,
    metadata?: Metadata
  ): BoxedDomain {
    if (domain instanceof _BoxedDomain) return domain;

    if (typeof domain === 'string') {
      const expr = this._commonDomains[domain];
      if (expr) return expr;
    }

    // @fastpath: skip validity checks when not in stric mode
    if (!this.strict) {
      if (typeof domain === 'string') {
        const expr = DOMAIN_ALIAS[domain];
        if (expr) return this.domain(expr);
      }
      return new _BoxedDomain(this, domain as DomainExpression, metadata);
    }

    // Wrapped in a `Domain` expression
    if (Array.isArray(domain) && (domain[0] as string) === 'Domain')
      domain = domain[1] as DomainExpression;

    if (typeof domain === 'string') {
      const expr = DOMAIN_ALIAS[domain];
      if (expr) return this.domain(expr);
      if (!isDomainLiteral(domain))
        throw Error('Expected a domain literal, got ' + domain);
      return new _BoxedDomain(this, domain, metadata);
    }

    if (!Array.isArray(domain) || domain.length === 0)
      throw Error('Expected a valid domain');

    const constructor = domain[0];

    if (!DOMAIN_CONSTRUCTORS.includes(constructor))
      throw Error('Expected a domain constructor, got ' + constructor);
    return new _BoxedDomain(this, domain, metadata);
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
      | MathJsonNumber
      | Decimal
      | Complex
      | Rational,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;
    if (options.canonical === 'Number') options.canonical = true;
    if (
      Array.isArray(options.canonical) &&
      options.canonical.includes('Number')
    )
      options.canonical = true;

    //
    // Is this number eligible to be a cached number expression?
    // (i.e. it has no associated metadata)
    //
    if (options.metadata === undefined) {
      if (typeof value === 'bigint') {
        if (value === BigInt(1)) return this.One;
        if (value === BigInt(0)) return this.Zero;
        if (value === BigInt(-1)) return this.NegativeOne;
      }
      if (typeof value === 'number') {
        const n = value;
        if (n === 1) return this.One;
        if (n === 0) return this.Zero;
        if (n === -1) return this.NegativeOne;

        if (Number.isInteger(n) && this._commonNumbers[n] !== undefined) {
          if (this._commonNumbers[n] === null)
            this._commonNumbers[n] = boxNumber(this, value) ?? this.NaN;
          return this._commonNumbers[n]!;
        }

        if (Number.isNaN(n)) return this.NaN;

        if (!Number.isFinite(n))
          return n < 0 ? this.NegativeInfinity : this.PositiveInfinity;
      }
    }

    if (typeof value === 'bigint') value = this.bignum(value);

    return (
      boxNumber(this, value, {
        metadata: options.metadata,
        canonical: options.canonical === true,
      }) ?? this.NaN
    );
  }

  rules(rules: Rule[]): BoxedRuleSet {
    return boxRules(this, rules);
  }

  getRuleSet(id?: string): BoxedRuleSet | undefined {
    id ??= 'standard-simplification';

    if (id === 'standard-simplification')
      return this.cache('standard-simplification-rules', () =>
        boxRules(this, SIMPLIFY_RULES)
      );

    if (id === 'solve-univariate')
      return this.cache('univariate-roots-rules', () =>
        boxRules(this, UNIVARIATE_ROOTS)
      );

    if (id === 'harmonization')
      return this.cache('harmonization-rules', () =>
        boxRules(this, HARMONIZATION_RULES)
      );

    return undefined;
  }

  /**
   * Return a function expression, but the caller is responsible for making
   * sure that the arguments are canonical.
   *
   * Unlike ce.function(), the head of the  result is the head argument.
   * Calling this function directly is potentially unsafe, as it bypasses
   * the canonicalization of the arguments.
   *
   * For example:
   *
   * - `ce._fn('Multiply', [1, 'x'])` returns `['Multiply', 1, 'x']` as a canonical expression, even though it doesn't follow the canonical form
   * - `ce.function('Multiply', [1, 'x']` returns `'x'` which is the correct canonical form
   *
   * @internal */
  _fn(
    head: string | BoxedExpression,
    ops: BoxedExpression[],
    options?: Metadata & { canonical?: boolean }
  ): BoxedExpression {
    const canonical = options?.canonical ?? true;
    return new BoxedFunction(this, head, ops, { ...options, canonical });
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

      skipSpace: true,
      parseNumbers: 'auto',
      getIdentifierType: (id) => {
        const def = this.lookupFunction(id);
        if (def) return 'function';
        // const def = this.lookupSymbol(id);
        // if (def?.domain) return 'symbol';
        return 'symbol';
      },
      parseUnexpectedToken: (lhs, parser) => null,
      preserveLatex: false,
    };

    const result = parse(
      asLatexString(latex) ?? latex,
      this.indexedLatexDictionary,
      { ...defaultOptions, ...options }
    );
    if (!result) throw Error('Failed to parse LaTeX string');
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
  ask(pattern: SemiBoxedExpression): BoxedSubstitution[] {
    const pat = this.box(pattern, { canonical: false });
    const result: BoxedSubstitution[] = [];
    for (const [assumption, val] of this.assumptions) {
      const m = pat.match(assumption, {
        numericTolerance: this._tolerance,
      });
      if (m !== null && val === true) result.push(m);
    }
    return result;
  }

  /**
   * Answer a query based on the current assumptions.
   *
   */

  verify(_query: SemiBoxedExpression): boolean {
    // @todo
    return false;
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
  assume(predicate: SemiBoxedExpression): AssumeResult {
    try {
      return assume(this.box(predicate, { canonical: false }));
    } catch (e) {
      console.error(e.toString());
      return 'internal-error';
    }
  }

  /** Remove all assumptions about one or more symbols */
  forget(symbol: undefined | string | string[]): void {
    if (!this.context) throw Error('No scope available');

    //
    // ## THEORY OF OPERATIONS
    //
    // When forgeting we need to preserve existing definitions for symbols,
    // as some expressions may be pointing to them. Instead, we
    // reset the value of those definitions, but don't change the domain.
    //

    if (symbol === undefined) {
      if (this.context.ids)
        for (const k of this.context.ids.keys()) this.forget(k);

      this.assumptions.clear();
      return;
    }

    if (Array.isArray(symbol)) {
      for (const x of symbol) this.forget(x);
      return;
    }

    if (typeof symbol === 'string') {
      // Remove symbol definition in the current scope (if any)
      if (this.context.ids) {
        const def = this.context.ids.get(symbol);
        if (def instanceof _BoxedSymbolDefinition) def.value = undefined;
        else if (def instanceof _BoxedFunctionDefinition) {
          const sig = def.signature;
          def.signature = {
            ...sig,
            evaluate: undefined,
            N: undefined,
            simplify: undefined,
            canonical: undefined,
          };
        }
      }
      // Remove any assumptions that make a reference to this symbol
      // (note that when a scope is created, any assumptions from the
      // parent scope are copied over, so this effectively removes any
      // reference to this symbol, even if there are assumptions about
      // it in a parent scope. However, when the current scope exits,
      // any previous assumptions about the symbol will be restored).
      for (const [assumption, _val] of this.assumptions) {
        if (assumption.symbols.includes(symbol))
          this.assumptions.delete(assumption);
      }
    }
  }
}

/** Return true if the value is a function  */
function isFunctionValue(value: AssignValue): boolean {
  if (typeof value === 'function') return true;
  if (value instanceof _BoxedExpression && value.domain?.base === 'Functions')
    return true;

  return false;
}
