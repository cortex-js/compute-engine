import { Expression } from '../public';
import { ComputeEngine } from './public';

export function evaluateOnce(
  engine: ComputeEngine,
  expr: Expression | null
): Expression | null {
  if (expr === null) return null;

  // @todo: implement evaluation algorithm:
  // 1/ Convert to Canonical Form.
  // 2/ Is it a number?
  // 3/ Is is a symbol?
  // 4/ Is it a dictionary?
  // 5/ Is it a function?
  // 5.1/ Does it have a definition?
  // 5.2/ Is it idempotent?
  // 5.3/ Is it threadable?
  // 5.4/ Evaluate each argument
  // (respecting Hold)

  return expr;
}
/**
 * Evaluate until:
 * - the timeLimit is reached
 * - the iterationLimit is reached
 * - the expression stops changing
 */
export async function evaluateWithEngine(
  engine: ComputeEngine,
  expr: Expression,
  options?: { timeLimit?: number; iterationLimit?: number }
): Promise<Expression | null> {
  const timeLimit = options?.timeLimit ?? engine.timeLimit ?? 2.0;
  if (timeLimit && isFinite(timeLimit)) {
    engine.deadline = globalThis.performance.now() + timeLimit * 1000;
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

  // 6/ Convert the result to canonical form (or some other form...)?
  return result;
}
