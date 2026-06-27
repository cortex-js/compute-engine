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

const evalStr = (expr: any[]) => ce.expr(expr).evaluate().toString();

describe('PrimeFactors', () => {
  test('returns distinct prime factors, ascending', () => {
    expect(evalStr(['PrimeFactors', 360])).toEqual('[2,3,5]');
    expect(evalStr(['PrimeFactors', 17])).toEqual('[17]');
    expect(evalStr(['PrimeFactors', 1024])).toEqual('[2]');
  });
  test('1 has no prime factors; sign is ignored; 0 is unevaluated', () => {
    expect(evalStr(['PrimeFactors', 1])).toEqual('[]');
    expect(evalStr(['PrimeFactors', -12])).toEqual('[2,3]');
    expect(evalStr(['PrimeFactors', 0])).toEqual('PrimeFactors(0)');
  });
});

describe('PrimeNu and PrimeOmega', () => {
  test('PrimeNu counts distinct prime factors', () => {
    expect(evalStr(['PrimeNu', 360])).toEqual('3'); // 2,3,5
    expect(evalStr(['PrimeNu', 1])).toEqual('0');
    expect(evalStr(['PrimeNu', 17])).toEqual('1');
  });
  test('PrimeOmega counts prime factors with multiplicity', () => {
    expect(evalStr(['PrimeOmega', 360])).toEqual('6'); // 2^3·3^2·5
    expect(evalStr(['PrimeOmega', 1024])).toEqual('10'); // 2^10
    expect(evalStr(['PrimeOmega', 1])).toEqual('0');
  });
});

describe('MoebiusMu', () => {
  test('square-free with an even/odd number of primes', () => {
    expect(evalStr(['MoebiusMu', 1])).toEqual('1');
    expect(evalStr(['MoebiusMu', 2])).toEqual('-1');
    expect(evalStr(['MoebiusMu', 6])).toEqual('1'); // 2·3
    expect(evalStr(['MoebiusMu', 30])).toEqual('-1'); // 2·3·5
  });
  test('0 when divisible by a square; sign ignored', () => {
    expect(evalStr(['MoebiusMu', 12])).toEqual('0'); // 2^2·3
    expect(evalStr(['MoebiusMu', -30])).toEqual('-1');
  });
});

describe('IsSquareFree', () => {
  test('true for square-free, false otherwise', () => {
    expect(evalStr(['IsSquareFree', 30])).toEqual('"True"');
    expect(evalStr(['IsSquareFree', 1])).toEqual('"True"');
    expect(evalStr(['IsSquareFree', 12])).toEqual('"False"');
    expect(evalStr(['IsSquareFree', 0])).toEqual('"False"');
  });
});

describe('Radical', () => {
  test('product of distinct prime factors', () => {
    expect(evalStr(['Radical', 360])).toEqual('30'); // 2·3·5
    expect(evalStr(['Radical', 1])).toEqual('1');
    expect(evalStr(['Radical', 17])).toEqual('17');
    expect(evalStr(['Radical', -360])).toEqual('30');
  });
});

describe('PowerMod', () => {
  test('modular exponentiation', () => {
    expect(evalStr(['PowerMod', 2, 10, 1000])).toEqual('24'); // 1024 mod 1000
    expect(evalStr(['PowerMod', 7, 256, 13])).toEqual('9');
    expect(evalStr(['PowerMod', 5, 3, 1])).toEqual('0'); // anything mod 1
  });
  test('negative exponent uses the modular inverse', () => {
    expect(evalStr(['PowerMod', 3, -1, 7])).toEqual('5'); // 3·5 ≡ 1 mod 7
    expect(evalStr(['PowerMod', 3, -2, 7])).toEqual('4'); // 5^2 mod 7
  });
  test('undefined when the inverse does not exist or modulus ≤ 0', () => {
    expect(evalStr(['PowerMod', 2, -1, 4])).toEqual('PowerMod(2, -1, 4)');
    expect(evalStr(['PowerMod', 2, 10, 0])).toEqual('PowerMod(2, 10, 0)');
  });
});

describe('ExtendedGCD', () => {
  test('returns (g, x, y) with a·x + b·y = g', () => {
    expect(evalStr(['ExtendedGCD', 12, 18])).toEqual('(6, -1, 1)');
    expect(evalStr(['ExtendedGCD', 240, 46])).toEqual('(2, -9, 47)');
    expect(evalStr(['ExtendedGCD', 0, 5])).toEqual('(5, 0, 1)');
  });
  test('g is non-negative even for negative inputs', () => {
    const r = ce.box(['ExtendedGCD', -12, 18]).evaluate();
    const [g, x, y] = r.ops!.map((o) => BigInt(o.re));
    expect(g).toEqual(6n);
    expect(-12n * x + 18n * y).toEqual(6n);
  });
});

describe('IntegerSqrt', () => {
  test('floor of the square root', () => {
    expect(evalStr(['IntegerSqrt', 17])).toEqual('4');
    expect(evalStr(['IntegerSqrt', 16])).toEqual('4');
    expect(evalStr(['IntegerSqrt', 0])).toEqual('0');
  });
  test('exact for large integers (bigint)', () => {
    // 10^24 = (10^12)^2.
    const r = ce.box(['IntegerSqrt', ce.number(10n ** 24n)]).evaluate();
    expect(r.is(10n ** 12n)).toBe(true);
  });
  test('negative input is left unevaluated', () => {
    expect(evalStr(['IntegerSqrt', -4])).toEqual('IntegerSqrt(-4)');
  });
});

describe('ChineseRemainder', () => {
  test('solves a consistent system', () => {
    expect(
      evalStr(['ChineseRemainder', ['List', 2, 3, 2], ['List', 3, 5, 7]])
    ).toEqual('23');
  });
  test('inconsistent systems and length mismatches are unevaluated', () => {
    expect(
      ce
        .box(['ChineseRemainder', ['List', 1, 2], ['List', 4, 6]])
        .evaluate()
        .operator
    ).toEqual('ChineseRemainder');
    expect(
      ce
        .box(['ChineseRemainder', ['List', 2], ['List', 3, 5]])
        .evaluate()
        .operator
    ).toEqual('ChineseRemainder');
  });
});

describe('CarmichaelLambda', () => {
  test('reduced totient', () => {
    expect(evalStr(['CarmichaelLambda', 1])).toEqual('1');
    expect(evalStr(['CarmichaelLambda', 8])).toEqual('2'); // 2^(3-2)
    expect(evalStr(['CarmichaelLambda', 15])).toEqual('4'); // lcm(λ3,λ5)=lcm(2,4)
    expect(evalStr(['CarmichaelLambda', 561])).toEqual('80'); // Carmichael number
  });
});

describe('LucasL', () => {
  test('Lucas numbers', () => {
    expect(evalStr(['LucasL', 0])).toEqual('2');
    expect(evalStr(['LucasL', 1])).toEqual('1');
    expect(evalStr(['LucasL', 10])).toEqual('123');
  });
  test('negative index uses L(-n) = (-1)^n L(n)', () => {
    expect(evalStr(['LucasL', -1])).toEqual('-1');
    expect(evalStr(['LucasL', -2])).toEqual('3');
  });
});

describe('CatalanNumber', () => {
  test('Catalan numbers', () => {
    expect(evalStr(['CatalanNumber', 0])).toEqual('1');
    expect(evalStr(['CatalanNumber', 1])).toEqual('1');
    expect(evalStr(['CatalanNumber', 5])).toEqual('42');
    expect(evalStr(['CatalanNumber', 10])).toEqual('16796');
  });
  test('negative input is left unevaluated', () => {
    expect(evalStr(['CatalanNumber', -1])).toEqual('CatalanNumber(-1)');
  });
});

describe('IsPerfectPower', () => {
  test('true for perfect powers', () => {
    expect(evalStr(['IsPerfectPower', 64])).toEqual('"True"'); // 2^6, 4^3, 8^2
    expect(evalStr(['IsPerfectPower', 9])).toEqual('"True"');
    expect(evalStr(['IsPerfectPower', 1000000])).toEqual('"True"'); // 10^6
  });
  test('false for non-powers and small values', () => {
    expect(evalStr(['IsPerfectPower', 12])).toEqual('"False"');
    expect(evalStr(['IsPerfectPower', 2])).toEqual('"False"');
    expect(evalStr(['IsPerfectPower', 1])).toEqual('"False"');
  });
  test('negative inputs require an odd exponent', () => {
    expect(evalStr(['IsPerfectPower', -8])).toEqual('"True"'); // (-2)^3
    expect(evalStr(['IsPerfectPower', -27])).toEqual('"True"'); // (-3)^3
    expect(evalStr(['IsPerfectPower', -4])).toEqual('"False"'); // no odd power
  });
});

describe('ContinuedFraction', () => {
  test('exact rationals expand fully', () => {
    expect(evalStr(['ContinuedFraction', ['Rational', 43, 19]])).toEqual(
      '[2,3,1,4]'
    );
    expect(evalStr(['ContinuedFraction', ['Rational', 22, 7]])).toEqual(
      '[3,7]'
    );
    expect(evalStr(['ContinuedFraction', 7])).toEqual('[7]');
  });
  test('negative rationals use a floor first term', () => {
    expect(evalStr(['ContinuedFraction', ['Rational', -7, 3]])).toEqual(
      '[-3,1,2]'
    );
  });
  test('inexact values truncate to n terms', () => {
    expect(
      evalStr(['ContinuedFraction', ce.parse('\\pi').N(), 5])
    ).toEqual('[3,7,15,1,292]');
  });
});

describe('FromContinuedFraction', () => {
  test('reconstructs the rational value', () => {
    expect(evalStr(['FromContinuedFraction', ['List', 2, 3, 1, 4]])).toEqual(
      '43/19'
    );
    expect(evalStr(['FromContinuedFraction', ['List', 5]])).toEqual('5');
  });
  test('round-trips with ContinuedFraction for a rational', () => {
    const cf = ce.box(['ContinuedFraction', ['Rational', 355, 113]]).evaluate();
    expect(ce.box(['FromContinuedFraction', cf]).evaluate().toString()).toEqual(
      '355/113'
    );
  });
});

describe('IntegerDigits', () => {
  test('digits most-significant first, default base 10', () => {
    expect(evalStr(['IntegerDigits', 1234])).toEqual('[1,2,3,4]');
    expect(evalStr(['IntegerDigits', 0])).toEqual('[0]');
  });
  test('other bases; sign ignored', () => {
    expect(evalStr(['IntegerDigits', 255, 16])).toEqual('[15,15]');
    expect(evalStr(['IntegerDigits', 5, 2])).toEqual('[1,0,1]');
    expect(evalStr(['IntegerDigits', -255, 16])).toEqual('[15,15]');
  });
  test('length pads or truncates to the least-significant digits', () => {
    expect(evalStr(['IntegerDigits', 1234, 10, 6])).toEqual('[0,0,1,2,3,4]');
    expect(evalStr(['IntegerDigits', 1234, 10, 2])).toEqual('[3,4]');
  });
});

describe('DigitCount', () => {
  test('count of a specific digit', () => {
    expect(evalStr(['DigitCount', 122, 10, 2])).toEqual('2');
  });
  test('list form: counts of 1..base-1 then 0 last', () => {
    expect(evalStr(['DigitCount', 100])).toEqual('[1,0,0,0,0,0,0,0,0,2]');
    expect(evalStr(['DigitCount', 0])).toEqual('[0,0,0,0,0,0,0,0,0,1]');
  });
});

describe('RandomPrime', () => {
  test('returns a prime in range', () => {
    for (let i = 0; i < 20; i++) {
      const p = Number(ce.box(['RandomPrime', 50]).evaluate().re);
      expect(p).toBeGreaterThanOrEqual(2);
      expect(p).toBeLessThanOrEqual(50);
      expect(ce.box(['IsPrime', p]).evaluate().toString()).toEqual('"True"');
    }
  });
  test('two-argument range', () => {
    for (let i = 0; i < 20; i++) {
      const p = Number(ce.box(['RandomPrime', 10, 20]).evaluate().re);
      expect([11, 13, 17, 19]).toContain(p);
    }
  });
  test('a range with no prime is unevaluated', () => {
    expect(
      ce.box(['RandomPrime', 24, 28]).evaluate().operator
    ).toEqual('RandomPrime');
  });
});
