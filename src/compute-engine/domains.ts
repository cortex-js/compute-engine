import { Domain, ComputeEngine, Expression, Dictionary } from '../public';
import { isSetDefinition } from '../dictionary/utils';

export function domain(
  _expr: Expression,
  _engine: ComputeEngine
): Expression | null {
  // @todo
  return null;
}

export function isSubdomainOf(
  dict: Dictionary,
  lhs: Domain,
  rhs: Domain
): boolean {
  if (lhs === rhs) return true;
  if (typeof lhs !== 'string') return false;
  const def = dict[lhs];
  if (!isSetDefinition(def)) return false;

  for (const parent of def.supersets) {
    if (isSubdomainOf(dict, parent, rhs)) return true;
  }

  return false;
}
