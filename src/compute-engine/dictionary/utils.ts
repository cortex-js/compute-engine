import { BoxedFunctionDefinition, BoxedSymbolDefinition } from '../public';

export function isSymbolDefinition(
  def: BoxedSymbolDefinition | BoxedFunctionDefinition | undefined | null
): def is BoxedSymbolDefinition {
  return !!def && typeof def === 'object' && 'constant' in def;
}

export function isFunctionDefinition(
  def: BoxedSymbolDefinition | BoxedFunctionDefinition | undefined | null
): def is BoxedFunctionDefinition {
  return !!def && 'numeric' in def;
}
