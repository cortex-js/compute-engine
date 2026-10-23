import {
  RationalNumberField,
  factorNumberFieldPolynomial as factor,
  numberFieldPolynomialNorm,
} from '../../src/compute-engine/polynomial/number-field';
import {
  FieldPolynomials,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';

const rational = (a: number[]) => a.map((x) => q(BigInt(x)));
describe('Certified abstract number fields and Trager factorization', () => {
  const K = RationalNumberField.create(rational([-2, 0, 1]));
  const a = K.generator;
  const poly = (cs: number[]) => cs.map((c) => K.fromInteger(BigInt(c)));
  test('defining relation, inverse and field identity are exact', () => {
    expect(K.equals(K.mul(a, a), K.fromInteger(2n))).toBe(true);
    expect(K.equals(K.mul(K.inv(a), a), K.one)).toBe(true);
    expect(() => K.inv(K.zero)).toThrow();
    expect(() =>
      K.add(a, RationalNumberField.create(rational([-3, 0, 1])).generator)
    ).toThrow('embedding');
    expect(() => RationalNumberField.create(rational([-1, 0, 1]))).toThrow(
      'irreducible'
    );
    expect(() => RationalNumberField.create(rational([1, 2, 1]))).toThrow(
      'irreducible'
    );
  });
  test('norm of x-a is x squared minus two', () => {
    expect(numberFieldPolynomialNorm(K, [K.neg(a), K.one])).toEqual(
      rational([-2, 0, 1])
    );
  });
  test('x squared minus two splits over Q(sqrt(2))', () => {
    const r = factor(K, poly([-2, 0, 1]));
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    expect(r.factors.every((f) => f.coefficients.length === 2)).toBe(true);
    const constants = r.factors.map((f) => f.coefficients[0]);
    expect(constants.some((c) => K.equals(c, a))).toBe(true);
    expect(constants.some((c) => K.equals(c, K.neg(a)))).toBe(true);
  });
  test('x squared minus three remains irreducible in Q(sqrt(2))', () => {
    const r = factor(K, poly([-3, 0, 1]));
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(1);
    expect(r.factors[0].coefficients).toHaveLength(3);
  });
  test('factors with algebraic coefficients and repeated multiplicities', () => {
    const P = new FieldPolynomials(K);
    const first = [K.add(a, K.one), K.one],
      second = [K.neg(a), K.one];
    const f = P.scale(P.mul(P.mul(first, first), second), a);
    const r = factor(K, f);
    expect(r.status).toBe('complete');
    expect(r.factors.map((f) => f.multiplicity).sort()).toEqual([1, 2]);
    expect(K.equals(r.coefficient, a)).toBe(true);
  });
  test('imaginary quadratic fields are abstract rather than guessed embeddings', () => {
    const C = RationalNumberField.create(rational([1, 0, 1]));
    const r = factor(C, [C.one, C.zero, C.one]);
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
  });
  test('resource limits do not return spurious irreducibility', () => {
    expect(
      factor(K, poly([-2, 0, 1]), {
        maxShifts: 0,
        numberFieldStrategy: 'trager',
      }).status
    ).toBe('incomplete');
    expect(
      factor(K, poly([-2, 0, 1]), {
        maxNormDegree: 2,
        numberFieldStrategy: 'trager',
      }).status
    ).toBe('incomplete');
    expect(factor(K, poly([-2, 0, 1]), { maxOperations: 0 }).status).toBe(
      'incomplete'
    );
  });
});
