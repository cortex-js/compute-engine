import { Expression, Substitution } from '../math-json/math-json-format';
import { LatexSyntax } from '../math-json/latex-syntax';
import {
  DictionaryCategory,
  ErrorSignal,
  LatexString,
  Serializer,
  WarningSignal,
} from '../math-json/public';
import {
  AssumeResult,
  CollectionDefinition,
  ComputeEngine,
  Definition,
  Dictionary,
  Domain,
  DomainExpression,
  Form,
  FunctionDefinition,
  Numeric,
  NumericFormat,
  RuleSet,
  RuntimeScope,
  Scope,
  SetDefinition,
  Simplification,
  SymbolDefinition,
} from '../math-json/compute-engine-interface';

import { evaluateBoolean, forget, forgetAll, internalAssume } from './assume';
import { DEFAULT_COST_FUNCTION, internalSimplify } from './simplify';
import { internalDomain } from './domains';
import { match } from './patterns';
import { format } from './canonical-forms';
import { CortexError, getVariables } from './utils';
import {
  isEqual,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isSubsetOf,
  isZero,
  isNotZero,
  isNumeric,
  isInfinity,
  isFinite,
  isNonNegative,
  isPositive,
  isNegative,
  isNonPositive,
  isInteger,
  isReal,
  isComplex,
  isAlgebraic,
  isRational,
  isExtendedReal,
  isOne,
  isElement,
  isNegativeOne,
} from './predicates';
import { internalEvaluate } from './evaluate';
import { ExpressionMap } from '../math-json/expression-map';
import { MACHINE_PRECISION, NUMERICAL_TOLERANCE } from './numeric';
import { replace } from './rules';
import { internalN } from './numerical-eval';
import { DECIMAL_ZERO } from './numeric-decimal';
import { univariateSolve } from './solve';

import {
  compileDictionary,
  getDefaultDictionaries,
} from './dictionary/dictionary';
import {
  isFunctionDefinition,
  isSymbolDefinition,
  isSetDefinition,
  isCollectionDefinition,
} from './dictionary/utils';

import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { unstyle } from './dictionary/arithmetic';

/**
 * The internal  compute engine implements the ComputeEngine interface
 * but does not:
 * - account for time limits
 * - account for iteration limits
 * - apply a canonical form
 *
 * It is used for recursive calls, and by the "top-level" `ComputeEngine`.
 */
export class InternalComputeEngine implements ComputeEngine<Numeric> {
  static getDictionaries(
    categories: DictionaryCategory[] | 'all' = 'all'
  ): Readonly<Dictionary<Numeric>>[] {
    return getDefaultDictionaries(categories);
  }

  private _precision: number;
  private _numericFormat: NumericFormat;
  private _latexSyntax?: LatexSyntax; // To parse rules as LaTeX

  private _tolerance: number;

  private _cache: { [key: string]: any } = {};

  private _cost?: (expr: Expression) => number;

  /**
   * The current scope.
   *
   * A scope is a dictionary that contains the definition of local symbols.
   *
   * Scopes form a stack, and definitions in more recent
   * scopes can obscure definitions from older scopes.
   *
   */
  context: RuntimeScope<Numeric>;

  /** Absolute time beyond which evaluation should not proceed */
  deadline?: number;

  constructor(options?: {
    dictionaries?: Readonly<Dictionary<Numeric>>[];
    numericFormat?: NumericFormat;
    assumptions?: (LatexString | Expression)[];
    numericPrecision?: number;
    tolerance?: number;
  }) {
    const dicts =
      options?.dictionaries ?? InternalComputeEngine.getDictionaries();

    this.numericFormat = options?.numericFormat ?? 'auto';
    this.tolerance = options?.tolerance ?? NUMERICAL_TOLERANCE;

    for (const dict of dicts) {
      if (!this.context) {
        //
        // The first, topmost, scope contains additional info
        //
        this.pushScope({
          dictionary: dict,
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
      } else {
        if (Object.keys(dict).length > 0) this.pushScope({ dictionary: dict });
      }
    }

    // Push a fresh scope to protect global definitions:
    // this will be the "user" scope
    if (options?.assumptions === null) {
      // If `assumptions` is set to null: no assumptions
      this.pushScope();
    } else {
      this.pushScope({
        assumptions: options?.assumptions ?? [
          ['Element', 'a', 'RealNumber'],
          ['Element', 'b', 'RealNumber'],
          ['Element', 'c', 'RealNumber'],
          ['Element', 'd', 'RealNumber'],
          ['Equal', 'e', 'ExponentialE'],
          ['Element', 'f', 'Function'],
          ['Element', 'g', 'Function'],
          ['Element', 'h', 'Function'],
          ['Element', 'i', 'RealNumber'], // Could also be ImaginaryUnit
          ['Element', 'j', 'RealNumber'],
          ['Element', 'k', 'RealNumber'],
          ['Element', 'l', 'RealNumber'], //? Length or a prime number
          ['Element', 'm', 'Integer'],
          ['Element', 'n', 'Integer'],
          // ['Element', 'o', 'RealNumber'], // ?
          ['Element', 'p', 'Integer'], // Could also be Boolean or probability or prime number
          ['Element', 'q', 'Integer'], // Could also be Boolean, prime power or quotient
          ['Element', 'r', 'RealNumber'], // Radius, remainder or correlation coefficient
          // ['Element', 's', 'RealNumber'],
          ['Element', 't', 'RealNumber'],
          // ['Element', 'u', 'RealNumber'], // Could be vectors
          // ['Element', 'v', 'RealNumber'],
          ['Element', 'w', 'ComplexNumber'],
          ['Element', 'x', 'RealNumber'],
          ['Element', 'y', 'RealNumber'],
          ['Element', 'z', 'ComplexNumber'],
        ],
      });
    }
  }

  cache<T>(cacheName: string, fn: null | (() => T)): T {
    if (this._cache[cacheName] === undefined && fn !== null) {
      try {
        this._cache[cacheName] = fn();
      } catch (e) {
        console.error(
          `Fatal error building cache "${cacheName}":\n\t ${e.toString()}`
        );
      }
    }
    // Reset the cache if `fn` is null
    if (fn === null) this._cache[cacheName] = undefined;

    return this._cache[cacheName];
  }

  get precision(): number {
    return this._precision;
  }
  set precision(p: number | 'machine') {
    const currentPrecision = this._precision;
    if (p === 'machine') {
      p = Math.min(MACHINE_PRECISION, Math.floor(MACHINE_PRECISION));
    }
    if (p !== currentPrecision) {
      if (p <= MACHINE_PRECISION) this._numericFormat = 'machine';

      Decimal.set({ precision: p });
      this._precision = p;

      // Reset the caches
      // (some of the values in the cache may depend on the current precision)
      this._cache = {};
    }
  }

  get numericFormat(): NumericFormat {
    return this._numericFormat;
  }
  set numericFormat(f: NumericFormat) {
    if (f !== this._numericFormat) {
      if (f === 'machine' || f === 'complex' || f === 'auto') {
        this._precision = Math.floor(MACHINE_PRECISION);
      } else if (f === 'decimal') {
        this._precision = Decimal.precision;
      }
      this._numericFormat = f;

      // Reset the caches
      // (some of the values in the cache may depend on the current precision)
      this._cache = {};
    }
  }

  get tolerance(): number {
    return this._tolerance;
  }

  set tolerance(val: number) {
    if (typeof val === 'number' && Number.isFinite(val))
      this._tolerance = Math.max(val, 0);
    else this._tolerance = NUMERICAL_TOLERANCE;
  }

  get latexSyntax(): LatexSyntax {
    // We'll use this LatexSyntax instance internally, for example to parse
    // rules, etc... Use our own custom error handler, which will throw
    // on any error.
    if (!this._latexSyntax)
      this._latexSyntax = new LatexSyntax({
        computeEngine: this,
        onError: (err) => {
          throw new Error(err[0].message.toString());
        },
      });
    return this._latexSyntax;
  }

  get serializer(): Serializer {
    return this.latexSyntax.serializer;
  }

  set cost(fn: ((expr: Expression) => number) | undefined) {
    if (typeof fn !== 'function') this._cost = DEFAULT_COST_FUNCTION;
    this._cost = fn;
  }

  get cost(): (expr: Expression) => number {
    return this._cost ?? DEFAULT_COST_FUNCTION;
  }

  pushScope(options?: {
    dictionary?: Readonly<Dictionary<Numeric>>;
    assumptions?: (LatexString | Expression)[];
    scope?: Partial<Scope>;
  }): void {
    this.context = {
      ...options?.scope,
      parentScope: this.context,
      dictionary: compileDictionary(this, options?.dictionary),
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
    // Add any user-specified assumptions
    if (options?.assumptions !== undefined) {
      for (const assumption of options.assumptions) {
        if (typeof assumption === 'string') {
          this.assume(this.latexSyntax.parse(assumption));
        } else {
          this.assume(assumption);
        }
      }
    }
  }

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

  get assumptions(): ExpressionMap<Numeric, boolean> {
    if (this.context.assumptions) return this.context.assumptions;
    // When creating a new context, the assumptions of this context
    // are a copy of all the previous assumptions
    // (as a result, there's no need to check parent assumptions,
    // and it solves the assumptions in a scope that could be contradictory
    // or complementary to previous assumptions).
    this.context.assumptions = new ExpressionMap<Numeric, boolean>();
    return this.context.assumptions;
  }

  signal(sig: ErrorSignal | WarningSignal): void {
    // @todo
    console.error(...sig.message);
    return;
  }

  get timeLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.timeLimit !== undefined) return scope.timeLimit;
      scope = scope.parentScope;
    }
    return 2.0; // 2s
  }
  get recursionLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.recursionLimit !== undefined) return scope.recursionLimit;
      scope = scope.parentScope;
    }
    return 1024;
  }
  get iterationLimit(): number {
    let scope = this.context;
    while (scope) {
      if (scope.iterationLimit !== undefined) return scope.iterationLimit;
      scope = scope.parentScope;
    }
    return 1024;
  }

  shouldContinueExecution(): boolean {
    return this.deadline === undefined || this.deadline >= Date.now();
  }

  checkContinueExecution(): void {
    if (!this.shouldContinueExecution()) {
      throw new CortexError({
        message: 'timeout', // @todo: should capture stack
      });
    }
  }

  getFunctionDefinition(name: string): FunctionDefinition | null {
    let scope = this.context;
    let def: Definition<Numeric> | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isFunctionDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return (def as FunctionDefinition) ?? null;
  }

  getSymbolDefinition(name: string): SymbolDefinition<Numeric> | null {
    let scope = this.context;
    let def: Definition<Numeric> | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isSymbolDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def as SymbolDefinition<Numeric>;
  }

  getSetDefinition(name: string): SetDefinition<Numeric> | null {
    let scope = this.context;
    let def: Definition<any> | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isSetDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def as SetDefinition<Numeric>;
  }

  getCollectionDefinition(name: string): CollectionDefinition<Numeric> | null {
    let scope = this.context;
    let def: Definition<any> | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isCollectionDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def as CollectionDefinition<Numeric>;
  }

  getDefinition(name: string): Definition<Numeric> | null {
    let scope = this.context;
    let def: Definition<Numeric> | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def;
  }

  canonical(expr: Expression | null): Expression | null {
    return this.format(expr);
  }

  format(expr: Expression | null, forms?: Form | Form[]): Expression | null {
    try {
      return format(
        this,
        expr,
        Array.isArray(forms) ? forms : [forms ?? 'canonical']
      );
    } catch {
      return null;
    }
  }

  evaluate(
    expr: Expression,
    options?: { timeLimit?: number; iterationLimit?: number }
  ): Promise<Expression | null> {
    try {
      return internalEvaluate(this, unstyle(expr), options);
    } catch {
      return Promise.resolve(null);
    }
  }

  simplify(
    expr: Expression,
    options?: { simplifications?: Simplification[] }
  ): Expression | null {
    try {
      return internalSimplify(this, unstyle(expr), options?.simplifications);
    } catch {
      return null;
    }
  }

  N(expr: Expression, options?: { precision?: number }): Expression | null {
    try {
      const savedPrecision = this.precision;
      const savedNumericFormat = this.numericFormat;

      if (options?.precision !== undefined) this.precision = options.precision;
      //
      // 1/ Prepare the expression by simplifying it
      // (this will simplify things like `Parentheses` and other things
      // that could throw us off)
      //
      let result = this.canonical(internalSimplify(this, unstyle(expr)));

      if (result !== null) result = internalN(this, result);
      if (result !== null) result = this.canonical(result);

      this.precision = savedPrecision;
      this.numericFormat = savedNumericFormat;

      return result ?? expr;
    } catch {
      return null;
    }
  }

  solve(
    expr: Expression<Numeric>,
    vars: string[]
  ): null | Expression<Numeric>[] {
    // @todo: multivariate solving
    if (vars.length !== 1) return null;
    try {
      return univariateSolve(this, expr, vars[0]);
    } catch {
      return null;
    }
  }

  // is(symbol: Expression, domain: Domain): boolean | undefined;
  // is(proposition: Expression): boolean | undefined;
  /**
   * Provide an answer to questions about
   * - equality
   * - inequality
   * - set/domain membership
   * - subset of
   *
   * Consider assumptions and evaluate boolean expressions.
   *
   * The proposition can be a boolean expression including:
   * - `And`
   * - `Or`
   * - `Not`
   *
   */
  is(arg1: Expression, arg2?: Domain): boolean | undefined {
    let proposition: Expression = arg1;
    if (arg2) {
      proposition = ['Element', arg1, arg2];
    }
    const result = evaluateBoolean(this, proposition);
    if (result === 'True') return true;
    if (result === 'False') return false;
    return undefined;
  }

  ask(pattern: Expression): Substitution[] {
    const result: { [symbol: string]: Expression }[] = [];
    for (const [assumption, val] of this.assumptions) {
      const m = match(assumption, pattern, {
        numericTolerance: this._tolerance,
      });
      if (m !== null && val === true) result.push(m);
    }
    return result;
  }

  // assume(
  //   symbol: Expression,
  //   domain: Domain
  // ): 'contradiction' | 'tautology' | 'ok';
  // assume(predicate: Expression): 'contradiction' | 'tautology' | 'ok';
  assume(arg1: Expression, arg2?: Domain): AssumeResult {
    try {
      let predicate: Expression = arg1;
      if (arg2) {
        predicate = ['Element', arg1, arg2];
      }
      return internalAssume(this, predicate);
    } catch {
      return 'internal-error';
    }
  }

  forget(symbol?: string | string[]): void {
    if (symbol === undefined) {
      forgetAll(this);
      return;
    }
    if (Array.isArray(symbol)) {
      for (const x of symbol) forget(this, x);
    }
    if (typeof symbol === 'string') forget(this, symbol);
  }

  match(
    expr: Expression<Numeric>,
    pattern: Expression<Numeric>,
    options?: {
      numericTolerance?: number;
      exact?: boolean;
    }
  ): Substitution | null {
    if (!(options?.exact ?? false)) {
      expr = this.canonical(expr);
      pattern = this.canonical(pattern);
    }
    return match(expr, pattern, {
      numericTolerance: options?.numericTolerance ?? this.tolerance,
    });
  }

  replace(expr: Expression<Numeric>, rules: RuleSet): Expression<Numeric> {
    return replace(this, expr, rules);
  }

  domain(expr: Expression): Domain | null {
    return internalDomain(this, expr);
  }

  getVars(expr: Expression): Set<string> {
    return getVariables(this, expr);
  }

  chop(n: Numeric): Numeric {
    if (typeof n === 'number') {
      return Math.abs(n) <= this._tolerance ? 0 : n;
    } else if (n instanceof Complex) {
      if (
        Math.abs(n.re) <= this._tolerance &&
        Math.abs(n.im) <= this._tolerance
      ) {
        return 0;
      } else {
        return n;
      }
    } else if (n instanceof Decimal) {
      return n.abs().lte(this._tolerance) ? DECIMAL_ZERO : n;
    }
    return n;
  }

  parse(s: string): Expression {
    return this.latexSyntax.parse(s);
  }

  serialize(x: Expression): string {
    return this.latexSyntax.serialize(x);
  }

  isZero(x: Expression): boolean | undefined {
    return isZero(this, x);
  }
  isNotZero(x: Expression): boolean | undefined {
    return isNotZero(this, x);
  }
  isNumeric(x: Expression): boolean | undefined {
    return isNumeric(this, x);
  }
  isInfinity(x: Expression): boolean | undefined {
    return isInfinity(this, x);
  }
  // Not +- Infinity, not NaN
  isFinite(x: Expression): boolean | undefined {
    return isFinite(this, x);
  }
  // x >= 0
  isNonNegative(x: Expression): boolean | undefined {
    return isNonNegative(this, x);
  }
  // x > 0
  isPositive(x: Expression): boolean | undefined {
    return isPositive(this, x);
  }
  // x < 0
  isNegative(x: Expression): boolean | undefined {
    return isNegative(this, x);
  }
  // x <= 0
  isNonPositive(x: Expression): boolean | undefined {
    return isNonPositive(this, x);
  }
  isInteger(x: Expression): boolean | undefined {
    return isInteger(this, x);
  }
  isRational(x: Expression): boolean | undefined {
    return isRational(this, x);
  }
  isAlgebraic(x: Expression): boolean | undefined {
    return isAlgebraic(this, x);
  }
  isReal(x: Expression): boolean | undefined {
    return isReal(this, x);
  }
  // Real or +-Infinity
  isExtendedReal(x: Expression): boolean | undefined {
    return isExtendedReal(this, x);
  }
  isComplex(x: Expression): boolean | undefined {
    return isComplex(this, x);
  }
  isOne(x: Expression): boolean | undefined {
    return isOne(this, x);
  }
  isNegativeOne(x: Expression): boolean | undefined {
    return isNegativeOne(this, x);
  }
  isElement(x: Expression, set: Expression): boolean | undefined {
    return isElement(this, x, set);
  }
  isSubsetOf(
    lhs: DomainExpression | null,
    rhs: DomainExpression | null
  ): boolean | undefined {
    return isSubsetOf(this, lhs, rhs);
  }

  isEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    return isEqual(this, lhs, rhs);
  }
  isLess(lhs: Expression, rhs: Expression): boolean | undefined {
    return isLess(this, lhs, rhs);
  }
  isLessEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    return isLessEqual(this, lhs, rhs);
  }
  isGreater(lhs: Expression, rhs: Expression): boolean | undefined {
    return isGreater(this, lhs, rhs);
  }
  isGreaterEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    return isGreaterEqual(this, lhs, rhs);
  }
}
