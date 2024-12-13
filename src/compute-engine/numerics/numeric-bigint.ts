import { bigint } from './bigint';
import { bigPrimeFactors } from './primes';

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
  let counter = 0;

  while (loop > 2) {
    loop -= BigInt(2); // Process even numbers only
    sum += loop; // Accumulate the sum of current and previous values
    val *= sum; // Update the factorial product

    // Yield periodically for interruptibility
    counter += 1;
    if (counter % 50000 === 0 || (counter > 10000 && counter % 500 === 0))
      yield val;
  }

  return val; // Final factorial result
}
