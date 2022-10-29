import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';

import { Expression, MathJsonNumber } from '../math-json/math-json-format';
import { SignalMessage, WarningSignal } from '../common/signals';

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
  SymbolTable,
  ExpressionMapInterface,
  NumericMode as NumericMode,
  Pattern,
  RuntimeScope,
  Scope,
  SemiBoxedExpression,
  Substitution,
  SymbolDefinition,
  BoxedRuleSet,
  Rule,
  JsonSerializationOptions,
  ComputeEngineStats,
  Metadata,
  BoxedDomain,
  DomainExpression,
  BoxedLambdaExpression,
  FunctionDefinition,
  Rational,
} from './public';
import { box, boxFunction, boxNumber } from './boxed-expression/box';
import {
  setCurrentContextSymbolTable,
  getStandardLibrary,
} from './library/library';
import { DEFAULT_COST_FUNCTION } from './cost-function';
import { ExpressionMap } from './boxed-expression/expression-map';
import { BoxedPattern } from './boxed-expression/boxed-patterns';
import { getVars, latexString } from './boxed-expression/utils';
import { boxRules } from './rules';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedNumber } from './boxed-expression/boxed-number';
import { BoxedSymbolDefinitionImpl } from './boxed-expression/boxed-symbol-definition';
import { canonicalNegate } from './symbolic/negate';
import { canonicalPower } from './library/arithmetic-power';
import {
  BoxedFunction,
  flattenSequence,
} from './boxed-expression/boxed-function';
import { canonicalMultiply } from './library/arithmetic-multiply';
import { canonicalAdd } from './library/arithmetic-add';
import { canonicalDivide } from './library/arithmetic-divide';
import { BoxedSymbol } from './boxed-expression/boxed-symbol';
import {
  boxDomain,
  isDomain,
  _BoxedDomain,
} from './boxed-expression/boxed-domain';
import { AbstractBoxedExpression } from './boxed-expression/abstract-boxed-expression';
import { isValidSymbolName } from '../math-json/utils';
import { makeFunctionDefinition } from './boxed-expression/boxed-function-definition';
import {
  isBigRational,
  isMachineRational,
  isRational,
} from './numerics/rationals';

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
    HyperbolicFunction: null,
    LogicOperator: null, // (Boolean, Boolean) -> Boolean
    Predicate: null, // (Anything^n) -> MaybeBoolean
    RelationalOperator: null, // (Anything, Anything) -> MaybeBoolean
    Expression: null, // () -> Anything
    BooleanExpression: null, // () -> MaybeBoolean
    NumericExpression: null, // () -> Number
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

  /** Absolute time beyond which evaluation should not proceed.
   * @internal
   */
  deadline?: number;

  /**
   * Return symbol tables suitable for the specified categories, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A symbol table defines how the symbols and function names in a MathJSON
   * expression should be interpreted, i.e. how to evaluate and manipulate them.
   *
   */
  static getSymbolTables(
    categories: LibraryCategory[] | LibraryCategory | 'all' = 'all'
  ): Readonly<SymbolTable>[] {
    return getStandardLibrary(categories);
  }

  /**
   * Construct a new `ComputeEngine` instance.
   *
   * Dictionaries define functions and symbols (in `options.dictionaries`) and
   * the LaTeX syntax (in `options.latexDictionaries`). If no dictionaries
   * are provided, the default ones are used.
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
    symbolTables?: Readonly<SymbolTable>[];
    latexDictionary?: readonly LatexDictionaryEntry[];
    numericMode?: NumericMode;
    numericPrecision?: number;
    tolerance?: number;
    assumptions?: (LatexString | Expression)[];
    defaultDomain?: string;
  }) {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Unexpected argument');

    this._latexDictionary = options?.latexDictionary;

    this._jsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'dictionary', 'number'],
      metadata: [],
      precision: 'max',
      repeatingDecimals: true,
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
    const tables = options?.symbolTables ?? ComputeEngine.getSymbolTables();
    this.pushScope({
      symbolTable: tables,
      scope: {
        warn: (sigs: WarningSignal[]): void => {
          for (const sig of sigs) {
            if (typeof sig.message === 'string') {
              console.warn(sig.message);
            } else {
              console.warn(...sig.message);
            }
          }
        },
        timeLimit: 2.0, // execution time limit: 2.0 seconds
        memoryLimit: 1.0, // memory limit: 1.0 megabyte
        recursionLimit: 1024,
        // iterationLimit:    no iteration limit
      },
    });

    // Push a fresh scope to protect global definitions:
    // this will be the "user" scope
    if (options?.assumptions === null)
      // If `assumptions` is set to null: no assumptions
      this.pushScope();
    else this.pushScope({ assumptions: options?.assumptions });

    // Patch-up any missing definitions (domains that were
    // 'forward-declared')
    for (const d of Object.keys(this._commonDomains))
      if (this._commonDomains[d] && !this._commonDomains[d]!.symbolDefinition)
        this._commonDomains[d]!.bind(this.context);

    for (const d of Object.keys(this._commonSymbols))
      if (this._commonSymbols[d] && !this._commonSymbols[d]!.symbolDefinition)
        this._commonSymbols[d]!.bind(this.context);

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
      if (scope.symbolTable?.functions)
        for (const [_k, v] of scope.symbolTable.functions) v.reset();
      if (scope.symbolTable?.symbols)
        for (const [_k, v] of scope.symbolTable.symbols) v.reset();

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

  /** The precision, or number of significant digits, for numeric calculations
   * such as when calling `ce.N()`.
   *
   * To  make calculations using more digits, at the cost of expended memory
   * usage and slower computations, set the `precision` higher.
   *
   * Trigonometric operations are accurate for precision up to 1,000.
   *
   */
  get precision(): number {
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
    if (this._latexSyntax) {
      this.latexSyntax.updateOptions({
        precision: p,
        avoidExponentsInRange: [-6, p],
      });
    }

    this._precision = Math.max(p, Math.floor(MACHINE_PRECISION));
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
  bignum(a: Decimal.Value): Decimal {
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

  private get latexSyntax(): LatexSyntax {
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
    if (typeof symbol !== 'string') throw Error('Expected a string');

    // Wildcards never have definitions
    if (symbol.startsWith('_') || !this.context) return undefined;

    let def: undefined | BoxedSymbolDefinition = undefined;

    // Try to find a match by wikidata
    scope ??= this.context;
    if (wikidata)
      while (scope && !def) {
        def = scope.symbolTable?.symbolWikidata.get(wikidata);
        scope = scope.parentScope;
      }

    // Match by name
    if (symbol.length > 0) {
      scope = this.context;
      while (scope && !def) {
        def = scope.symbolTable?.symbols.get(symbol);
        scope = scope.parentScope;
      }
    }
    return def;
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

    // Wildcards never have definitions
    if (head.startsWith('_') || !this.context) return undefined;

    scope ??= this.context;
    while (scope) {
      const def = scope.symbolTable?.functions.get(head);
      if (def) return def;
      scope = scope.parentScope;
    }
    return undefined;
  }

  /**
   * Add (or replace) a definition for a symbol in the current scope.
   */
  defineSymbol(def: SymbolDefinition): BoxedSymbolDefinition {
    if (!this.context)
      throw Error('Symbol cannot be defined: no scope available');
    const boxedDef = new BoxedSymbolDefinitionImpl(this, def);
    if (!this.context.symbolTable) {
      this.context.symbolTable = {
        symbols: new Map<string, BoxedSymbolDefinition>(),
        functions: new Map<string, BoxedFunctionDefinition>(),
        symbolWikidata: new Map<string, BoxedSymbolDefinition>(),
        functionWikidata: new Map<string, BoxedFunctionDefinition>(),
      };
    }

    if (boxedDef.name)
      this.context.symbolTable.symbols.set(boxedDef.name, boxedDef);
    if (boxedDef.wikidata)
      this.context.symbolTable.symbolWikidata.set(boxedDef.wikidata, boxedDef);

    return boxedDef;
  }

  defineFunction(def: FunctionDefinition): BoxedFunctionDefinition {
    if (!this.context)
      throw Error('Function cannot be defined: no scope available');

    const boxedDef = makeFunctionDefinition(this, def);

    if (!this.context.symbolTable) {
      this.context.symbolTable = {
        symbols: new Map<string, BoxedSymbolDefinition>(),
        functions: new Map<string, BoxedFunctionDefinition>(),
        symbolWikidata: new Map<string, BoxedSymbolDefinition>(),
        functionWikidata: new Map<string, BoxedFunctionDefinition>(),
      };
    }

    if (boxedDef.name)
      this.context.symbolTable.functions.set(def.name, boxedDef);
    if (boxedDef.wikidata)
      this.context.symbolTable.functionWikidata.set(
        boxedDef.wikidata,
        boxedDef
      );

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
  pushScope(options?: {
    symbolTable?: Readonly<SymbolTable> | Readonly<SymbolTable>[];
    assumptions?: (LatexString | Expression)[];
    scope?: Partial<Scope>;
  }): void {
    if (options !== undefined && typeof options !== 'object')
      throw Error('Expected an object literal');
    if (this.context === null) throw Error('No parent scope available');
    this.context = {
      ...options?.scope,
      parentScope: this.context,
      // We always copy the current assumptions in the new scope.
      // This make is much easier to deal with 'inherited' assumptions
      // (and potentially modifying them later) without having to walk back
      // into parent contexts. In other words, calling `ce.forget()` will
      // forget everything **in the current scope**. When exiting the scope,
      // the previous assumptions are restored.
      assumptions: this.context
        ? new ExpressionMap(this.context.assumptions)
        : new ExpressionMap(),
    };

    // `setCurrentContextDictionary` will associate the definitions in the
    // dictionary with the current scope, so we need to set the scope first
    // above(`this.context =...`);
    if (options?.symbolTable) {
      if (Array.isArray(options.symbolTable))
        for (const dict of options.symbolTable)
          setCurrentContextSymbolTable(this, dict);
      else setCurrentContextSymbolTable(this, options.symbolTable);
    }
    // Add any user-specified assumptions
    // (those assumptions may use the definitions from the dictionary,
    // so set those up *after* setting up the dictionary)
    if (options?.assumptions !== undefined) {
      for (const assumption of options.assumptions) {
        this.assume(this.parse(latexString(assumption)) ?? assumption);
      }
    }
  }

  /** Remove the topmost scope from the scope stack.
   */
  popScope(): void {
    if (!this.context) throw Error('No scope available');

    const parentScope = this.context?.parentScope;

    // If there are some warnings, handle them
    if (this.context.warnings) {
      const warnings = [...this.context.warnings];
      this.context.warnings = [];
      if (this.context.warn) {
        this.context.warn(warnings);
      }
    }

    // If there are some unhandled warnings, or warnings signaled during the
    // warning handler, propagate them.
    if (
      parentScope &&
      this.context.warnings &&
      this.context.warnings.length > 0
    ) {
      if (!parentScope.warnings) {
        parentScope.warnings = [...this.context.warnings];
      } else {
        parentScope.warnings = [
          ...parentScope.warnings,
          ...this.context.warnings,
        ];
      }
    }

    this.context = parentScope ?? null;

    if (this.context === null) debugger;
  }

  set(identifiers: { [identifier: string]: SemiBoxedExpression }): void {
    for (const k of Object.keys(identifiers)) {
      if (k !== 'Nothing') {
        const def = this.lookupSymbol(k);
        const val = this.box(identifiers[k]);
        if (def) {
          if (def.domain && !val.domain.isCompatible(def.domain))
            throw Error(
              `Expected value with domain ${def.domain.toString()} for "${k}"`
            );
          def.value = val;
        } else {
          if (val.domain.isNumeric)
            this.defineSymbol({ name: k, value: val, domain: 'Number' });
          else this.defineSymbol({ name: k, value: val });
        }
      }
    }
  }

  let(identifiers: {
    [identifier: string]: SymbolDefinition | FunctionDefinition;
  }): void {
    for (const k of Object.keys(identifiers)) {
      if (k !== 'Nothing') {
        const def = identifiers[k];
        if ('value' in def || ('domain' in def && def.domain !== 'Function'))
          this.defineSymbol({ ...def, name: k } as SymbolDefinition);
        else this.defineFunction({ ...def, name: k } as FunctionDefinition);
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

  assert(
    condition: boolean,
    expr: BoxedExpression,
    msg: string,
    code?: SignalMessage
  ) {
    if (!condition) this.signal(expr, msg, code);
  }

  /**
   * Call this function if an unexpected condition occurs during execution of a
   * function in the engine.
   *
   * An `ErrorSignal` is a problem that cannot be recovered from.
   *
   * A `WarningSignal` indicates a minor problem that does not prevent the
   * execution to continue.
   *
   */
  signal(expr: BoxedExpression, msg: string, code?: SignalMessage): void;
  signal(sig: WarningSignal): void;
  signal(
    arg1: WarningSignal | BoxedExpression,
    msg?: string,
    code?: SignalMessage
  ): void {
    let subject = '';
    let message = '';
    // @todo: store the warnings
    if (typeof arg1 === 'object' && 'message' in arg1) {
      code = arg1.message;
    } else {
      subject = arg1.latex;
      message = msg ?? '';
    }
    const codeString =
      code === undefined
        ? ''
        : typeof code === 'string'
        ? `[${code}]`
        : Array.isArray(code)
        ? '[' + code.map((x) => x.toString()).join(', ') + ']'
        : '';
    console.error(`${subject}: ${message ?? ''} ${codeString}`);

    return;
  }

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
    // if (!ops.every((x) => x.isCanonical))    debugger;
    // return makeCanonicalFunction(this, head, ops, {
    //   metadata,
    //   canonical: true,
    // });

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
    if (where && Array.isArray(where) && where[0] === 'Latex') {
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
        : new BoxedFunction(
            this,
            'ErrorCode',
            [
              this.string(message[0]),
              ...message.slice(1).map((x) => this.box(x, { canonical: false })),
            ],
            { canonical: false }
          );

    if (!where)
      return new BoxedFunction(this, 'Error', [msg], { canonical: false });

    return new BoxedFunction(
      this,
      'Error',
      [msg, this.box(where, { canonical: false })],
      { canonical: false }
    );
  }

  add(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    ops = flattenSequence(ops);

    const result = canonicalAdd(this, ops);
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    if (metadata?.wikidata !== undefined) result.wikidata = metadata.wikidata;
    return result;
  }

  negate(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    return canonicalNegate(expr, metadata);
  }

  mul(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    ops = flattenSequence(ops);

    const result = canonicalMultiply(this, ops);
    if (metadata?.latex !== undefined) result.latex = metadata.latex;
    if (metadata?.wikidata !== undefined) result.wikidata = metadata.wikidata;
    return result;
  }

  divide(
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
    return this.power(base, [1, 2], metadata);
  }

  power(
    base: BoxedExpression,
    exponent: number | Rational | BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    let e: number | null = null;

    if (exponent instanceof AbstractBoxedExpression) {
      const num = exponent.numericValue;
      if (num !== null) {
        if (typeof num === 'number') exponent = num;
        if (isRational(num)) exponent = num;
      }
    }

    if (typeof exponent === 'number') e = exponent;
    else if (isRational(exponent)) {
      if (isMachineRational(exponent) && exponent[1] === 1) e = exponent[0];
      if (isBigRational(exponent) && exponent[1].equals(1))
        e = exponent[0].toNumber();
    }

    // x^1
    if (e === 1) return base;

    // x^(-1)
    const r = base.numericValue;
    if (e === -1 && r !== null) {
      if (typeof r === 'number' && Number.isInteger(r))
        return this.number([1, r]);
      if (r instanceof Decimal && r.isInteger())
        return this.number([base.engine._BIGNUM_ONE, r]);
      if (isRational(r))
        return this.number(isBigRational(r) ? [r[1], r[0]] : [r[1], r[0]]);
    }

    if (typeof exponent === 'number' || isRational(exponent))
      exponent = this.number(exponent);

    return (
      canonicalPower(this, base, exponent, metadata) ??
      this._fn('Power', [base, exponent], metadata)
    );
  }

  inverse(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    // Short path. Note that are arguments are **not** validated.
    let e = this._NEGATIVE_ONE;

    if (expr.head === 'Power') {
      // Inverse(x^{-1}) -> x
      if (expr.op2.isNegativeOne) return expr.op1;

      // Inverse(x^n) -> x^{-n}
      e = canonicalNegate(expr.op2);
      expr = expr.op1;
    }

    // Inverse(expr) -> expr^{-1}
    // Will take care of literals, i.e. Inverse(n/d) -> d/n
    return (
      canonicalPower(this, expr, e, metadata) ??
      this._fn('Power', [expr, e], metadata)
    );
  }

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

  tuple(elements: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // Short path
    return new BoxedFunction(
      this,
      'Tuple',
      elements.map((x) => x.canonical),
      {
        metadata,
        canonical: true,
      }
    );
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

    if (!isValidSymbolName(name)) {
      return this.error(
        ['invalid-symbol-name', { str: name }],
        ['Latex', { str: options?.metadata?.latex ?? '' }]
      );
    }

    // If there is some LaTeX metadata provided, we can't use the
    // `_commonSymbols` cache, as their LaTeX metadata may not match.
    if (options?.metadata?.latex !== undefined && !options.canonical)
      return new BoxedSymbol(this, name, options);

    let result = this._commonSymbols[name];
    if (result) {
      // Only use the cache if there is no metadata or it matches
      if (
        !options?.metadata?.wikidata ||
        !result.wikidata ||
        result.wikidata === options.metadata.wikidata
      )
        return result;
      return new BoxedSymbol(this, name, options);
    }
    if (result === null) {
      // If `null`, the symbol is in `_commonSymbols`, but not yet cached
      result = new BoxedSymbol(this, name, { canonical: true });
      this._commonSymbols[name] = result;
      return result;
    }
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
      if (this._commonDomains[domain] === null)
        this._commonDomains[domain] = boxDomain(this, domain, metadata);
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

  lambda(expr: SemiBoxedExpression, sig: BoxedDomain): BoxedLambdaExpression {
    console.assert(sig.ctor === 'Function');
    console.assert(sig.domainArgs);
    const context = this.context;
    this.context = null;
    const result = this.box(expr);
    this.context = context;
    return result;
  }

  /*
   * This function tries to avoid creating a boxed number if `num` corresponds
   * to a common value for which we have a shared instance (-1, 0, NaN, etc...)
   */

  number(
    value: number | MathJsonNumber | Decimal | Complex | Rational,
    options?: { canonical?: boolean; metadata?: Metadata }
  ): BoxedExpression {
    options ??= {};
    if (!('canonical' in options)) options.canonical = true;

    //
    // Is this number eligible to be a cached number expression?
    //
    if (options.metadata === undefined && typeof value === 'number') {
      const n = value;
      if (n === 1) return this._ONE;
      if (n === 0) return this._ZERO;
      if (n === -1) return this._NEGATIVE_ONE;

      if (isNaN(n)) return this._NAN;

      if (!Number.isFinite(n))
        return n < 0 ? this._NEGATIVE_INFINITY : this._POSITIVE_INFINITY;

      if (Number.isInteger(n) && this._commonNumbers[n] === null) {
        this._commonNumbers[n] = boxNumber(this, value);
        if (this._commonNumbers[n] === null) return this._NAN;
        return this._commonNumbers[n]!;
      }
    }

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
    if (typeof x === 'object' && 'json' in x)
      return this.latexSyntax.serialize(x.json);

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

  get jsonSerializationOptions(): JsonSerializationOptions {
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
  ask(pattern: LatexString | SemiBoxedExpression): Substitution[] {
    const pat = this.pattern(pattern);
    const result: Substitution[] = [];
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
    domainValue: BoxedDomain | DomainExpression | Expression | BoxedExpression
  ): AssumeResult;
  assume(predicate: LatexString | SemiBoxedExpression): AssumeResult;
  assume(
    arg1: LatexString | SemiBoxedExpression,
    arg2?: BoxedDomain | DomainExpression | Expression | BoxedExpression
  ): AssumeResult {
    try {
      const latex = latexString(arg1);
      const predicate = latex ? this.parse(latex) : this.box(arg1);

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

    if (symbol === undefined) {
      this.context.symbolTable = undefined;
      this.assumptions.clear();
      return;
    }

    if (Array.isArray(symbol)) {
      for (const x of symbol) this.forget(x);
      return;
    }

    if (typeof symbol === 'string') {
      // Remove symbol definition in the current scope (if any)
      if (this.context.symbolTable) {
        this.context.symbolTable.symbols.delete(symbol);
        this.context.symbolTable.symbolWikidata.delete(symbol);
        this.context.symbolTable.functions.delete(symbol);
        this.context.symbolTable.functionWikidata.delete(symbol);
      }
      // Remove any assumptions that make a reference to this symbol
      // (note that when a scope if created, any assumptions from the
      // parent scope are copied over, so this effectively removes any
      // reference to this symbol, even if there are assumptions about
      // it in a parent scope. However, when the current scope exits,
      // any previous assumptions about the symbol will be restored).
      for (const [assumption, _val] of this.assumptions) {
        const vars = getVars(assumption);
        if (vars.includes(symbol)) this.assumptions.delete(assumption);
      }
    }
  }
}
