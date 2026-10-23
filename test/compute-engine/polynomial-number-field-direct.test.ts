import {
  FieldPolynomials,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import {
  RationalNumberField,
  factorNumberFieldPolynomial as factor,
} from '../../src/compute-engine/polynomial/number-field';
import { numberFieldReconstructionBound } from '../../src/compute-engine/polynomial/number-field-direct';
import { NumberFieldWork } from '../../src/compute-engine/polynomial/number-field-work';

const modulus = (a: number[]) => a.map((n) => q(BigInt(n)));
describe('Certified direct number field factorization', () => {
  test('an irreducible reduction certifies the input without lifting', () => {
    const K = RationalNumberField.create(modulus([-2, 0, 1]));
    const f = [K.add(K.one, K.generator), K.zero, K.one];
    const r = factor(K, f, {
      numberFieldStrategy: 'hensel',
      maxNumberFieldLifts: 0,
      maxNormDegree: 0,
    });
    expect(r.status).toBe('complete');
    expect(r.factors).toEqual([{ coefficients: f, multiplicity: 1 }]);
    expect(r.statistics.direct[0].certificate).toBe('modular-irreducibility');
    expect(r.statistics.direct[0].lifts).toBe(0);
  });
  test('a limit of the direct method alone falls back to the norm method', () => {
    // x^4 - 2 = (x^2 - √2)(x^2 + √2) over Q(√2) needs a lift.
    const K = RationalNumberField.create(modulus([-2, 0, 1]));
    const f = [-2, 0, 0, 0, 1].map((n) => K.fromInteger(BigInt(n)));
    const auto = factor(K, f, { maxNumberFieldLifts: 0 });
    expect(auto.status).toBe('complete');
    expect(auto.factors).toHaveLength(2);
    expect(auto.statistics.direct[0].fallback).toBe('number-field-lift-limit');
    const hensel = factor(K, f, {
      maxNumberFieldLifts: 0,
      numberFieldStrategy: 'hensel',
    });
    expect(hensel.status).toBe('incomplete');
  });
  test.each([3, 5, 10, 12, 16])(
    'recovers distinct algebraic factors in degree-%i fields without norms',
    (degree) => {
      const K = RationalNumberField.create(
        modulus([-2, ...Array<number>(degree - 1).fill(0), 1])
      );
      const P = new FieldPolynomials(K);
      const expected = Array.from({ length: 6 }, (_, i) => [
        K.add(
          K.mul(K.generator, K.generator),
          K.fromInteger(BigInt(2 * i + 1))
        ),
        K.one,
      ]);
      const f = expected.reduce((a, b) => P.mul(a, b), [K.one]);
      const r = factor(K, f, {
        numberFieldStrategy: 'hensel',
        maxNormDegree: 0,
        profile: true,
      });
      expect(r.status).toBe('complete');
      expect(r.statistics.norms).toBe(0);
      expect(r.factors).toHaveLength(expected.length);
      for (const g of expected)
        expect(r.factors.some((h) => !P.sub(g, h.coefficients).length)).toBe(
          true
        );
      expect(r.statistics.direct[0].certificate).toBe('modular-atoms');
      expect(
        Object.values(r.statistics.phases!).reduce(
          (s, p) => s + p.operations,
          0
        )
      ).toBe(r.operations);
    }
  );
  test('reconstructs integral elements outside a nonmaximal power order', () => {
    const K = RationalNumberField.create(modulus([-5, 0, 1]));
    const P = new FieldPolynomials(K);
    const expected = [
      [K.element([q(-1n, 2n), q(-1n, 2n)]), K.one],
      [K.element([q(-1n, 2n), q(1n, 2n)]), K.one],
    ];
    const r = factor(K, [K.fromInteger(-1n), K.fromInteger(-1n), K.one], {
      numberFieldStrategy: 'hensel',
    });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    for (const g of expected)
      expect(r.factors.some((h) => !P.sub(g, h.coefficients).length)).toBe(
        true
      );
    const bound = numberFieldReconstructionBound(
      [-5n, 0n, 1n],
      [[-1n], [-1n], [1n]],
      new NumberFieldWork(2_000_000, undefined, false, 16384)
    );
    expect(bound.denominator % 2n).toBe(0n);
    expect(bound.bound >= bound.denominator / 2n).toBe(true);
  });
  test('certifies nonlinear factors after recombining several modular atoms', () => {
    const K = RationalNumberField.create(modulus([-5, 0, 1]));
    const P = new FieldPolynomials(K);
    const expected = [
      [K.fromInteger(-3n), K.zero, K.one],
      [K.fromInteger(-7n), K.zero, K.one],
    ];
    // Neither sqrt(3) nor sqrt(7) belongs to Q(sqrt(5)); both quadratics split
    // over each inert residue field of odd characteristic not dividing 21.
    const r = factor(K, P.mul(expected[0], expected[1]), {
      numberFieldStrategy: 'hensel',
      numberFieldRecombination: 'subsets',
    });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    for (const g of expected)
      expect(r.factors.some((h) => !P.sub(g, h.coefficients).length)).toBe(
        true
      );
    expect(r.statistics.direct[0].certificate).toBe('bounded-recombination');
    expect(r.statistics.direct[0].subsets).toBeGreaterThan(0);
  });
  test('handles rational defining polynomials, nonmonic inputs, and multiplicities', () => {
    const K = RationalNumberField.create([q(-1n, 2n), q(0n), q(0n), q(1n)]);
    const P = new FieldPolynomials(K);
    const a = [K.element([q(0n), q(1n, 3n)]), K.one];
    const b = [K.element([q(1n, 5n), q(0n), q(1n, 5n)]), K.one];
    const scalar = K.element([q(1n, 7n), q(2n, 7n)]);
    const r = factor(K, P.scale(P.mul(P.mul(a, a), b), scalar), {
      numberFieldStrategy: 'hensel',
    });
    expect(r.status).toBe('complete');
    expect(K.equals(r.coefficient, scalar)).toBe(true);
    expect(r.factors).toHaveLength(2);
    expect(
      r.factors.some(
        (g) => g.multiplicity === 2 && !P.sub(g.coefficients, a).length
      )
    ).toBe(true);
    expect(
      r.factors.some(
        (g) => g.multiplicity === 1 && !P.sub(g.coefficients, b).length
      )
    ).toBe(true);
  });
  test('fields without inert primes use an explicit general fallback', () => {
    const K = RationalNumberField.create(modulus([1, 0, -10, 0, 1]));
    const P = new FieldPolynomials(K);
    const f = P.mul([K.generator, K.one], [K.one, K.one]);
    const strict = factor(K, f, {
      numberFieldStrategy: 'hensel',
      maxNumberFieldPrimes: 8,
    });
    expect(strict.status).toBe('incomplete');
    expect(strict.reason).toBe('no-inert-good-prime');
    expect(strict.factors).toEqual([]);
    const automatic = factor(K, f, { maxNumberFieldPrimes: 8 });
    expect(automatic.status).toBe('complete');
    expect(automatic.statistics.direct[0].fallback).toBe('no-inert-good-prime');
    expect(automatic.statistics.norms).toBeGreaterThan(0);
  });
  test('insufficient lifting precision cannot claim irreducibility', () => {
    const K = RationalNumberField.create(modulus([-5, 0, 1]));
    const P = new FieldPolynomials(K);
    const f = P.mul(
      [K.add(K.generator, K.fromInteger(1000n)), K.one],
      [K.add(K.generator, K.fromInteger(1001n)), K.one]
    );
    const r = factor(K, f, {
      numberFieldStrategy: 'hensel',
      maxNumberFieldLifts: 0,
    });
    expect(r.status).toBe('incomplete');
    expect(r.reason).toBe('number-field-lift-limit');
    expect(r.factors).toEqual([]);
    expect(r.remainder).toEqual(f);
  });
  test.each(['maxNumberFieldPrimes', 'maxNumberFieldLifts'])(
    'validates %s before zero input',
    (name) => {
      const K = RationalNumberField.create(modulus([-2, 0, 1]));
      for (const value of [NaN, Infinity, -1, 1.5])
        expect(() => factor(K, [], { [name]: value })).toThrow(RangeError);
    }
  );
});
