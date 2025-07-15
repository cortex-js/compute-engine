import type { SymbolDefinitions } from '../global-types';
import { toBigint } from '../boxed-expression/numerics';
import { gcd } from '../numerics/numeric-bigint';
import Decimal from 'decimal.js';

export const NUMBER_THEORY_LIBRARY: SymbolDefinitions[] = [
  {
    Totient: {
      wikidata: 'Q190026',
      description:
        'Euler’s totient function φ(n): count of positive integers ≤ n that are coprime to n.',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let result = 1n;
        for (let i = 2n; i < k; i++) {
          if (gcd(i, k) === 1n) result++;
        }
        return ce.number(result);
      },
    },

    Sigma0: {
      description: 'Number of positive divisors of n.',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let count = 0;
        for (let i = 1n; i <= k; i++) {
          if (k % i === 0n) count++;
        }
        return ce.number(count);
      },
    },

    Sigma1: {
      description: 'Sum of positive divisors of n.',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = ce.bignum(0);
        for (let i = 1n; i <= k; i++) {
          if (k % i === 0n) sum = sum.add(ce.bignum(i));
        }
        return ce.number(sum);
      },
    },

    SigmaMinus1: {
      description: 'Sum of reciprocals of positive divisors of n.',
      signature: '(integer) -> number',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1) return undefined;
        let sum = ce.bignum(0);
        for (let i = 1n; i <= k; i++) {
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
        for (let i = 1n; i < k; i++) {
          if (k % i === 0n) sum += i;
        }
        return ce.symbol(sum === k ? 'True' : 'False');
      },
    },

    Eulerian: {
      description:
        'Eulerian number A(n, m): number of permutations of {1..n} with exactly m ascents.',
      signature: '(integer, integer) -> integer',
      evaluate: ([n, m], { engine: ce }) => {
        const nn = toBigint(n);
        const mm = toBigint(m);
        if (nn === null || mm === null || nn < 0n || mm < 0n || mm >= nn)
          return undefined;
        const A = (n: bigint, k: bigint): bigint => {
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
      evaluate: ([n, m], { engine: ce }) => {
        const nn = toBigint(n);
        const mm = toBigint(m);
        if (nn === null || mm === null || nn < 0n || mm < 0n || mm > nn)
          return undefined;
        const S = (n: bigint, k: bigint): bigint => {
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
      evaluate: ([n], { engine: ce }) => {
        const nn = toBigint(n);
        if (nn === null || nn < 0n) return undefined;
        const memo = new Map<bigint, bigint>();
        const P = (n: bigint): bigint => {
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
        const sqrt = BigInt(Decimal.sqrt(ce.bignum(D)).toFixed(0));
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
        const sqrt = BigInt(Decimal.sqrt(ce.bignum(k)).toFixed(0));
        return ce.symbol(sqrt * sqrt === k ? 'True' : 'False');
      },
    },

    IsOctahedral: {
      description: 'True if n is an octahedral number.',
      signature: '(integer) -> boolean',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null || k < 1n) return ce.False;
        const discriminant = 3n * k + 1n;
        const sqrt = BigInt(Decimal.sqrt(ce.bignum(discriminant)).toFixed(0));
        return ce.symbol(sqrt * sqrt === discriminant ? 'True' : 'False');
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
        const sqrt = BigInt(Decimal.sqrt(ce.bignum(t)).toFixed(0));
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
        if (k === null) return ce.False;
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
        for (let i = 2n; i * i <= k; i++) {
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

function sumSquareDigits(k: bigint): bigint {
  return k
    .toString()
    .split('')
    .map((d) => BigInt(d))
    .reduce((sum, d) => sum + d * d, 0n);
}
