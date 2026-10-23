import {
  FieldPolynomials,
  PolynomialBudgetExceeded,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import {
  RationalNumberField,
  factorNumberFieldPolynomial as factor,
} from '../../src/compute-engine/polynomial/number-field';

const coefficients = (a: number[]) => a.map((n) => q(BigInt(n)));
describe('General number field factorization contracts', () => {
  test.each([
    [-2, 0, 0, 1],
    [-2, 0, 0, 0, 1],
    [-1, -1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ])(
    'recovers repeated factors over the field defined by %j',
    (...modulus: number[]) => {
      const K = RationalNumberField.create(coefficients(modulus));
      const P = new FieldPolynomials(K);
      const a = [K.add(K.generator, K.one), K.one];
      const b = [
        K.add(K.mul(K.generator, K.generator), K.fromInteger(3n)),
        K.one,
      ];
      const scalar = K.element([q(2n, 3n), q(1n, 5n)]);
      const f = P.scale(P.mul(P.mul(a, a), b), scalar);
      const r = factor(K, f);
      expect(r.status).toBe('complete');
      expect(K.equals(r.coefficient, scalar)).toBe(true);
      expect(r.factors).toHaveLength(2);
      expect(
        r.factors.some(
          (g) => g.multiplicity === 2 && P.sub(g.coefficients, a).length === 0
        )
      ).toBe(true);
      expect(
        r.factors.some(
          (g) => g.multiplicity === 1 && P.sub(g.coefficients, b).length === 0
        )
      ).toBe(true);
    }
  );
  test('nonlinear factors remain irreducible over a nonradical quintic', () => {
    const K = RationalNumberField.create(coefficients([-1, -1, 0, 0, 0, 1]));
    const P = new FieldPolynomials(K);
    // The field polynomial has square-free reduction at 101 and 103.
    // Both factors are Eisenstein at every prime over their respective prime.
    const a = [
      K.fromInteger(101n),
      K.mul(K.fromInteger(101n), K.generator),
      K.one,
    ];
    const b = [
      K.fromInteger(103n),
      K.mul(K.fromInteger(103n), K.generator),
      K.one,
    ];
    const r = factor(K, P.mul(a, b));
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    expect(
      r.factors.every(
        (g) => g.multiplicity === 1 && g.coefficients.length === 3
      )
    ).toBe(true);
    expect(r.factors.some((g) => !P.sub(g.coefficients, a).length)).toBe(true);
    expect(r.factors.some((g) => !P.sub(g.coefficients, b).length)).toBe(true);
  });
  test('zero, constants, and linear polynomials do not need a norm', () => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    expect(factor(K, []).status).toBe('zero');
    const constant = factor(K, [K.generator], { maxNormDegree: 0 });
    expect(constant.status).toBe('complete');
    expect(K.equals(constant.coefficient, K.generator)).toBe(true);
    expect(constant.factors).toEqual([]);
    expect(
      factor(K, [K.generator, K.one], { maxNormDegree: 0, maxShifts: 0 }).status
    ).toBe('complete');
  });
  test('strategies agree over a nonintegral defining polynomial', () => {
    const K = RationalNumberField.create([q(-1n, 2n), q(0n), q(0n), q(1n)]);
    const P = new FieldPolynomials(K);
    const a = [K.neg(K.generator), K.one];
    const b = [K.add(K.generator, K.one), K.one];
    const f = P.mul(a, b);
    for (const gcdStrategy of ['auto', 'euclidean'] as const)
      for (const normStrategy of ['auto', 'bareiss', 'modular'] as const) {
        const r = factor(K, f, {
          gcdStrategy,
          normStrategy,
          numberFieldStrategy: 'trager',
        });
        expect(r.status).toBe('complete');
        expect(r.factors).toHaveLength(2);
        for (const expected of [a, b])
          expect(
            r.factors.some((g) => !P.sub(g.coefficients, expected).length)
          ).toBe(true);
      }
  });
  test('norm degree limits apply after square-free decomposition', () => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    const P = new FieldPolynomials(K);
    const a = [K.generator, K.one];
    const b = [K.add(K.generator, K.one), K.one];
    const squareFree = P.mul(a, b);
    let f = [K.one];
    for (let i = 0; i < 5; i++) f = P.mul(f, squareFree);
    const r = factor(K, f, { maxNormDegree: 6, numberFieldStrategy: 'trager' });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    expect(r.factors.every((g) => g.multiplicity === 5)).toBe(true);
    expect(
      factor(K, squareFree, { maxNormDegree: 5, numberFieldStrategy: 'trager' })
        .reason
    ).toBe('norm-degree-limit');
    expect(
      factor(K, squareFree, { maxShifts: 0, numberFieldStrategy: 'trager' })
        .reason
    ).toBe('shift-limit');
  });
  test.each([
    'maxNormDegree',
    'maxShifts',
    'maxDegree',
    'maxOperations',
    'maxCoefficientBits',
    'maxIntermediateCoefficientBits',
  ])('rejects invalid %s even on zero input', (name) => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => factor(K, [], { [name]: value })).toThrow(RangeError);
    }
  });
  test('incomplete results retain the original input and claim no factors', () => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    const f = [K.generator, K.zero, K.one];
    const r = factor(K, f, { maxOperations: 0 });
    expect(r.status).toBe('incomplete');
    expect(r.factors).toEqual([]);
    expect(r.remainder).toEqual(f);
    expect(K.equals(r.coefficient, K.one)).toBe(true);
  });
  test('input and intermediate sizes have explicit resource outcomes', () => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    const f = [K.element([q(1n << 20n)]), K.one];
    expect(factor(K, f, { maxCoefficientBits: 16 }).reason).toBe(
      'coefficient-limit'
    );
    const g = [K.one, K.element([q(1n), q(1n), q(1n)])];
    expect(factor(K, g, { maxIntermediateCoefficientBits: 1 }).status).toBe(
      'incomplete'
    );
  });
  test('profiling accounts for all work and does not change factors', () => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    const f = [K.fromInteger(-2n), K.zero, K.zero, K.one];
    const r = factor(K, f, { profile: true });
    expect(r.status).toBe('complete');
    expect(r.factors).toEqual(factor(K, f).factors);
    expect(
      Object.values(r.statistics.phases!).reduce((s, p) => s + p.operations, 0)
    ).toBe(r.operations);
  });
  test('cancellation exceptions propagate unchanged', () => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    const cancelled = new Error('caller cancelled');
    expect(() =>
      factor(K, [K.generator, K.one], {
        check: () => {
          throw cancelled;
        },
      })
    ).toThrow(cancelled);
  });
  test('caller exceptions resembling internal limits still propagate', () => {
    const K = RationalNumberField.create(coefficients([-2, 0, 0, 1]));
    const cancelled = new PolynomialBudgetExceeded('caller budget');
    expect(() =>
      factor(K, [K.generator, K.one], {
        check: () => {
          throw cancelled;
        },
      })
    ).toThrow(cancelled);
    expect(
      factor(K, [K.one], {
        maxIntermediateCoefficientBits: Number.MAX_SAFE_INTEGER,
      }).status
    ).toBe('complete');
  });
});
