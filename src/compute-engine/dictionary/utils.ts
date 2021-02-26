import {
  Definition,
  FunctionDefinition,
  SetDefinition,
  SymbolDefinition,
  CollectionDefinition,
} from '../public';

export function isSetDefinition(
  def: number | Definition
): def is SetDefinition {
  return typeof def === 'object' && 'supersets' in def;
}
export function isSymbolDefinition(
  def: number | Definition
): def is SymbolDefinition {
  return typeof def === 'object' && 'constant' in def;
}

export function isFunctionDefinition(
  def: number | Definition
): def is FunctionDefinition {
  return typeof def === 'object' && 'signatures' in def;
}

export function isCollectionDefinition(
  def: number | Definition
): def is CollectionDefinition {
  return typeof def === 'object' && 'countable' in def;
}
