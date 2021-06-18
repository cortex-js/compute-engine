import {
  DictionaryCategory,
  Expression,
  ErrorSignal,
  WarningSignal,
} from '../public';
import { internalAssume, isWithEngine } from './assume';
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
import {
  CollectionDefinition,
  ComputeEngine,
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
import { internalSimplify } from './simplify';
import { internalDomain } from './domains';
import { match } from './patterns';
import { format } from './canonical-forms';
import { internalEvaluateNumerically } from './numerical-eval';
import {
  CortexError,
  getVars,
  isEqual,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isSubsetOf,
} from './utils';
import { internalEvaluate } from './evaluate';
import { ExpressionMap } from './expression-map';
import { MACHINE_PRECISION } from './numeric';

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
  _numericFormat: NumericFormat;

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

  constructor(options?: { dictionaries?: Readonly<Dictionary<Numeric>>[] }) {
    const dicts =
      options?.dictionaries ?? InternalComputeEngine.getDictionaries();

    for (const dict of dicts) {
      if (!this.context) {
        //
        // The first, topmost, scope contains additional info
        //
        this.pushScope(dict, {
          warn: (sigs: WarningSignal[]): void => {
            for (const sig of sigs) {
              if (typeof sig.message === 'string') {
                console.warn(sig.message);
              } else {
                console.warn(...sig.message);
              }
            }
          },
          timeLimit: 2.0, // execution time limit: 2.0s
          memoryLimit: 1.0, // memory limit: 1.0 megabyte
          recursionLimit: 1024,
          // iterationLimit:    no iteration limit
        });
      } else {
        this.pushScope(dict);
      }
    }

    // Push a fresh scope to protect global definitions.
    this.pushScope({});
  }

  get precision(): number {
    return this._precision;
  }
  set precision(p: number | 'machine') {
    if (p === 'machine') p = Math.floor(MACHINE_PRECISION);
    if (p <= MACHINE_PRECISION) {
      this._numericFormat = 'machine';
    }
    this._precision = p;
  }

  get numericFormat(): NumericFormat {
    return this._numericFormat;
  }
  set numericFormat(f: NumericFormat) {
    if (f === 'machine' || f === 'complex') {
      this._precision = Math.floor(MACHINE_PRECISION);
    }
    this._numericFormat = f;
  }

  pushScope(
    dictionary: Readonly<Dictionary<Numeric>>,
    scope?: Partial<Scope>
  ): void {
    this.context = {
      ...scope,
      parentScope: this.context,
      dictionary: compileDictionary(dictionary, this),
      assumptions: this.context
        ? new ExpressionMap(this.context.assumptions)
        : new ExpressionMap(),
    };
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
    this.context.assumptions = new ExpressionMap<Numeric, boolean>();
    return this.context.assumptions;
  }

  signal(_sig: ErrorSignal | WarningSignal): void {
    // @todo
    return;
  }

  get timeLimit(): undefined | number {
    let scope = this.context;
    while (scope) {
      if (scope.timeLimit !== undefined) return scope.timeLimit;
      scope = scope.parentScope;
    }
    return undefined;
  }
  get recursionLimit(): undefined | number {
    let scope = this.context;
    while (scope) {
      if (scope.recursionLimit !== undefined) return scope.recursionLimit;
      scope = scope.parentScope;
    }
    return undefined;
  }
  get iterationLimit(): undefined | number {
    let scope = this.context;
    while (scope) {
      if (scope.iterationLimit !== undefined) return scope.iterationLimit;
      scope = scope.parentScope;
    }
    return undefined;
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
    return def ?? null;
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
    return def;
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
    return def;
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
    return def;
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
    return format(
      this,
      expr,
      Array.isArray(forms) ? forms : [forms ?? 'canonical']
    );
  }

  evaluate(expr: Expression): Promise<Expression | null> {
    return internalEvaluate(this, expr);
  }

  simplify(
    expr: Expression,
    options?: { simplifications?: Simplification[] }
  ): Expression | null {
    return internalSimplify(this, expr, options?.simplifications);
  }

  N(expr: Expression, options?: { precision?: number }): Expression | null {
    const savedPrecision = this.precision;
    const savedNumericFormat = this.numericFormat;

    if (options?.precision) this.precision = options.precision;

    const result = internalEvaluateNumerically(this, expr);

    this.precision = savedPrecision;
    this.numericFormat = savedNumericFormat;
    return this.canonical(result);
  }

  // is(symbol: Expression, domain: Domain): boolean | undefined;
  // is(predicate: Expression): boolean | undefined;
  is(arg1: Expression, arg2?: Domain): boolean | undefined {
    let predicate: Expression = arg1;
    if (arg2) {
      predicate = ['Element', arg1, arg2];
    }
    return isWithEngine(this, predicate);
  }

  ask(pattern: Expression): { [symbol: string]: Expression }[] {
    const result: { [symbol: string]: Expression }[] = [];
    for (const assumption in this.assumptions) {
      const m = match(pattern, assumption);
      if (m !== null) result.push(m);
    }
    return result;
  }

  // assume(
  //   symbol: Expression,
  //   domain: Domain
  // ): 'contradiction' | 'tautology' | 'ok';
  // assume(predicate: Expression): 'contradiction' | 'tautology' | 'ok';
  assume(
    arg1: Expression,
    arg2?: Domain
  ): 'contradiction' | 'tautology' | 'ok' {
    let predicate: Expression = arg1;
    if (arg2) {
      predicate = ['Element', arg1, arg2];
    }
    return internalAssume(this, predicate);
  }

  domain(expr: Expression): Domain | null {
    return internalDomain(this, expr);
  }

  isSubsetOf(lhs: Domain | null, rhs: Domain | null): boolean {
    return isSubsetOf(this, lhs, rhs);
  }

  getVars(expr: Expression): Set<string> {
    return getVars(this, expr);
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
