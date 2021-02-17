import { FunctionDefinition, SetDefinition, SymbolDefinition } from '../public';

export function isSetDefinition(
  entry: number | SymbolDefinition | FunctionDefinition | SetDefinition
): entry is SetDefinition {
  return typeof entry === 'object' && 'supersets' in entry;
}
export function isSymbolDefinition(
  entry: number | SymbolDefinition | FunctionDefinition | SetDefinition
): entry is SymbolDefinition {
  return typeof entry === 'object' && 'constant' in entry;
}

export function isFunctionDefinition(
  entry: number | SymbolDefinition | FunctionDefinition | SetDefinition
): entry is FunctionDefinition {
  return typeof entry === 'object' && 'signatures' in entry;
}
