export const LARGE_PRIME = 1125899906842597; // Largest prime < 2^50

export function isPrime(n: number): 'True' | 'False' | 'Maybe' {
  if (!Number.isInteger(n) || !isFinite(n) || isNaN(n) || n <= 1) {
    return 'False';
  }

  // Is it a known small prime?
  if (n <= LARGEST_SMALL_PRIME) return SMALL_PRIMES.has(n) ? 'True' : 'False';

  // Is it a factor of a small known prime?
  for (const smallPrime of SMALL_PRIMES) {
    if (n % smallPrime === 0) return 'False';
  }

  if (n >= LARGE_PRIME) {
    return probablyPrime(n, 30) ? 'Maybe' : 'False';
  }
  return n === leastFactor(n) ? 'True' : 'False';
}

function leastFactor(n: number): number {
  if (n === 1) return 1;
  if (n % 2 === 0) return 2;
  if (n % 3 === 0) return 3;
  if (n % 5 === 0) return 5;
  const m = Math.floor(Math.sqrt(n));
  let i = 7;
  while (i <= m) {
    if (n % i === 0) return i;
    if (n % (i + 4) === 0) return i + 4;
    if (n % (i + 6) === 0) return i + 6;
    if (n % (i + 10) === 0) return i + 10;
    if (n % (i + 12) === 0) return i + 12;
    if (n % (i + 16) === 0) return i + 16;
    if (n % (i + 22) === 0) return i + 22;
    if (n % (i + 24) === 0) return i + 24;
    i += 30;
  }
  return n;
}

/**
 *  Miller-Rabin primality test
 */
function probablyPrime(n: number, k: number): boolean {
  // if (n === 2 || n === 3)
  // 	return true;
  // if (n % 2 === 0 || n < 2)
  // 	return false;

  // Write (n - 1) as 2^s * d
  let s = 0,
    d = n - 1;
  while (d % 2 === 0) {
    d /= 2;
    ++s;
  }

  WitnessLoop: do {
    // A base between 2 and n - 2
    let x = Math.pow(2 + Math.floor(Math.random() * (n - 3)), d) % n;

    if (x === 1 || x === n - 1) continue;

    for (let i = s - 1; i--; ) {
      x = (x * x) % n;
      if (x === 1) return false;
      if (x === n - 1) continue WitnessLoop;
    }

    return false;
  } while (--k);

  return true;
}
