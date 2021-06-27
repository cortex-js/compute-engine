import {
  getNumberValue,
  getComplexValue,
  getDecimalValue,
  getSymbolName,
  applyRecursively,
  getDictionary,
  getFunctionHead,
  getTail,
  getFunctionName,
  getArg,
  MISSING,
} from '../common/utils';
import { Expression } from '../public';
import { internalN } from './numerical-eval';
import { substitute, Substitution } from './patterns';
import { ComputeEngine } from './public';

export function evaluateOnce(
  engine: ComputeEngine,
  expr: Expression | null
): Expression | null {
  if (expr === null) return null;

  //
  // 1/ Is it a number?
  //
  const val =
    getDecimalValue(expr) ?? getNumberValue(expr) ?? getComplexValue(expr);
  if (val !== null) return val;

  //
  // 2/ Is is a symbol?
  //
  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    const def = engine.getSymbolDefinition(symbol);
    if (def && def.value) {
      if (typeof def.value === 'function') return def.value(engine);
      return def.value;
    }
    return expr;
  }

  //
  // 3/ Is it a dictionary?
  //
  if (getDictionary(expr) !== null) {
    return applyRecursively(expr, (x) => evaluateOnce(engine, x) ?? x);
  }
  //
  // 4/ Is it a function?
  //
  const head = getFunctionHead(expr);
  if (head !== null) {
    if (typeof head === 'string') {
      const def = engine.getFunctionDefinition(head);
      // If it's an unknown function, we don't know how to handle the arguments
      if (def === null) return expr;

      //
      // 4.1/ It's a function with a definition:
      //      process the arguments
      //
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
          args.push(evaluateOnce(engine, tail[i]) ?? tail[i]);
        }
      }
      // @todo: async evaluate
      if (typeof def.evaluate === 'function') {
        return def.evaluate(engine, ...args);
      }
      return [head, ...args];
    }

    //
    // 4.2/ It's a lambda function
    //

    const args: Substitution = { __: ['Sequence', getTail(expr)] };
    let n = 1;
    for (const arg of getTail(expr)) args[`_${n++}`] = arg;
    args['_'] = args['_1'];

    return evaluateOnce(engine, substitute(head, args));
  }

  return expr;
}

/**
 * Evaluate until:
 * - the timeLimit is reached
 * - the iterationLimit is reached
 * - the expression stops changing
 */
export async function internalEvaluate(
  engine: ComputeEngine,
  expr: Expression,
  options?: { timeLimit?: number; iterationLimit?: number }
): Promise<Expression | null> {
  const timeLimit = options?.timeLimit ?? engine.timeLimit ?? 2.0;
  if (timeLimit && isFinite(timeLimit)) {
    engine.deadline = Date.now() + timeLimit * 1000;
  }
  const iterationLimit =
    options?.iterationLimit ?? engine.iterationLimit ?? 1024;
  let iterationCount = 0;
  let result: Expression | null = expr;
  let prevResult = JSON.stringify(result);
  while (iterationCount < iterationLimit && engine.shouldContinueExecution()) {
    result = evaluateOnce(engine, result);
    if (result === null) return null;
    const curResult = JSON.stringify(result);
    if (prevResult === curResult) return result;
    prevResult = curResult;
    iterationCount += 1;
  }

  // Convert the result to canonical form
  return engine.canonical(result);
}
