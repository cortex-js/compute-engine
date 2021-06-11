import { getFunctionName } from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';

export function simplifyOnce(
  engine: ComputeEngine,
  expr: Expression
): Expression {
  const head = getFunctionName(expr);
  // @todo: evaluate `head`
  const def = engine.getFunctionDefinition(head);
  if (def) {
    if (typeof def.simplify === 'function') {
    }
  }
  return expr;
}

export function simplifyWithEngine(
  engine: ComputeEngine,
  expr: Expression,
  options?: { timeLimit: number; iterationLimit: number }
): Expression | null {
  const timeLimit = options?.timeLimit ?? engine.timeLimit ?? 2.0;
  if (timeLimit && isFinite(timeLimit)) {
    engine.deadline = globalThis.performance.now() + timeLimit * 1000;
  }

  const iterationLimit =
    options?.iterationLimit ?? engine.iterationLimit ?? 1024;
  let iterationCount = 0;
  let result = expr;
  while (iterationCount < iterationLimit && engine.shouldContinueExecution()) {
    result = simplifyOnce(engine, result);
    iterationCount += 1;
  }

  return result;
}
