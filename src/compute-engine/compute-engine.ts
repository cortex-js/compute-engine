import {
  DictionaryCategory,
  ErrorSignal,
  Expression,
  WarningSignal,
} from '../public';

import {
  CollectionDefinition,
  Definition,
  Dictionary,
  Domain,
  Form,
  FunctionDefinition,
  RuntimeScope,
  Scope,
  SetDefinition,
  SymbolDefinition,
} from './public';

import {
  compileDictionary,
  getDefaultDictionaries,
} from './dictionary/dictionary';
import { format as formatWithEngine } from './forms';
import { compare } from './dictionary/compare';
import { evaluateWithEngine } from './evaluate';
import { domain as domainWithEngine } from './domains';
import {
  getArg,
  getFunctionName,
  getNumberValue,
  getSymbolName,
  getTail,
} from '../common/utils';
import {
  isCollectionDefinition,
  isFunctionDefinition,
  isSetDefinition,
  isSymbolDefinition,
} from './dictionary/utils';
import { same } from './same';
import { CortexError } from './utils';
import { simplifyWithEngine } from './simplify';
import { numericalEvalWithEngine } from './numerical-eval';
import { assumeWithEngine, isWithEngine } from './assume';

export class ComputeEngine {
  static getDictionaries(
    categories: DictionaryCategory[] | 'all' = 'all'
  ): Readonly<Dictionary>[] {
    return getDefaultDictionaries(categories);
  }
  context: RuntimeScope;
  deadline?: number;

  constructor(options?: { dictionaries?: Readonly<Dictionary>[] }) {
    const dicts = options?.dictionaries ?? ComputeEngine.getDictionaries();

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

  pushScope(dictionary: Readonly<Dictionary>, scope?: Partial<Scope>): void {
    this.context = {
      ...scope,
      parentScope: this.context,
      dictionary: compileDictionary(dictionary, this),
      assumptions: this.context ? new Set(this.context.assumptions) : new Set(),
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

  get assumptions(): Set<Expression> {
    if (this.context.assumptions) return this.context.assumptions;
    this.context.assumptions = new Set();
    return this.context.assumptions;
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
    if (
      this.deadline !== undefined &&
      this.deadline < globalThis.performance.now()
    ) {
      return false;
    }
    return true;
  }

  checkContinueExecution(): void {
    if (!this.shouldContinueExecution()) {
      throw new CortexError({
        message: 'timeout', // @todo: should capture stack
      });
    }
  }

  /**
   * Return the set of free variables in an expression.
   */
  getVars(expr: Expression): Set<string> {
    const result = new Set<string>();
    varsRecursive(expr, result, this);
    return result;
  }

  getFunctionDefinition(name: string): FunctionDefinition | null {
    let scope = this.context;
    let def: Definition | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isFunctionDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return def ?? null;
  }
  getSymbolDefinition(name: string): SymbolDefinition | null {
    let scope = this.context;
    let def: Definition | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isSymbolDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def;
  }
  getSetDefinition(name: string): SetDefinition | null {
    let scope = this.context;
    let def: Definition | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isSetDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def;
  }
  getCollectionDefinition(name: string): CollectionDefinition | null {
    let scope = this.context;
    let def: Definition | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def !== undefined && !isCollectionDefinition(def)) def = undefined;
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def;
  }
  getDefinition(name: string): Definition | null {
    let scope = this.context;
    let def: Definition | undefined = undefined;
    while (scope && !def) {
      def = scope.dictionary?.get(name);
      if (def === undefined) scope = scope.parentScope;
    }
    if (!def) return null;
    def.scope = scope;
    return def;
  }

  signal(_sig: ErrorSignal | WarningSignal): void {
    // @todo
    return;
  }

  /**
   * Return true if lhs is a subset or equal  rhs
   */
  isSubsetOf(lhs: Expression | null, rhs: Expression | null): boolean {
    if (!lhs || !rhs) return false;
    if (typeof lhs === 'string' && lhs === rhs) return true;
    if (rhs === 'Anything') return true;
    if (rhs === 'Nothing') return false;

    //
    // 1. Set operations on lhs
    //
    // Union: lhs or rhs
    // Intersection: lhs and rhs
    // SetMinus: lhs and not rhs
    // Complement: not lhs
    const lhsFnName = getFunctionName(lhs);
    if (lhsFnName === 'Union') {
      return getTail(lhs).some((x) => this.isSubsetOf(x, rhs));
    } else if (lhsFnName === 'Intersection') {
      return getTail(lhs).every((x) => this.isSubsetOf(x, rhs));
    } else if (lhsFnName === 'SetMinus') {
      return (
        this.isSubsetOf(getArg(lhs, 1), rhs) &&
        !this.isSubsetOf(getArg(lhs, 2), rhs)
      );
      // } else if (lhsFnName === 'Complement') {
      //   return !this.isSubsetOf(getArg(lhs, 1), rhs);
    }

    //
    // 2. Set operations on rhs
    //
    const rhsFnName = getFunctionName(rhs);
    if (rhsFnName === 'Union') {
      return getTail(rhs).some((x) => this.isSubsetOf(lhs, x));
    } else if (rhsFnName === 'Intersection') {
      return getTail(rhs).every((x) => this.isSubsetOf(lhs, x));
    } else if (rhsFnName === 'SetMinus') {
      return (
        this.isSubsetOf(lhs, getArg(rhs, 1)) &&
        !this.isSubsetOf(lhs, getArg(rhs, 2))
      );
      // } else if (rhsFnName === 'Complement') {
      //   return !this.isSubsetOf(lhs, getArg(rhs, 1));
    }

    //
    // 3. Not a set operation: a domain or a parametric domain
    //
    const rhsDomainName = getSymbolName(rhs) ?? rhsFnName;
    if (!rhsDomainName) {
      const rhsVal = getNumberValue(rhs) ?? NaN;
      if (Number.isNaN(rhsVal)) return false;
      // If the rhs is a number, 'upgrade' it to a set singleton
      rhs = rhs === 0 ? 'NumberZero' : ['Set', rhs];
    }

    const rhsDef = this.getSetDefinition(rhsDomainName);
    if (!rhsDef) return false;
    if (typeof rhsDef.isSubsetOf === 'function') {
      // 3.1 Parametric domain
      return rhsDef.isSubsetOf(this, lhs, rhs);
    }
    const lhsDomainName = getSymbolName(lhs) ?? lhsFnName;
    if (!lhsDomainName) return false;

    const lhsDef = this.getSetDefinition(lhsDomainName);
    if (!lhsDef) return false;

    // 3.2 Non-parametric domain:
    for (const parent of lhsDef.supersets) {
      if (this.isSubsetOf(parent, rhs)) return true;
    }

    return false;
  }

  format(expr: Expression | null, forms?: Form | Form[]): Expression | null {
    return formatWithEngine(
      this,
      expr,
      Array.isArray(forms) ? forms : [forms ?? 'canonical']
    );
  }
  /**
   * Return the canonical form of an expression.
   */
  canonical(expr: Expression | null): Expression | null {
    return this.format(expr);
  }

  /**
   * Return a numerical approximation of an expression.
   */
  N(exp: Expression): Expression | null {
    return numericalEvalWithEngine(this, exp);
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
    exp: Expression,
    options?: { timeLimit: number; iterationLimit: number }
  ): Expression | null {
    return simplifyWithEngine(this, exp, options);
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
    exp: Expression,
    options?: { timeLimit?: number; iterationLimit?: number }
  ): Promise<Expression | null> {
    return evaluateWithEngine(this, exp, options);
  }

  domain(exp: Expression): Expression | null {
    return domainWithEngine(this, exp);
  }

  isInfinity(_expr: Expression): boolean | undefined {
    // @todo inferDomainOf
    return undefined;
  }
  isZero(expr: Expression): boolean | undefined {
    return this.equal(expr, 0);
  }
  isOne(expr: Expression): boolean | undefined {
    return this.equal(expr, 1);
  }
  isMinusOne(expr: Expression): boolean | undefined {
    return this.equal(expr, -1);
  }
  /** Is `expr` >= 0? */
  isNonNegative(expr: Expression): boolean | undefined {
    const result = this.isZero(expr);
    if (result === undefined) return undefined;
    if (result === true) return true;
    return this.isPositive(expr);
  }
  /** Is `expr` > 0? */
  isPositive(_expr: Expression): boolean | undefined {
    // @todo
    return undefined;
  }
  /** Is `expr` < 0? */
  isNegative(expr: Expression): boolean | undefined {
    const result = this.isNonNegative(expr);
    if (result === undefined) return undefined;
    return !result;
  }
  /** Is `expr` <= 0? */
  isNonPositive(expr: Expression): boolean | undefined {
    const result = this.isPositive(expr);
    if (result === undefined) return undefined;
    return !result;
  }
  isInteger(_expr: Expression): boolean | undefined {
    // @todo
    return undefined;
  }
  /** Is `expr` an element of QQ (can be written as p/q)? */
  isRational(_expr: Expression): boolean | undefined {
    // @todo
    return undefined;
  }
  /** Is `expr` an element of RR? */
  isReal(_expr: Expression): boolean | undefined {
    // @todo
    return undefined;
  }
  /** Is `expr` an element of RR, including ±∞? */
  isExtendedReal(_expr: Expression): boolean | undefined {
    // @todo
    return undefined;
  }
  /** Is `expr` an algebraic number, i.e. not transcendental (π, e)? */
  isAlgebraic(_expr: Expression): boolean | undefined {
    // @todo
    return undefined;
  }
  /** Is `expr` a complex number? */
  isComplex(_expr: Expression): boolean | undefined {
    // @todo
    return undefined;
  }
  /** Is `expr` an element of `dom`? */
  isElement(_expr: Expression, _dom: Domain): boolean | undefined {
    // @todo
    return undefined;
  }
  match(
    _pattern: Expression,
    _target: Expression
  ): { [key: string]: Expression } | null {
    // @todo
    return null;
  }
  /**
   * True if `lhs` and `rhs` are structurally equal
   */
  same(lhs: Expression, rhs: Expression): boolean {
    return same(lhs, rhs);
  }
  compare(lhs: Expression, rhs: Expression): -1 | 0 | 1 | undefined {
    return compare(this, lhs, rhs);
  }
  equal(lhs: Expression, rhs: Expression): boolean | undefined {
    const result = compare(this, lhs, rhs);
    return result === undefined ? undefined : result === 0;
  }
  less(lhs: Expression, rhs: Expression): boolean | undefined {
    const result = compare(this, lhs, rhs);
    return result === undefined ? undefined : result < 0;
  }
  lessEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    const result = compare(this, lhs, rhs);
    return result === undefined ? undefined : result <= 0;
  }
  greater(lhs: Expression, rhs: Expression): boolean | undefined {
    const result = compare(this, lhs, rhs);
    return result === undefined ? undefined : result > 0;
  }
  greaterEqual(lhs: Expression, rhs: Expression): boolean | undefined {
    const result = compare(this, lhs, rhs);
    return result === undefined ? undefined : result >= 0;
  }

  is(symbol: Expression, domain: Domain): boolean | undefined;
  is(predicate: Expression): boolean | undefined;
  is(arg1: Expression, arg2?: Domain): boolean | undefined {
    let predicate: Expression = arg1;
    if (arg2) {
      predicate = ['Element', arg1, arg2];
    }
    return isWithEngine(this, predicate);
  }

  matchAssumptions(pattern: Expression): { [symbol: string]: Expression }[] {
    const result: { [symbol: string]: Expression }[] = [];
    this.assumptions.forEach((assumption) => {
      const match = this.match(pattern, assumption);
      if (match !== null) result.push(match);
    });
    return result;
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
    let predicate: Expression = arg1;
    if (arg2) {
      predicate = ['Element', arg1, arg2];
    }
    return assumeWithEngine(this, predicate);
  }
}

// This return all the vars (free or not) in the expression.
// Calculating the free vars is more difficult: to do so you need to know
// which function create a scope, and when a symbol is added to a scope.
// The better way to deal with it is to compile an expression and catch
// the errors when an undefined symbol is encountered.
function varsRecursive(
  expr: Expression,
  vars: Set<string>,
  engine: ComputeEngine
): void {
  const args = getTail(expr);
  if (args.length > 0) {
    args.forEach((x) => varsRecursive(x, vars, engine));
  } else {
    // It has a name, but no arguments. It's a symbol
    const name = getSymbolName(expr);
    if (name && !vars.has(name)) {
      const def = engine.getSymbolDefinition(name);
      if (!def || def.constant === false) {
        // It's not in the dictionary, or it's in the dictionary
        // but not as a constant -> it's a variable
        vars.add(name);
      }
    }
  }
}

export function format(
  expr: Expression,
  forms: Form | Form[],
  options?: {
    dictionaries?: Readonly<Dictionary>[];
  }
): Expression | null {
  return formatWithEngine(
    new ComputeEngine(options),
    expr,
    Array.isArray(forms) ? forms : [forms]
  );
}

export function evaluate(
  expr: Expression,
  options?: {
    dictionaries?: Readonly<Dictionary>[];
  }
): Promise<Expression | null> {
  return evaluateWithEngine(new ComputeEngine(options), expr);
}
