import { LatexSyntax } from './latex-syntax/latex-syntax';

import { assume } from './assume';

import { Expression, MathJsonNumber } from '../math-json/math-json-format';

import {
  DictionaryCategory,
  LatexString,
  NumberFormattingOptions,
  ParseLatexOptions,
  SerializeLatexOptions,
} from './latex-syntax/public';
import { MACHINE_PRECISION, NUMERICAL_TOLERANCE } from './numerics/numeric';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { SignalMessage, WarningSignal } from '../common/signals';
import {
  AssumeResult,
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedSymbolDefinition,
  IComputeEngine,
  Dictionary,
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
} from './public';
import { box, boxDomain, boxNumber } from './boxed-expression/box';
import {
  setCurrentContextDictionary,
  getDefaultDictionaries,
} from './dictionary/dictionary';
import { DEFAULT_COST_FUNCTION } from './cost-function';
import { ExpressionMap } from './boxed-expression/expression-map';
import { BoxedPattern } from './boxed-expression/boxed-patterns';
import { getVars, latexString } from './boxed-expression/utils';
import { boxRules } from './rules';
import { BoxedString } from './boxed-expression/boxed-string';
import { BoxedNumber } from './boxed-expression/boxed-number';
import { BoxedSymbolDefinitionImpl } from './boxed-expression/boxed-symbol-definition';
import { canonicalNegate } from './symbolic/negate';
import { canonicalPower } from './dictionary/arithmetic-power';
import { BoxedFunction } from './boxed-expression/boxed-function';
import { canonicalMultiply } from './dictionary/arithmetic-multiply';
import { canonicalAdd } from './dictionary/arithmetic-add';
import { canonicalDivide } from './dictionary/arithmetic-divide';
import { BoxedSymbol } from './boxed-expression/boxed-symbol';
import { BoxedDictionary } from './boxed-expression/boxed-dictionary';

/**
 * Create a `CustomEngine` instance to customize its behavior and the syntax
 * and operation dictionaries it uses.
 *
 * The constructor of `ComputeEngine` will compile and optimize the dictionary
 * upfront.
 */
export class ComputeEngine implements IComputeEngine {
  readonly ZERO: BoxedExpression;
  readonly ONE: BoxedExpression;
  readonly TWO: BoxedExpression;
  readonly HALF: BoxedExpression;
  readonly NEGATIVE_ONE: BoxedExpression;
  readonly I: BoxedExpression;
  readonly NAN: BoxedExpression;
  readonly POSITIVE_INFINITY: BoxedExpression;
  readonly NEGATIVE_INFINITY: BoxedExpression;
  readonly COMPLEX_INFINITY: BoxedExpression;

  DECIMAL_NAN: Decimal;
  DECIMAL_ZERO: Decimal;
  DECIMAL_ONE: Decimal;
  DECIMAL_TWO: Decimal;
  DECIMAL_HALF: Decimal;
  DECIMAL_PI: Decimal;
  DECIMAL_NEGATIVE_ONE: Decimal;

  private _precision: number;
  private _numericMode: NumericMode;
  private _latexSyntax?: LatexSyntax; // To parse rules as LaTeX

  private _tolerance: number;
  private _decimalTolerance: Decimal;

  private _cache: {
    [key: string]: {
      value: any;
      build: () => any;
      purge: (v: any) => void;
    };
  } = {};

  private _stats: ComputeEngineStats & { [key: string]: any };

  private _cost?: (expr: BoxedExpression) => number;

  private _jsonSerializationOptions: JsonSerializationOptions;

  /** The domain of unknown symbols. If `null` unknown symbols do not have a
   * definition automatically associated with them.
   */
  private _defaultDomain: null | BoxedExpression;

  private _commonSymbols: { [symbol: string]: null | BoxedExpression } = {
    True: null,
    False: null,
    Maybe: null,

    All: null,
    Missing: null,
    Nothing: null,
    None: null,
    Undefined: null,

    Pi: null,
    ImaginaryUnit: null,
  };
  private _commonNumbers: { [num: number]: null | BoxedExpression } = {
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
    5: null,
    6: null,
    7: null,
    8: null,
    9: null,
    10: null,
  };
  private _commonDomains: { [dom: string]: null | BoxedExpression } = {
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
  };

  /**
   * The current scope.
   *
   * A scope is a dictionary that contains the definition of local symbols.
   *
   * Scopes form a stack, and definitions in more recent
   * scopes can obscure definitions from older scopes.
   *
   */
  context: RuntimeScope;

  /** Absolute time beyond which evaluation should not proceed */
  deadline?: number;
  /**
   * Return dictionaries suitable for the specified categories, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A symbol dictionary defines how the symbols and function names in a MathJSON
   * expression should be interpreted, i.e. how to evaluate and manipulate them.
   *
   */
  static getDictionaries(
    categories: DictionaryCategory[] | 'all' = 'all'
  ): Readonly<Dictionary>[] {
    return getDefaultDictionaries(categories);
  }

  /**
   * Construct a new `ComputeEngine` environment.
   *
   * If no `options.dictionaries` is provided a default set of dictionaries
   * is used. The `ComputeEngine.getDictionaries()` method can be called
   * to access some subset of dictionaries, e.g. for arithmetic, calculus, etc...
   * The order of the dictionaries matter: the definitions from the later ones
   * override the definitions from earlier ones. The first dictionary should
   * be the `'core'` dictionary which include some basic definitions such
   * as domains (`Boolean`, `Number`, etc...) that are used by later dictionaries.
   */
  constructor(options?: {
    dictionaries?: Readonly<Dictionary>[];
    numericMode?: NumericMode;
    assumptions?: (LatexString | Expression)[];
    numericPrecision?: number;
    tolerance?: number;
    defaultDomain?: string;
  }) {
    this._jsonSerializationOptions = {
      exclude: [],
      shorthands: ['function', 'symbol', 'string', 'dictionary', 'number'],
      metadata: [],
      repeatingDecimal: true,
    };

    this._stats = {
      highwaterMark: 0,
      symbols: new Set<BoxedExpression>(),
      expressions: new Set<BoxedExpression>(),
    };

    // Prevent creation of definitions for unknown symbols until after
    // we've built the dictionary
    this._defaultDomain = null;

    // Set the default precision for `decimal` calculations
    this._numericMode = options?.numericMode ?? 'auto';
    this._precision = Math.max(
      options?.numericPrecision ?? 100,
      Math.floor(MACHINE_PRECISION)
    );

    this._decimal = Decimal.clone({ precision: this._precision });
    this.decimal = (a) => new this._decimal(a);
    this.complex = (a, b) => new Complex(a, b);

    this.tolerance = options?.tolerance ?? NUMERICAL_TOLERANCE;

    this.ZERO = new BoxedNumber(this, 0);
    this.ONE = new BoxedNumber(this, 1);
    this.TWO = new BoxedNumber(this, 2);
    this.HALF = new BoxedNumber(this, [1, 2]);
    this.NEGATIVE_ONE = new BoxedNumber(this, -1);
    this.I = new BoxedNumber(this, Complex.I);
    this.NAN = new BoxedNumber(this, Number.NaN);
    this.POSITIVE_INFINITY = new BoxedNumber(this, Number.POSITIVE_INFINITY);
    this.NEGATIVE_INFINITY = new BoxedNumber(this, Number.NEGATIVE_INFINITY);
    this.COMPLEX_INFINITY = new BoxedNumber(this, Complex.INFINITY);

    // Reset the caches/create numeric constants
    this.purge();

    //
    // The first, topmost, scope contains additional info
    //
    const dicts = options?.dictionaries ?? ComputeEngine.getDictionaries();
    this.pushScope({
      dictionary: dicts,
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
        this._commonDomains[d]!._repairDefinition();

    for (const d of Object.keys(this._commonSymbols))
      if (this._commonSymbols[d] && !this._commonSymbols[d]!.symbolDefinition)
        this._commonSymbols[d]!._repairDefinition();

    // Once a scope is set and the default dictionaries)
    // we can reference symbols for the domain names and other constants
    this._defaultDomain =
      options?.defaultDomain === null
        ? null
        : this.domain(options?.defaultDomain ?? 'ExtendedRealNumber');
  }

  /** After the configuration of the engine has changed, clear the caches
   * so that new values can be recalculated.
   *
   * This needs to happen for example when the numeric precision changes.
   *
   */
  purge() {
    // Recreate the Decimal constants (they depend on the engine's precision)
    this.DECIMAL_NEGATIVE_ONE = this.decimal(-1);
    this.DECIMAL_NAN = this.decimal(NaN);
    this.DECIMAL_ZERO = this.decimal(0);
    this.DECIMAL_ONE = this.decimal(1);
    this.DECIMAL_TWO = this.decimal(2);
    this.DECIMAL_HALF = this.DECIMAL_ONE.div(this.DECIMAL_TWO);
    this.DECIMAL_PI = this.DECIMAL_NEGATIVE_ONE.acos();

    // Purge all the known expressions/symbols
    const symbols = this._stats.symbols.values();
    const expressions = this._stats.expressions!.values();
    this._stats.symbols = new Set<BoxedExpression>();
    this._stats.expressions = new Set<BoxedExpression>();
    for (const s of symbols) s._purge();
    for (const s of expressions) s._purge();

    // Purge all the common  expression (probably not necessary)
    for (const d of Object.values(this._commonDomains)) d?._purge();
    for (const d of Object.values(this._commonSymbols)) d?._purge();

    // Purge all the definitions
    let scope = this.context;
    while (scope) {
      if (scope.dictionary?.functions)
        for (const [_k, v] of scope.dictionary.functions)
          for (const d of v) d._purge();
      if (scope.dictionary?.symbols)
        for (const [_k, v] of scope.dictionary.symbols) v._purge();

      // @todo purge assumptions
      scope = scope.parentScope;
    }

    // Purge any caches
    for (const k of Object.keys(this._cache))
      if (this._cache[k].value) {
        if (!this._cache[k].purge) delete this._cache[k];
        else this._cache[k].value = this._cache[k].purge(this._cache[k].value);
      }
  }

  _register(expr: BoxedExpression): void {
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

  _unregister(expr: BoxedExpression): void {
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

  _decimal: Decimal.Constructor;
  decimal: (a: Decimal.Value) => Decimal;
  complex: (a: number | Complex, b?: number) => Complex;

  /** The precision, or number of significant digits, for numerical calculations
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
    const currentPrecision = this._precision;
    if (p === 'machine') p = Math.floor(MACHINE_PRECISION);
    if (p === currentPrecision) return;

    // Set the display precision as requested.
    // It may be less than the effective precision, which is never less than 15
    this.latexSyntax.updateOptions({
      precision: p,
      avoidExponentsInRange: [-6, p],
    });

    this._precision = Math.max(p, Math.floor(MACHINE_PRECISION));
    this._decimal = this._decimal.config({ precision: this._precision });

    // Reset the caches
    // (the values in the cache depend on the current precision)
    this.purge();
  }

  /**
   * Mode to use for numerical calculations:
   *
   * - `auto`:  use machine number if the precision is 15 or less, Decimal
   * otherwise. Complex numbers are allowed.
   * - `number`: use the machine format (64-bit float, 52-bit mantissa, about
   * 15 digits of precision).
   * - `decimal`: arbitrary precision floating-point numbers, as provided by the
   * "decimal.js" library
   * - `complex`: machine and complex numbers: two 64-bit float, as provided by the
   * "complex.js" library
   *
   */
  get numericMode(): NumericMode {
    return this._numericMode;
  }
  set numericMode(f: NumericMode) {
    if (f === this._numericMode) return;

    this._numericMode = f;
    if (f === 'complex' || f === 'machine')
      this._precision = Math.floor(MACHINE_PRECISION);

    // Make sure the display precision is not larger than the computation precision
    if (this.latexSyntax.options.precision > this._precision)
      this.latexSyntax.updateOptions({ precision: this._precision });

    // Reset the caches: the values in the cache depend on the numeric mode)
    this.purge();
  }

  get timeLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.timeLimit !== undefined) return scope.timeLimit;
      scope = scope.parentScope;
    }
    return 2.0; // 2s
  }
  get iterationLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.iterationLimit !== undefined) return scope.iterationLimit;
      scope = scope.parentScope;
    }
    return 1024;
  }
  get recursionLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.recursionLimit !== undefined) return scope.recursionLimit;
      scope = scope.parentScope;
    }
    return 1024;
  }
  get defaultDomain(): BoxedExpression | null {
    return this._defaultDomain;
  }
  set defaultDomain(domain: BoxedExpression | string | null) {
    if (domain === null) this._defaultDomain = null;
    else this._defaultDomain = this.domain(domain);
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
    else this._tolerance = NUMERICAL_TOLERANCE;
    this._decimalTolerance = this.decimal(this._tolerance);
  }

  chop(n: number): number;
  chop(n: Decimal): Decimal | 0;
  chop(n: Complex): Complex | 0;
  chop(n: number | Decimal | Complex): number | Decimal | Complex {
    if (typeof n === 'number' && Math.abs(n) <= this._tolerance) return 0;

    if (n instanceof Decimal && n.abs().lte(this._decimalTolerance)) return 0;

    if (
      n instanceof Complex &&
      Math.abs(n.re) <= this._tolerance &&
      Math.abs(n.im) <= this._tolerance
    )
      return 0;

    return n;
  }

  private get latexSyntax(): LatexSyntax {
    // We'll use this LatexSyntax instance internally, for example to parse
    // rules, etc... Use our own custom error handler, which will throw
    // on any error.
    if (!this._latexSyntax)
      this._latexSyntax = new LatexSyntax({
        precision: this.precision,
        avoidExponentsInRange: [-6, this.precision],
        computeEngine: this,
        onError: (err) => {
          throw new Error(err[0].message.toString());
        },
      });
    return this._latexSyntax;
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
   * scope and going up the scope chain.
   */
  getSymbolDefinition(
    symbol: string,
    wikidata?: string
  ): undefined | BoxedSymbolDefinition {
    let scope = this.context;
    let def: undefined | BoxedSymbolDefinition = undefined;

    // Try to find a match by wikidata
    if (wikidata)
      while (scope && !def) {
        def = scope.dictionary?.symbolWikidata.get(wikidata);
        scope = scope.parentScope;
      }

    // Match by name
    while (scope && !def) {
      if (wikidata) def = scope.dictionary?.symbolWikidata.get(wikidata);
      if (!def) def = scope.dictionary?.symbols.get(symbol);
      scope = scope.parentScope;
    }
    return def;
  }

  /**
   * Return the definition for a function matching this head.
   *
   * Start looking in the current scope, than up the scope chain.
   */
  getFunctionDefinition(head: string): undefined | BoxedFunctionDefinition {
    let scope = this.context;
    let defs: undefined | BoxedFunctionDefinition[] = undefined;
    while (scope && !defs) {
      defs = scope.dictionary?.functions.get(head);
      scope = scope.parentScope;
    }

    if (defs) return defs[0];

    // If no definition matching the domain of the arguments, return `undefined`
    return undefined;
  }

  /**
   * Add (or replace) a definition for a symbol in the current scope.
   */
  defineSymbol(def: SymbolDefinition): BoxedSymbolDefinition {
    const boxedDef = new BoxedSymbolDefinitionImpl(this, def);
    if (!this.context.dictionary) {
      this.context.dictionary = {
        symbols: new Map<string, BoxedSymbolDefinition>(),
        functions: new Map<string, BoxedFunctionDefinition[]>(),
        symbolWikidata: new Map<string, BoxedSymbolDefinition>(),
        functionWikidata: new Map<string, BoxedFunctionDefinition>(),
      };
    }

    if (def.name) this.context.dictionary.symbols.set(def.name, boxedDef);
    if (def.wikidata)
      this.context.dictionary.symbolWikidata.set(def.wikidata, boxedDef);

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
    dictionary?: Readonly<Dictionary> | Readonly<Dictionary>[];
    assumptions?: (LatexString | Expression)[];
    scope?: Partial<Scope>;
  }): void {
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
    setCurrentContextDictionary(this, options?.dictionary);

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

    this.context = parentScope;
  }

  get assumptions(): ExpressionMapInterface<boolean> {
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
   */
  shouldContinueExecution(): boolean {
    return this.deadline === undefined || this.deadline >= Date.now();
  }

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
    expr: Decimal | Complex | [num: number, denom: number] | SemiBoxedExpression
  ): BoxedExpression {
    return box(this, expr);
  }

  fn(
    head: string,
    ops: BoxedExpression[],
    metadata?: Metadata
  ): BoxedExpression {
    // Don't attempt to canonicalize the ops if a `Hold` expression
    if (head === 'Hold') return this._fn('Hold', ops, metadata);

    ops = ops.map((x) => x.canonical);

    if (head === 'String')
      return this.string(
        ops.map((x) => x.string ?? x.latex).join(''),
        metadata
      );

    if (head === 'Symbol')
      return this.symbol(
        ops.map((x) => x.string ?? x.latex).join(''),
        metadata
      );

    if ((head === 'Divide' || head === 'Rational') && ops.length === 2) {
      const n = ops[0].asSmallInteger;
      const d = ops[1].asSmallInteger;
      if (
        n !== null &&
        d !== null &&
        Number.isInteger(n) &&
        Number.isInteger(d)
      ) {
        return this.number([n, d]);
      }
    }

    if (head === 'Number') {
      if (ops.length === 1) {
        const x = ops[0];
        const val = x.decimalValue ?? x.complexValue ?? x.machineValue;
        if (val !== null) return this.number(val);
        const [n, d] = x.rationalValue;
        if (n !== null && d !== null) return this.number([n, d]);
      }
      return this.NAN;
    }

    if (head === 'Complex') {
      if (ops.length === 1) {
        // If single argument, assume it's imaginary
        const val = ops[0].asFloat;
        if (val !== null) return this.number(this.complex(0, val));
        return this.mul([ops[0], this.I]);
      } else if (ops.length === 2) {
        const re = ops[0].asFloat;
        const im = ops[1].asFloat;
        if (re !== null && im !== null) this.number(this.complex(re, im));
        if (im === 0) return ops[0];
        return this.add([ops[0], this.mul([ops[1], this.I])], metadata);
      }
    }

    if (head === 'Negate' && ops.length === 1)
      return canonicalNegate(ops[0] ?? this.symbol('Missing'), metadata);

    if (
      head === 'Single' ||
      head === 'Pair' ||
      head === 'Triple' ||
      head === 'KeyValuePair'
    )
      return this.tuple(ops, metadata);

    if (head === 'Dictionary') {
      const dict = {};
      for (const op of ops) {
        if (op.head === 'Tuple') {
          const key = op.op1;
          if (!key.isMissing) {
            const val = op.op2;
            let k = key.symbol ?? key.string;
            if (!k && key.isLiteral) {
              const n = key.machineValue ?? key.asSmallInteger;
              if (n && Number.isFinite(n) && Number.isInteger(n))
                k = n.toString();
            }
            if (k) dict[k] === val;
          }
        }
      }
      return new BoxedDictionary(this, dict, metadata);
    }

    if (head === 'Add') return this.add(ops, metadata);
    if (head === 'Multiply') return this.mul(ops, metadata);
    if (head === 'Divide')
      return this.divide(
        ops[0] ?? this.symbol('Missing'),
        ops[1] ?? this.symbol('Missing'),
        metadata
      );
    if (head === 'Power')
      return this.power(
        ops[0] ?? this.symbol('Missing'),
        ops[1] ?? this.symbol('Missing'),
        metadata
      );

    const result = new BoxedFunction(this, head, ops, metadata);
    return result.canonical;
  }

  _fn(
    head: string | BoxedExpression,
    ops: BoxedExpression[],
    metadata?: Metadata
  ): BoxedExpression {
    const result = new BoxedFunction(this, head, ops, metadata);
    // @debug-begin
    // if (
    //   (head === 'Multiply' || head === 'Add') &&
    //   flattenOps(ops, head) !== null
    // ) {
    //   const tail = flattenOps(ops, head);
    //   console.error(
    //     `_fn("${head}") called with non-associative argument ${tail}`
    //   );
    // }
    // holdMap(ops, result.functionDefinition?.hold ?? 'none', (x) => {
    //   if (!x.isCanonical)
    //     console.error(
    //       `_fn("${head}" called with non-canonical argument ${x.toJSON()}`
    //     );
    //   return x;
    // });
    // @debug-end
    result.isCanonical = true;
    return result;
  }

  error(
    val: BoxedExpression,
    message: string,
    messageArg: SemiBoxedExpression
  ) {
    return this._fn('Error', [val, this.string(message), this.box(messageArg)]);
  }

  add(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    const result = canonicalAdd(this, ops);
    if (metadata?.latex) result.latex = metadata.latex;
    if (metadata?.wikidata) result.wikidata = metadata.wikidata;
    return result;
  }
  mul(ops: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    const result = canonicalMultiply(this, ops);
    if (metadata?.latex) result.latex = metadata.latex;
    if (metadata?.wikidata) result.wikidata = metadata.wikidata;
    return result;
  }
  power(
    base: BoxedExpression,
    exponent: number | [number, number] | BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    console.assert(base.isCanonical); // @debug
    let e: number | null = null;
    if (typeof exponent === 'number') e = exponent;
    else if (Array.isArray(exponent) && exponent[1] === 1) e = exponent[0];
    if (e === 1) return base;
    if (e === -1 && base.isLiteral) {
      const [n, d] = base.rationalValue;
      if (n !== null && d !== null) return this.number([d, n]);
      const i = base.asSmallInteger;
      if (i !== null) return this.number([1, i]);
    }

    if (typeof exponent === 'number' || Array.isArray(exponent))
      exponent = this.number(exponent);
    else {
      console.assert(exponent.isCanonical); // @debug
    }

    return (
      canonicalPower(this, base, exponent, metadata) ??
      this._fn('Power', [base, exponent], metadata)
    );
  }

  inverse(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    console.assert(expr.isCanonical); // @debug

    let e = this.NEGATIVE_ONE;

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
  negate(expr: BoxedExpression, metadata?: Metadata): BoxedExpression {
    return canonicalNegate(expr, metadata);
  }
  divide(
    num: BoxedExpression,
    denom: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    const result = canonicalDivide(this, num, denom);
    if (metadata?.latex) result.latex = metadata.latex;
    if (metadata?.wikidata) result.wikidata = metadata.wikidata;
    return result;
  }
  pair(
    first: BoxedExpression,
    second: BoxedExpression,
    metadata?: Metadata
  ): BoxedExpression {
    // @todo: fast path
    return this._fn('Tuple', [first, second], metadata);
  }
  tuple(elements: BoxedExpression[], metadata?: Metadata): BoxedExpression {
    // @todo: fast path
    return this._fn('Tuple', elements, metadata);
  }

  string(s: string, metadata?: Metadata): BoxedExpression {
    return new BoxedString(this, s, metadata);
  }

  symbol(sym: string, metadata?: Metadata): BoxedExpression {
    // These three are not symbols (one of them are not even valid symbol names)
    // but they're a common type
    if (sym === 'Infinity') return this.POSITIVE_INFINITY;
    if (sym === '+Infinity') return this.POSITIVE_INFINITY;
    if (sym === '-Infinity') return this.NEGATIVE_INFINITY;

    // `Half` is a synonym for the rational 1/2
    if (sym === 'Half') return this.HALF;

    let result = this._commonSymbols[sym];
    if (result) {
      if (
        !metadata?.wikidata ||
        !result.wikidata ||
        result.wikidata === metadata.wikidata
      )
        return result;
      return new BoxedSymbol(this, sym, metadata);
    }
    if (result === null) {
      // If `null`, the symbol is in `_commonSymbols`, but not
      // yet cached
      result = new BoxedSymbol(this, sym);
      this._commonSymbols[sym] = result;
      return result;
    }
    return new BoxedSymbol(this, sym, metadata);
  }
  domain(
    domain: BoxedExpression | string,
    metadata?: Metadata
  ): BoxedExpression {
    if (typeof domain !== 'string') return domain;
    if (this._commonDomains[domain]) return this._commonDomains[domain]!;
    if (this._commonDomains[domain] === null) {
      this._commonDomains[domain] = boxDomain(this, domain, metadata);
      return this._commonDomains[domain]!;
    }

    return boxDomain(this, domain, metadata);
  }
  number(
    value:
      | number
      | MathJsonNumber
      | Decimal
      | Complex
      | [num: number, denom: number],
    metadata?: Metadata
  ): BoxedExpression {
    if (Array.isArray(value) && value[1] === 1) value = value[0];
    if (typeof value === 'number') {
      if (value === -1) return this.NEGATIVE_ONE;
      if (this._commonNumbers[value] === null)
        this._commonNumbers[value] = boxNumber(this, value) ?? null;

      if (this._commonNumbers[value]) return this._commonNumbers[value]!;
    }
    return boxNumber(this, value, metadata) ?? this.NAN;
  }
  rules(rules: Rule[]): BoxedRuleSet {
    return boxRules(this, rules);
  }
  pattern(expr: LatexString | SemiBoxedExpression): Pattern {
    return new BoxedPattern(this, expr);
  }

  parse(s: null): null;
  parse(s: LatexString | string): BoxedExpression;
  parse(s: LatexString | string | null): null | BoxedExpression;
  parse(s: LatexString | null | string): BoxedExpression | null {
    if (s === null) return null;
    return this.box(this.latexSyntax.parse(latexString(s) ?? s));
  }
  serialize(x: Expression | BoxedExpression): string {
    if (typeof x === 'object' && 'json' in x)
      return this.latexSyntax.serialize(x.json);

    return this.latexSyntax.serialize(x as Expression);
  }

  get latexOptions(): Required<NumberFormattingOptions> &
    Required<ParseLatexOptions> &
    Required<SerializeLatexOptions> {
    return {
      ...this.latexSyntax.options,
      ...this.latexSyntax.serializer.options,
    };
  }
  set latexOptions(
    opts: NumberFormattingOptions & ParseLatexOptions & SerializeLatexOptions
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

  /**
   * Add an assumption.
   *
   * Return `contradiction` if the new assumption is incompatible with previous
   * ones.
   *
   * Return `tautology` if the new assumption is redundant with previous ones.
   *
   * Return `ok` if the assumption was successfully added to the assumption set.
   *
   * Note that the assumption is put into canonical form before being added.
   *
   */
  assume(
    symbol: LatexString | SemiBoxedExpression,
    domain: string | BoxedExpression
  ): AssumeResult;
  assume(predicate: LatexString | SemiBoxedExpression): AssumeResult;
  assume(
    arg1: LatexString | SemiBoxedExpression,
    arg2?: string | BoxedExpression
  ): AssumeResult {
    try {
      const latex = latexString(arg1);

      let predicate = latex ? this.parse(latex) : this.box(arg1);
      if (arg2) predicate = this.box(['Element', arg1, this.domain(arg2)]);

      return assume(predicate);
    } catch {
      return 'internal-error';
    }
  }

  forget(symbol: undefined | string | string[]): void {
    if (symbol === undefined) {
      this.assumptions.clear();
      return;
    }
    if (Array.isArray(symbol)) {
      for (const x of symbol) this.forget(x);
      return;
    }
    if (typeof symbol === 'string') {
      // Remove symbol definition in the current scope (if any)
      this.context.dictionary?.symbols.delete(symbol);

      // Remove any assumptions that make a reference to this symbol
      // (note that when a scope if created, any assumptions from the
      // parent scope are copied over, so this effectively remove any
      // reference to this symbol, even if they are assumptions about
      // it in a parent scope. However, when the current scope exits,
      // any previous assumptions about the symbol will be restored).
      for (const [assumption, _val] of this.assumptions) {
        const vars = getVars(assumption);
        if (vars.includes(symbol)) this.assumptions.delete(assumption);
      }
    }
  }
}
