import {
  equalExpr,
  getDictionary,
  getFunctionHead,
  getSymbolName,
  getTail,
} from '../common/utils';
import { Expression } from '../math-json/math-json-format';
import { ComputeEngine, Domain } from '../math-json/compute-engine-interface';
import { Signal } from '../math-json';
import { ErrorSignal } from '../math-json/public';
import { isSymbolDefinition } from './dictionary/utils';

export class CortexError {
  signal: ErrorSignal;
  constructor(errorSignal: Signal) {
    this.signal = { severity: 'error', ...errorSignal } as ErrorSignal;
  }
  toString(): string {
    let result = '';
    if (this.signal.head) {
      result += this.signal.head + ': ';
    }

    if (typeof this.signal.message === 'string') {
      result += this.signal.message;
    } else {
      result += ' ';
      for (const arg of this.signal.message) {
        result += arg.toString() + ' ';
      }
    }

    return result;
  }
}

// This return all the vars (free or not) in the expression.
// Calculating the free vars is more difficult: to do so you need to know
// which function create a scope, and when a symbol is added to a scope.
// The better way to deal with it is to compile an expression and catch
// the errors when an undefined symbol is encountered.
function getVarsRecursive(
  engine: ComputeEngine,
  expr: Expression,
  vars: Set<string>
): void {
  const args = getTail(expr);
  if (args.length > 0) {
    args.forEach((x) => getVarsRecursive(engine, x, vars));
  } else {
    // It has a name, but no arguments. It's a symbol
    const name = getSymbolName(expr);
    if (name && !vars.has(name)) {
      const def = engine.getDefinition(name);
      if (!def || !isSymbolDefinition(def) || def.constant === false) {
        // It's not in the dictionary, or it's in the dictionary
        // but not as a constant -> it's a variable
        vars.add(name);
      }
    }
  }
}

/**
 * Return the set of variables (free or not) in an expression.
 * Doesn't return free vars because doesn't account for variable declaration
 * and scopes.
 */
export function getVariables(ce: ComputeEngine, expr: Expression): Set<string> {
  const result = new Set<string>();
  getVarsRecursive(ce, expr, result);
  return result;
}

export function isCanonical(ce: ComputeEngine, expr: Expression): boolean {
  const canon = ce.canonical(expr);
  return equalExpr(canon, expr);
}

export function hasWildcards(expr: Expression): boolean {
  const symbol = getSymbolName(expr);
  if (symbol?.startsWith('_')) return true;

  const head = getFunctionHead(expr);
  if (head !== null) {
    return hasWildcards(head) || getTail(expr).some(hasWildcards);
  }
  const dict = getDictionary(expr);
  if (dict !== null) {
    return Object.keys(dict).some((key) => hasWildcards(dict[key]));
  }
  return false;
}

/** If the expression is a function, return the domains of its arguments. */
export function getDomains(
  ce: ComputeEngine,
  expr: Expression
): null | Domain[] {
  return getTail(expr)?.map((x) => ce.domain(x)) ?? null;
}
