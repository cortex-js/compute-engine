import {
  DictionaryCategory,
  ErrorSignal,
  Expression,
  WarningSignal,
} from '../public';

import {
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
import { isSetDefinition } from './dictionary/utils';
import { same } from './same';
import { CortexError } from './utils';

export class ComputeEngine {
  static getDictionaries(
    categories: DictionaryCategory[] | 'all' = 'all'
  ): Readonly<Dictionary>[] {
    return getDefaultDictionaries(categories);
  }
  context: RuntimeScope;

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
              console.warn(sig.code, ...(sig.args ? sig.args : []));
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
    if (parentScope && this.context.warnings.length > 0) {
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

  shouldContinueExecution(): boolean {
    if (this.context.timeLimit) {
      if (this.context.deadline < global.performance.now()) {
        throw new CortexError({
          code: 'timeout',
          args: [], // @todo: should capture stack
        });
      }
    }
    return true;
  }

  getVars(expr: Expression): Set<string> {
    const result = new Set<string>();
    varsRecursive(expr, result, this);
    return result;
  }

  getFunctionDefinition(name: string): FunctionDefinition | null {
    let scope = this.context;
    let def = null;
    while (scope && !def) {
      def = scope.dictionary.get(name);
      if (def && !('signatures' in def)) def = null;
      if (!def) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return def;
  }
  getSymbolDefinition(name: string): SymbolDefinition | null {
    let scope = this.context;
    let def = null;
    while (scope && !def) {
      def = scope.dictionary.get(name);
      if (def && !('constant' in def)) def = null;
      if (!def) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return def;
  }
  getSetDefinition(name: string): SetDefinition | null {
    let scope = this.context;
    let def = null;
    while (scope && !def) {
      def = scope.dictionary.get(name);
      if (!isSetDefinition(def)) def = null;
      if (!def) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return def;
  }
  getDefinition(name: string): Definition | null {
    let scope = this.context;
    let def = null;
    while (scope && !def) {
      def = scope.dictionary.get(name);
      if (!def) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return def;
  }

  signal(sig: ErrorSignal | WarningSignal): void {
    // @todo
    return;
  }

  /**
   * Return true if lhs is a subset or equal  rhs
   */
  isSubsetOf(lhs: Expression, rhs: Expression): boolean {
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
      expr,
      Array.isArray(forms) ? forms : [forms ?? 'canonical'],
      this
    );
  }
  canonical(expr: Expression | null): Expression | null {
    return this.format(expr);
  }
  evaluate(exp: Expression): Promise<Expression | null> {
    return evaluateWithEngine(exp, this);
  }

  domain(exp: Expression): Expression | null {
    return domainWithEngine(exp, this);
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
): Expression {
  return formatWithEngine(
    expr,
    Array.isArray(forms) ? forms : [forms],
    new ComputeEngine(options)
  );
}

export function evaluate(
  expr: Expression,
  options?: {
    dictionaries?: Readonly<Dictionary>[];
  }
): Promise<Expression | null> {
  return evaluateWithEngine(expr, new ComputeEngine(options));
}
