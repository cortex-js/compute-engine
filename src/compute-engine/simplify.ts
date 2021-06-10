import { getFunctionHead, getHead } from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine } from './public';

export function simplifyWithEngine(
  engine: ComputeEngine,
  expr: Expression
): Expression | null {
  // Check if an error has been signaled, or if
  // the time or memory budget have been exceeded.
  if (!engine.shouldContinueExecution()) return null;
  const head = getFunctionHead(expr);
  // @todo: evaluate `head`
  const def = engine.getFunctionDefinition(head);
  if (def) {
    if (typeof def.simplify === 'function') {
    }
  }

  return expr;
}
