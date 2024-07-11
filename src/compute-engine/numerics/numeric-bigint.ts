import Decimal from 'decimal.js';
import { primeFactors as machinePrimeFactors } from './primes';
import { Expression } from '../../math-json';
import { isNumberExpression, isNumberObject } from '../../math-json/utils';

export function bigintValue(
  expr: Expression | null | undefined
): bigint | null {
  if (typeof expr === 'number')
    return Number.isInteger(expr) ? BigInt(expr) : null;

  if (expr === null || expr === undefined) return null;

  if (!isNumberExpression(expr)) return null;

  const num = isNumberObject(expr) ? expr.num : expr;

  if (typeof num === 'number')
    return Number.isInteger(num) ? BigInt(num) : null;
  if (typeof num !== 'string') return null;

  const s = num
    .toLowerCase()
    .replace(/[nd]$/, '')
    .replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  if (s === 'nan') return null;
  if (s === 'infinity' || s === '+infinity') return null;
  if (s === '-infinity') return null;
  if (s.includes('.')) return null;

  return bigint(s);
}
export function bigint(a: Decimal | number | bigint | string): bigint {
  if (typeof a === 'bigint') return a;
  if (a instanceof Decimal) return bigint(a.toString());

  // BigInt constructor does not deal well with e.g. `1e30` or `1.2e5`
  let s = a.toString().toLowerCase();

  if (s === 'nan') return NaN as unknown as bigint;
  if (s === 'infinity' || s === '+infinity')
    return Infinity as unknown as bigint;
  if (s === '-infinity') return -Infinity as unknown as bigint;

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
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a < 0 ? -a : a;
}

export function lcm(a: bigint, b: bigint): bigint {
  return (a * b) / gcd(a, b);
}

// Difference between primes from 7 to 31
const PRIME_WHEEL_INC = [
  BigInt(4),
  BigInt(2),
  BigInt(4),
  BigInt(2),
  BigInt(4),
  BigInt(6),
  BigInt(2),
  BigInt(6),
];

export function primeFactors(d: bigint): Map<bigint, number> {
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

  let k = BigInt(10);
  while (n % k === BigInt(0)) {
    count2 += 1;
    count5 += 1;
    n = n / k;
  }

  k = BigInt(5);
  while (n % k === BigInt(0)) {
    count5 += 1;
    n = n / k;
  }

  k = BigInt(3);
  while (n % k === BigInt(0)) {
    count3 += 1;
    n = n / k;
  }

  k = BigInt(2);
  while (n % k === BigInt(0)) {
    count2 += 1;
    n = n / k;
  }

  if (count2 > 0) result.set('2', count2);
  if (count3 > 0) result.set('3', count3);
  if (count5 > 0) result.set('5', count5);

  k = BigInt(7);
  let kIndex = '';
  let i = 0;
  while (k * k < n) {
    if (n % k === BigInt(0)) {
      if (!kIndex) kIndex = k.toString();
      result.set(kIndex, (result.get(kIndex) ?? 0) + 1);
      n = n / k;
    } else {
      k = k + PRIME_WHEEL_INC[i];
      kIndex = '';
      i = i < 7 ? i + 1 : 0;
    }
  }

  if (n !== BigInt(1))
    result.set(n.toString(), (result.get(n.toString()) ?? 0) + 1);

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
  n: bigint,
  exponent: number
): [factor: bigint, root: bigint] {
  // @todo: handle negative n
  const factors = primeFactors(n);
  let f = BigInt(1);
  let r = BigInt(1);
  const exp = BigInt(exponent);
  for (const [k, v] of factors) {
    const v2 = bigint(v);
    f = f * k ** (v2 / exp);
    r = r * k ** (v2 % exp);
  }
  return [f, r];
}

/**
 * Return a, b, c such that n = a * b^c
 * @param n
 *
 */
export function canonicalInteger(n: bigint): [a: bigint, b: bigint, c: bigint] {
  if (n === BigInt(0)) return [BigInt(0), BigInt(0), BigInt(1)];
  let sign = BigInt(1);
  if (n < 0) {
    sign = BigInt(-1);
    n = -n;
  }

  if (n === BigInt(1)) return [sign, BigInt(1), BigInt(1)];

  const factors = primeFactors(n);
  let a = BigInt(1);
  let b = BigInt(1);
  let c = BigInt(0);
  for (const [k, v] of factors) {
    if (v === 1) {
      a = a * k;
    } else {
      b = k;
      c = BigInt(v);
    }
  }
  return [sign * a, b, c];
}
