import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
} from '../../src/compute-engine/polynomial/exact-field';
import { modularPolynomialDeterminant as determinant } from '../../src/compute-engine/polynomial/modular-polynomial-determinant';
import {
  RationalNumberField,
  numberFieldPolynomialNorm as norm,
} from '../../src/compute-engine/polynomial/number-field';

const poly = (a: number[]) => a.map((n) => q(BigInt(n)));
describe('Certified modular polynomial determinants', () => {
  test('empty, singular, constant and swapped-pivot matrices', () => {
    expect(determinant([], new PolynomialWork())).toEqual(poly([1]));
    expect(
      determinant(
        [
          [[], []],
          [poly([1]), poly([2])],
        ],
        new PolynomialWork()
      )
    ).toEqual([]);
    expect(
      determinant(
        [
          [[], poly([2])],
          [poly([3]), poly([1])],
        ],
        new PolynomialWork()
      )
    ).toEqual(poly([-6]));
    expect(() =>
      determinant([[poly([1]), poly([2])]], new PolynomialWork())
    ).toThrow('square');
  });
  test('rational entries, negative coefficients and multiple CRT primes', () => {
    const P = new FieldPolynomials(Q);
    const a = [q(1n << 100n, 7n), q(-19n, 3n)],
      b = poly([5, -1, 2]);
    const c = [q(-3n, 11n), q(7n)],
      d = poly([4, 3, -1]);
    const result = determinant(
      [
        [a, b],
        [c, d],
      ],
      new PolynomialWork()
    );
    expect(result).toEqual(P.sub(P.mul(a, d), P.mul(b, c)));
  });
  test('cancellation can lower the determinant degree or make it identically zero', () => {
    expect(
      determinant(
        [
          [poly([0, 1]), poly([1, 1])],
          [poly([-1, 1]), poly([0, 1])],
        ],
        new PolynomialWork()
      )
    ).toEqual(poly([1]));
    expect(
      determinant(
        [
          [poly([0, 1]), poly([0, 2])],
          [poly([1]), poly([2])],
        ],
        new PolynomialWork()
      )
    ).toEqual([]);
  });
  test.each([
    [-2, 0, 0, 1],
    [-2, 0, 0, 0, 1],
    [-1, -1, 0, 0, 0, 1],
    [-2, 0, 0, 0, 0, 0, 1],
  ])(
    'modular norms agree with exact Bareiss for %j',
    (...modulus: number[]) => {
      const K = RationalNumberField.create(poly(modulus));
      const P = new FieldPolynomials(Q);
      for (let variant = 0; variant < 3; variant++) {
        const f = [
          K.element([q(BigInt(variant + 1), 3n), q(-2n, 7n)]),
          K.generator,
          K.one,
        ];
        const first = norm(K, f, new PolynomialWork(), 'modular');
        expect(first).toEqual(norm(K, f, new PolynomialWork(), 'bareiss'));
        const linear = [K.neg(K.generator), K.one];
        const product = new FieldPolynomials(K).mul(f, linear);
        expect(norm(K, product, new PolynomialWork(), 'modular')).toEqual(
          P.mul(first, K.definingPolynomial)
        );
      }
    }
  );
  test('nonintegral field definitions preserve denominator scaling', () => {
    const K = RationalNumberField.create([q(-2n, 3n), q(0n), q(0n), q(1n)]);
    expect(
      norm(K, [K.neg(K.generator), K.one], new PolynomialWork(), 'modular')
    ).toEqual(K.definingPolynomial);
  });
  test('budget exhaustion and cancellation cannot produce a determinant', () => {
    const m = [
      [poly([1, 2]), poly([3])],
      [poly([4]), poly([5, 6])],
    ];
    expect(() => determinant(m, new PolynomialWork(0))).toThrow(
      'operation-limit'
    );
    const error = new Error('cancelled');
    expect(() =>
      determinant(
        m,
        new PolynomialWork(1000, () => {
          throw error;
        })
      )
    ).toThrow(error);
  });
});
