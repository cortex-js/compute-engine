import { engine as ce } from '../utils';

const isOctahedral = (n: number | bigint) =>
  ce
    .expr(['IsOctahedral', ce.number(n)])
    .evaluate()
    .toString()
    .replace(/"/g, '');

describe('IsOctahedral — REVIEW.md B11', () => {
  // The m-th octahedral number is O(m) = m(2m² + 1)/3:
  // 1, 6, 19, 44, 85, 146, 231, … (OEIS A005900). The previous code tested a
  // perfect square of 3n+1, which is unrelated to octahedral numbers.
  const octahedral = [1, 6, 19, 44, 85, 146, 231];
  for (const n of octahedral) {
    test(`IsOctahedral(${n}) is True`, () =>
      expect(isOctahedral(n)).toEqual('True'));
  }

  const nonOctahedral = [2, 5, 7, 18, 20, 45, 100];
  for (const n of nonOctahedral) {
    test(`IsOctahedral(${n}) is False`, () =>
      expect(isOctahedral(n)).toEqual('False'));
  }

  test('n < 1 is False', () => {
    expect(isOctahedral(0)).toEqual('False');
    expect(isOctahedral(-6)).toEqual('False');
  });

  test('large octahedral numbers are detected exactly (bigint)', () => {
    // O(100000) = 100000·(2·100000² + 1)/3.
    const m = 100000n;
    const o = (2n * m * m * m + m) / 3n;
    expect(isOctahedral(o)).toEqual('True');
    expect(isOctahedral(o + 1n)).toEqual('False');
  });
});

// REVIEW.md B21: IsHappy threw on negative input (`BigInt('-')`).
describe('IsHappy on non-positive input (REVIEW.md B21)', () => {
  it('returns False for negative/zero instead of throwing', () => {
    expect(ce.expr(['IsHappy', -7]).evaluate().json).toBe('False');
    expect(ce.expr(['IsHappy', 0]).evaluate().json).toBe('False');
  });
  it('still identifies positive happy numbers', () => {
    expect(ce.expr(['IsHappy', 7]).evaluate().json).toBe('True');
    expect(ce.expr(['IsHappy', 4]).evaluate().json).toBe('False');
  });
});

const factorInteger = (n: number | bigint) =>
  ce.expr(['FactorInteger', ce.number(n)]).evaluate().toString();

describe('FactorInteger', () => {
  test('factors a composite into ascending [prime, exponent] tuples', () => {
    expect(factorInteger(360)).toEqual('[(2, 3),(3, 2),(5, 1)]');
    expect(factorInteger(12)).toEqual('[(2, 2),(3, 1)]');
    expect(factorInteger(100)).toEqual('[(2, 2),(5, 2)]');
  });

  test('a prime factors as itself with exponent 1', () => {
    expect(factorInteger(17)).toEqual('[(17, 1)]');
    expect(factorInteger(999983)).toEqual('[(999983, 1)]');
  });

  test('a prime power factors as a single tuple', () => {
    expect(factorInteger(1024)).toEqual('[(2, 10)]');
  });

  test('degenerate inputs follow Mathematica conventions', () => {
    expect(factorInteger(0)).toEqual('[(0, 1)]');
    expect(factorInteger(1)).toEqual('[(1, 1)]');
    expect(factorInteger(-1)).toEqual('[(-1, 1)]');
  });

  test('a negative integer carries the sign in a leading [-1, 1] tuple', () => {
    expect(factorInteger(-12)).toEqual('[(-1, 1),(2, 2),(3, 1)]');
    expect(factorInteger(-360)).toEqual('[(-1, 1),(2, 3),(3, 2),(5, 1)]');
  });

  test('factors large integers exactly (bigint path)', () => {
    // Project Euler #3: 600851475143 = 71 · 839 · 1471 · 6857.
    expect(factorInteger(600851475143n)).toEqual(
      '[(71, 1),(839, 1),(1471, 1),(6857, 1)]'
    );
  });

  test('the factorization multiplies back to the original integer', () => {
    for (const n of [2, 84, 360, 1000000, 999983]) {
      const factors = ce.expr(['FactorInteger', n]).evaluate();
      let product = 1n;
      for (const tuple of factors.ops!) {
        const [p, e] = tuple.ops!;
        product *= BigInt(p.re) ** BigInt(e.re);
      }
      expect(product).toEqual(BigInt(n));
    }
  });
});

const divisors = (n: number | bigint) =>
  ce.expr(['Divisors', ce.number(n)]).evaluate().toString();

describe('Divisors', () => {
  test('returns the sorted positive divisors', () => {
    expect(divisors(12)).toEqual('[1,2,3,4,6,12]');
    expect(divisors(28)).toEqual('[1,2,4,7,14,28]');
    expect(divisors(1)).toEqual('[1]');
  });

  test('a prime has exactly two divisors', () => {
    expect(divisors(17)).toEqual('[1,17]');
  });

  test('a perfect square includes its middle divisor once', () => {
    expect(divisors(16)).toEqual('[1,2,4,8,16]');
    expect(divisors(36)).toEqual('[1,2,3,4,6,9,12,18,36]');
  });

  test('the sign of n is ignored', () => {
    expect(divisors(-12)).toEqual('[1,2,3,4,6,12]');
  });

  test('0 is left unevaluated (infinitely many divisors)', () => {
    expect(divisors(0)).toEqual('Divisors(0)');
  });
});

const nthPrime = (n: number) =>
  ce.expr(['NthPrime', ce.number(n)]).evaluate().toString();

describe('NthPrime', () => {
  test('returns the nth prime (1-based)', () => {
    expect(nthPrime(1)).toEqual('2');
    expect(nthPrime(2)).toEqual('3');
    expect(nthPrime(10)).toEqual('29');
    expect(nthPrime(100)).toEqual('541');
    expect(nthPrime(1000)).toEqual('7919');
  });

  test('non-positive indices are left unevaluated', () => {
    expect(nthPrime(0)).toEqual('NthPrime(0)');
    expect(nthPrime(-3)).toEqual('NthPrime(-3)');
  });
});

const nextPrime = (n: number, k?: number) =>
  ce
    .expr(k === undefined ? ['NextPrime', n] : ['NextPrime', n, k])
    .evaluate()
    .toString();

describe('NextPrime', () => {
  test('returns the smallest prime strictly greater than n', () => {
    expect(nextPrime(10)).toEqual('11');
    expect(nextPrime(11)).toEqual('13');
    expect(nextPrime(2)).toEqual('3');
    expect(nextPrime(1)).toEqual('2');
  });

  test('works for non-positive n (smallest prime is 2)', () => {
    expect(nextPrime(-5)).toEqual('2');
    expect(nextPrime(0)).toEqual('2');
  });

  test('a positive k gives the kth prime after n', () => {
    expect(nextPrime(10, 1)).toEqual('11');
    expect(nextPrime(10, 3)).toEqual('17');
  });

  test('a negative k gives the |k|th prime before n', () => {
    expect(nextPrime(10, -1)).toEqual('7');
    expect(nextPrime(100, -5)).toEqual('73');
  });

  test('no prime below 2 leaves a backward search unevaluated', () => {
    expect(nextPrime(2, -1)).toEqual('NextPrime(2, -1)');
  });
});
