import {
  applyRecursively,
  getArg,
  getComplexValue,
  getDecimalValue,
  getDictionary,
  getFunctionHead,
  getFunctionName,
  getNumberValue,
  getSymbolName,
  getTail,
  MISSING,
  NOTHING,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';
import type { Decimal } from 'decimal.js';
import type { Complex } from 'complex.js';

/**
 */
export function internalEvaluateNumerically(
  engine: ComputeEngine,
  expr: Expression
): Complex | Decimal | Expression | null {
  // 1/ Is it a number?
  const val =
    getNumberValue(expr) ?? getComplexValue(expr) ?? getDecimalValue(expr);
  if (val !== null) return val;

  // 3/ Is is a symbol?
  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    const def = engine.getSymbolDefinition(symbol);
    if (def && def.value) {
      return internalEvaluateNumerically(engine, def.value);
    }
    return expr;
  }

  // 4/ Is it a dictionary?
  if (getDictionary(expr) !== null) {
    return applyRecursively(expr, (x) => engine.N(x) ?? x);
  }

  // 5/ Is it a function?

  const head = engine.simplify(getFunctionHead(expr) ?? NOTHING);
  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);
    if (def && def.numeric) {
      // The function is `numeric`: it expects all its arguments to be
      // numbers (or Decimal or Complex) and it should not have Hold arguments.

      if (typeof def.evalNumber === 'function') {
        const args: number[] = [];
        for (const arg of getTail(expr)) {
          const name = getFunctionName(arg);
          if (name === 'Hold') return expr;

          const val = getNumberValue(arg) ?? getNumberValue(engine.N(arg));
          if (typeof val !== 'number') return NaN;
          args.push(val);
        }
        return def.evalNumber(engine, ...args);
      }
    }
    if (def && typeof def.evaluate === 'function') {
      // The function is not numeric.
      // Pass the arguments marked 'Hold' unchanged, evaluate the rest.
      const args: Expression[] = [];
      const tail = getTail(expr);
      for (let i = 0; i < tail.length; i++) {
        const name = getFunctionName(tail[i]);
        if (name === 'Hold') {
          args.push(getArg(tail[i], 1) ?? MISSING);
        } else if (name === 'Evaluate') {
          args.push(engine.N(getArg(tail[i], 1) ?? NaN) ?? tail[i]);
        } else if (
          (i === 0 && def.hold === 'first') ||
          (i > 0 && def.hold === 'rest') ||
          def.hold === 'all'
        ) {
          args.push(tail[i]);
        } else {
          args.push(engine.N(tail[i]) ?? tail[i]);
        }
      }

      return def.evaluate(engine, ...args);
    }

    // @todo: is there a value definition?
  }
  if (head !== null) {
    // If we can't identify the function, we don't know how to process
    // the arguments (they may be Hold...), so don't attempt to process them.
    return [head, ...getTail(expr)];
  }

  // Probably a string...
  return expr;
}
