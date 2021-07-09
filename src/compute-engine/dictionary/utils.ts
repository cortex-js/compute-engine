import {
  Definition,
  FunctionDefinition,
  SetDefinition,
  SymbolDefinition,
  CollectionDefinition,
  Numeric,
} from '../../math-json/compute-engine-interface';

export function isSetDefinition(
  def: number | Definition<any> | undefined | null
): def is SetDefinition<Numeric> {
  return def !== null && typeof def === 'object' && 'supersets' in def;
}
export function isSymbolDefinition(
  def: number | Definition<any> | undefined | null
): def is SymbolDefinition<Numeric> {
  return def !== null && typeof def === 'object' && 'constant' in def;
}

export function isFunctionDefinition(
  def: number | Definition<any> | undefined | null
): def is FunctionDefinition<Numeric> {
  if (def === null || typeof def !== 'object') return false;
  if ('numeric' in def || 'evalDomain' in def) return true;
  return [
    'Function',
    'Predicate',
    'LogicalFunction',
    'TrigonometricFunction',
    'HypergeometricFunction',
  ].includes(def.domain);
}

export function isCollectionDefinition(
  def: number | Definition<any> | undefined | null
): def is CollectionDefinition<Numeric> {
  return def !== null && typeof def === 'object' && 'countable' in def;
}
