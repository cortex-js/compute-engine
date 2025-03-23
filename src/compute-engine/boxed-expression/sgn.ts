import type { BoxedExpression, Sign } from '../global-types';

export function sgn(expr: BoxedExpression): Sign | undefined {
  const ce = expr.engine;

  // If we have a hold expression, we don't know the sign
  if (expr.operator === 'Hold') return undefined;

  let s: Sign | undefined = undefined;

  //
  // The expression is a function expression
  //
  if (expr.ops) {
    const def = expr.functionDefinition;
    if (def?.sgn) {
      const context = ce.swapScope(expr.scope);
      s = def.sgn(expr.ops, { engine: ce });
      ce.swapScope(context);
    }
    return s;
  }

  //
  // A symbol
  //
  if (expr.symbol) return expr.symbolDefinition?.sgn;

  //
  // A number
  //
  if (expr.isNumberLiteral) return expr.sgn;

  // A string, or a tensor
  return 'unsigned';
}

export function infinitySgn(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;
  return (
    s === 'positive-infinity' ||
    s === 'negative-infinity' ||
    s === 'complex-infinity'
  );
}

// > 0
export function positiveSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if (s === 'positive') return true;
  if (
    [
      'non-positive',
      'zero',
      'unsigned',
      'negative',
      'negative-infinity',
    ].includes(s)
  )
    return false;

  return undefined;
}

// >= 0
export function nonNegativeSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if (s === 'positive' || s === 'positive-infinity' || s === 'non-negative')
    return true;
  if (['negative', 'negative-infinity', 'zero', 'unsigned'].includes(s))
    return false;

  return undefined;
}

// < 0
export function negativeSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if (s === 'negative' || s === 'negative-infinity') return true;
  if (
    [
      'non-negative',
      'zero',
      'unsigned',
      'positive',
      'positive-infinity',
    ].includes(s)
  )
    return false;

  return undefined;
}

// <= 0
export function nonPositiveSign(s: Sign | undefined): boolean | undefined {
  if (s === undefined) return undefined;

  if (s === 'negative' || s === 'negative-infinity' || s === 'non-positive')
    return true;
  if (['positive', 'zero', 'unsigned'].includes(s)) return false;

  return undefined;
}
