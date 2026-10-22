import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
  type ExactField,
} from '../../src/compute-engine/polynomial/exact-field';
import {
  RationalNumberField,
  factorNumberFieldPolynomial as factor,
} from '../../src/compute-engine/polynomial/number-field';
import {
  numberFieldDivisibilityFilter,
  numberFieldRationalReconstructor,
  reconstructNumberFieldRational,
} from '../../src/compute-engine/polynomial/number-field-modular';
import { NumberFieldWork } from '../../src/compute-engine/polynomial/number-field-work';

function referenceDivision<T>(a: T[], b: T[], F: ExactField<T>): [T[], T[]] {
  const P = new FieldPolynomials(F);
  let r = P.trim(a);
  b = P.trim(b);
  const quotient = Array<T>(Math.max(0, r.length - b.length + 1)).fill(F.zero);
  while (r.length >= b.length) {
    const shift = r.length - b.length;
    const c = F.mul(r.at(-1)!, F.inv(b.at(-1)!));
    quotient[shift] = c;
    for (let i = 0; i < b.length; i++)
      r[shift + i] = F.add(r[shift + i], F.neg(F.mul(c, b[i])));
    r = P.trim(r);
  }
  return [P.trim(quotient), r];
}

describe('General exact division and coefficient arithmetic', () => {
  test.each([1, 2, 3, 5])(
    'agrees with ordinary long division in field degree %i',
    (degree) => {
      const K = RationalNumberField.create(
        [-2n, ...Array<bigint>(degree - 1).fill(0n), 1n].map((a) => q(a))
      );
      const P = new FieldPolynomials(K);
      for (let n = 0; n <= 7; n++)
        for (let d = 0; d <= 4; d++) {
          const a = Array.from({ length: n }, (_, i) =>
            K.element([q(BigInt(i - 2), 3n), q(BigInt(i % 3))])
          );
          for (const leading of [K.one, K.element([q(2n, 3n), q(1n)])]) {
            const b = [
              ...Array.from({ length: d }, (_, i) =>
                K.fromInteger(BigInt(i % 2))
              ),
              leading,
            ];
            const input = [...a],
              divisor = [...b];
            const actual = P.divrem([...a, K.zero], [...b, K.zero]);
            const expected = referenceDivision(a, b, K);
            expect(P.sub(actual[0], expected[0])).toEqual([]);
            expect(P.sub(actual[1], expected[1])).toEqual([]);
            expect(P.sub(P.add(P.mul(actual[0], b), actual[1]), a)).toEqual([]);
            expect(a).toEqual(input);
            expect(b).toEqual(divisor);
          }
        }
    }
  );
  test('scalar extension operations preserve guards and field identity', () => {
    const K = RationalNumberField.create([q(-2n), q(0n), q(1n)]);
    const F = K.withWork(new NumberFieldWork(10000, undefined, false, 8));
    expect(
      K.equals(F.inv(K.element([q(3n, 7n)])), K.element([q(7n, 3n)]))
    ).toBe(true);
    expect(() => F.inv(K.zero)).toThrow();
    expect(() => F.mul(K.fromInteger(128n), K.fromInteger(128n))).toThrow(
      'intermediate-coefficient-limit'
    );
    const L = RationalNumberField.create([q(-2n), q(0n), q(1n)]);
    expect(() => F.mul(K.one, L.one)).toThrow('explicit embedding');
    expect(() => F.inv(L.one)).toThrow('explicit embedding');
    expect(() => new FieldPolynomials(F).mul([K.zero], [L.one])).toThrow(
      'explicit embedding'
    );
  });
  test('monic division retains cancellation and operation limits', () => {
    expect(() =>
      new FieldPolynomials(Q, new PolynomialWork(0)).divrem([q(1n)], [q(1n)])
    ).toThrow('operation-limit');
    expect(() =>
      new FieldPolynomials(
        Q,
        new PolynomialWork(100, () => {
          throw Error('cancelled');
        })
      ).divrem([q(1n), q(1n)], [q(1n), q(1n)])
    ).toThrow('cancelled');
  });
});

describe('One-sided modular recovery filter', () => {
  const K = RationalNumberField.create([q(-2n), q(0n), q(1n)]);
  const P = new FieldPolynomials(K);
  test('rejects false candidates but never substitutes for exact division', () => {
    const f = [K.fromInteger(3n), K.one];
    const possible = numberFieldDivisibilityFilter(K, f, new PolynomialWork());
    expect(possible(f)).toBe(true);
    expect(possible([K.fromInteger(4n), K.one])).toBe(false);
    const collision = [K.fromInteger(104n), K.one];
    expect(possible(collision)).toBe(true);
    expect(P.divrem(f, collision)[1].length).toBeGreaterThan(0);
  });
  test.each([101n, 101n * 103n, 101n * 103n * 107n])(
    'denominator primes %s are inconclusive, not false rejections',
    (denominator) => {
      const g = [K.element([q(1n, denominator), q(2n, denominator)]), K.one];
      const f = P.mul(g, [K.generator, K.one]);
      expect(numberFieldDivisibilityFilter(K, f, new PolynomialWork())(g)).toBe(
        true
      );
    }
  );
  test('a candidate denominator does not disable the prime for later candidates', () => {
    const f = [K.fromInteger(3n), K.one];
    const possible = numberFieldDivisibilityFilter(K, f, new PolynomialWork());
    possible([K.element([q(1n, 101n * 103n * 107n)]), K.one]);
    expect(possible([K.fromInteger(4n), K.one])).toBe(false);
  });
  test('works with ramified and split finite defining reductions', () => {
    for (const constant of [101n, 102n]) {
      const L = RationalNumberField.create([q(-constant), q(0n), q(1n)]);
      const S = new FieldPolynomials(L);
      const g = [L.generator, L.one];
      const f = S.mul(g, [L.one, L.one]);
      const possible = numberFieldDivisibilityFilter(
        L,
        f,
        new PolynomialWork()
      );
      expect(possible(g)).toBe(true);
      expect(possible([L.fromInteger(2n), L.one])).toBe(false);
    }
  });
  test('unavailable defining reductions are skipped safely', () => {
    const L = RationalNumberField.create([
      q(-2n, 101n * 103n * 107n),
      q(0n),
      q(1n),
    ]);
    const g = [L.generator, L.one];
    expect(numberFieldDivisibilityFilter(L, g, new PolynomialWork())(g)).toBe(
      true
    );
  });
  test('filtering never suppresses cancellation', () => {
    const possible = numberFieldDivisibilityFilter(
      K,
      [K.generator, K.one],
      new PolynomialWork(10000, () => {
        throw Error('cancelled');
      })
    );
    expect(() => possible([K.one, K.one])).toThrow('cancelled');
  });
  test('reuses reconstruction bounds without changing rational results', () => {
    for (const modulus of [13n, 169n, 65537n]) {
      const recover = numberFieldRationalReconstructor(modulus);
      for (let c = 0n; c < 100n && c < modulus; c++)
        expect(recover(c)).toEqual(reconstructNumberFieldRational(c, modulus));
    }
    expect(() => numberFieldRationalReconstructor(1n)).toThrow(RangeError);
  });
  test.each([2, 3, 5, 8])(
    'filtered and unfiltered factoring agree in degree %i',
    (degree) => {
      const L = RationalNumberField.create(
        [-2n, ...Array<bigint>(degree - 1).fill(0n), 1n].map((a) => q(a))
      );
      const S = new FieldPolynomials(L);
      const expected = Array.from({ length: 7 }, (_, i) => [
        L.element([q(BigInt(i + 1), 7n), q(BigInt(i + 2), 11n)]),
        L.one,
      ]);
      const f = expected.reduce((a, b) => S.mul(a, b), [L.one]);
      for (const numberFieldRecovery of ['auto', 'unfiltered'] as const) {
        const result = factor(L, f, { numberFieldRecovery });
        expect(result.status).toBe('complete');
        expect(result.factors).toHaveLength(expected.length);
        for (const g of expected)
          expect(
            result.factors.some((h) => !S.sub(g, h.coefficients).length)
          ).toBe(true);
      }
      expect(() =>
        factor(L, [], { numberFieldRecovery: 'invalid' as 'auto' })
      ).toThrow(RangeError);
    }
  );
});
