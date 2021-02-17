import { ComputeEngine, Expression } from '../public';

/**
 * Structural comparison between two expressions
 */
export function compare(
  _engine: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): -1 | 0 | 1 | undefined {
  // @todo
  // Special case if both numbers
  // Special case if both domains
  // Special case if both sets
  // What to do with Boolean? Not orderable, but Expressions are...
  // If both Expressions (general case)
  return 0;
}
