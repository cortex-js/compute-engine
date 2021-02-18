import { ComputeEngine, Expression } from '../public';
import { order } from './order';

/**
 * Structural comparison between two expressions
 */
export function compare(
  _engine: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): -1 | 0 | 1 | undefined {
  // @todo
  // Special case if both numbers
  // Special case if both domains
  // Special case if both sets
  // What to do with Boolean? Not orderable, but Expressions are...
  // If both Expressions (general case)
  const result = order(lhs, rhs);

  return result < 0 ? -1 : result > 0 ? +1 : 0;
}
