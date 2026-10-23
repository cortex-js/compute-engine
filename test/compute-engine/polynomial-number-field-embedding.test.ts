import { CertifiedNumberFieldEmbedding as Embedding } from '../../src/compute-engine/polynomial/number-field-embedding';
import { RationalNumberField } from '../../src/compute-engine/polynomial/number-field';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field';

const poly = (a: number[]) => a.map((n) => q(BigInt(n)));
describe('Explicit certified number field embeddings', () => {
  test('maps a cubic subfield into a sextic field exactly', () => {
    const K = RationalNumberField.create(poly([-2, 0, 0, 1]));
    const L = RationalNumberField.create(poly([-2, 0, 0, 0, 0, 0, 1]));
    const image = L.mul(L.generator, L.generator);
    const map = Embedding.create(K, L, image);
    const a = K.element([q(2n, 3n), q(-5n, 7n), q(1n)]),
      b = K.add(K.generator, K.one);
    expect(L.equals(map.apply(K.generator), image)).toBe(true);
    expect(
      L.equals(map.apply(K.add(a, b)), L.add(map.apply(a), map.apply(b)))
    ).toBe(true);
    expect(
      L.equals(map.apply(K.mul(a, b)), L.mul(map.apply(a), map.apply(b)))
    ).toBe(true);
    expect(L.equals(map.apply(K.inv(a)), L.inv(map.apply(a)))).toBe(true);
    expect(() => map.apply(L.generator)).toThrow('embedding');
    expect(Object.isFrozen(map)).toBe(true);
  });
  test('different presentations require a checked generator image', () => {
    const K = RationalNumberField.create(poly([-2, 0, 0, 1]));
    const L = RationalNumberField.create(poly([-3, 3, -3, 1]));
    const map = Embedding.create(K, L, L.add(L.generator, L.fromInteger(-1n)));
    expect(
      L.equals(
        map.apply(K.mul(K.mul(K.generator, K.generator), K.generator)),
        L.fromInteger(2n)
      )
    ).toBe(true);
    expect(() => Embedding.create(K, L, L.generator)).toThrow(
      'defining polynomial'
    );
    expect(() => Embedding.create(K, L, K.generator)).toThrow('embedding');
  });
  test('invalid images and exhausted certification budgets throw', () => {
    const K = RationalNumberField.create(poly([-2, 0, 0, 1]));
    expect(() => Embedding.create(K, K, K.one)).toThrow('defining polynomial');
    expect(() =>
      Embedding.create(K, K, K.generator, { maxOperations: 0 })
    ).toThrow('operation-limit');
    expect(() =>
      Embedding.create(K, K, { field: K, coefficients: [q(0n), q(1n)] })
    ).toThrow('embedding');
  });
});
