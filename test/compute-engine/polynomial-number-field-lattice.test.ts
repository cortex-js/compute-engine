import {
  FieldPolynomials,
  PolynomialWork,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import {
  RationalNumberField,
  factorNumberFieldPolynomial as factor,
} from '../../src/compute-engine/polynomial/number-field';
import { latticeIndicatorPartition } from '../../src/compute-engine/polynomial/lattice-recombination';

describe('Certified number field lattice recombination', () => {
  test('lattice blocks recover half-integral coordinates outside the power order', () => {
    const K = RationalNumberField.create([q(-5n), q(0n), q(1n)]);
    const P = new FieldPolynomials(K);
    // Norm(21*(1+sqrt(5))/2) is negative, so neither conjugate is a square
    // in this real quadratic field. Primes dividing 21 are not square-free
    // reductions; the first good inert reduction splits both quadratics.
    const expected = [-1n, 1n].map((sign) => [
      K.element([q(-21n, 2n), q(sign * 21n, 2n)]),
      K.zero,
      K.one,
    ]);
    const f = [-441n, 0n, -21n, 0n, 1n].map((a) => K.fromInteger(a));
    const r = factor(K, f, { numberFieldRecombination: 'lattice' });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    for (const g of expected)
      expect(r.factors.some((h) => !P.sub(g, h.coefficients).length)).toBe(
        true
      );
    expect(r.statistics.direct[0].certificate).toBe('lattice-recombination');
  });
  test('certifies an irreducible input whose inert reductions split', () => {
    const K = RationalNumberField.create([q(-5n), q(0n), q(1n)]);
    const f = [K.fromInteger(-3n), K.zero, K.one];
    const r = factor(K, f, { numberFieldRecombination: 'lattice' });
    expect(r.status).toBe('complete');
    expect(r.factors).toEqual([{ coefficients: f, multiplicity: 1 }]);
    expect(r.statistics.direct[0].certificate).toBe('lattice-recombination');
    expect(r.statistics.direct[0].subsets).toBe(0);
  });
  test('constraints remain valid after early modular atoms are removed', () => {
    const K = RationalNumberField.create([q(-5n), q(0n), q(1n)]);
    const P = new FieldPolynomials(K);
    const expected = [
      [K.generator, K.one],
      ...[3n, 7n].map((a) => [K.fromInteger(-a), K.zero, K.one]),
    ];
    const f = expected.reduce((a, b) => P.mul(a, b), [K.one]);
    const r = factor(K, f, { numberFieldRecombination: 'lattice' });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(3);
    for (const g of expected)
      expect(r.factors.some((h) => !P.sub(g, h.coefficients).length)).toBe(
        true
      );
    expect(r.statistics.direct[0].certificate).toBe('lattice-recombination');
  });
  test('recombines many modular atoms into distinct nonlinear factors', () => {
    const K = RationalNumberField.create([q(-5n), q(0n), q(1n)]);
    const P = new FieldPolynomials(K);
    const expected = [3n, 7n, 11n, 13n, 17n, 19n].map((a) => [
      K.fromInteger(-a),
      K.zero,
      K.one,
    ]);
    const f = expected.reduce((a, b) => P.mul(a, b), [K.one]);
    const r = factor(K, f, { numberFieldRecombination: 'lattice' });
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(expected.length);
    for (const g of expected)
      expect(r.factors.some((h) => !P.sub(g, h.coefficients).length)).toBe(
        true
      );
    expect(r.statistics.direct[0].certificate).toBe('lattice-recombination');
    expect(r.statistics.direct[0].subsets).toBe(0);
  });
  test.each([2, 4])('recovers shifted nonlinear factors in degree %i', (d) => {
    const K = RationalNumberField.create(
      [d === 2 ? -5n : -2n, ...Array<bigint>(d - 1).fill(0n), 1n].map((a) =>
        q(a)
      )
    );
    const P = new FieldPolynomials(K);
    const expected = [3n, 7n].map((a) => [
      K.add(K.mul(K.generator, K.generator), K.fromInteger(-a)),
      K.mul(K.fromInteger(2n), K.generator),
      K.one,
    ]);
    const f = P.mul(expected[0], expected[1]);
    const r = factor(K, f, {
      numberFieldStrategy: 'hensel',
      numberFieldRecombination: 'lattice',
    });
    expect(r.status).toBe('complete');
    expect(r.statistics.direct[0].certificate).toBe('lattice-recombination');
    expect(r.statistics.direct[0].subsets).toBe(0);
    expect(r.factors).toHaveLength(2);
    for (const g of expected)
      expect(r.factors.some((h) => P.sub(g, h.coefficients).length === 0)).toBe(
        true
      );
  });

  test('handles rational generators, nonmaximal orders, and repeated nonmonic inputs', () => {
    const K = RationalNumberField.create([q(-5n, 4n), q(0n), q(1n)]);
    const P = new FieldPolynomials(K);
    const beta = K.add(K.generator, K.element([q(1n, 2n)]));
    // At each unramified prime above p, x^2+p*beta*x+p is Eisenstein.
    const expected = [3n, 7n].map((p) => [
      K.fromInteger(p),
      K.mul(K.fromInteger(p), beta),
      K.one,
    ]);
    const scalar = K.element([q(2n, 3n)]);
    const product = P.mul(expected[0], expected[1]);
    const f = P.scale(P.mul(product, product), scalar);
    const r = factor(K, f, { numberFieldRecombination: 'lattice' });
    expect(r.status).toBe('complete');
    expect(K.equals(r.coefficient, scalar)).toBe(true);
    expect(r.factors).toHaveLength(2);
    for (const g of expected)
      expect(
        r.factors.some(
          (h) => h.multiplicity === 2 && !P.sub(g, h.coefficients).length
        )
      ).toBe(true);
    expect(r.statistics.norms).toBe(0);
  });

  test('insufficient precision is incomplete, not an irreducibility claim', () => {
    const K = RationalNumberField.create([q(-5n), q(0n), q(1n)]);
    const f = [21n, 0n, -10n, 0n, 1n].map((a) => K.fromInteger(a));
    const r = factor(K, f, {
      numberFieldRecombination: 'lattice',
      maxNumberFieldLifts: 1,
    });
    expect(r.status).toBe('incomplete');
    expect(r.factors).toEqual([]);
    expect(r.remainder).toEqual(f);
  });

  test('validates the direct strategy independently of rational recombination', () => {
    const K = RationalNumberField.create([q(-2n), q(0n), q(1n)]);
    expect(() =>
      factor(K, [], { numberFieldRecombination: 'invalid' as 'auto' })
    ).toThrow(RangeError);
  });
});

describe('Shared bounded indicator lattice', () => {
  const M = 1n << 60n;
  const constraints = () => [
    {
      coefficients: [
        12345678901n,
        M - 12345678899n,
        31415926535897n,
        M - 31415926535894n,
      ],
      bound: 5n,
    },
    {
      coefficients: [
        2718281828459n,
        M - 2718281828457n,
        1618033988749n,
        M - 1618033988746n,
      ],
      bound: 5n,
    },
  ];
  test('retains true indicators while proving inseparable blocks', () => {
    const groups = latticeIndicatorPartition(
      4,
      M,
      constraints,
      new PolynomialWork()
    );
    expect(groups).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
  test('uninformative precision and exhausted probes are inconclusive', () => {
    expect(
      latticeIndicatorPartition(
        4,
        7n,
        () => [{ coefficients: [1n, 2n, 3n, 1n], bound: 5n }],
        new PolynomialWork()
      )
    ).toBeNull();
    expect(
      latticeIndicatorPartition(
        4,
        M,
        constraints,
        new PolynomialWork(),
        undefined,
        undefined,
        0
      )
    ).toBeNull();
  });
  test('propagates caller cancellation instead of treating it as an inconclusive probe', () => {
    const error = new Error('cancelled');
    expect(() =>
      latticeIndicatorPartition(
        4,
        M,
        constraints,
        new PolynomialWork(100000, () => {
          throw error;
        })
      )
    ).toThrow(error);
  });
});
