import { getSymbolName, getTail } from '../common/utils';
import { ErrorSignal, Expression, Signal } from '../public';
import { ComputeEngine } from './public';

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
      const def = engine.getSymbolDefinition(name);
      if (!def || def.constant === false) {
        // It's not in the dictionary, or it's in the dictionary
        // but not as a constant -> it's a variable
        vars.add(name);
      }
    }
  }
}

/**
 * Return the set of free variables in an expression.
 */
export function getVars(ce: ComputeEngine, expr: Expression): Set<string> {
  const result = new Set<string>();
  getVarsRecursive(ce, expr, result);
  return result;
}
