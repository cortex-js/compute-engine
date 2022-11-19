import {
  BoxedFunctionDefinition,
  BoxedSymbolDefinition,
  FunctionDefinition,
  SymbolDefinition,
} from '../public';

export function isSymbolDefinition(
  def:
    | BoxedSymbolDefinition
    | BoxedFunctionDefinition
    | SymbolDefinition
    | FunctionDefinition
    | undefined
    | null
): def is BoxedSymbolDefinition {
  return (
    !!def &&
    typeof def === 'object' &&
    ('domain' in def || 'value' in def || 'constant' in def)
  );
}

export function isFunctionDefinition(
  def:
    | BoxedSymbolDefinition
    | BoxedFunctionDefinition
    | SymbolDefinition
    | FunctionDefinition
    | undefined
    | null
): def is BoxedFunctionDefinition {
  return (
    !!def &&
    typeof def === 'object' &&
    ('complexity' in def || 'numeric' in def || 'signature' in def)
  );
}
