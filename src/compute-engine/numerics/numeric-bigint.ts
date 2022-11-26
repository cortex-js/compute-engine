import Decimal from 'decimal.js';
import { IComputeEngine } from '../public';
import { primeFactors as machinePrimeFactors } from './numeric';

export function bigint(a: Decimal | number | bigint | string): bigint {
  if (typeof a === 'bigint') return a;
  if (a instanceof Decimal) return bigint(a.toString());

  // BigInt constructor does not deal well with e.g. `1e30` or `1.2e5`
  let s = a.toString();
  const m = s.match(/([^\.]+)(?:\.([0-9]+))?e(.+)$/);
  if (m) {
    s =
      m[1] +
      (m[2] ?? '') +
      '0'.repeat(parseInt(m[3]) - (m[2] ? m[2].length : 0));
  }
  return BigInt(s);
}

export function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function lcm(a: bigint, b: bigint): bigint {
  return (a * b) / gcd(a, b);
}

// Difference between primes from 7 to 31
const PRIME_WHEEL_INC = [4n, 2n, 4n, 2n, 4n, 6n, 2n, 6n];

export function primeFactors(
  ce: IComputeEngine,
  d: bigint
): Map<bigint, number> {
  if (d < Number.MAX_SAFE_INTEGER) {
    const factors = machinePrimeFactors(Number(d));
    const result = new Map<bigint, number>();
    for (const f of Object.keys(factors)) result.set(bigint(f), factors[f]);
    return result;
  }

  //https:rosettacode.org/wiki/Prime_decomposition#JavaScript

  let n = d;
  const result = new Map<string, number>();

  // Wheel factorization
  // @todo: see https://github.com/Fairglow/prime-factor/blob/main/src/lib.rs

  let count2 = 0;
  let count3 = 0;
  let count5 = 0;

  let k = 10n;
  while (n % k === 0n) {
    count2 += 1;
    count5 += 1;
    n = n / k;
  }

  k = 5n;
  while (n % k === 0n) {
    count5 += 1;
    n = n / k;
  }

  k = 3n;
  while (n % k === 0n) {
    count3 += 1;
    n = n / k;
  }

  k = 2n;
  while (n % k === 0n) {
    count2 += 1;
    n = n / k;
  }

  if (count2 > 0) result.set('2', count2);
  if (count3 > 0) result.set('3', count3);
  if (count5 > 0) result.set('5', count5);

  k = 7n;
  let kIndex = '';
  let i = 0;
  while (k * k < n) {
    if (n % k === 0n) {
      if (!kIndex) kIndex = k.toString();
      result.set(kIndex, (result.get(kIndex) ?? 0) + 1);
      n = n / k;
    } else {
      k = k + PRIME_WHEEL_INC[i];
      kIndex = '';
      i = i < 7 ? i + 1 : 0;
    }
  }

  if (n !== 1n) result.set(n.toString(), (result.get(n.toString()) ?? 0) + 1);

  const r = new Map<bigint, number>();
  for (const [k, v] of result) r.set(bigint(k), v);
  return r;
}

/** Return `[factor, root]` such that
 * pow(n, 1/exponent) = factor * pow(root, 1/exponent)
 *
 * factorPower(75, 2) -> [5, 3] = 5^2 * 3
 *
 */
export function factorPower(
  ce: IComputeEngine,
  n: bigint,
  exponent: number
): [factor: bigint, root: bigint] {
  // @todo: handle negative n
  const factors = primeFactors(ce, n);
  let f = 1n;
  let r = 1n;
  const exp = bigint(exponent);
  for (const [k, v] of factors) {
    const v2 = bigint(v);
    f = f * k ** (v2 / exp);
    r = r * k ** (v2 % exp);
  }
  return [f, r];
}
