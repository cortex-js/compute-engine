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
  RuntimeScope,
  Scope,
  SetDefinition,
  Simplification,
  SymbolDefinition,
} from './public';

import { InternalComputeEngine } from './internal-compute-engine';
import { equalExpr } from '../common/utils';
import { ExpressionMap } from './expression-map';

export class ComputeEngine<T extends number = number>
  implements ComputeEngineInterface
{
  readonly internal: InternalComputeEngine;

  static getDictionaries(
    categories: DictionaryCategory[] | 'all' = 'all'
  ): Readonly<Dictionary<Numeric>>[] {
    return InternalComputeEngine.getDictionaries(categories);
  }

  constructor(options?: { dictionaries?: Readonly<Dictionary<Numeric>>[] }) {
    this.internal = new InternalComputeEngine(options);
  }

  get precision(): number {
    return this.internal.precision;
  }
  set precision(p: number | 'machine') {
    this.internal.precision = p;
  }

  get numericFormat(): NumericFormat {
    return this.internal.numericFormat;
  }
  set numericFormat(f: NumericFormat) {
    this.internal.numericFormat = f;
  }

  get context(): RuntimeScope<Numeric> {
    return this.internal.context;
  }

  pushScope(
    dictionary: Readonly<Dictionary<Numeric>>,
    scope?: Partial<Scope>
  ): void {
    this.internal.pushScope(dictionary, scope);
  }

  popScope(): void {
    this.internal.popScope();
  }

  get assumptions(): ExpressionMap<T, boolean> {
    return this.internal.assumptions;
  }

  shouldContinueExecution(): boolean {
    return this.internal.shouldContinueExecution();
  }

  checkContinueExecution(): void {
    this.internal.checkContinueExecution();
  }

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

  format(expr: Expression | null, forms?: Form | Form[]): Expression | null {
    return this.internal.format(expr, forms);
  }

  /**
   * Return the canonical form of an expression.
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
    const simplifications: Simplification[] = options?.simplifications ?? [
      'all',
    ];
    const timeLimit = options?.timeLimit ?? this.internal.timeLimit ?? 2.0;
    if (timeLimit && isFinite(timeLimit)) {
      this.internal.deadline = Date.now() + timeLimit * 1000;
    }

    const iterationLimit =
      options?.iterationLimit ?? this.internal.iterationLimit ?? 1024;
    let iterationCount = 0;
    let result: Expression | null = this.canonical(expr);
    let prevResult: Expression | null = null;
    while (iterationCount < iterationLimit && this.shouldContinueExecution()) {
      result = this.internal.simplify(result!, { simplifications });
      if (result === null) return null;
      if (equalExpr(prevResult, result)) return result;
      prevResult = result;
      iterationCount += 1;
    }
    return result;
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
   */
  evaluate(
    expr: Expression,
    options?: { timeLimit?: number; iterationLimit?: number }
  ): Promise<Expression | null> {
    const timeLimit = options?.timeLimit ?? this.internal.timeLimit ?? 2.0;
    if (timeLimit && isFinite(timeLimit)) {
      // eslint-disable-next-line no-restricted-globals
      this.internal.deadline = Date.now() + timeLimit * 1000;
    }

    const iterationLimit =
      options?.iterationLimit ?? this.internal.iterationLimit ?? 1024;
    let iterationCount = 0;
    let result: Expression | null = this.canonical(expr);
    let prevResult: Expression | null = null;
    while (iterationCount < iterationLimit && this.shouldContinueExecution()) {
      result = this.internal.simplify(result!);
      if (result === null) break;
      if (equalExpr(prevResult, result)) break;
      prevResult = result;
      iterationCount += 1;
    }

    result = this.internal.N(result ?? expr);

    return this.internal.evaluate(result ?? expr);
  }

  domain(expr: Expression): Expression | null {
    return this.internal.domain(expr);
  }

  /** Query the assumption database
   */
  is(symbol: Expression, domain: Domain): boolean | undefined;
  is(predicate: Expression): boolean | undefined;
  is(arg1: Expression, arg2?: Domain): boolean | undefined {
    return this.internal.is(arg1, arg2);
  }

  ask(pattern: Expression): { [symbol: string]: Expression }[] {
    return this.internal.ask(pattern);
  }

  assume(
    symbol: Expression,
    domain: Domain
  ): 'contradiction' | 'tautology' | 'ok';
  assume(predicate: Expression): 'contradiction' | 'tautology' | 'ok';
  assume(
    arg1: Expression,
    arg2?: Domain
  ): 'contradiction' | 'tautology' | 'ok' {
    return this.internal.assume(arg1, arg2);
  }

  isSubsetOf(lhs: Domain | null, rhs: Domain | null): boolean {
    return this.internal.isSubsetOf(lhs, rhs);
  }

  getVars(expr: Expression): Set<string> {
    return this.internal.getVars(expr);
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

export function format(
  expr: Expression,
  forms: Form | Form[]
): Expression | null {
  if (gComputeEngine === null) gComputeEngine = new ComputeEngine();
  return gComputeEngine.format(expr, forms);
}

export function evaluate(expr: Expression): Promise<Expression | null> {
  if (gComputeEngine === null) gComputeEngine = new ComputeEngine();
  return gComputeEngine.evaluate(expr);
}
