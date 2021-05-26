import {
  Definition,
  FunctionDefinition,
  SetDefinition,
  SymbolDefinition,
  CollectionDefinition,
} from '../public';

export function isSetDefinition(
  def: number | Definition | undefined | null
): def is SetDefinition {
  return def !== null && typeof def === 'object' && 'supersets' in def;
}
export function isSymbolDefinition(
  def: number | Definition | undefined | null
): def is SymbolDefinition {
  return def !== null && typeof def === 'object' && 'constant' in def;
}

export function isFunctionDefinition(
  def: number | Definition | undefined | null
): def is FunctionDefinition {
  return def !== null && typeof def === 'object' && 'signatures' in def;
}

export function isCollectionDefinition(
  def: number | Definition | undefined | null
): def is CollectionDefinition {
  return def !== null && typeof def === 'object' && 'countable' in def;
}
