import {
  DictionaryCategory,
  Dictionary,
  ErrorListener,
  ErrorCode,
  Expression,
  Form,
  Domain,
  FunctionDefinition,
  SymbolDefinition,
  SetDefinition,
  Scope,
} from '../public';
import {
  compileDictionary,
  getDefaultDictionaries,
} from '../dictionary/dictionary';
import { format as formatWithEngine } from './forms';
import { compare } from './compare';
import { evaluate as evaluateWithEngine } from './evaluate';
import { domain as domainWithEngine } from './domains';
import {
  getArg,
  getArgs,
  getFunctionName,
  getNumberValue,
  getSymbolName,
} from '../utils';
import { isSetDefinition } from '../dictionary/utils';

export class ComputeEngine {
  static getDictionaries(
    categories: DictionaryCategory[] | 'all' = 'all'
  ): Readonly<Dictionary>[] {
    return getDefaultDictionaries(categories);
  }
  scope: Scope;
  onError: ErrorListener<ErrorCode>;

  constructor(options?: {
    dictionaries?: Readonly<Dictionary>[];
    onError?: ErrorListener<ErrorCode>;
  }) {
    const onError =
      typeof window === 'undefined'
        ? () => {
            return;
          }
        : (err) => {
            if (!err.before || !err.after) {
              console.warn(err.code + (err.arg ? ': ' + err.arg : ''));
            } else {
              console.warn(
                err.code +
                  (err.arg ? ': ' + err.arg : '') +
                  '\n' +
                  '%c' +
                  '|  ' +
                  err.before +
                  '%c' +
                  err.after +
                  '\n' +
                  '%c' +
                  '|  ' +
                  String(' ').repeat(err.before.length) +
                  '▲',
                'font-weight: bold',
                'font-weight: normal; color: rgba(160, 160, 160)',
                'font-weight: bold; color: hsl(4deg, 90%, 50%)'
              );
            }
          };
    this.onError = options?.onError ?? onError;

    const scopes = options?.dictionaries ?? ComputeEngine.getDictionaries();
    for (const scope of scopes) this.pushScope(scope);

    // Push a fresh scope to protect global definitions.
    this.pushScope({});
  }

  popScope(): void {
    this.scope = this.scope?.parentScope;
  }

  pushScope(dictionary: Readonly<Dictionary> = {}): void {
    this.scope = {
      parentScope: this.scope,
      dictionary: compileDictionary(dictionary, this),
    };
  }

  getVars(expr: Expression): Set<string> {
    const result = new Set<string>();
    varsRecursive(expr, result, this);
    return result;
  }

  getFunctionDefinition(name: string): FunctionDefinition | null {
    let scope = this.scope;
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
    let scope = this.scope;
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
    let scope = this.scope;
    let def = null;
    while (scope && !def) {
      def = scope.dictionary.get(name);
      if (!isSetDefinition(def)) def = null;
      if (!def) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return def;
  }
  getDefinition(
    name: string
  ): SymbolDefinition | FunctionDefinition | SetDefinition | null {
    let scope = this.scope;
    let def = null;
    while (scope && !def) {
      def = scope.dictionary.get(name);
      if (!def) scope = scope.parentScope;
    }
    if (def) def.scope = scope;
    return def;
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
      return getArgs(lhs).some((x) => this.isSubsetOf(x, rhs));
    } else if (lhsFnName === 'Intersection') {
      return getArgs(lhs).every((x) => this.isSubsetOf(x, rhs));
    } else if (lhsFnName === 'SetMinus') {
      return (
        this.isSubsetOf(getArg(lhs, 1), rhs) &&
        !this.isSubsetOf(getArg(lhs, 2), rhs)
      );
    } else if (lhsFnName === 'Complement') {
      return !this.isSubsetOf(getArg(lhs, 1), rhs);
    }

    //
    // 2. Set operations on rhs
    //
    const rhsFnName = getFunctionName(rhs);
    if (rhsFnName === 'Union') {
      return getArgs(rhs).some((x) => this.isSubsetOf(lhs, x));
    } else if (rhsFnName === 'Intersection') {
      return getArgs(rhs).every((x) => this.isSubsetOf(lhs, x));
    } else if (rhsFnName === 'SetMinus') {
      return (
        this.isSubsetOf(lhs, getArg(rhs, 1)) &&
        !this.isSubsetOf(lhs, getArg(rhs, 2))
      );
    } else if (rhsFnName === 'Complement') {
      return !this.isSubsetOf(lhs, getArg(rhs, 1));
    }

    //
    // 3. Not a set operation: a domain or a parametric domain
    //
    const rhsDomainName = getSymbolName(rhs) ?? rhsFnName;
    if (!rhsDomainName) {
      const rhsVal = getNumberValue(rhs);
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
  evaluate(exp: Expression): Expression | null {
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
  const args = getArgs(expr);
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
    dictionary?: Dictionary;
    onError?: ErrorListener<ErrorCode>;
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
    scope?: Dictionary;
    dictionary?: Dictionary;
    onError?: ErrorListener<ErrorCode>;
  }
): Expression {
  return evaluateWithEngine(expr, new ComputeEngine(options));
}
