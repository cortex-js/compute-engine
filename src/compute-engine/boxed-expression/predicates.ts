import type { Expression } from '../global-types';
import { asBigint, toInteger } from './numerics';
import { isPrime as isPrimeMachine, isPrimeBigint } from '../numerics/primes';
import { isNumber } from './type-guards';

export function isPrime(expr: Expression): boolean | undefined {
  if (!expr.isInteger) return undefined;
  if (expr.isNegative) return undefined;

  if (!isNumber(expr)) return undefined;

  const n = toInteger(expr);
  if (n !== null) return isPrimeMachine(n);
  const b = asBigint(expr);
  if (b !== null) return isPrimeBigint(b);

  return undefined;
}
