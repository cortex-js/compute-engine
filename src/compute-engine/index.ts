import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import {
  Expression,
  MathJsonIdentifier,
  MathJsonNumber,
} from '../math-json/types';

import { assume } from './assume';

import {
  DEFAULT_PRECISION,
  DEFAULT_TOLERANCE,
  MACHINE_PRECISION,
  MAX_BIGINT_DIGITS,
  SMALL_INTEGER,
} from './numerics/numeric';

import {
  SymbolDefinition,
  FunctionDefinition,
  AngularUnit,
  AssignValue,
  AssumeResult,
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedRule,
  BoxedRuleSet,
  BoxedSubstitution,
  BoxedSymbolDefinition,
  CanonicalOptions,
  ComputeEngineStats,
  EvaluateOptions,
  ExpressionMapInterface,
  IdentifierDefinitions,
  Metadata,
  Rule,
  RuntimeScope,
  Scope,
  SemiBoxedExpression,
  ComputeEngine as IComputeEngine,
} from './global-types';

import { box, boxFunction } from './boxed-expression/box';

import {
  setIdentifierDefinitions,
  getStandardLibrary,
} from './library/library';

import { DEFAULT_COST_FUNCTION } from './cost-function';
import { ExpressionMap } from './boxed-expression/expression-map';
import {
  asLatexString,
  isFunctionDefinition,
  isLatexString,
  isSymbolDefinition,
} from './boxed-expression/utils';
import { boxRules } from './boxed-expression/rules';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedNumber, canonicalNumber } from './boxed-expression/boxed-number';
import { _BoxedSymbolDefinition } from './boxed-expression/boxed-symbol-definition';
import { BoxedFunction } from './boxed-expression/boxed-function';
import {
  BoxedSymbol,
  makeCanonicalSymbol,
} from './boxed-expression/boxed-symbol';
import { _BoxedExpression } from './boxed-expression/abstract-boxed-expression';
import {
  makeFunctionDefinition,
  _BoxedFunctionDefinition,
} from './boxed-expression/boxed-function-definition';
import type { BigNum, Rational } from './numerics/types';
import { isMachineRational, isRational } from './numerics/rationals';
import { applicable, parseFunctionSignature } from './function-utils';
import { CYAN, INVERSE_RED, RESET, YELLOW } from '../common/ansi-codes';
import {
  type IndexedLatexDictionary,
  getLatexDictionary,
  indexLatexDictionary,
} from './latex-syntax/dictionary/definitions';
import { parse } from './latex-syntax/parse';

// To avoid circular dependencies, serializeToJson is forward declared. Type
// to import it.
import './boxed-expression/serialize';
import { SIMPLIFY_RULES } from './symbolic/simplify-rules';
import {
  HARMONIZATION_RULES,
  UNIVARIATE_ROOTS,
} from './boxed-expression/solve';
import {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from './numeric-value/types';
import { ExactNumericValue } from './numeric-value/exact-numeric-value';
import { BigNumericValue } from './numeric-value/big-numeric-value';
import { MachineNumericValue } from './numeric-value/machine-numeric-value';
import {
  isValidIdentifier,
  validateIdentifier,
} from '../math-json/identifiers';
import type {
  LatexDictionaryEntry,
  LatexString,
  LibraryCategory,
  ParseLatexOptions,
} from './latex-syntax/types';
import type { OneOf } from '../common/one-of';
import { hidePrivateProperties } from '../common/utils';
import { bigint } from './numerics/bigint';
import { Type, TypeString } from '../common/type/types';
import { isSignatureType, isValidType } from '../common/type/utils';
import { parseType } from '../common/type/parse';
import { isSubtype } from '../common/type/subtype';
import { BoxedType } from '../common/type/boxed-type';
import { typeToString } from '../common/type/serialize';

export * from './global-types';

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

  /**
   * Generation.
   *
   * The generation is incremented each time the context changes.
   * It is used to invalidate caches.
   * @internal
   */
  generation: number = 0;

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

  /** @internal */
  private _latexDictionaryInput: Readonly<LatexDictionaryEntry[]>;

  /** @internal */
  _indexedLatexDictionary: IndexedLatexDictionary;

  /** @internal */
  _bignum: Decimal.Constructor;

  static getStandardLibrary(
    categories: LibraryCategory[] | LibraryCategory | 'all' = 'all'
  ): readonly IdentifierDefinitions[] {
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
   * Construct a new `ComputeEngine` instance.
   *
   * Identifier tables define functions and symbols (in `options.ids`).
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
    ids?: readonly IdentifierDefinitions[];
    precision?: number | 'machine';
    tolerance?: number | 'auto';
  }) {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Unexpected argument');

    this.strict = true;

    this._stats = {
      highwaterMark: 0,
      symbols: new Set<BoxedExpression>(),
      expressions: new Set<BoxedExpression>(),
    };

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

    // Reset the caches/create numeric constants
    this.reset();

    //
    // The first, topmost, scope contains additional info
    //
    this.context = {
      assumptions: new ExpressionMap<boolean>(),
    };

    for (const table of ComputeEngine.getStandardLibrary('domains'))
      setIdentifierDefinitions(this, table);

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

    hidePrivateProperties(this);
  }

  toString(): string {
    return '[ComputeEngine]';
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

    this.generation += 1;

    // Recreate the bignum constants (they depend on the engine's precision)
    this._BIGNUM_NEGATIVE_ONE = this.bignum(-1);
    this._BIGNUM_NAN = this.bignum(NaN);
    this._BIGNUM_ZERO = this.bignum(0);
    this._BIGNUM_ONE = this.bignum(1);
    this._BIGNUM_TWO = this.bignum(2);
    this._BIGNUM_HALF = this._BIGNUM_ONE.div(this._BIGNUM_TWO);
    this._BIGNUM_PI = this._BIGNUM_NEGATIVE_ONE.acos();

    // Reset all the known expressions/symbols
    const symbols = this._stats.symbols.values();
    const expressions = this._stats.expressions!.values();
    this._stats.symbols = new Set<BoxedExpression>();
    this._stats.expressions = new Set<BoxedExpression>();
    for (const s of symbols) s.reset();
    for (const s of expressions) s.reset();

    // Reset all the common  expressions (probably not necessary)
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
    this.reset();
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
    this.reset();
  }

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

  get iterationLimit(): number {
    return this._iterationLimit;
  }
  set iterationLimit(t: number) {
    if (t <= 0) t = Number.POSITIVE_INFINITY;
    this._iterationLimit = t;
  }

  private _iterationLimit: number = 1024;

  get recursionLimit(): number {
    return this._recursionLimit;
  }
  set recursionLimit(t: number) {
    if (t <= 0) t = Number.POSITIVE_INFINITY;
    this._recursionLimit = t;
  }

  private _recursionLimit: number = 1024;

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
   * Return the definition for a function with this operator name.
   *
   * Start looking in the current context, than up the scope chain.
   *
   * This is a very rough lookup, since it doesn't account for the domain
   * of the argument or the codomain. However, it is useful during parsing
   * to differentiate between symbols that might represent a function application, e.g. `f` vs `x`.
   */
  lookupFunction(
    name: MathJsonIdentifier,
    scope?: RuntimeScope | null
  ): undefined | BoxedFunctionDefinition {
    if (typeof name !== 'string') return undefined;

    if (!this.context) return undefined;

    scope ??= this.context;
    while (scope) {
      const def = scope.ids?.get(name);
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

    this.generation += 1;

    return boxedDef;
  }

  /**
   * Associate a new FunctionDefinition to a function in the current context.
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

    this.generation += 1;

    return boxedDef;
  }

  /**
   *
   * Create a new scope and add it to the top of the scope stack
   *
   */
  pushScope(scope?: Partial<Scope>): IComputeEngine {
    if (this.context === null) throw Error('No parent scope available');
    this.context = {
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
   *  parent scope as the current scope. */
  popScope(): IComputeEngine {
    if (!this.context) throw Error('No scope available');

    this.context = this.context.parentScope ?? null;

    console.assert(this.context);
    return this;
  }

  /** Set the current scope, return the previous scope. */
  swapScope(scope: RuntimeScope | null): RuntimeScope | null {
    const oldScope = this.context;
    if (scope) this.context = scope;

    return oldScope;
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
            console.info(`${id}: ${v.type?.toString() ?? undef} = ${val}`);
          } else if (v instanceof _BoxedFunctionDefinition) {
            if (typeof v.evaluate === 'function')
              console.info(
                `${id}(): ${
                  options.details ? v.evaluate.toString() : '[native-code]'
                }`
              );
            else if (v.evaluate === undefined)
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
        def.evaluate = undefined;
        def.canonical = undefined;
      }
    }
  }

  /**
   * Declare an identifier: specify their type and other attributes,
   * including optionally a value.
   *
   * Once the type of an identifier has been declared, it cannot be changed.
   * The type information is used to calculate the canonical form of
   * expressions and ensure they are valid. If the type could be changed
   * after the fact, previously valid expressions could become invalid.
   *
   * Set the type to `any` type for a very generic type, or use `unknown`
   * if the type is not known yet. If `unknown`, the type will be inferred
   * based on usage.
   *
   * An identifier can be redeclared with a different type, but only if
   * the type of the identifier was inferred. If the domain was explicitly
   * set, the identifier cannot be redeclared.
   *
   */
  declare(
    id: string,
    def: TypeString | OneOf<[Type, SymbolDefinition, FunctionDefinition]>
  ): IComputeEngine;
  declare(identifiers: {
    [id: string]:
      | Type
      | TypeString
      | OneOf<[SymbolDefinition, FunctionDefinition]>;
  }): IComputeEngine;
  declare(
    arg1:
      | string
      | {
          [id: string]:
            | Type
            | TypeString
            | OneOf<[SymbolDefinition, FunctionDefinition]>;
        },
    arg2?: Type | TypeString | OneOf<[SymbolDefinition, FunctionDefinition]>
  ): IComputeEngine {
    //
    // If we got an object literal, call `_declare` for each entry
    //
    if (typeof arg1 !== 'string' || arg2 === undefined) {
      for (const [id, def] of Object.entries(arg1)) this.declare(id, def);
      return this;
    }

    // Function signatures are not valid with `ce.declare`, it must
    // be a plain identifier.
    const [id, args] = parseFunctionSignature(arg1);
    if (args !== undefined) {
      // ce.declare("f(x)", ["Add", "x", 1]) is not valid: the second argument
      // should be a type or a definition. Use ce.assign() instead.
      throw Error(
        `Unexpected arguments "${arg1}". It should be a plain identifier. Use 'ce.assign()' instead to assign a value, or a use a function definition with 'ce.declare()'.`
      );
    }

    // The special id `Nothing` can never be redeclared.
    // It is also used to indicate that a symbol should be ignored,
    // so it's valid, but it doesn't do anything.
    if (id === 'Nothing') return this;

    // Can't "undeclare" (set to undefined/null) an identifier either
    if (!arg2) throw Error(`Expected a definition or type for "${id}"`);

    //
    // Modifying the definition of an identifier?
    //
    if (this.context?.ids?.get(id)) {
      const def = this.context.ids.get(id)!;

      // We're updating the definition of a symbol
      this.generation += 1;

      let isFnDef = false;
      let isSymDef = false;
      try {
        isFnDef = isFunctionDefinition(arg2);
        isSymDef = isSymbolDefinition(arg2);
      } catch (err) {
        // Catch potentially invalid definitions
        console.error(
          [`\nInvalid definition for "${id}"`, err.message].join('\n|   ') +
            '\n'
        );
      }

      if (def instanceof _BoxedSymbolDefinition && def.inferredType) {
        // The type of this symbol was inferred: it can be redeclared
        // with a different type

        if (isFnDef)
          throw new Error(`Cannot redeclare the symbol "${id}" as a function`);

        // Don't replace the def, since other expressions may already be
        // referencing it, but update it.
        if (isSymDef) def.update(arg2 as SymbolDefinition);
        else {
          // @todo: could check that the new type is compatible
          def.type = parseType(arg2 as Type | TypeString);
          def.inferredType = false;
        }
        return this;
      }

      if (def instanceof _BoxedFunctionDefinition && def.inferredSignature) {
        // The domain of this function was inferred: it can be redeclared
        // with a different domain
        if (isFnDef) def.update(arg2 as FunctionDefinition);
        else if (isSymDef)
          throw new Error(`Cannot redeclare the function "${id}" as a symbol`);
        else def.update({ signature: parseType(arg2 as TypeString) });

        return this;
      }
      // Note: can't redeclare a symbol as other expressions might reference it
      // now and changing the definition might make them invalid (i.e. not
      // canonical)
      if (def instanceof _BoxedFunctionDefinition)
        throw Error(
          [
            `The symbol "${id}" has already been declared in the current scope as a function with signature ${def.signature}.`,
            `You may use 'ce.assign("${id}", ...)' to assign a new value to this function.`,
          ].join('\n|   ')
        );
      throw Error(
        [
          `The symbol "${id}" has already been declared in the current scope.`,
          `You may use 'ce.assign("${id}", ...)' to assign a new value to this symbol.`,
        ].join('\n|   ')
      );
    }

    //
    // Declaring a symbol or function with a definition or type
    //

    const def = arg2;
    if (
      typeof def === 'object' &&
      'type' in def &&
      ((typeof def.type === 'string' && isSubtype(def.type, 'function')) ||
        (def.type && !isValidType(def.type)))
    ) {
      throw new Error(
        `Invalid definition for "${id}": use a FunctionDefinition to define a function or use 'ce.declare("${id}", "function")'`
      );
    }

    if (isSymbolDefinition(def)) {
      this.defineSymbol(id, def);
      return this;
    }

    if (isFunctionDefinition(def)) {
      this.defineFunction(id, def as FunctionDefinition);
      return this;
    }

    //
    // Declaring an identifier with a type
    // `ce.declare("f", 'number -> number')`
    // `ce.declare("z", "complex")`
    // `ce.declare("n", "integer")`
    //
    {
      const type = parseType(def);
      if (!isValidType(type)) {
        if (typeof def === 'object' && 'N' in def) {
          throw Error(
            [
              `Invalid argument for "${id}"`,
              'Use `evaluate` handler instead of `N`',
            ].join('\n|   ')
          );
        }
        throw Error(
          [
            `Invalid argument for "${id}"`,
            JSON.stringify(def),
            `Use a type, a \`FunctionDefinition\` or a \`SymbolDefinition\``,
          ].join('\n|   ')
        );
      }

      if (type === 'function') {
        this.defineFunction(id, { signature: '...unknown -> unknown' });
      } else if (isSignatureType(type)) {
        this.defineFunction(id, { signature: type });
      } else {
        console.assert(!args);
        this.defineSymbol(id, { type });
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
   * If the id was not previously declared, assigning a value will declare it.
   * Its type is inferred from the value.
   *
   * To more precisely define the type of the identifier, use `ce.declare()`
   * instead, which allows you to specify the type, value and other
   * attributes of the identifier.
   */
  assign(id: string, value: AssignValue): IComputeEngine;
  assign(ids: { [id: string]: AssignValue }): IComputeEngine;
  assign(
    arg1: string | { [id: string]: AssignValue },
    arg2?: AssignValue
  ): IComputeEngine {
    //
    // If the first argument is an object literal, call `assign` for each key
    //
    if (typeof arg1 === 'object') {
      console.assert(arg2 === undefined);
      for (const [id, def] of Object.entries(arg1)) this.assign(id, def);
      return this;
    }

    const [id, args] = parseFunctionSignature(arg1 as string);

    // Cannot set the value of 'Nothing'
    // @todo: could have a 'locked attribute on the definition
    if (id === 'Nothing') return this;

    let value = arg2 as AssignValue;

    if (typeof value === 'boolean') value = value ? this.True : this.False;

    //
    // 1. The identifier was declared as a symbol in this scope
    //    or a parent scope
    //
    const symDef = this.lookupSymbol(id);
    if (symDef) {
      if (symDef.constant)
        throw Error(`Cannot change the value of the constant "${id}"`);

      if (
        !symDef.type.isUnknown &&
        !symDef.inferredType &&
        isFunctionValue(value)
      )
        throw Error(`Cannot assign a function to symbol "${id}"`);

      // Temporarily remove the def to avoid circular references.
      const scope = symDef.scope;
      scope?.ids?.delete(symDef.name!);

      // Make sure the value is not a function
      if (!args && !isFunctionValue(value)) {
        if (value === undefined || value === null) symDef.value = undefined;
        else symDef.value = this.box(value);

        // Reinsert the def in the scope
        scope?.ids?.set(symDef.name!, symDef);

        this.generation += 1;

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

      // Will replace definitdefineFunctionion if it already exists
      if (typeof value === 'function') {
        // Make sure defineFunction acts on the correct scope
        const previousScope = this.swapScope(scope!);
        this.defineFunction(id, { evaluate: value });
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
      if (!val.isValid) throw Error(`Invalid function ${val.toString()}`);

      const previousScope = this.swapScope(scope!);
      const fn = applicable(val);

      this.defineFunction(id, { evaluate: (xs) => fn(xs) });
      this.swapScope(previousScope);

      this.generation += 1;

      return this;
    }

    //
    // 3. The identifier has not been declared yet.
    //

    if (value === undefined || value === null) {
      // If we don't have a value, let type inference or explicit
      // declaration handle it.
      // We still want to reserve a spot for this value, so we declare it.
      this.declare(id, { inferred: true, type: 'unknown' });
      return this;
    }

    //
    // Is it a JS function?
    //
    if (typeof value === 'function') {
      this.defineFunction(id, { evaluate: value });
      return this;
    }

    //
    // Is it a function expression?
    //
    if (
      value instanceof _BoxedExpression &&
      (value.type.type === 'function' || isSignatureType(value.type.type))
    ) {
      this.defineFunction(id, { evaluate: value, signature: value.type.type });
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

      if (expr.operator === 'Hold') {
        this.defineSymbol(id, { value: expr, type: 'unknown' });
        return this;
      }

      if (expr.operator === 'Function') {
        // If no arguments are specified in the signature, add the 'args'
        expr = this.box([
          'Function',
          ...expr.ops!,
          ...(args ?? []).map((x) => this.symbol(x)),
        ]);
        this.defineFunction(id, { evaluate: expr, signature: expr.type.type });
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
        this.defineFunction(id, { evaluate: expr, signature: expr.type.type });
        return this;
      }

      // We had some unknowns, but they are not anonymous parameters
      if (args && args.length > 0) {
        this.pushScope();
        expr = this.box(['Function', expr, ...args]);
        this.popScope();
        this.defineFunction(id, { evaluate: expr, signature: expr.type.type });
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

  _assign(
    id: string,
    value:
      | BoxedExpression
      | ((
          ops: ReadonlyArray<BoxedExpression>,
          options: Partial<EvaluateOptions> & { engine?: IComputeEngine }
        ) => BoxedExpression | undefined)
  ): void {
    const symDef = this.lookupSymbol(id);
    if (symDef) {
      console.assert(typeof value !== 'function');
      symDef.value = (value as BoxedExpression).evaluate();
      this.generation += 1;
      return;
    }

    const fnDef = this.lookupFunction(id);
    if (fnDef) {
      console.assert(typeof value == 'function');
      fnDef.canonical = undefined;
      fnDef.evaluate = value as any as () => any;
      this.generation += 1;
      return;
    }

    console.assert(false, `Cannot assign to undeclared symbol "${id}"`);
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
    expr: NumericValue | SemiBoxedExpression,
    options?: { canonical?: CanonicalOptions; structural?: boolean }
  ): BoxedExpression {
    return box(this, expr, options);
  }

  function(
    name: string,
    ops: ReadonlyArray<BoxedExpression> | ReadonlyArray<Expression>,
    options?: {
      metadata?: Metadata;
      canonical: CanonicalOptions;
      structural: boolean;
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
      msg = this._fn(
        'ErrorCode',
        message.map((x) => this.string(x))
      );

    let whereExpr: BoxedExpression | undefined = undefined;
    if (where && isLatexString(where)) {
      whereExpr = this._fn('LatexString', [this.string(asLatexString(where)!)]);
    } else if (typeof where === 'string' && where.length > 0) {
      whereExpr = this.string(where);
    }

    const ops = [this.box(msg)];
    if (whereExpr) ops.push(whereExpr);

    return new BoxedFunction(this, 'Error', ops, { canonical: false });
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
    // Short path
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
    return new BoxedType(type);
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

    // These few are not symbols (some of them are not even valid
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
    if (name === 'ComplexInfinity') return this.ComplexInfinity;

    // `Half` is a synonym for the rational 1/2
    if (name === 'Half') return this.Half;

    if (this.strict && !isValidIdentifier(name)) {
      const where = options?.metadata?.latex;
      return this.error(
        ['invalid-identifier', validateIdentifier(name)],
        where ? `$$${where}$$` : name
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
      | MathJsonNumber
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

  getRuleSet(id?: string): BoxedRuleSet | undefined {
    id ??= 'standard-simplification';

    if (id === 'standard-simplification')
      return this.cache('standard-simplification-rules', () =>
        boxRules(this, SIMPLIFY_RULES, { canonical: true })
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
   * Unlike ce.function(), the operator of the  result is the name argument.
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
    name: MathJsonIdentifier,
    ops: ReadonlyArray<BoxedExpression>,
    options?: Metadata & { canonical?: boolean }
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

      skipSpace: true,
      parseNumbers: 'auto',
      getIdentifierType: (id) => {
        const def = this.lookupFunction(id);
        if (def) return 'function';
        // const def = this.lookupSymbol(id);
        // if (def?.domain) return 'symbol';
        return 'symbol';
      },
      parseUnexpectedToken: (_lhs, _parser) => null,
      preserveLatex: false,
    };

    const result = parse(
      asLatexString(latex) ?? latex,
      this.indexedLatexDictionary,
      { ...defaultOptions, ...options }
    );
    if (result === null) throw Error('Failed to parse LaTeX string');
    return this.box(result, { canonical: options?.canonical ?? true });
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
    for (const [assumption, val] of this.assumptions) {
      const m = pat.match(assumption);
      if (m !== null && val === true) result.push(m);
    }
    return result;
  }

  /**
   * Answer a query based on the current assumptions.
   *
   */

  verify(_query: BoxedExpression): boolean {
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
  assume(predicate: BoxedExpression): AssumeResult {
    try {
      const pred = isLatexString(predicate)
        ? this.parse(predicate, { canonical: false })
        : this.box(predicate, { canonical: false });

      // The new assumption could affect existing expressions
      this.generation += 1;

      return assume(pred);
    } catch (e) {
      console.error(e.message.toString());
      throw e;
    }
  }

  /** Remove all assumptions (in the current scope) about one or more symbols */
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

      // The removed assumptions could affect existing expressions
      this.generation += 1;

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
          def.evaluate = undefined;
          def.canonical = undefined;
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
    // The removed assumptions could affect existing expressions
    this.generation += 1;
  }
}

/** Return true if the value is a function  */
function isFunctionValue(
  value: AssignValue
): value is (
  args: ReadonlyArray<BoxedExpression>,
  options: Partial<EvaluateOptions> & { engine?: IComputeEngine }
) => BoxedExpression {
  if (typeof value === 'function') return true;
  if (
    value instanceof _BoxedExpression &&
    isSubtype(value.type.type, 'function')
  )
    return true;

  return false;
}
