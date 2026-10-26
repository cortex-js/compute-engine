import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import {
  RationalNumberField,
  factorNumberFieldPolynomial as factor,
} from '../../src/compute-engine/polynomial/number-field';
import { NumberFieldIdealRecovery } from '../../src/compute-engine/polynomial/number-field-ideal';
import {
  NumberFieldResidueRing,
  NumberFieldHenselTree,
} from '../../src/compute-engine/polynomial/number-field-hensel';
import { HenselTree } from '../../src/compute-engine/polynomial/hensel';
import { finiteExtension } from '../../src/compute-engine/polynomial/finite-extension';

describe('Unramified prime-ideal lifting and certified recovery', () => {
  test('recovers algebraic integers outside the integral power order', () => {
    const K = RationalNumberField.create([-13, 0, 1].map((v) => q(BigInt(v))));
    const P = new FieldPolynomials(K);
    // (1 +/- sqrt(13))/2 are integral but not in Z[sqrt(13)].
    const f = [-3, -1, 1].map((v) => K.fromInteger(BigInt(v)));
    const r = factor(K, f, {
      numberFieldStrategy: 'hensel',
      maxNumberFieldPrimes: 1,
      maxNormDegree: 0,
    });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    expect(r.factors.every((g) => g.coefficients.length === 2)).toBe(true);
    expect(
      P.sub(
        r.factors.reduce((a, g) => P.mul(a, g.coefficients), [r.coefficient]),
        f
      )
    ).toEqual([]);
    expect(
      r.factors.some((g) =>
        g.coefficients[0].coefficients.some((c) => c.denominator === 2n)
      )
    ).toBe(true);
  });

  test('does not use a ramified defining relation as a residue field', () => {
    const K = RationalNumberField.create([-3, 0, 1].map((v) => q(BigInt(v))));
    const r = factor(K, [K.one, K.generator, K.one], {
      numberFieldStrategy: 'hensel',
      maxNumberFieldPrimes: 1,
    });
    expect(r.status).toBe('incomplete');
    expect(r.reason).toBe('no-unramified-good-prime');
    expect(r.factors).toEqual([]);
  });
  test('recovers rational coordinates through a degree-one residue field', () => {
    const K = RationalNumberField.create([-13, 0, 1].map((v) => q(BigInt(v))));
    const P = new FieldPolynomials(K);
    const a = [K.element([q(1n, 2n), q(1n, 2n)]), K.one];
    const b = [K.fromInteger(2n), K.one];
    const r = factor(K, P.mul(a, b), {
      numberFieldStrategy: 'hensel',
      maxNumberFieldPrimes: 1,
      maxNormDegree: 0,
    });
    expect(r.status).toBe('complete');
    expect(r.statistics.direct[0].residueDegree).toBe(1);
    expect(r.factors).toHaveLength(2);
    expect(r.factors.some((g) => !P.sub(g.coefficients, a).length)).toBe(true);
  });
  test.each([3, 5])(
    'uses weighted scaling for nonintegral degree-%i generators',
    (degree) => {
      const m = Array<number>(degree + 1).fill(0);
      m[0] = -2;
      m[degree] = 2 ** degree;
      const K = RationalNumberField.create(m.map((v) => q(BigInt(v))));
      const P = new FieldPolynomials(K);
      const factors = Array.from({ length: 12 }, (_, i) => [
        K.add(K.generator, K.element([q(BigInt(i + 1), 7n)])),
        K.one,
      ]);
      const f = factors.reduce((a, b) => P.mul(a, b), [K.one]);
      const r = factor(K, f, {
        numberFieldStrategy: 'hensel',
        maxNormDegree: 0,
        maxIntermediateCoefficientBits: 512,
        maxOperations: 20_000_000,
      });
      expect(r.status).toBe('complete');
      expect(r.factors).toHaveLength(12);
      for (const g of factors)
        expect(r.factors.some((v) => !P.sub(v.coefficients, g).length)).toBe(
          true
        );
    }
  );

  test.each(['lattice', 'subsets'] as const)(
    'certifies nonlinear factors using %s recombination',
    (numberFieldRecombination) => {
      const K = RationalNumberField.create(
        [1, 0, 0, 0, 1].map((v) => q(BigInt(v)))
      );
      const P = new FieldPolynomials(K);
      // These primes are unramified; Eisenstein certifies both factors over K.
      const a = [
        K.fromInteger(101n),
        K.mul(K.fromInteger(101n), K.generator),
        K.zero,
        K.one,
      ];
      const b = [
        K.fromInteger(103n),
        K.mul(K.fromInteger(103n), K.generator),
        K.one,
      ];
      const r = factor(K, P.mul(a, b), {
        numberFieldStrategy: 'hensel',
        numberFieldRecombination,
        maxOperations: 20_000_000,
        maxNormDegree: 0,
      });
      expect(r.status).toBe('complete');
      expect(r.factors).toHaveLength(2);
      expect(r.factors.some((v) => !P.sub(v.coefficients, a).length)).toBe(
        true
      );
      expect(r.factors.some((v) => !P.sub(v.coefficients, b).length)).toBe(
        true
      );
    }
  );

  test('does not spend a norm-shift attempt on a provably repeated rational norm', () => {
    const K = RationalNumberField.create([-2, 0, 1].map((v) => q(BigInt(v))));
    const r = factor(K, [K.one, K.zero, K.one], {
      numberFieldStrategy: 'trager',
      maxShifts: 1,
    });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(1);
    expect(r.statistics.norms).toBe(1);
  });
  test('recovers power-basis coefficients from a proper residue field', () => {
    const work = new PolynomialWork(20_000_000);
    // t^4+1 = (t^2+t+2)(t^2-t+2) modulo 3.
    const definition = new HenselTree(
      [
        [2n, 1n, 1n],
        [2n, 2n, 1n],
      ],
      3,
      work
    );
    const m = [1n, 0n, 0n, 0n, 1n];
    for (let i = 0; i < 5; i++) definition.lift(m);
    const h = definition.factors()[0];
    const R = new NumberFieldResidueRing(definition.modulus, h, work);
    const recovery = new NumberFieldIdealRecovery(
      4,
      definition.modulus,
      h,
      work
    );
    expect(recovery.certified(10n)).toBe(true);
    for (const a of [
      [3n, -2n, 5n, 7n],
      [-10n, 8n, 1n, -3n],
      [0n, 0n, 0n, 0n],
    ])
      expect(recovery.recover(R.element(a), 1n)).toEqual(a);
    const low = new NumberFieldIdealRecovery(4, 3n, [2n, 1n, 1n], work);
    expect(low.certified(10n)).toBe(false);
  });

  test('lifts the coefficient relation and polynomial factors together', () => {
    const work = new PolynomialWork();
    const definition = new HenselTree(
      [
        [2n, 1n, 1n],
        [2n, 2n, 1n],
      ],
      3,
      work
    );
    const F = finiteExtension([2, 1, 1], 3, work)!;
    const P = new FieldPolynomials(F, work);
    const factors = [
      [[0, 1], [1]],
      [[1], [1]],
    ];
    const tree = new NumberFieldHenselTree(
      factors,
      3,
      definition.factors()[0],
      F,
      work
    );
    const target = [[0n, 1n], [1n, 1n], [1n]];
    expect(P.mul(factors[0], factors[1])).toEqual(
      target.map((c) => c.map(Number))
    );
    for (let i = 0; i < 3; i++) {
      definition.lift([1n, 0n, 0n, 0n, 1n]);
      tree.lift(target, definition.factors()[0]);
      const R = new NumberFieldResidueRing(tree.modulus, tree.defining, work);
      expect(tree.factors().reduce((a, b) => R.mul(a, b), [[1n]])).toEqual(
        R.normalize(target)
      );
    }
    const before = tree.factors();
    expect(() => tree.lift(target, [0n, 0n, 1n])).toThrow('Incompatible');
    expect(tree.factors()).toEqual(before);
  });

  test.each([
    [1, 0, 0, 0, 1],
    [1, 0, -10, 0, 1],
  ])('factors without an inert prime or norm over %j', (...m: number[]) => {
    const K = RationalNumberField.create(m.map((v) => q(BigInt(v))));
    const P = new FieldPolynomials(K);
    const fs = Array.from({ length: 6 }, (_, i) => [
      K.add(K.generator, K.fromInteger(BigInt(i + 1))),
      K.one,
    ]);
    const f = fs.reduce((a, b) => P.mul(a, b), [K.one]);
    const r = factor(K, f, {
      numberFieldStrategy: 'hensel',
      maxNormDegree: 0,
      maxOperations: 20_000_000,
    });
    expect(r.status).toBe('complete');
    expect(r.statistics.norms).toBe(0);
    expect(r.statistics.direct[0].residueDegree).toBeLessThan(K.degree);
    expect(r.factors).toHaveLength(fs.length);
    for (const g of fs)
      expect(r.factors.some((v) => !P.sub(v.coefficients, g).length)).toBe(
        true
      );
  });

  test('insufficient prime or lifting budgets never certify a partial result', () => {
    const K = RationalNumberField.create(
      [1, 0, 0, 0, 1].map((v) => q(BigInt(v)))
    );
    const f = [K.fromInteger(7n), K.generator, K.one];
    const r = factor(K, f, {
      numberFieldStrategy: 'hensel',
      maxNumberFieldPrimes: 0,
    });
    expect(r.status).toBe('incomplete');
    expect(r.factors).toEqual([]);
    expect(r.statistics.direct[0].fallback).toBe('no-unramified-good-prime');
  });
});
