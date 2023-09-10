import { MAX_ITERATION, asSmallInteger } from '../numerics/numeric';
import {
  BoxedExpression,
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

export function normalizeLimits(
  range: BoxedExpression
): [index: string, lower: number, upper: number, isFinite: boolean] {
  let lower = 1;
  let upper = lower + MAX_ITERATION;
  let index = 'Nothing';
  let isFinite = true;
  if (
    range.head === 'Tuple' ||
    range.head === 'Triple' ||
    range.head === 'Pair' ||
    range.head === 'Single'
  ) {
    index =
      (range.op1.head === 'Hold' ? range.op1.op1.symbol : range.op1.symbol) ??
      'Nothing';
    lower = asSmallInteger(range.op2) ?? 1;

    if (!Number.isFinite(lower)) isFinite = false;

    if (range.op3.isNothing || range.op3.isInfinity) {
      isFinite = false;
    } else {
      const u = asSmallInteger(range.op3);
      if (u === null) isFinite = false;
      else {
        upper = u;
        if (!Number.isFinite(upper)) isFinite = false;
      }
    }
    if (!isFinite && Number.isFinite(lower)) upper = lower + MAX_ITERATION;
  }
  return [index, lower, upper, isFinite];
}
