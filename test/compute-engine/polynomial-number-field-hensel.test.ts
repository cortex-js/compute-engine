import {
  FieldPolynomials,
  PolynomialWork,
} from '../../src/compute-engine/polynomial/exact-field';
import {
  finiteExtension,
  factorFiniteExtension,
} from '../../src/compute-engine/polynomial/finite-extension';
import {
  NumberFieldHenselTree,
  NumberFieldResidueRing,
} from '../../src/compute-engine/polynomial/number-field-hensel';

describe('Finite extensions and number field Hensel lifting', () => {
  test.each([3, 2])(
    'factors over a genuine extension in characteristic %i',
    (prime) => {
      const work = new PolynomialWork();
      const m = prime === 3 ? [1, 0, 1] : [1, 1, 1];
      const K = finiteExtension(m, prime, work)!;
      const P = new FieldPolynomials(K, work);
      const quadratic = prime === 3 ? [[1, 1], [], [1]] : [[0, 1], [1], [1]];
      // Exhaustive root testing independently proves this quadratic irreducible.
      for (let i = 0; i < prime; i++)
        for (let j = 0; j < prime; j++) {
          const root = [i, j];
          while (root.length && !root.at(-1)) root.pop();
          let value: number[] = [];
          for (let k = quadratic.length - 1; k >= 0; k--)
            value = K.add(K.mul(value, root), quadratic[k]);
          expect(K.isZero(value)).toBe(false);
        }
      const expected = [quadratic, [[0, 1], [1]], [[1], [1]]];
      const f = expected.reduce((a, b) => P.mul(a, b), [K.one]);
      const actual = factorFiniteExtension(f, P, prime, 2);
      expect(actual.map((a) => JSON.stringify(a)).sort()).toEqual(
        expected.map((a) => JSON.stringify(a)).sort()
      );
      expect(() =>
        factorFiniteExtension(P.mul(expected[1], expected[1]), P, prime, 2)
      ).toThrow('square-free');
    }
  );
  test('rejects reducible coefficient algebras', () => {
    expect(finiteExtension([2, 0, 1], 3, new PolynomialWork())).toBeUndefined();
    expect(finiteExtension([0, 0, 1], 3, new PolynomialWork())).toBeUndefined();
  });
  test('doubles precision and preserves the exact product congruence', () => {
    const work = new PolynomialWork(),
      defining = [-5n, 0n, 1n];
    const K = finiteExtension([1, 0, 1], 3, work)!;
    const factors = [
      [[1, 1], [1]],
      [[1, 2], [1]],
    ];
    const target = [[23n, 3n], [11n], [1n]];
    const tree = new NumberFieldHenselTree(factors, 3, defining, K, work);
    for (const precision of [9n, 81n, 6561n]) {
      tree.lift(target);
      expect(tree.modulus).toBe(precision);
      const R = new NumberFieldResidueRing(precision, defining, work);
      expect(tree.factors().reduce((a, b) => R.mul(a, b), [[1n]])).toEqual(
        R.normalize(target)
      );
    }
    const R = new NumberFieldResidueRing(tree.modulus, defining, work);
    expect(tree.factors()).toEqual([
      R.normalize([[4n, 1n], [1n]]),
      R.normalize([[7n, -1n], [1n]]),
    ]);
    const copy = tree.factors();
    copy[0][0][0] = 99n;
    expect(tree.factors()[0][0][0]).toBe(4n);
  });
  test('failed congruences and cancellation cannot partially commit a lift', () => {
    let cancel = false;
    const marker = new Error('cancelled');
    const work = new PolynomialWork(2_000_000, () => {
      if (cancel) throw marker;
    });
    const K = finiteExtension([1, 0, 1], 3, work)!;
    const tree = new NumberFieldHenselTree(
      [
        [[1, 1], [1]],
        [[1, 2], [1]],
      ],
      3,
      [-5n, 0n, 1n],
      K,
      work
    );
    const before = tree.factors();
    expect(() => tree.lift([[24n, 3n], [11n], [1n]])).toThrow('target');
    expect(tree.factors()).toEqual(before);
    expect(tree.modulus).toBe(3n);
    cancel = true;
    expect(() => tree.lift([[23n, 3n], [11n], [1n]])).toThrow(marker);
    expect(tree.factors()).toEqual(before);
    expect(tree.modulus).toBe(3n);
  });
});
