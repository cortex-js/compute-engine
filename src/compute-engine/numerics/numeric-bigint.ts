import { bigint } from './bigint.js';
import { bigPrimeFactors } from './primes.js';

export function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a < 0 ? -a : a;
}

export function lcm(a: bigint, b: bigint): bigint {
  return (a * b) / gcd(a, b);
}

/**
 * Extended Euclidean algorithm: returns `[g, x, y]` with `a·x + b·y = g`,
 * where `g = gcd(a, b)` (its sign follows `a`/`b`; callers that need a
 * non-negative `g` normalize the triple).
 */
export function extGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let [oldR, r] = [a, b];
  let [oldS, s] = [1n, 0n];
  let [oldT, t] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}

/**
 * The modular multiplicative inverse of `a` modulo `m` (`m > 0`): the integer
 * `x` in `[0, m)` with `a·x ≡ 1 (mod m)`, or `null` when `a` and `m` are not
 * coprime (i.e. `gcd(a mod m, m) ≠ 1`).
 */
export function modularInverse(a: bigint, m: bigint): bigint | null {
  if (m <= 0n) return null;
  if (m === 1n) return 0n;
  const base = ((a % m) + m) % m;
  const [g, s] = extGcd(base, m);
  if (g !== 1n && g !== -1n) return null;
  return ((s % m) + m) % m;
}

/**
 * General Chinese Remainder: merge the congruences `x ≡ residues[i]
 * (mod moduli[i])` pairwise. Moduli need not be coprime. Returns the least
 * non-negative solution modulo lcm(moduli), or `null` if inconsistent or a
 * modulus is not positive.
 */
export function chineseRemainder(
  residues: bigint[],
  moduli: bigint[]
): bigint | null {
  let x = 0n;
  let m = 1n; // current solution: x (mod m)
  for (let i = 0; i < residues.length; i++) {
    const ni = moduli[i];
    if (ni <= 0n) return null;
    const ri = ((residues[i] % ni) + ni) % ni;
    const [g, p] = extGcd(m, ni);
    if ((ri - x) % g !== 0n) return null; // inconsistent
    const lcmMN = (m / g) * ni;
    const mod2 = ni / g;
    const lambda = (((((ri - x) / g) * p) % mod2) + mod2) % mod2;
    x = (((x + m * lambda) % lcmMN) + lcmMN) % lcmMN;
    m = lcmMN;
  }
  return x;
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

/**
 * Computes the factorial of a number as a generator to allow interruptibility.
 * Yields intermediate values periodically, but these are not intended to be the primary result.
 *
 * @param n - The number to compute the factorial of (as a BigInt).
 * @returns A generator that can be iterated for intermediate values, with the final value returned when the computation completes.
 */
export function* factorial(n: bigint): Generator<bigint, bigint> {
  // No NaN for BigInt, so we return 0 for invalid inputs.
  if (n < 0) return BigInt(0);

  // Directly return precomputed values for small n
  if (n < 10)
    return BigInt([1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880][Number(n)]);

  // Handle odd numbers by multiplying with the factorial of n-1
  if (n % BigInt(2) === BigInt(1)) return n * (yield* factorial(n - BigInt(1)));

  let loop = n;
  let sum = n;
  let val = n;

  while (loop > 2) {
    loop -= BigInt(2); // Process even numbers only
    sum += loop; // Accumulate the sum of current and previous values
    val *= sum; // Update the factorial product

    yield val;
  }

  return val; // Final factorial result
}
