import type { Expression } from '../global-types';
import { asBigint } from './numerics';
import { isPrimeBigint } from '../numerics/primes';
import { isNumber } from './type-guards';

export function isPrime(expr: Expression): boolean | undefined {
  if (!expr.isInteger) return undefined;
  if (expr.isNegative) return undefined;

  if (!isNumber(expr)) return undefined;

  // Use the exact bigint path: `toInteger` would silently round integers
  // beyond 2^53 (e.g. a large Mersenne prime), yielding a wrong answer.
  // `isPrimeBigint` is already O(1) for small values.
  const b = asBigint(expr);
  if (b !== null) return isPrimeBigint(b);

  return undefined;
}
