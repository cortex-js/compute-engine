import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import { RationalNumberField } from '../../src/compute-engine/polynomial/number-field';
import { modularNumberFieldGcd } from '../../src/compute-engine/polynomial/number-field-modular';

const rational = (a: number[]) => a.map((n) => q(BigInt(n)));
describe('Modular number field GCD certification', () => {
  test.each([
    [-2, 0, 0, 1],
    [1, 1, 1, 1, 1],
    [-1, -1, 0, 0, 0, 1],
  ])(
    'reconstructs rational power-basis coefficients over %j',
    (...modulus: number[]) => {
      const K = RationalNumberField.create(rational(modulus));
      const work = new PolynomialWork(),
        P = new FieldPolynomials(K.withWork(work), work);
      const g = [K.element([q(-17n, 13n), q(5n, 19n)]), K.generator, K.one];
      const a = P.mul(g, [K.fromInteger(3n), K.one]);
      const b = P.mul(g, [K.fromInteger(7n), K.one]);
      const result = modularNumberFieldGcd(K, a, b, P, work);
      expect(result).toBeDefined();
      expect(P.sub(result!, g)).toEqual([]);
      expect(P.sub(result!, P.gcd(a, b))).toEqual([]);
    }
  );
  test('skips ramified and denominator primes and drops unlucky GCD degrees', () => {
    const K = RationalNumberField.create(rational([-101, 0, 1]));
    const work = new PolynomialWork(),
      P = new FieldPolynomials(K.withWork(work), work);
    const g = [K.element([q(1n, 103n), q(3n)]), K.one];
    const a = P.mul(g, [K.one, K.one]);
    const b = P.mul(g, [K.fromInteger(108n), K.one]);
    // 101 ramifies, 103 divides a denominator, and the cofactors agree at 107.
    const result = modularNumberFieldGcd(K, a, b, P, work);
    expect(result).toBeDefined();
    expect(P.sub(result!, g)).toEqual([]);
  });
  test('nonunit leading reductions never prove an incorrect degree', () => {
    const K = RationalNumberField.create(rational([-2, 0, 1]));
    const work = new PolynomialWork(),
      P = new FieldPolynomials(K.withWork(work), work);
    // 101 kills the leading coefficient; a-38 is a zero divisor at 103.
    const scalar = K.mul(
      K.fromInteger(101n),
      K.add(K.generator, K.fromInteger(-38n))
    );
    const g = [K.generator, K.one];
    const a = P.scale(P.mul(g, [K.one, K.one]), scalar);
    const b = P.mul(g, [K.fromInteger(3n), K.one]);
    expect(P.sub(modularNumberFieldGcd(K, a, b, P, work)!, g)).toEqual([]);
  });
  test('supports nonintegral defining polynomials', () => {
    const K = RationalNumberField.create([q(-2n, 3n), q(0n), q(1n)]);
    const work = new PolynomialWork(),
      P = new FieldPolynomials(K.withWork(work), work);
    const g = [K.generator, K.one];
    expect(
      P.sub(
        modularNumberFieldGcd(
          K,
          P.mul(g, [K.one, K.one]),
          P.mul(g, [K.fromInteger(2n), K.one]),
          P,
          work
        )!,
        g
      )
    ).toEqual([]);
  });
  test('bounded unsuccessful reconstruction does not assert coprimality', () => {
    const K = RationalNumberField.create(rational([-2, 0, 0, 1]));
    const work = new PolynomialWork(),
      P = new FieldPolynomials(K.withWork(work), work);
    const g = [K.element([q(1n << 100n, 97n)]), K.one];
    const a = P.mul(g, [K.one, K.one]),
      b = P.mul(g, [K.generator, K.one]);
    expect(modularNumberFieldGcd(K, a, b, P, work, 1)).toBeUndefined();
    expect(P.sub(modularNumberFieldGcd(K, a, b, P, work)!, g)).toEqual([]);
  });
});
