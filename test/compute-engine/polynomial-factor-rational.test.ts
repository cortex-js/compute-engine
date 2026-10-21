import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
  rationalField as Q,
} from '../../src/compute-engine/polynomial/exact-field';
import {
  factorFiniteField,
  primeField,
} from '../../src/compute-engine/polynomial/finite-field';
import {
  factorRationalPolynomial as factor,
  reconstructsRationalFactorization as reconstructs,
  verifyModularFactors,
} from '../../src/compute-engine/polynomial/factor-rational';

const poly = (cs: number[]) => cs.map((c) => q(BigInt(c)));
const P = new FieldPolynomials(Q, new PolynomialWork(100_000_000));
const signature = (
  factors: { coefficients: bigint[]; multiplicity: number }[]
) => factors.map((f) => `${f.coefficients.join(',')}^${f.multiplicity}`).sort();

describe('Certified rational polynomial factorization', () => {
  test.each([
    [
      [2, 0, 3, 0, 1],
      ['1,0,1^1', '2,0,1^1'],
    ],
    [
      [4, 0, 0, 0, 1],
      ['2,-2,1^1', '2,2,1^1'],
    ],
    [
      [2, 2, 3, 2, 1],
      ['1,0,1^1', '2,2,1^1'],
    ],
    [[-2, 0, 0, 1], ['-2,0,0,1^1']],
    [
      [-1, 0, 0, 0, 0, 0, 1],
      ['-1,1^1', '1,1^1', '1,-1,1^1', '1,1,1^1'],
    ],
  ])('factors %j without requiring rational roots', (input, expected) => {
    const f = poly(input as number[]),
      r = factor(f);
    expect(r.status).toBe('complete');
    expect(reconstructs(f, r)).toBe(true);
    expect(signature(r.factors)).toEqual((expected as string[]).sort());
  });
  test('preserves rational content, nonmonic factors and repeated roots', () => {
    let f = P.mul(poly([1, 2]), poly([3, 5]));
    f = P.scale(P.mul(f, f), q(-7n, 11n));
    const r = factor(f);
    expect(r.status).toBe('complete');
    expect(r.coefficient).toEqual(q(-7n, 11n));
    expect(signature(r.factors)).toEqual(['1,2^2', '3,5^2']);
    expect(reconstructs(f, r)).toBe(true);
  });
  test('zero, constants, monomials and huge rational linear factors', () => {
    expect(factor([]).status).toBe('zero');
    expect(factor([q(-3n, 5n)]).coefficient).toEqual(q(-3n, 5n));
    expect(signature(factor(poly([0, 0, 0, 2])).factors)).toEqual(['0,1^3']);
    const f = [q(2n ** 200n + 1n, 7n), q(3n)];
    expect(reconstructs(f, factor(f))).toBe(true);
  });
  test('budget and input size limits never claim irreducibility', () => {
    const f = poly([2, 0, 3, 0, 1]);
    for (const options of [
      { maxOperations: 0 },
      { maxDegree: 2 },
      { maxCoefficientBits: 1 },
    ]) {
      const r = factor(f, options);
      expect(r.status).toBe('incomplete');
      expect(r.remainder).toEqual(f);
      expect(r.factors).toEqual([]);
      expect(reconstructs(f, r)).toBe(false);
    }
    expect(() =>
      factor(f, {
        check: () => {
          throw new Error('cancelled');
        },
      })
    ).toThrow('cancelled');
  });
  test('untrusted modular backend cannot label a reducible polynomial irreducible', () => {
    expect(() =>
      factor(poly([2, 0, 3, 0, 1]), { modularBackend: (f) => [[...f]] })
    ).toThrow('Reducible modular factor');
  });
  test('reconstruction alone does not imply irreducibility', () => {
    const f = poly([2, 0, 3, 0, 1]),
      r = factor(f);
    expect(
      reconstructs(f, {
        ...r,
        factors: [{ coefficients: [2n, 0n, 3n, 0n, 1n], multiplicity: 1 }],
      })
    ).toBe(true);
    expect(r.factors).toHaveLength(2);
    expect(
      reconstructs(f, { ...r, coefficient: { numerator: 1n, denominator: 0n } })
    ).toBe(false);
    expect(
      reconstructs(f, {
        ...r,
        factors: [{ coefficients: [0n, 0n], multiplicity: 1 }],
      })
    ).toBe(false);
  });
  test('translation preserves exact factors, rational content and multiplicity', () => {
    const center = 2n ** 160n;
    const a = [q(1n + center * center), q(-2n * center), q(1n)];
    const b = [q(-center - 3n), q(1n)];
    const f = P.scale(P.mul(P.mul(a, a), b), q(-5n, 7n));
    const r = factor(f);
    expect(r.status).toBe('complete');
    expect(r.coefficient).toEqual(q(-5n, 7n));
    expect(signature(r.factors)).toEqual(
      [
        `${1n + center * center},${-2n * center},1^2`,
        `${-center - 3n},1^1`,
      ].sort()
    );
    expect(reconstructs(f, r)).toBe(true);
  });
  test('Eisenstein certification requires the constant not to contain p squared', () => {
    const irreducible = poly([6, 12, -6, 0, 1]);
    expect(signature(factor(irreducible).factors)).toEqual(['6,12,-6,0,1^1']);
    const reducible = poly([4, 0, 0, 0, 1]);
    const r = factor(reducible);
    expect(r.status).toBe('complete');
    expect(signature(r.factors)).toEqual(['2,-2,1^1', '2,2,1^1']);
  });
  test('exact recovered groups are fully factored, not accepted by reconstruction alone', () => {
    const f = P.mul(
      P.mul(poly([1, 0, 0, 0, 1]), poly([1, 0, -1, 0, 1])),
      poly([-1, 1])
    );
    const r = factor(f);
    expect(r.status).toBe('complete');
    expect(signature(r.factors)).toEqual(
      ['-1,1^1', '1,0,0,0,1^1', '1,0,-1,0,1^1'].sort()
    );
    expect(reconstructs(f, r)).toBe(true);
  });
  test('generated products of proved irreducible quadratics', () => {
    for (let a = 1; a <= 10; a++)
      for (let b = 1; b <= 5; b++) {
        const f = P.mul(poly([a, 0, 1]), poly([b, 0, 1]));
        const r = factor(f);
        expect(r.status).toBe('complete');
        expect(reconstructs(f, r)).toBe(true);
        expect(signature(r.factors)).toEqual(
          a === b ? [`${a},0,1^2`] : [`${a},0,1^1`, `${b},0,1^1`].sort()
        );
      }
  });
});

describe('Finite-field factors and independent backend checks', () => {
  test.each([2, 3, 5, 7, 11])(
    'square-free factorization over F_%i',
    (prime) => {
      const work = new PolynomialWork();
      const K = primeField(prime),
        R = new FieldPolynomials(K, work);
      const f = R.sub(
        R.powmod([0n, 1n], BigInt(prime), [
          1n,
          ...Array<bigint>(prime).fill(0n),
          1n,
        ]),
        [0n, 1n]
      );
      const factors = factorFiniteField(f, prime, work);
      expect(factors).toHaveLength(prime);
      verifyModularFactors(f, factors, prime, work);
    }
  );
  test('rejects composite characteristics, repeated and nonmonic inputs', () => {
    expect(() => primeField(9)).toThrow('Composite');
    expect(() =>
      factorFiniteField([1n, 2n, 1n], 3, new PolynomialWork())
    ).toThrow('square-free');
    expect(() => factorFiniteField([1n, 2n], 3, new PolynomialWork())).toThrow(
      'monic'
    );
    expect(() => verifyModularFactors([1n, 1n], [[0n, 1n]], 3)).toThrow(
      'reconstruct'
    );
  });
  test('rejects reducible degree-six factors even when the final Frobenius identity holds', () => {
    const R = new FieldPolynomials(primeField(2));
    const f = R.mul([1n, 1n, 0n, 1n], [1n, 0n, 1n, 1n]);
    expect(R.sub(R.powmod([0n, 1n], 64n, f), [0n, 1n])).toEqual([]);
    expect(() => verifyModularFactors(f, [f], 2)).toThrow('Reducible');
  });
});
