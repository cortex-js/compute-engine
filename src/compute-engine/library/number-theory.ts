import type { Expression, SymbolDefinitions } from '../global-types';
import { toBigint } from '../boxed-expression/numerics';
import { gcd } from '../numerics/numeric-bigint';
import { bigPrimeFactors } from '../numerics/primes';
import { checkDeadline } from '../../common/interruptible';

export const NUMBER_THEORY_LIBRARY: SymbolDefinitions[] = [
  {
    FactorInteger: {
      description:
        'Return the prime factorization of an integer `n` as a list of `[prime, exponent]` tuples, ordered by ascending prime. For a negative `n`, a leading `[-1, 1]` tuple carries the sign.',
      signature: '(integer) -> list<tuple<integer, integer>>',
      examples: ['FactorInteger(360)  // [(2, 3), (3, 2), (5, 1)]'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;

        const tuple = (prime: bigint, exponent: number) =>
          ce._fn('Tuple', [ce.number(prime), ce.number(exponent)]);

        // Match Mathematica's conventions for the degenerate inputs:
        //   FactorInteger(0)  -> [(0, 1)]
        //   FactorInteger(1)  -> [(1, 1)]
        //   FactorInteger(-1) -> [(-1, 1)]
        if (k === 0n) return ce.function('List', [tuple(0n, 1)]);
        if (k === 1n) return ce.function('List', [tuple(1n, 1)]);

        const result: Expression[] = [];
        let m = k;
        if (m < 0n) {
          result.push(tuple(-1n, 1));
          m = -m;
        }

        // `m` is now >= 1; when it is 1 (i.e. k === -1) there are no prime
        // factors and only the leading `[-1, 1]` tuple remains.
        if (m > 1n) {
          const factors = bigPrimeFactors(m);
          // Sort by ascending prime so the result is canonical regardless of
          // the order in which the factors were discovered.
          const primes = [...factors.keys()].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0
          );
          for (const p of primes) result.push(tuple(p, factors.get(p)!));
        }

        return ce.function('List', result);
      },
    },

    Divisors: {
      description:
        'Return the sorted list of positive divisors of an integer `n`. The sign of `n` is ignored.',
      signature: '(integer) -> list<integer>',
      examples: ['Divisors(12)  // [1, 2, 3, 4, 6, 12]'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        // 0 has infinitely many divisors; leave it unevaluated.
        const m = k < 0n ? -k : k;
        if (m === 0n) return undefined;

        // Collect divisor pairs (i, m/i) by trial division up to √m: the small
        // divisors come out ascending, the large ones descending, so reversing
        // the latter yields a single ascending list.
        const small: bigint[] = [];
        const large: bigint[] = [];
        let steps = 0;
        for (let i = 1n; i * i <= m; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (m % i === 0n) {
            small.push(i);
            const j = m / i;
            if (j !== i) large.push(j);
          }
        }
        large.reverse();
        return ce.function(
          'List',
          [...small, ...large].map((d) => ce.number(d))
        );
      },
    },

    NthPrime: {
      description:
        'Return the nth prime number (1-based): `NthPrime(1)` is 2, `NthPrime(2)` is 3, …',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      examples: ['NthPrime(10)  // 29'],
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return undefined;
        if (k === 1n) return ce.number(2);
        // 2 is already counted; scan the odd candidates 3, 5, 7, … until the
        // kth prime is reached.
        let count = 1n;
        let candidate = 1n;
        let steps = 0;
        while (count < k) {
          candidate += 2n;
          if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);
          if (isPrimeTrial(candidate, ce._deadline)) count += 1n;
        }
        return ce.number(candidate);
      },
    },

    NextPrime: {
      description:
        'Return the smallest prime greater than `n`. With a second argument `k`, return the kth prime after `n` (`k < 0` returns the |k|th prime before `n`).',
      signature: '(integer, integer?) -> integer',
      type: () => 'finite_integer',
      examples: ['NextPrime(10)  // 11', 'NextPrime(10, -1)  // 7'],
      evaluate: ([n, kArg], { engine: ce }) => {
        const start = toBigint(n);
        if (start === null) return undefined;
        const k = kArg === undefined ? 1n : toBigint(kArg);
        if (k === null || k === 0n) return undefined;

        let p = start;
        let steps = 0;
        if (k > 0n) {
          for (let i = 0n; i < k; i++) {
            do {
              p += 1n;
              if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);
            } while (!isPrimeTrial(p, ce._deadline));
          }
        } else {
          for (let i = 0n; i > k; i--) {
            do {
              p -= 1n;
              if ((++steps & 0x3ff) === 0) checkDeadline(ce._deadline);
              if (p < 2n) return undefined; // no prime below 2
            } while (!isPrimeTrial(p, ce._deadline));
          }
        }
        return ce.number(p);
      },
    },

    Totient: {
      wikidata: 'Q190026',
      description:
        "Euler's totient function φ(n): count of positive integers ≤ n that are coprime to n.",
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let result = 1n;
        let count = 0;
        for (let i = 2n; i < k; i++) {
          if ((++count & 0x3ff) === 0) checkDeadline(ce._deadline);
          if (gcd(i, k) === 1n) result++;
        }
        return ce.number(result);
      },
    },

    Sigma0: {
      description: 'Number of positive divisors of n.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let count = 0;
        let steps = 0;
        for (let i = 1n; i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) count++;
        }
        return ce.number(count);
      },
    },

    Sigma1: {
      description: 'Sum of positive divisors of n.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = ce.bignum(0);
        let steps = 0;
        for (let i = 1n; i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) sum = sum.add(ce.bignum(i));
        }
        return ce.number(sum);
      },
    },

    SigmaMinus1: {
      description: 'Sum of reciprocals of positive divisors of n.',
      signature: '(integer) -> number',
      type: () => 'finite_rational',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = ce.bignum(0);
        let steps = 0;
        for (let i = 1n; i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) sum = sum.add(ce.bignum(1).div(ce.bignum(i)));
        }
        return ce.number(sum);
      },
    },

    IsPerfect: {
      wikidata: 'Q170043',
      description:
        'Returns "True" if n is a perfect number, a positive integer which equals the sum of all its divisors.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = 0n;
        let steps = 0;
        for (let i = 1n; i < k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) sum += i;
        }
        return ce.symbol(sum === k ? 'True' : 'False');
      },
    },

    Eulerian: {
      description:
        'Eulerian number A(n, m): number of permutations of {1..n} with exactly m ascents.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n, m], { engine: ce }) => {
        const nn = toBigint(n);
        const mm = toBigint(m);
        if (nn === null || mm === null || nn < 0n || mm < 0n || mm >= nn)
          return undefined;
        let steps = 0;
        const A = (n: bigint, k: bigint): bigint => {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k === 0n) return 1n;
          if (k >= n) return 0n;
          return (k + 1n) * A(n - 1n, k) + (n - k) * A(n - 1n, k - 1n);
        };
        return ce.number(A(nn, mm));
      },
    },

    Stirling: {
      description:
        'Stirling number of the second kind S(n, m): ways to partition n elements into m non-empty subsets.',
      signature: '(integer, integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n, m], { engine: ce }) => {
        const nn = toBigint(n);
        const mm = toBigint(m);
        if (nn === null || mm === null || nn < 0n || mm < 0n || mm > nn)
          return undefined;
        let steps = 0;
        const S = (n: bigint, k: bigint): bigint => {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (n === 0n && k === 0n) return 1n;
          if (n === 0n || k === 0n) return 0n;
          return S(n - 1n, k - 1n) + k * S(n - 1n, k);
        };
        return ce.number(S(nn, mm));
      },
    },

    NPartition: {
      description: 'Number of integer partitions of n.',
      signature: '(integer) -> integer',
      type: () => 'finite_integer',
      evaluate: ([n], { engine: ce }) => {
        const nn = toBigint(n);
        if (nn === null || nn < 0n) return undefined;
        const memo = new Map<bigint, bigint>();
        let steps = 0;
        const P = (n: bigint): bigint => {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (n === 0n) return 1n;
          if (n < 0n) return 0n;
          if (memo.has(n)) return memo.get(n)!;
          let total = 0n;
          for (let k = 1n; ; k++) {
            const pent1 = (k * (3n * k - 1n)) / 2n;
            const pent2 = (k * (3n * k + 1n)) / 2n;
            if (pent1 > n && pent2 > n) break;
            const sign = k % 2n === 0n ? -1n : 1n;
            total += sign * (P(n - pent1) + P(n - pent2));
          }
          memo.set(n, total);
          return total;
        };
        return ce.number(P(nn));
      },
    },

    IsTriangular: {
      description: 'True if n is a triangular number.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        const D = 8n * k + 1n;
        const sqrt = BigInt(ce.bignum(D).sqrt().toFixed(0));
        return ce.symbol(
          sqrt * sqrt === D && (sqrt - 1n) % 2n === 0n ? 'True' : 'False'
        );
      },
    },

    IsSquare: {
      description: 'True if n is a perfect square.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 0n) return ce.False;
        const sqrt = BigInt(ce.bignum(k).sqrt().toFixed(0));
        return ce.symbol(sqrt * sqrt === k ? 'True' : 'False');
      },
    },

    IsOctahedral: {
      description: 'True if n is an octahedral number.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        // The m-th octahedral number is O(m) = m(2m² + 1)/3, i.e.
        // 2m³ + m = 3n. The previous code tested a perfect square of 3n+1,
        // which is unrelated. Estimate m via a cube root, then verify
        // exactly over a small neighborhood (guards against rounding).
        const target = 3n * k; // = 2m³ + m
        const est = BigInt(
          ce
            .bignum(target / 2n)
            .cbrt()
            .toFixed(0)
        );
        for (let m = est - 2n; m <= est + 2n; m++) {
          if (m < 1n) continue;
          if (2n * m * m * m + m === target) return ce.True;
        }
        return ce.False;
      },
    },

    IsCenteredSquare: {
      description: 'True if n is a centered square number.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        if ((k - 1n) % 4n !== 0n) return ce.False;
        const t = (k - 1n) / 4n;
        const sqrt = BigInt(ce.bignum(t).sqrt().toFixed(0));
        return ce.symbol(sqrt * sqrt * 4n + 1n === k ? 'True' : 'False');
      },
    },

    IsHappy: {
      wikidata: 'Q44535',
      description:
        'True if n is a happy number, a number which eventually reaches 1 when the number is replaced by the sum of the square of each digit',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const seen = new Set<bigint>();
        let k = toBigint(n);
        // Happy numbers are positive integers; a negative `k` would also make
        // `sumSquareDigits` throw on the "-" sign.
        if (k === null || k < 1n) return ce.False;
        while (!seen.has(k)) {
          if (k === 1n) return ce.True;
          seen.add(k);
          k = sumSquareDigits(k);
        }
        return ce.False;
      },
    },

    IsAbundant: {
      description: 'True if n is an abundant number (sum of divisors > 2n).',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        let sum = 1n;
        let steps = 0;
        for (let i = 2n; i * i <= k; i++) {
          if ((++steps & 0xfff) === 0) checkDeadline(ce._deadline);
          if (k % i === 0n) {
            sum += i;
            const j = k / i;
            if (j !== i) sum += j;
          }
        }
        return ce.symbol(sum > k ? 'True' : 'False');
      },
    },
  },
];

/**
 * Deterministic primality test by 6k±1 trial division. Exact for every input,
 * and adequate for the magnitudes reachable before the evaluation deadline
 * fires (the loop is guarded by `checkDeadline`).
 */
function isPrimeTrial(n: bigint, deadline: number | undefined): boolean {
  if (n < 2n) return false;
  if (n < 4n) return true; // 2 and 3
  if (n % 2n === 0n || n % 3n === 0n) return false;
  let steps = 0;
  for (let i = 5n; i * i <= n; i += 6n) {
    if ((++steps & 0xfff) === 0) checkDeadline(deadline);
    if (n % i === 0n || n % (i + 2n) === 0n) return false;
  }
  return true;
}

function sumSquareDigits(k: bigint): bigint {
  return k
    .toString()
    .split('')
    .map((d) => BigInt(d))
    .reduce((sum, d) => sum + d * d, 0n);
}
