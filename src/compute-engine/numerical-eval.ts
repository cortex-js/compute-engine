import { Expression } from '../public';
import { ComputeEngine } from './public';

export async function numericalEvalWithEngine(
  engine: ComputeEngine,
  _expr: Expression
): Promise<Expression | null> {
  // Check if an error has been signaled, or if
  // the time or memory budget have been exceeded.
  if (!engine.shouldContinueExecution()) return null;

  // 6/ Convert the result to canonical form (or some other form...)?
  return 'Nothing';
}
