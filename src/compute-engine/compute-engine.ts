import {
  DictionaryCategory,
  ErrorSignal,
  Expression,
  WarningSignal,
} from '../public';

import {
  CollectionDefinition,
  ComputeEngine as ComputeEngineInterface,
  Definition,
  Dictionary,
  Domain,
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
} from './public';

import { InternalComputeEngine } from './internal-compute-engine';
import { equalExpr } from '../common/utils';
import { ExpressionMap } from './expression-map';
import { Substitution } from './patterns';

/**
 * Create a `CustomEngine` instance to customize its behavior and the syntax
 * and operation dictionaries it uses.
 *
 * The constructor of `ComputeEngine` will compile and optimize the dictionary
 * upfront.
 */
export class ComputeEngine<T extends number = number>
  implements ComputeEngineInterface
{
  readonly internal: InternalComputeEngine;

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
  ): Readonly<Dictionary<Numeric>>[] {
    return InternalComputeEngine.getDictionaries(categories);
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
  constructor(options?: { dictionaries?: Readonly<Dictionary<Numeric>>[] }) {
    this.internal = new InternalComputeEngine(options);
  }

  /** The default precision of the compute engine: the number of significant
   * digits when performing numeric evaluations, such as when calling `ce.N()`.
   *
   * To make calculations using machine floating point representation, set
   * `precision` to `"machine"`  (15 by default).
   *
   * To  make calculations using more digits, at the cost of expended memory
   * usage and slower computations, set the `precision` higher.
   *
   * Trigonometric operations are accurate for precision up to 1,000.
   *
   * Some functions, such as `ce.N()` have an option to specify the precision.
   * If no precision is specified in these functions, the precision of
   * the compute engine is used.
   *
   */
  get precision(): number {
    return this.internal.precision;
  }
  set precision(p: number | 'machine') {
    this.internal.precision = p;
  }

  /**
   * Internal format to represent numbers:
   * - `auto`: the best format is determined based on the calculations to perform
   * and the requested precision.
   * - `number`: use the machine format (64-bit float, 52-bit, about 15 digits
   * of precision).
   * - `decimal`: arbitrary precision floating-point numbers, as provided by the
   * "decimal.js" library
   * - `complex`: complex numbers: two 64-bit float, as provided by the
   * "complex.js" library
   *
   */
  get numericFormat(): NumericFormat {
    return this.internal.numericFormat;
  }
  set numericFormat(f: NumericFormat) {
    this.internal.numericFormat = f;
  }

  /**
   * Values smaller than the tolerance are considered to be zero for the
   * purpose of comparison, i.e. if `|b - a| <= tolerance`, `b` is considered
   * equal to `a`.
   */
  get tolerance(): number {
    return this.internal.tolerance;
  }
  set tolerance(val: number) {
    this.internal.tolerance = val;
  }

  /**
   * The current executin context, a runtime scope.
   *
   * A scope is a dictionary that contains the definition of local symbols.
   *
   * Scopes form a stack, and definitions in more recent
   * scopes can obscure definitions from older scopes.
   *
   */
  get context(): RuntimeScope<Numeric> {
    return this.internal.context;
  }

  /** Create a new scope and add it to the top of the scope stack */
  pushScope(
    dictionary: Readonly<Dictionary<Numeric>>,
    scope?: Partial<Scope>
  ): void {
    this.internal.pushScope(dictionary, scope);
  }

  /** Remove the topmost scope from the scope stack.
   */
  popScope(): void {
    this.internal.popScope();
  }

  get assumptions(): ExpressionMap<T, boolean> {
    return this.internal.assumptions;
  }

  /**
   * Return false if the execution should stop.
   *
   * This can occur if:
   * - an error has been signaled
   * - the time limit or memory limit has been exceeded
   */
  shouldContinueExecution(): boolean {
    return this.internal.shouldContinueExecution();
  }

  checkContinueExecution(): void {
    this.internal.checkContinueExecution();
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
  signal(sig: ErrorSignal | WarningSignal): void {
    this.internal.signal(sig);
  }

  getFunctionDefinition(name: string): FunctionDefinition | null {
    return this.internal.getFunctionDefinition(name);
  }
  getSymbolDefinition(name: string): SymbolDefinition<Numeric> | null {
    return this.internal.getSymbolDefinition(name);
  }
  getSetDefinition(name: string): SetDefinition<Numeric> | null {
    return this.internal.getSetDefinition(name);
  }
  getCollectionDefinition(name: string): CollectionDefinition<Numeric> | null {
    return this.internal.getCollectionDefinition(name);
  }
  getDefinition(name: string): Definition<Numeric> | null {
    return this.internal.getDefinition(name);
  }

  cache<T>(key: string, fn: () => T): T {
    return this.internal.cache(key, fn);
  }

  format(expr: Expression | null, forms?: Form | Form[]): Expression | null {
    return this.internal.format(expr, forms);
  }

  /** Format the expression to the canonical form.
   *
   * In the canonical form, some operations are simplified (subtractions
   * becomes additions of negative, division become multiplications of inverse,
   * etc...) and terms are ordered using a deglex order. This can make
   * subsequent operations easier.
   */
  canonical(expr: Expression | null): Expression | null {
    return this.internal.format(expr, ['canonical']);
  }

  /**
   * Return a numerical approximation of an expression.
   */
  N(expr: Expression): Expression | null {
    return this.internal.N(expr);
  }

  solve(expr: Expression<T>, vars: string[]): null | Expression<T>[] {
    return this.internal.solve(expr, vars);
  }

  /**
   * Attempt to simplify an expression, that is rewrite it in a simpler form,
   * making use of the available assumptions.
   *
   * The simplification steps will proceed multiple times until either:
   * 1/ the expression stop changing
   * 2/ the number of iteration exceeds `iterationLimit`
   * 3/ the time to compute exceeds `timeLimit`, expressed in seconds
   *
   * If no `timeLimit` or `iterationLimit` are provided, the values
   * from the current ComputeEngine context are used. By default those
   * values are an infinite amount of iterations and a 2s time limit.
   *
   */
  simplify(
    expr: Expression,
    options?: {
      timeLimit?: number;
      iterationLimit?: number;
      simplifications?: Simplification[];
    }
  ): Expression | null {
    const timeLimit = options?.timeLimit ?? this.internal.timeLimit ?? 2.0;
    if (timeLimit && isFinite(timeLimit)) {
      this.internal.deadline = Date.now() + timeLimit * 1000;
    }

    const iterationLimit =
      options?.iterationLimit ?? this.internal.iterationLimit ?? 1024;
    let iterationCount = 0;
    let result: Expression | null = this.canonical(expr);
    let prevResult: Expression | null = result;
    while (iterationCount < iterationLimit && this.shouldContinueExecution()) {
      result = this.internal.simplify(result!, {
        simplifications: options?.simplifications,
      });
      if (result === null) return prevResult;
      if (equalExpr(prevResult, result)) return this.canonical(result);
      prevResult = result;
      iterationCount += 1;
    }
    if (result === null) return null;
    return this.canonical(result);
  }

  /**
   * Return a simplified and numerically approximation of an expression
   * in canonical form.
   *
   * The simplification steps will proceed multiple times until either:
   * 1/ the expression stop changing
   * 2/ the number of iteration exceeds `iterationLimit`
   * 3/ the time to compute exceeds `timeLimit`, expressed in seconds
   *
   * If no `timeLimit` or `iterationLimit` are provided, the values
   * from the current ComputeEngine context are used. By default those
   * values are an infinite amount of iterations and a 2s time limit.
   *
   * Evaluating some expressions can take a very long time. Some can invole
   * making network queries. To avoid blocking the main event loop,
   * this function is asynchronous and returns a `Promise`
   *
   * Use `result = await engine.evaluate(expr)` to get the result without
   * blocking.
   */
  async evaluate(
    expr: Expression,
    options?: { timeLimit?: number; iterationLimit?: number }
  ): Promise<Expression | null> {
    const val = this.internal.evaluate(expr, options);
    if (val === null) return null;
    return this.canonical(await val);
  }

  parse(s: string): Expression {
    return this.internal.parse(s);
  }
  serialize(x: Expression): string {
    return this.serialize(x);
  }

  /** Return the domain of the expression */
  domain(expr: Expression): Expression | null {
    return this.internal.domain(expr);
  }

  /**
   * Determines if the predicate is satisfied based on the known assumptions.
   *
   * Return `undefined` if the value of the predicate cannot be determined.
   *
   * ```js
   * ce.is(["Equal", "x", 0]);
   * ce.is(["Equal", 3, 4]);
   * ```
   *
   */
  is(symbol: Expression, domain: Domain): boolean | undefined;
  is(predicate: Expression): boolean | undefined;
  is(arg1: Expression, arg2?: Domain): boolean | undefined {
    return this.internal.is(arg1, arg2);
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
  ask(pattern: Expression): Substitution[] {
    return this.internal.ask(pattern);
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
   * Note that the assumption is put into normal form before being added.
   *
   */
  assume(
    symbol: Expression,
    domain: Domain
  ): 'not-a-predicate' | 'contradiction' | 'tautology' | 'ok';
  assume(
    predicate: Expression
  ): 'not-a-predicate' | 'contradiction' | 'tautology' | 'ok';
  assume(
    arg1: Expression,
    arg2?: Domain
  ): 'not-a-predicate' | 'contradiction' | 'tautology' | 'ok' {
    return this.internal.assume(arg1, arg2);
  }

  /**
   * Apply repeatedly a set of rules to an expression.
   */
  replace(rules: RuleSet<T>, expr: Expression<T>): Expression<T> {
    return this.internal.replace(rules, expr);
  }

  /** Return the variables in the expression */
  getVars(expr: Expression): Set<string> {
    return this.internal.getVars(expr);
  }
  chop(n: Numeric): Numeric {
    return this.internal.chop(n);
  }

  isZero(x: Expression<T>): boolean | undefined {
    return this.internal.isZero(x);
  }
  isNotZero(x: Expression<T>): boolean | undefined {
    return this.internal.isNotZero(x);
  }
  isNumeric(x: Expression<T>): boolean | undefined {
    return this.internal.isNumeric(x);
  }
  isInfinity(x: Expression<T>): boolean | undefined {
    return this.internal.isInfinity(x);
  }
  // Not +- Infinity, not NaN
  isFinite(x: Expression<T>): boolean | undefined {
    return this.internal.isFinite(x);
  }
  // x >= 0
  isNonNegative(x: Expression<T>): boolean | undefined {
    return this.internal.isNonNegative(x);
  }
  // x > 0
  isPositive(x: Expression<T>): boolean | undefined {
    return this.internal.isPositive(x);
  }
  // x < 0
  isNegative(x: Expression<T>): boolean | undefined {
    return this.internal.isNegative(x);
  }
  // x <= 0
  isNonPositive(x: Expression<T>): boolean | undefined {
    return this.internal.isNonPositive(x);
  }
  isInteger(x: Expression<T>): boolean | undefined {
    return this.internal.isInteger(x);
  }
  isRational(x: Expression<T>): boolean | undefined {
    return this.internal.isRational(x);
  }
  isAlgebraic(x: Expression<T>): boolean | undefined {
    return this.internal.isAlgebraic(x);
  }
  isReal(x: Expression<T>): boolean | undefined {
    return this.internal.isReal(x);
  }
  // Real or +-Infinity
  isExtendedReal(x: Expression<T>): boolean | undefined {
    return this.internal.isExtendedReal(x);
  }
  isComplex(x: Expression<T>): boolean | undefined {
    return this.internal.isComplex(x);
  }
  isOne(x: Expression<T>): boolean | undefined {
    return this.internal.isOne(x);
  }
  isNegativeOne(x: Expression<T>): boolean | undefined {
    return this.internal.isNegativeOne(x);
  }
  isElement(x: Expression<T>, set: Expression<T>): boolean | undefined {
    return this.internal.isElement(x, set);
  }
  isSubsetOf(lhs: Domain | null, rhs: Domain | null): boolean | undefined {
    return this.internal.isSubsetOf(lhs, rhs);
  }

  isEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    return this.internal.isEqual(lhs, rhs);
  }
  isLess(lhs: Expression, rhs: Expression): boolean | undefined {
    return this.internal.isLess(lhs, rhs);
  }
  isLessEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    return this.internal.isLessEqual(lhs, rhs);
  }
  isGreater(lhs: Expression, rhs: Expression): boolean | undefined {
    return this.internal.isGreater(lhs, rhs);
  }
  isGreaterEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    return this.internal.isGreaterEqual(lhs, rhs);
  }
}

let gComputeEngine: ComputeEngine | null = null;

/**
 * Transform an expression by applying one or more rewriting rules to it,
 * recursively.
 *
 * There are many ways to symbolically manipulate an expression, but
 * transformations with `form` have the following characteristics:
 *
 * - they don't require calculations or assumptions about the domain of free
 * variables or the value of constants
 * - the output expression is expressed with more primitive functions,
 * for example subtraction is replaced with addition
 *
 */
export function format(
  expr: Expression,
  forms: Form | Form[]
): Expression | null {
  if (gComputeEngine === null) gComputeEngine = new ComputeEngine();
  return gComputeEngine.format(expr, forms);
}

/**
 * Apply the definitions in the supplied dictionary to an expression
 * and return the result.
 *
 * Unlike `format` this may entail performing calculations and irreversible
 * transformations.
 *
 * See also `[ComputeEngine.evaluate()](#(ComputeEngine%3Aclass).(evaluate%3Ainstance))`.
 *
 * @param dictionaries - An optional set of functions and constants to use
 * when evaluating the expression. Evaluating the expression may modify the
 * scope, for example if the expression is an assignment or definition.
 */
export function evaluate(expr: Expression): Promise<Expression | null> {
  if (gComputeEngine === null) gComputeEngine = new ComputeEngine();
  return gComputeEngine.evaluate(expr);
}
