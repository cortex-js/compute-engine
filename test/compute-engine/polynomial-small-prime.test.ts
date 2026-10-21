import {
  FieldPolynomials,
  PolynomialWork,
} from '../../src/compute-engine/polynomial/exact-field';
import { primeField } from '../../src/compute-engine/polynomial/finite-field';
import { SmallPrimePolynomials } from '../../src/compute-engine/polynomial/small-prime';

describe('Exact small-prime polynomial arithmetic', () => {
  test.each([2, 3, 251, 65521])(
    'agrees with bigint arithmetic over F_%i',
    (prime) => {
      const P = new SmallPrimePolynomials(prime);
      const B = new FieldPolynomials(primeField(prime));
      const inputs = [
        [-1n, 2n ** 100n + 1n, -BigInt(prime), 7n, 1n],
        [BigInt(prime - 1), BigInt(prime - 2), 0n, 1n],
      ];
      const [a, b] = inputs.map((f) => P.fromIntegers(f));
      const [aa, bb] = inputs.map((f) => B.trim(f.map(B.field.fromInteger)));
      expect(P.mul(a, b).map(BigInt)).toEqual(B.mul(aa, bb));
      expect(P.divrem(a, b).map((f) => f.map(BigInt))).toEqual(
        B.divrem(aa, bb)
      );
      expect(P.gcd(a, b).map(BigInt)).toEqual(B.gcd(aa, bb));
      expect(P.powmod(a, 13n, b).map(BigInt)).toEqual(B.powmod(aa, 13n, bb));
      const product = P.mul(a, b);
      expect(P.exactDivide(product, a)).toEqual(b);
      expect(P.fromIntegers(inputs[0])).toEqual(a);
      for (const x of [1, prime - 1, Math.floor(prime / 2)])
        expect(BigInt(P.field.inv(x))).toBe(B.field.inv(BigInt(x)));
    }
  );

  test('preserves zero, rejects invalid fields and observes cancellation', () => {
    const P = new SmallPrimePolynomials(5);
    expect(P.mul([], [1])).toEqual([]);
    expect(P.divrem([0, 0], [1])).toEqual([[], []]);
    expect(() => P.divrem([1], [])).toThrow('division by zero');
    expect(() => P.field.inv(0)).toThrow('Division by zero');
    expect(() => new SmallPrimePolynomials(9)).toThrow('Composite');
    expect(() => new SmallPrimePolynomials(65537)).toThrow('at most');
    const bounded = new SmallPrimePolynomials(5, new PolynomialWork(0));
    expect(() => bounded.mul([1, 1], [1, 1])).toThrow('operation-limit');
    const cancelled = new SmallPrimePolynomials(
      5,
      new PolynomialWork(100, () => {
        throw new Error('cancelled');
      })
    );
    expect(() => cancelled.divrem([1, 1], [1])).toThrow('cancelled');
  });
  test('dense products at the largest supported prime agree with bigint arithmetic', () => {
    const P = new SmallPrimePolynomials(65521);
    const B = new FieldPolynomials(primeField(65521));
    const a = Array<number>(64).fill(65520),
      b = Array<number>(48).fill(65519);
    const product = P.mul(a, b);
    expect(product.map(BigInt)).toEqual(B.mul(a.map(BigInt), b.map(BigInt)));
    expect(P.divrem(product, b)).toEqual([a, []]);
  });
});
