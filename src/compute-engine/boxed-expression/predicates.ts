import type { BoxedExpression } from '../global-types';
import { asBigint, toInteger } from './numerics';
import { isPrime as isPrimeMachine, isPrimeBigint } from '../numerics/primes';

export function isPrime(expr: BoxedExpression): boolean | undefined {
  if (!expr.isInteger) return undefined;
  if (expr.isNegative) return undefined;

  const value = expr.numericValue;
  if (value === undefined) return undefined;

  const n = toInteger(expr);
  if (n !== null) return isPrimeMachine(n);
  const b = asBigint(expr);
  if (b !== null) return isPrimeBigint(b);

  return undefined;
}
