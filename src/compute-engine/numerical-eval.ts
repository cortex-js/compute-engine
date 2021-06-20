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
export function internalN(
  engine: ComputeEngine,
  expr: Expression<Numeric>
): Numeric | Expression<Numeric> | null {
  //
  // 2/ Is it a number?
  //
  const val =
    getNumberValue(expr) ?? getComplexValue(expr) ?? getDecimalValue(expr);
  if (val !== null) return val;

  //
  // 3/ Is is a symbol?
  //
  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    if (engine.numericFormat === 'decimal') {
      if (symbol === PI) return DECIMAL_PI;
      if (symbol === EXPONENTIAL_E) return DECIMAL_E;
    }
    const def = engine.getSymbolDefinition(symbol);
    if (def && def.value) {
      return internalN(engine, def.value);
    }
    return expr;
  }

  //
  // 4/ Is it a dictionary?
  //
  if (getDictionary(expr) !== null) {
    return applyRecursively(expr, (x) => internalN(engine, x) ?? x);
  }

  //
  // 5/ Is it a function?
  //
  if (getFunctionHead(expr) !== null) return applyN(engine, expr);

  // Probably a string...
  return expr;
}

/**
 * Assuming that expr is a function expression, apply the
 * function to its arguments:
 *
 * - either by using a function definition
 * - or if the head is an expression, interpreting it as a lambda
 */
function applyN(
  engine: ComputeEngine,
  expr: Expression<Numeric>
): Numeric | Expression<Numeric> {
  const head = getFunctionHead(expr)!;
  console.assert(head !== null);

  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);

    // @todo:handle idempotent, threadable functions

    //
    // 1/ Numeric function
    //    (takes all numeric arguments, return a numeric)
    //
    if (def && def.numeric) {
      // The function is `numeric`: it expects all its arguments to be
      // `numbers` or `Decimal` or `Complex` and it should not have Hold arguments.

      const args: (Numeric | Expression)[] = [];
      let numberCount = 0;
      let decimalCount = 0;
      let complexCount = 0;
      for (let arg of getTail(expr)) {
        if (getFunctionName(arg) === 'Evaluate') {
          // This is a forced evaluation (that's a no-op)
          arg = getArg(arg, 1) ?? MISSING;
        }
        if (getFunctionName(arg) === 'Hold') {
          // This is a forced Hold. We'll keep the arg, but won't be able to
          // call the evalNumber, evalDecimal or evalComplex functions.
          args.push(arg);
        } else {
          let val = internalN(engine, arg);
          val =
            getDecimalValue(val) ?? getComplexValue(val) ?? getNumberValue(val);
          if (val instanceof Decimal) {
            decimalCount += 1;
            args.push(val);
          } else if (val instanceof Complex) {
            complexCount += 1;
            args.push(val);
          } else if (typeof val === 'number') {
            numberCount += 1;
            args.push(val);
          } else {
            args.push(arg);
          }
        }
      }
      // Try to use the preferred format, but if we don't have a `evalDecimal`
      // or `evalComplex` function, we'll fallback to getting machine numbers.
      let format = engine.numericFormat;
      if (format === 'auto') {
        if (complexCount > 0) {
          format = 'complex';
        } else if (decimalCount > 0) {
          format = 'decimal';
        } else {
          format = 'machine';
        }
      }
      if (
        (format === 'decimal' && typeof def.evalDecimal !== 'function') ||
        (format === 'complex' && typeof def.evalComplex !== 'function')
      ) {
        format = 'machine';
      }
      const numericCount = numberCount + decimalCount + complexCount;
      if (numericCount === args.length) {
        // All the arguments were numeric...
        if (format == 'decimal' && complexCount === 0) {
          // All the arguments were `number` or `Decimal`
          console.assert(typeof def.evalDecimal === 'function');
          return def.evalDecimal!(engine, ...(args as (Decimal | number)[]));
        }
        if (format == 'complex' && decimalCount === 0) {
          // All the arguments were `number` or `Complex`
          console.assert(typeof def.evalComplex === 'function');
          return def.evalComplex!(engine, ...(args as (Complex | number)[]));
        }
        if (
          typeof def.evalNumber === 'function' &&
          numberCount === numericCount
        ) {
          // All the arguments were number
          return def.evalNumber(engine, ...(args as number[]));
        }
      }
      // The arguments were not all numeric. Call `evaluate` on the
      // function if there is one
      return typeof def.evaluate === 'function'
        ? def.evaluate(engine, ...args)
        : [head, ...args];
    }

    //
    // 2. Non-numeric function with an `evaluate()`
    //
    if (def) {
      // Pass the arguments marked 'Hold' unchanged, evaluate the rest.
      const args: Expression[] = [];
      const tail = getTail(expr);
      for (let i = 0; i < tail.length; i++) {
        const name = getFunctionName(tail[i]);
        if (name === 'Hold') {
          args.push(getArg(tail[i], 1) ?? MISSING);
        } else if (name === 'Evaluate') {
          const arg1 = getArg(tail[i], 1) ?? MISSING;
          args.push(internalN(engine, arg1) ?? arg1);
        } else if (
          (i === 0 && def.hold === 'first') ||
          (i > 0 && def.hold === 'rest') ||
          def.hold === 'all'
        ) {
          args.push(tail[i]);
        } else {
          args.push(internalN(engine, tail[i]) ?? tail[i]);
        }
      }
      // @todo: async evaluate
      if (typeof def.evaluate === 'function') {
        return def.evaluate(engine, ...args);
      }
      return [head, ...args];
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

  return internalN(engine, substitute(head, args));
}
