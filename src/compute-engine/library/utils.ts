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
  if (def === undefined || def === null) return false;
  if (typeof def !== 'object') return false;
  if ('complexity' in def || 'numeric' in def || 'signature' in def)
    return true;
  if (!('domain' in def)) return false;
  if (def.domain === undefined) return false;
  if (typeof def.domain === 'string') return def.domain === 'Function';
  return def.domain.isFunction;
}
