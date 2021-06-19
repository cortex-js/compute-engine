import {
  applyRecursively,
  EXPONENTIAL_E,
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
  PI,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine, Numeric } from './public';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { DECIMAL_E, DECIMAL_PI } from './numeric-decimal';
import { substitute } from './patterns';

/**
 */
export function internalEvaluateNumerically(
  engine: ComputeEngine,
  expr: Expression<Numeric>
): Numeric | Expression<Numeric> | null {
  // 1/ Is it a number?
  const val =
    getNumberValue(expr) ?? getComplexValue(expr) ?? getDecimalValue(expr);
  if (val !== null) return val;

  // 3/ Is is a symbol?
  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    if (engine.numericFormat === 'decimal') {
      if (symbol === PI) return DECIMAL_PI;
      if (symbol === EXPONENTIAL_E) return DECIMAL_E;
    }
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
  if (getFunctionHead(expr) !== null) {
    return apply(engine, expr);
  }

  // Probably a string...
  return expr;
}

/**
 * Assuming that expr is a function expression, apply the
 * function to its arguments:
 *
 * - either by using a function definiton
 * - or if the head is an expression, interpreting it as a lambda
 */
function apply(
  engine: ComputeEngine,
  expr: Expression<Numeric>
): Numeric | Expression<Numeric> {
  const head = getFunctionHead(expr)!;
  console.assert(head !== null);

  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);

    //
    // 1/ Numeric function
    //    (takes all numeric arguments, return a numeric)
    //
    if (def && def.numeric) {
      // The function is `numeric`: it expects all its arguments to be
      // numbers (or Decimal or Complex) and it should not have Hold arguments.

      const args: (Numeric | Expression)[] = [];
      let allNumeric = true;
      let format = engine.numericFormat;
      if (
        (format === 'decimal' && typeof def.evalDecimal !== 'function') ||
        (format === 'complex' && typeof def.evalComplex !== 'function')
      ) {
        format = 'machine';
      }
      for (let arg of getTail(expr)) {
        if (getFunctionName(arg) === 'Evaluate') {
          arg = getArg(arg, 1) ?? MISSING;
        }
        if (getFunctionName(arg) === 'Hold') {
          allNumeric = false;
          args.push(arg);
        } else {
          let val: Numeric | Expression | null;
          if (format === 'decimal') {
            val = getDecimalValue(arg) ?? getDecimalValue(engine.N(arg));
          } else if (format === 'complex') {
            val = getComplexValue(arg) ?? getComplexValue(engine.N(arg));
          } else {
            val = getNumberValue(arg) ?? getNumberValue(engine.N(arg));
          }
          if (format === 'decimal' && val instanceof Decimal) {
            args.push(val);
          } else if (format === 'complex' && val instanceof Complex) {
            args.push(val);
          } else if (typeof val === 'number') {
            args.push(val);
          } else {
            allNumeric = false;
            args.push(arg);
          }
        }
      }
      if (allNumeric) {
        if (format == 'decimal') {
          console.assert(typeof def.evalDecimal === 'function');
          return {
            num: def.evalDecimal!(engine, ...(args as (Decimal | number)[])),
          };
        }
        if (format == 'complex') {
          console.assert(typeof def.evalComplex === 'function');
          return {
            num: def.evalComplex!(engine, ...(args as (Complex | number)[])),
          };
        }
        if (typeof def.evalNumber !== 'function') return [head, ...args];
        return def.evalNumber(engine, ...(args as number[]));
      }
      if (typeof def.evaluate === 'function') {
        return def.evaluate(engine, ...args);
      }
      return [head, ...args];
    }

    //
    // 2. Non-numeric function with an `evaluate()`
    //
    if (def && typeof def.evaluate === 'function') {
      // Pass the arguments marked 'Hold' unchanged, evaluate the rest.
      const args: Expression[] = [];
      const tail = getTail(expr);
      for (let i = 0; i < tail.length; i++) {
        const name = getFunctionName(tail[i]);
        if (name === 'Hold') {
          args.push(getArg(tail[i], 1) ?? MISSING);
        } else if (name === 'Evaluate') {
          const arg1 = getArg(tail[i], 1) ?? MISSING;
          args.push(engine.N(arg1) ?? arg1);
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
      // @todo: async evaluate
      return def.evaluate(engine, ...args);
    }
  }

  //
  // 3. The function is a lambda
  //    (the head is an expression)
  //
  const args: { [symbol: string]: Expression } = {
    __: ['Sequence', getTail(expr)],
  };
  let n = 1;
  for (const arg of getTail(expr)) {
    if (n === 1) args['_'] = arg;
    args[`_${n}`] = arg;
    n += 1;
  }
  // @todo: this should probably be a call to evaluate()
  return internalEvaluateNumerically(engine, substitute(head, args));
}
