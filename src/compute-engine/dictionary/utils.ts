import {
  Definition,
  FunctionDefinition,
  SetDefinition,
  SymbolDefinition,
  CollectionDefinition,
  Numeric,
} from '../public';

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
  return def !== null && typeof def === 'object' && 'range' in def;
}

export function isCollectionDefinition(
  def: number | Definition<any> | undefined | null
): def is CollectionDefinition<Numeric> {
  return def !== null && typeof def === 'object' && 'countable' in def;
}
