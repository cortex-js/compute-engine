import { FunctionDefinition, SetDefinition, SymbolDefinition } from '../public';

export function isSetDefinition(
  def: number | SymbolDefinition | FunctionDefinition | SetDefinition
): def is SetDefinition {
  return typeof def === 'object' && 'supersets' in def;
}
export function isSymbolDefinition(
  def: number | SymbolDefinition | FunctionDefinition | SetDefinition
): def is SymbolDefinition {
  return typeof def === 'object' && 'constant' in def;
}

export function isFunctionDefinition(
  def: number | SymbolDefinition | FunctionDefinition | SetDefinition
): def is FunctionDefinition {
  return typeof def === 'object' && 'signatures' in def;
}
