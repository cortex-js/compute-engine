import { bigint } from './bigint.ts';
import { bigPrimeFactors } from './primes.ts';

export function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a < 0 ? -a : a;
}

export function lcm(a: bigint, b: bigint): bigint {
  return (a * b) / gcd(a, b);
}

/** Return `[factor, root]` such that
 * pow(n, 1/exponent) = factor * pow(root, 1/exponent)
 *
 * canonicalInteger(75, 2) -> [5, 3] = 5^2 * 3
 *
 */
export function canonicalInteger(
  n: bigint,
  exponent: number
): [factor: bigint, root: bigint] {
  // @todo: handle negative n
  const factors = bigPrimeFactors(n);
  let f = BigInt(1);
  let r = BigInt(1);
  const exp = BigInt(exponent);
  for (const [k, v] of factors) {
    const v2 = bigint(v);
    f = f * k ** (v2! / exp);
    r = r * k ** (v2! % exp);
  }
  return [f, r];
}

export function reducedInteger(n: bigint): bigint | number {
  if (n >= Number.MIN_SAFE_INTEGER && n <= Number.MAX_SAFE_INTEGER)
    return Number(n);
  return n;
}
