import {
  factorSparseRationalPolynomial as factor,
  type SparseRationalPolynomial,
} from '../../src/compute-engine/polynomial/factor-multivariate';
import { rationalCoefficient as q } from '../../src/compute-engine/polynomial/exact-field';

const poly = (terms: [number[], bigint][]): SparseRationalPolynomial => ({
  variables: ['x', 'y'],
  terms: terms.map(([exponents, c]) => ({ exponents, coefficient: q(c) })),
});
describe('Certified bounded multivariate rational factoring', () => {
  test('rejects spurious factors introduced by Kronecker substitution', () => {
    // x+y encodes as t+t^2, which factors, although x+y is irreducible.
    const r = factor(
      poly([
        [[1, 0], 1n],
        [[0, 1], 1n],
      ])
    );
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(1);
  });
  test('finds x+y and x-y from expanded coefficients', () => {
    const r = factor(
      poly([
        [[2, 0], 1n],
        [[0, 2], -1n],
      ])
    );
    expect(r.status).toBe('complete');
    expect(r.factors).toHaveLength(2);
    expect(r.factors.every((f) => f.polynomial.terms.length === 2)).toBe(true);
  });
  test('retains rational content and multiplicities', () => {
    const input = poly([
      [[2, 0], 1n],
      [[1, 1], 2n],
      [[0, 2], 1n],
    ]);
    const r = factor({
      ...input,
      terms: input.terms.map((t) => ({
        ...t,
        coefficient: q(-3n * t.coefficient.numerator, 7n),
      })),
    });
    expect(r.status).toBe('complete');
    expect(r.coefficient).toEqual(q(-3n, 7n));
    expect(r.factors).toHaveLength(1);
    expect(r.factors[0].multiplicity).toBe(2);
  });
  test('factors monomials and avoids dense allocation on huge degree boxes', () => {
    const r = factor(poly([[[2, 3], 2n]]));
    expect(r.status).toBe('complete');
    expect(r.factors.map((f) => f.multiplicity).sort()).toEqual([2, 3]);
    expect(factor(poly([[[1000, 1000], 1n]])).status).toBe('incomplete');
    expect(factor(poly([[[1, 1], 1n]]), { maxOperations: 0 }).status).toBe(
      'incomplete'
    );
  });
  test('handles zero, constants, cancellation and invalid exponents', () => {
    expect(factor(poly([])).status).toBe('zero');
    expect(factor(poly([[[0, 0], 5n]])).coefficient).toEqual(q(5n));
    expect(() => factor(poly([[[-1, 0], 1n]]))).toThrow('exponents');
  });
});
