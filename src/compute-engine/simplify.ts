import {
  getFunctionHead,
  getTail,
  isAtomic,
  mapArgs,
  NOTHING,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';

export function simplifyOnce(
  engine: ComputeEngine,
  expr: Expression | null
): Expression | null {
  if (expr === null) return null;

  // If the expression is a predicate which is an assumption, return `True`
  if (engine.is(expr)) return 'True';

  // Dictionary
  // isDictionaryObject(lhs)
  // @todo

  if (isAtomic(expr)) return expr;

  //
  // It's a function (not a dictionary and not atomic)
  //

  const head = simplifyOnce(engine, getFunctionHead(expr));
  if (typeof head === 'string') {
    const def = engine.getFunctionDefinition(head);
    if (def && typeof def.simplify === 'function') {
      // @todo: (respect Hold)
      return def.simplify(engine, ...getTail(expr));
    }
  }
  if (head !== null) {
    return [head, ...mapArgs(expr, (x) => simplifyOnce(engine, x) ?? NOTHING)];
  }
  return expr;
}

/**
 * Simplify until:
 * - the timeLimit is reached
 * - the iterationLimit is reached
 * - the expression stops changing
 */
export function simplifyWithEngine(
  engine: ComputeEngine,
  expr: Expression,
  options?: { timeLimit: number; iterationLimit: number }
): Expression | null {
  const timeLimit = options?.timeLimit ?? engine.timeLimit ?? 2.0;
  if (timeLimit && isFinite(timeLimit)) {
    // engine.deadline = globalThis.performance.now() + timeLimit * 1000;
  }

  const iterationLimit =
    options?.iterationLimit ?? engine.iterationLimit ?? 1024;
  let iterationCount = 0;
  let result: Expression | null = expr;
  let prevResult = JSON.stringify(result);
  while (iterationCount < iterationLimit && engine.shouldContinueExecution()) {
    result = simplifyOnce(engine, result);
    if (result === null) return null;
    const curResult = JSON.stringify(result);
    if (prevResult === curResult) return result;
    prevResult = curResult;
    iterationCount += 1;
  }

  return result;
}
