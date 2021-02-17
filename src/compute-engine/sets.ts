import { ComputeEngine, Expression } from '../public';

export function union(
  _engine: ComputeEngine,
  ..._args: Expression[]
): Expression {
  return 'EmptySet';
}

export function intersection(
  _engine: ComputeEngine,
  ..._args: Expression[]
): Expression {
  return 'EmptySet';
}

export function setminus(
  _engine: ComputeEngine,
  _lhs: Expression[],
  _rhs: Expression[]
): Expression {
  return 'EmptySet';
}
export function cartesianProduct(
  _engine: ComputeEngine,
  _lhs: Expression[],
  _rhs: Expression[]
): Expression {
  return 'EmptySet';
}
