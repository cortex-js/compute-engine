import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';

import { Expression, MathJsonNumber } from '../math-json/math-json-format';

import { LatexSyntax } from './latex-syntax/latex-syntax';
import type {
  LibraryCategory,
  LatexDictionary,
  LatexDictionaryEntry,
  LatexString,
  NumberFormattingOptions,
  ParseLatexOptions,
  SerializeLatexOptions,
} from './latex-syntax/public';

import { assume } from './assume';

import { MACHINE_PRECISION, NUMERIC_TOLERANCE } from './numerics/numeric';
import {
  AssumeResult,
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedSymbolDefinition,
  IComputeEngine,
  IdTable,
  ExpressionMapInterface,
  NumericMode,
  Pattern,
  RuntimeScope,
  Scope,
  SemiBoxedExpression,
  SymbolDefinition,
  BoxedRuleSet,
  Rule,
  JsonSerializationOptions,
  ComputeEngineStats,
  Metadata,
  BoxedDomain,
  DomainExpression,
  FunctionDefinition,
  Rational,
  BoxedSubstitution,
  Substitution,
} from './public';
import { box, boxFunction, boxNumber } from './boxed-expression/box';
import {
  setCurrentContextSymbolTable,
  getStandardLibrary,
} from './library/library';
import { DEFAULT_COST_FUNCTION } from './cost-function';
import { ExpressionMap } from './boxed-expression/expression-map';
import { BoxedPattern } from './boxed-expression/boxed-patterns';
import { latexString } from './boxed-expression/utils';
import { boxRules } from './rules';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedNumber } from './boxed-expression/boxed-number';
import { BoxedSymbolDefinitionImpl } from './boxed-expression/boxed-symbol-definition';
import { canonicalPower } from './library/arithmetic-power';
import { BoxedFunction } from './boxed-expression/boxed-function';
import { canonicalMultiply } from './library/arithmetic-multiply';
import { canonicalAdd } from './library/arithmetic-add';
import { canonicalDivide } from './library/arithmetic-divide';
import {
  BoxedSymbol,
  makeCanonicalSymbol,
} from './boxed-expression/boxed-symbol';
import {
  boxDomain,
  isDomain,
  _BoxedDomain,
} from './boxed-expression/boxed-domain';
import { AbstractBoxedExpression } from './boxed-expression/abstract-boxed-expression';
import { isValidIdentifier } from '../math-json/utils';
import { makeFunctionDefinition } from './boxed-expression/boxed-function-definition';
import {
  inverse,
  isBigRational,
  isMachineRational,
  isRational,
} from './numerics/rationals';
import { canonicalNegate } from './symbolic/negate';
import { canonical, flattenOps, flattenSequence } from './symbolic/flatten';
import { isFunctionDefinition, isSymbolDefinition } from './library/utils';
import { bigint } from './numerics/numeric-bigint';

/**
 *
 * To use the CortexJS Compute Engine, create a `ComputeEngine` instance.
 *
 * Use the instance to create expressions with `ce.parse()` and `ce.box()`.
 *
 *
 * ```ts
 * const ce = new ComputeEngine();
 * let expr = ce.parse("e^{i\\pi}");
 * console.log(expr.N().latex);
 * // ➔ "-1"
 *
 * expr = ce.box(["Expand", ["Power", ["Add", "a", "b"], 2]]);
 * console.log(expr.evaluate().latex);
 * // ➔ "a^2 +  2ab + b^2"
 *
 * ```
 */
export class ComputeEngine implements IComputeEngine {
  /** @internal */
  readonly _ZERO: BoxedExpression;
  /** @internal */
  readonly _ONE: BoxedExpression;
  /** @internal */
  readonly _HALF: BoxedExpression;
  /** @internal */
  readonly _NEGATIVE_ONE: BoxedExpression;
  /** @internal */
  readonly _I: BoxedExpression;
  /** @internal */
  readonly _NAN: BoxedExpression;
  /** @internal */
  readonly _POSITIVE_INFINITY: BoxedExpression;
  /** @internal */
  readonly _NEGATIVE_INFINITY: BoxedExpression;
  /** @internal */
  readonly _COMPLEX_INFINITY: BoxedExpression;

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
  /** @internal */
  private _numericMode: NumericMode;
  /** @internal */
  private _latexSyntax?: LatexSyntax; // To parse rules as LaTeX

  /** @internal */
  private _tolerance: number;
  /** @internal */
  private _bignumTolerance: Decimal;

  /** @internal */
  private _cache: {
    [key: string]: {
      value: any;
      build: () => any;
      purge: (v: unknown) => void;
    };
  } = {};

  /** @internal */
  private _stats: ComputeEngineStats & { [key: string]: unknown };

  /** @internal */
  private _cost?: (expr: BoxedExpression) => number;

  /** @internal */
  private _jsonSerializationOptions: JsonSerializationOptions;

  /**
   * During certain operations  (serializing to LaTeX, constructing error
   * messages) we need to use a "raw" JSON serialization without any customization. Setting the `_useRawJsonSerializationOptions` will bypass
   * the `_jsonSerializationOptions` and use `_rawJsonSerializationOptions`
   * instead
   * @internal */
  private _useRawJsonSerializationOptions: boolean;
  private _rawJsonSerializationOptions: JsonSerializationOptions;

  /** The domain of unknown symbols. If `null` unknown symbols do not have a
   * definition automatically associated with them.
   *
   *  @internal
   */
  private _defaultDomain: null | BoxedDomain;

  /** @internal */
  private _commonSymbols: { [symbol: string]: null | BoxedExpression } = {
    True: null,
    False: null,
    Maybe: null,

    All: null,
    Nothing: null,
    None: null,
    Undefined: null,
    Function: null,

    Pi: null,
    ImaginaryUnit: null,
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
  private _commonDomains: { [dom: string]: null | BoxedDomain } = {
    Anything: null,
    Nothing: null,
    Boolean: null,
    MaybeBoolean: null,
    String: null,
    Domain: null,
    Symbol: null,
    Integer: null,
    RationalNumber: null,
    AlgebraicNumber: null,
    RealNumber: null,
    ExtendedRealNumber: null,
    ImaginaryNumber: null,
    ComplexNumber: null,
    ExtendedComplexNumber: null,
    Number: null,
    PositiveInteger: null,
    TranscendentalNumber: null,
    PositiveNumber: null,
    Function: null, // (Anything^n) -> Anything
    NumericFunction: null, // (Number^n) -> Number
    RealFunction: null, // (ExtendedRealNumber^n) -> ExtendRealNumber
    TrigonometricFunction: null, // (ComplexNumber) -> ComplexNumber
    LogicOperator: null, // (Boolean, Boolean) -> Boolean
    Predicate: null, // (Anything^n) -> MaybeBoolean
    RelationalOperator: null, // (Anything, Anything) -> MaybeBoolean
  };

  /** @internal */
  private _latexDictionary?: readonly LatexDictionaryEntry[];

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
  static getStandardLibrary(
    categories: LibraryCategory[] | LibraryCategory | 'all' = 'all'
  ): Readonly<IdTable>[] {
    return getStandardLibrary(categories);
  }

  /**
   * Construct a new `ComputeEngine` instance.
   *
   * Identifier tables define functions and symbols (in `options.ids`).
   * If no table is provided the standard library is used (`ComputeEngine.getStandardLibrary()`)
   *
   * The LaTeX syntax dictionary is defined in `options.latexDictionary`.
   *
   * The order of the dictionaries matter: the definitions from the later ones
   * override the definitions from earlier ones. The first dictionary should
   * be the `'core'` dictionary which include some basic definitions such
   * as domains (`Boolean`, `Number`, etc...) that are used by later dictionaries.
   *
   * @param options.numericMode The default mode is `"auto"`. Use `"machine"`
   * to perform numeric calculations using 64-bit floats. Use `"bignum"` to
   * perform calculations using arbitrary precision floating point numbers.
   * Use `"auto"` or `"complex"` to allow calculations on complex numbers.
   *
   * @param options.numericPrecision Specific how many digits of precision for the
   * numeric calculations. Default is 100.
   *
   * @param options.tolerance If the absolute value of the difference of two numbers
   * is less than `tolerance`, they are considered equal. Used by `chop()` as well.
   *
   * @param options.defaultDomain If an unknown symbol is encountered, assume it should
   * be a variable in this domain. **Default** `ExtendedRealNumber`
   */
  constructor(options?: {
    numericMode?: NumericMode;
    numericPrecision?: number;
    ids?: Readonly<IdTable>[];
    latexDictionary?: readonly LatexDictionaryEntry[];
    tolerance?: number;
    defaultDomain?: string;
  }) {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Unexpected argument');

    this.strict = true;

    this._latexDictionary = options?.latexDictionary;

    this._jsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'dictionary', 'number'],
      metadata: [],
      precision: 'max',
      repeatingDecimals: true,
    };

    this._useRawJsonSerializationOptions = false;
    this._rawJsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'dictionary', 'number'],
      metadata: [],
      precision: 'max',
      repeatingDecimals: false,
    };

    this._stats = {
      highwaterMark: 0,
      symbols: new Set<BoxedExpression>(),
      expressions: new Set<BoxedExpression>(),
    };

    // Prevent creation of definitions for unknown symbols until after
    // we've built the dictionary
    this._defaultDomain = null;

    // Set the default precision for `bignum` calculations
    this._numericMode = options?.numericMode ?? 'auto';
    this._precision = Math.max(
      options?.numericPrecision ?? 100,
      Math.floor(MACHINE_PRECISION)
    );

    this._bignum = Decimal.clone({ precision: this._precision });

    this.tolerance = options?.tolerance ?? NUMERIC_TOLERANCE;

    this._ZERO = new BoxedNumber(this, 0);
    this._ONE = new BoxedNumber(this, 1);
    this._HALF = new BoxedNumber(this, [1, 2]);
    this._NEGATIVE_ONE = new BoxedNumber(this, -1);
    this._I = new BoxedNumber(this, Complex.I);
    this._NAN = new BoxedNumber(this, Number.NaN);
    this._POSITIVE_INFINITY = new BoxedNumber(this, Number.POSITIVE_INFINITY);
    this._NEGATIVE_INFINITY = new BoxedNumber(this, Number.NEGATIVE_INFINITY);
    this._COMPLEX_INFINITY = new BoxedNumber(this, Complex.INFINITY);

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

    const tables = options?.ids ?? ComputeEngine.getStandardLibrary();
    for (const table of tables) setCurrentContextSymbolTable(this, table);

    // Patch-up any missing definitions (domains that were
    // 'forward-declared')
    for (const d of Object.keys(this._commonDomains)) {
      if (this._commonDomains[d] && !this._commonDomains[d]!.symbolDefinition)
        this._commonDomains[d]!.bind(this.context);
      else this._commonDomains[d] = boxDomain(this, d);
    }

    // Populate the table of common symbols (they should be in the global context)
    for (const sym of Object.keys(this._commonSymbols)) {
      this._commonSymbols[sym] = new BoxedSymbol(this, sym, {
        canonical: true,
      });
      this._commonSymbols[sym]!.bind(this.context);
    }

    // Once a scope is set and the default dictionaries)
    // we can reference symbols for the domain names and other constants
    if (options?.defaultDomain) {
      const defaultDomain = this.domain(options.defaultDomain);
      if (defaultDomain.isValid)
        this._defaultDomain = defaultDomain as BoxedDomain;
      else
        this._defaultDomain = this.domain('ExtendedRealNumber') as BoxedDomain;
    } else
      this._defaultDomain = this.domain('ExtendedRealNumber') as BoxedDomain;

    // Push a fresh scope to protect global definitions:
    // this will be the "user" scope
    this.pushScope();
  }

  /** After the configuration of the engine has changed, clear the caches
   * so that new values can be recalculated.
   *
   * This needs to happen for example when the numeric precision changes.
   *
   * @internal
   */
  reset() {
    console.assert(this._bignum);

    // Recreate the bignum constants (they depend on the engine's precision)
    this._BIGNUM_NEGATIVE_ONE = this.bignum(-1);
    this._BIGNUM_NAN = this.bignum(NaN);
    this._BIGNUM_ZERO = this.bignum(0);
    this._BIGNUM_ONE = this.bignum(1);
    this._BIGNUM_TWO = this.bignum(2);
    this._BIGNUM_HALF = this._BIGNUM_ONE.div(this._BIGNUM_TWO);
    this._BIGNUM_PI = this._BIGNUM_NEGATIVE_ONE.acos();

    // Unbind all the known expressions/symbols
    const symbols = this._stats.symbols.values();
    const expressions = this._stats.expressions!.values();
    this._stats.symbols = new Set<BoxedExpression>();
    this._stats.expressions = new Set<BoxedExpression>();
    for (const s of symbols) s.unbind();
    for (const s of expressions) s.unbind();

    // Unbind all the common  expressions (probably not necessary)
    for (const d of Object.values(this._commonDomains)) d?.unbind();
    for (const d of Object.values(this._commonSymbols)) d?.unbind();

    // Reset all the definitions
    let scope = this.context;
    while (scope) {
      if (scope.idTable) for (const [_k, v] of scope.idTable) v.reset();

      // @todo purge assumptions
      scope = scope.parentScope ?? null;
    }

    // Purge any caches
    for (const k of Object.keys(this._cache))
      if (this._cache[k].value) {
        if (!this._cache[k].purge) delete this._cache[k];
        else this._cache[k].value = this._cache[k].purge(this._cache[k].value);
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
  get precision(): number {
    if (this._numericMode === 'machine' || this._numericMode === 'complex')
      return Math.floor(MACHINE_PRECISION);
    return this._precision;
  }

  set precision(p: number | 'machine') {
    if (p === 'machine') p = Math.floor(MACHINE_PRECISION);
    const currentPrecision = this._precision;

    if (p === currentPrecision) return;

    if (typeof p !== 'number' || p <= 0)
      throw Error('Expected "machine" or a positive number');

    // Set the display precision as requested.
    // It may be less than the effective precision, which is never less than 15
    this._latexSyntax?.updateOptions({
      precision: p,
      avoidExponentsInRange: [-6, p],
    });

    this._precision = Math.max(p, Math.floor(MACHINE_PRECISION));

    if (this.jsonSerializationOptions.precision > this._precision)
      this.jsonSerializationOptions = { precision: this._precision };

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

  set numericMode(f: NumericMode) {
    if (f === this._numericMode) return;

    if (typeof f !== 'string') throw Error('Expected a string');

    this._numericMode = f;
    if (f === 'complex' || f === 'machine')
      this._precision = Math.floor(MACHINE_PRECISION);

    // Make sure the display precision is not larger than the computation precision
    if (
      this._latexSyntax &&
      this.latexSyntax.options.precision > this._precision
    )
      this.latexSyntax.updateOptions({ precision: this._precision });

    if (this.jsonSerializationOptions.precision > this._precision)
      this.jsonSerializationOptions = { precision: this._precision };

    // Reset the caches: the values in the cache depend on the numeric mode)
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

  /**
   * If an unknown symbol is encountered, assume it should
   * be a variable in this domain.
   *
   * If set to `null`, unknown symbols will trigger an error.
   *
   * **Default:** `"ExtendedRealNumber"`
   */
  get defaultDomain(): BoxedDomain | null {
    return this._defaultDomain;
  }
  set defaultDomain(domain: BoxedDomain | string | null) {
    if (domain === null) this._defaultDomain = null;
    else {
      const defaultDomain = this.domain(domain);
      if (!defaultDomain.isValid) throw Error(`Invalid domain ${domain}`);
      this._defaultDomain = defaultDomain as BoxedDomain;
    }
  }

  /**
   * Values smaller than the tolerance are considered to be zero for the
   * purpose of comparison, i.e. if `|b - a| <= tolerance`, `b` is considered
   * equal to `a`.
   */
  get tolerance(): number {
    return this._tolerance;
  }
  set tolerance(val: number) {
    if (typeof val === 'number' && Number.isFinite(val))
      this._tolerance = Math.max(val, 0);
    else this._tolerance = NUMERIC_TOLERANCE;
    this._bignumTolerance = this.bignum(this._tolerance);
  }

  /** @internal */
  bignum(a: Decimal.Value | bigint): Decimal {
    if (typeof a === 'bigint') return new this._bignum(a.toString());

    return new this._bignum(a);
  }

  /** @internal */
  complex(a: number | Complex, b?: number): Complex {
    return new Complex(a, b);
  }

  /** Replace a number that is close to 0 with the exact integer 0.
   *
   * How close to 0 the number has to be to be considered 0 is determined by {@link tolerance}.
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

  get latexSyntax(): LatexSyntax {
    if (!this._latexSyntax)
      this._latexSyntax = new LatexSyntax({
        computeEngine: this,
        dictionary: this._latexDictionary,
        precision: this.precision,
        avoidExponentsInRange: [-6, this.precision],
        onError: (err) => {
          throw new Error(err[0].message.toString());
        },
      });
    return this._latexSyntax;
  }

  static getLatexDictionary(
    domain: LibraryCategory | 'all' = 'all'
  ): Readonly<LatexDictionary> {
    return LatexSyntax.getDictionary(domain);
  }

  set costFunction(fn: ((expr: BoxedExpression) => number) | undefined) {
    if (typeof fn !== 'function') this._cost = DEFAULT_COST_FUNCTION;
    this._cost = fn;
  }

  get costFunction(): (expr: BoxedExpression) => number {
    return this._cost ?? DEFAULT_COST_FUNCTION;
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
        const def = scope.idTable?.get(symbol);
        if (isSymbolDefinition(def)) return def;
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
        if (scope.idTable)
          for (const [_, d] of scope.idTable) {
            if (isSymbolDefinition(d) && d.wikidata === wikidata) return d;
          }
        scope = scope.parentScope;
      }
    }
    // Match by name
    scope = rootScope;
    while (scope) {
      const def = scope.idTable?.get(symbol);
      if (isSymbolDefinition(def)) return def;
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
      const def = scope.idTable?.get(head);
      if (isFunctionDefinition(def)) return def;
      scope = scope.parentScope;
    }
    return undefined;
  }

  /**
   * Add (or replace) a definition for a symbol in the current scope.
   */
  defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition {
    if (!this.context)
      throw Error('Symbol cannot be defined: no scope available');
    if (name.length === 0 || !isValidIdentifier(name))
      throw Error('Invalid identifier ' + name);

    if (!this.context.idTable) this.context.idTable = new Map();

    const boxedDef = new BoxedSymbolDefinitionImpl(this, name, def);
    if (boxedDef.name) this.context.idTable.set(boxedDef.name, boxedDef);

    return boxedDef;
  }

  defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition {
    if (!this.context)
      throw Error('Function cannot be defined: no scope available');
    if (name.length === 0 || !isValidIdentifier(name))
      throw Error('Invalid identifier ' + name);

    if (!this.context.idTable) this.context.idTable = new Map();

    const boxedDef = makeFunctionDefinition(this, name, def);

    if (boxedDef.name) this.context.idTable.set(name, boxedDef);

    return boxedDef;
  }

  /**
   *
   * Create a new scope and add it to the top of the scope stack
   *
   * The `options.scope` property can be used to specify custom precision,
   * etc... for this scope
   *
   */
  pushScope(
    ids?: Readonly<IdTable> | Readonly<IdTable>[],
    scope?: Partial<Scope>
  ): void {
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

    // `setCurrentContextDictionary` will associate the definitions in the
    // dictionary with the current scope, so we need to set the scope first
    // above(`this.context =...`);
    if (ids) {
      if (Array.isArray(ids))
        for (const table of ids) setCurrentContextSymbolTable(this, table);
      else setCurrentContextSymbolTable(this, ids);
    }
  }

  /** Remove the topmost scope from the scope stack.
   */
  popScope(): void {
    if (!this.context) throw Error('No scope available');

    const parentScope = this.context?.parentScope;

    this.context = parentScope ?? null;

    console.assert(this.context !== null);
  }

  set(identifiers: Substitution<SemiBoxedExpression | null | undefined>): void {
    // @fastpath
    if (!this.strict) {
      for (const k of Object.keys(identifiers)) {
        if (k !== 'Nothing') {
          const def = this.lookupSymbol(k);
          const idk = identifiers[k];
          if (def) def.value = idk ?? undefined;
          else if (idk !== undefined && idk !== null) {
            // Unknown identifier, define a new one
            const val = this.box(idk);
            if (val.domain.isNumeric)
              this.defineSymbol(k, { value: val, domain: 'Number' });
            else this.defineSymbol(k, { value: val });
          }
        }
      }
      return;
    }

    for (const k of Object.keys(identifiers)) {
      if (k !== 'Nothing') {
        const def = this.lookupSymbol(k);
        const idk = identifiers[k];
        if (idk === undefined || idk === null) {
          if (def) def.value = undefined;
        } else {
          const val = this.box(idk);
          if (def) {
            if (def.domain && !val.domain.isCompatible(def.domain))
              throw Error(
                `Expected value with domain ${def.domain.toString()} for "${k}"`
              );
            def.value = val;
          } else {
            if (val.domain.isNumeric)
              this.defineSymbol(k, { value: val, domain: 'Number' });
            else this.defineSymbol(k, { value: val });
          }
        }
      }
    }
  }

  let(identifiers: IdTable): void {
    for (const k of Object.keys(identifiers)) {
      if (k !== 'Nothing') {
        const def = identifiers[k];
        if (isSymbolDefinition(def)) this.defineSymbol(k, def);
        else if (isFunctionDefinition(def))
          this.defineFunction(k, def as FunctionDefinition);
        else this.set({ [k]: identifiers[k] as SemiBoxedExpression });
      }
    }
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
  cache<T>(cacheName: string, build: () => T, purge: (T) => T | undefined): T {
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

  box(
    expr:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression,
    options?: { canonical?: boolean }
  ): BoxedExpression {
    return box(this, expr, options);
  }

  canonical(xs: SemiBoxedExpression[]): BoxedExpression[] {
    if (!xs.every((x) => x instanceof AbstractBoxedExpression))
      return xs.map((x) => this.box(x));

    const bxs = xs as BoxedExpression[];
    return bxs.every((x) => x.isCanonical) ? bxs : bxs.map((x) => x.canonical);
  }

  fn(
    head: string,
    ops: BoxedExpression[],
    metadata?: Metadata
  ): BoxedExpression {
    return boxFunction(this, head, ops, { metadata, canonical: true });
  }

  /** @internal */
  _fn(
    head: string | BoxedExpression,
    ops: BoxedExpression[],
    metadata?: Metadata
  ): BoxedExpression {
    return new BoxedFunction(this, head, ops, {
      metadata,
      canonical: true,
      def: this.lookupFunction(head, this.context),
    });
  }

  error(
    message: ['invalid-domain', ...SemiBoxedExpression[]],
    where?: SemiBoxedExpression
  ): BoxedDomain;
  error(
    message: string | [string, ...SemiBoxedExpression[]],
    where?: SemiBoxedExpression
  ): BoxedExpression;
  error(
    message: string | [string, ...SemiBoxedExpression[]],
    where?: SemiBoxedExpression
  ): BoxedExpression {
    if (where instanceof AbstractBoxedExpression) {
      where = this.rawJson(where);
    } else if (where && Array.isArray(where) && where[0] === 'Latex') {
      if (where[1] === undefined || !where[1]) where = '';
      if (typeof where[1] === 'object' && 'str' in where[1] && !where[1].str)
        where = '';
    }

    if (Array.isArray(message) && message[0] === 'invalid-domain') {
      return boxDomain(this, [
        'Error',
        ['ErrorCode', "'invalid-domain'", message[1]],
      ]);
    }
    const msg =
      typeof message === 'string'
        ? this.string(message)
        : new BoxedFunction(this, 'ErrorCode', [
            this.string(message[0]),
            ...message.slice(1).map((x) => this.box(x, { canonical: false })),
          ]);

    if (!where)
      return new BoxedFunction(this, 'Error', [msg], { canonical: false });

    return new BoxedFunction(
      this,
      'Error',
      [msg, this.box(where, { canonical: false })],
      { canonical: false }
    );
  }

  hold(expr: SemiBoxedExpression): BoxedExpression {
    return this._fn('Hold', [this.box(expr, { canonical: false })]);
  }

  add(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    const result = canonicalAdd(this, flattenOps(flattenSequence(ops), 'Add'));
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    if (metadata?.wikidata !== undefined) result.wikidata = metadata.wikidata;
    return result;
  }

  neg(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    return canonicalNegate(expr, metadata);
  }

  mul(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    const result = canonicalMultiply(
      this,
      flattenOps(flattenSequence(ops), ' Multiply')
    );
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    if (metadata?.wikidata !== undefined) result.wikidata = metadata.wikidata;
    return result;
  }

  div(
    num: BoxedExpression,
    denom: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    const result = canonicalDivide(this, num, denom);
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    if (metadata?.wikidata !== undefined) result.wikidata = metadata.wikidata;
    return result;
  }

  sqrt(base: BoxedExpression, metadata?: Metadata) {
    return canonicalPower(this, base, this._HALF, metadata);
  }

  pow(
    base: BoxedExpression,
    exponent: number | Rational | BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.

    // The logic here handles the cases where the exponent is a number or Rational
    if (exponent instanceof AbstractBoxedExpression) {
      const num = exponent.numericValue;
      if (num !== null) {
        if (typeof num === 'number') exponent = num;
        if (isRational(num)) exponent = num;
      }
    }

    let e: number | null = null;

    if (typeof exponent === 'number') e = exponent;
    else if (isRational(exponent)) {
      // Is the denominator 1?
      if (isMachineRational(exponent) && exponent[1] === 1) e = exponent[0];
      else if (isBigRational(exponent) && exponent[1] === BigInt(1))
        e = Number(exponent[0]);
    }

    // x^1
    if (e === 1) return base;

    // x^(-1)
    const r = base.numericValue;
    if (e === -1 && r !== null) {
      if (typeof r === 'number' && Number.isInteger(r))
        return this.number([1, r]);
      else if (r instanceof Decimal && r.isInteger())
        return this.number([BigInt(1), bigint(r)]);
      else if (isRational(r)) return this.number([r[1], r[0]] as Rational);
    }

    if (typeof exponent === 'number' || isRational(exponent))
      exponent = this.number(exponent);

    return canonicalPower(this, base, exponent, metadata);
  }

  inv(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    if (expr.isOne) return this._ONE;
    if (expr.isNegativeOne) return this._NEGATIVE_ONE;
    if (expr.isInfinity) return this._ZERO;
    const n = expr.numericValue;
    if (n !== null) {
      if (isRational(n)) return this.number(inverse(n), { metadata });
      if (typeof n === 'number' && Number.isInteger(n))
        return this.number([1, n], { metadata });

      if (n instanceof Decimal && n.isInteger())
        return this.number([BigInt(1), bigint(n)], { metadata });
      return this._fn('Divide', [this._ONE, expr], metadata);
    }

    if (expr.head === 'Sqrt')
      return this._fn('Sqrt', [this.inv(expr.op1)], metadata);

    if (expr.head === 'Divide')
      return this._fn('Divide', [expr[1], expr[0]], metadata);

    if (expr.head === 'Rational')
      return this.number([expr[1], expr[0]], { metadata });

    // Inverse(expr) -> expr^{-1}
    let e = this._NEGATIVE_ONE;

    if (expr.head === 'Power') {
      // Inverse(x^{-1}) -> x
      if (expr.op2.isNegativeOne) return expr.op1;

      // Inverse(x^n) -> x^{-n}
      e = canonicalNegate(expr.op2);
      expr = expr.op1;
    }
    if (e.isNegativeOne) return this._fn('Divide', [this._ONE, expr], metadata);
    return this._fn('Power', [expr, e], metadata);
  }

  pair(
    first: BoxedExpression,
    second: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path
    return new BoxedFunction(this, 'Tuple', [first, second], {
      metadata,
      canonical: true,
    });
  }

  tuple(elements: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path
    return new BoxedFunction(this, 'Tuple', canonical(elements), {
      metadata,
      canonical: true,
    });
  }

  string(s: string, metadata?: Metadata): BoxedExpression {
    return new BoxedString(this, s, metadata);
  }

  symbol(
    name: string,
    options?: { metadata?: Metadata; canonical?: boolean }
  ): BoxedExpression {
    options ??= {};
    if (!('canonical' in options)) options.canonical = true;

    // Symbol names should use the Unicode NFC canonical form
    name = name.normalize();

    // These three are not symbols (some of them are not even valid symbol
    // names) but they're a common type
    if (name === 'NaN') return this._NAN;
    if (name === 'Infinity') return this._POSITIVE_INFINITY;
    if (name === '+Infinity') return this._POSITIVE_INFINITY;
    if (name === '-Infinity') return this._NEGATIVE_INFINITY;

    // `Half` is a synonym for the rational 1/2
    if (name === 'Half') return this._HALF;

    if (this.strict && !isValidIdentifier(name)) {
      const where = options?.metadata?.latex;
      const nameStr = `'${name}'`;
      if (where)
        return this.error(
          ['invalid-symbol-name', nameStr],
          where ? ['Latex', `'${where}'`] : nameStr
        );
    }

    // If there is some LaTeX metadata provided, we can't use the
    // `_commonSymbols` cache, as their LaTeX metadata may not match.
    if (options?.metadata?.latex !== undefined && !options.canonical)
      return new BoxedSymbol(this, name, options);

    const result = this._commonSymbols[name];
    if (result) {
      // Only use the cache if there is no metadata or it matches
      if (
        !options?.metadata?.wikidata ||
        !result.wikidata ||
        result.wikidata === options.metadata.wikidata
      )
        return result;
      if (options.canonical) return makeCanonicalSymbol(this, name);
      return new BoxedSymbol(this, name, options);
    }
    if (options.canonical) return makeCanonicalSymbol(this, name);
    return new BoxedSymbol(this, name, options);
  }

  domain(
    domain: BoxedExpression | DomainExpression | BoxedDomain,
    metadata?: Metadata
  ): BoxedDomain {
    if (domain instanceof _BoxedDomain) return domain;
    if (domain instanceof AbstractBoxedExpression && domain.symbol)
      domain = domain.symbol;
    if (typeof domain === 'string') {
      if (this._commonDomains[domain]) return this._commonDomains[domain]!;
    }

    if (!isDomain(domain)) {
      return this.error(
        ['invalid-domain', { str: JSON.stringify(domain) }],
        ['Latex', { str: metadata?.latex ?? '' }]
      );
    }
    return boxDomain(this, domain, metadata);
  }

  /*
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
    options?: { canonical?: boolean; metadata?: Metadata }
  ): BoxedExpression {
    options ??= {};
    if (!('canonical' in options)) options.canonical = true;

    //
    // Is this number eligible to be a cached number expression?
    //
    if (options.metadata === undefined) {
      if (typeof value === 'bigint') {
        if (value === BigInt(1)) return this._ONE;
        if (value === BigInt(0)) return this._ZERO;
        if (value === BigInt(-1)) return this._NEGATIVE_ONE;
      }
      if (typeof value === 'number') {
        const n = value;
        if (n === 1) return this._ONE;
        if (n === 0) return this._ZERO;
        if (n === -1) return this._NEGATIVE_ONE;

        if (Number.isInteger(n) && this._commonNumbers[n] !== undefined) {
          if (this._commonNumbers[n] === null)
            this._commonNumbers[n] = boxNumber(this, value) ?? this._NAN;
          return this._commonNumbers[n]!;
        }

        if (Number.isNaN(n)) return this._NAN;

        if (!Number.isFinite(n))
          return n < 0 ? this._NEGATIVE_INFINITY : this._POSITIVE_INFINITY;
      }
    }

    if (typeof value === 'bigint') value = this.bignum(value);

    return boxNumber(this, value, options) ?? this._NAN;
  }

  rules(rules: Rule[]): BoxedRuleSet {
    return boxRules(this, rules);
  }

  pattern(expr: LatexString | SemiBoxedExpression): Pattern {
    return new BoxedPattern(this, expr);
  }

  parse(
    latex: LatexString | string,
    options?: { canonical?: boolean }
  ): BoxedExpression;
  parse(s: null, options?: { canonical?: boolean }): null;
  parse(
    latex: LatexString | string | null,
    options?: { canonical?: boolean }
  ): null | BoxedExpression;
  parse(
    latex: LatexString | null | string,
    options?: { canonical?: boolean }
  ): BoxedExpression | null {
    if (typeof latex !== 'string') return null;
    return this.box(
      this.latexSyntax.parse(latexString(latex) ?? latex),
      options
    );
  }

  serialize(x: Expression | BoxedExpression): string {
    if (typeof x === 'object' && 'json' in x) {
      const ce = 'engine' in x ? x.engine : this;
      return this.latexSyntax.serialize(
        this.rawJson(ce.box(x, { canonical: false }))
      );
    }
    return this.latexSyntax.serialize(x as Expression);
  }

  get latexOptions(): NumberFormattingOptions &
    ParseLatexOptions &
    SerializeLatexOptions {
    const latexSyntax = this.latexSyntax;
    return new Proxy(
      {
        ...this.latexSyntax.options,
        ...this.latexSyntax.serializer.options,
      },
      {
        set(options, prop, value): boolean {
          if (!(prop in options)) return false;
          latexSyntax.updateOptions({ [prop]: value });
          return true;
        },
      }
    );
  }

  set latexOptions(
    opts: Partial<NumberFormattingOptions> &
      Partial<ParseLatexOptions> &
      Partial<SerializeLatexOptions>
  ) {
    this.latexSyntax.updateOptions(opts);
  }

  get jsonSerializationOptions(): Readonly<JsonSerializationOptions> {
    if (this._useRawJsonSerializationOptions)
      return this._rawJsonSerializationOptions;
    return this._jsonSerializationOptions;
  }

  set jsonSerializationOptions(val: Partial<JsonSerializationOptions>) {
    if (val.exclude) this._jsonSerializationOptions.exclude = [...val.exclude];
    if (val.shorthands) {
      if (
        (val.shorthands as unknown as string) === 'all' ||
        val.shorthands.includes('all')
      ) {
        this._jsonSerializationOptions.shorthands = [
          'function',
          'symbol',
          'string',
          'dictionary',
          'number',
        ];
      } else this._jsonSerializationOptions.shorthands = [...val.shorthands];
    }
    if (val.metadata) {
      if (
        (val.metadata as unknown as string) === 'all' ||
        val.metadata.includes('all')
      ) {
        this._jsonSerializationOptions.metadata = ['latex', 'wikidata'];
      } else this._jsonSerializationOptions.metadata = [...val.metadata];
    }
    if (typeof val.precision === 'number' && val.precision > 0) {
      this._jsonSerializationOptions.precision = val.precision;
    }
    if (typeof val.repeatingDecimals === 'boolean') {
      this._jsonSerializationOptions.repeatingDecimals = val.repeatingDecimals;
    }
  }

  rawJson(expr: BoxedExpression): Expression {
    const save = this._useRawJsonSerializationOptions;
    this._useRawJsonSerializationOptions = true;
    const result = expr.json;
    this._useRawJsonSerializationOptions = save;
    return result;
  }

  /**
   * Return a list of all the assumptions that match a pattern.
   *
   * ```js
   *  ce.assume(x, 'PositiveInteger');
   *  ce.ask(['Greater', 'x', '_val'])
   *  //  -> [{'val': 0}]
   * ```
   */
  ask(pattern: LatexString | SemiBoxedExpression): BoxedSubstitution[] {
    const pat = this.pattern(pattern);
    const result: BoxedSubstitution[] = [];
    for (const [assumption, val] of this.assumptions) {
      const m = pat.match(assumption, {
        numericTolerance: this._tolerance,
      });
      if (m !== null && val === true) result.push(m);
    }
    return result;
  }

  // Based on contextual usage, infer domain of a symbol
  infer(
    symbol: BoxedExpression | string,
    _domain: BoxedDomain | DomainExpression
  ): AssumeResult {
    if (typeof symbol !== 'string') {
      if (!symbol.symbol) return 'internal-error';
      symbol = symbol.symbol;
    }
    // @todo
    return 'ok';
  }

  assume(
    symbol: LatexString | SemiBoxedExpression,
    domainValue: BoxedDomain | Expression | BoxedExpression
  ): AssumeResult;
  assume(predicate: LatexString | SemiBoxedExpression): AssumeResult;
  assume(
    arg1: LatexString | SemiBoxedExpression,
    arg2?: BoxedDomain | Expression | BoxedExpression
  ): AssumeResult {
    try {
      const latex = latexString(arg1);
      const predicate = latex
        ? this.parse(latex, { canonical: false })
        : this.box(arg1, { canonical: false });

      if (!arg2) return assume(predicate);

      if (isDomain(arg2))
        return assume(this.box(['Element', predicate, this.domain(arg2)]));

      return assume(this.box(['Equal', predicate, arg2]));
    } catch (e) {
      console.error(e);
      return 'internal-error';
    }
  }

  forget(symbol: undefined | string | string[]): void {
    if (!this.context) throw Error('No scope available');

    //
    // Theory of Operations
    //
    // When forgeting we need to preserve existing definitions for symbols,
    // as some expressions may be pointing to them. Instead, we
    // reset the value/domain of those definitions.
    //

    if (symbol === undefined) {
      if (this.context.idTable)
        for (const k of this.context.idTable.keys()) this.forget(k);

      this.assumptions.clear();
      return;
    }

    if (Array.isArray(symbol)) {
      for (const x of symbol) this.forget(x);
      return;
    }

    if (typeof symbol === 'string') {
      // Remove symbol definition in the current scope (if any)
      if (this.context.idTable) {
        const def = this.context.idTable.get(symbol);
        if (isSymbolDefinition(def)) {
          def.value = undefined;
          if (def.domain?.isNumeric) {
            def.domain = this.defaultDomain ?? this.domain('Number');
          } else def.domain = undefined;
        } // @todo: if a function....
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
