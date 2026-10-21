import { MPoly } from '../../src/compute-engine/boxed-expression/multivariate-poly';
import {
  FieldPolynomials,
  rationalCoefficient as q,
} from '../../src/compute-engine/polynomial/exact-field';
import { factorSparseRationalPolynomial } from '../../src/compute-engine/polynomial/factor-multivariate';
import {
  RationalNumberField,
  factorNumberFieldPolynomial,
} from '../../src/compute-engine/polynomial/number-field';
import { splittingField } from '../../src/compute-engine/polynomial/splitting-field';

describe('Generated exact extension and multivariate families', () => {
  test.each([2, 3, 5, 7])(
    'algebraic linear factors with scalar and multiplicities over Q(sqrt(%i))',
    (p) => {
      const K = RationalNumberField.create([q(-BigInt(p)), q(0n), q(1n)]);
      const P = new FieldPolynomials(K);
      for (let b = -2; b <= 2; b++) {
        const a = K.add(K.generator, K.fromInteger(BigInt(b)));
        const first = [K.neg(a), K.one];
        const second = [K.add(a, K.one), K.one];
        const f = P.scale(P.mul(P.mul(first, first), second), K.generator);
        const r = factorNumberFieldPolynomial(K, f);
        expect(r.status).toBe('complete');
        expect(K.equals(r.coefficient, K.generator)).toBe(true);
        expect(r.factors).toHaveLength(2);
        for (const [coefficients, multiplicity] of [
          [first, 2],
          [second, 1],
        ] as const) {
          expect(
            r.factors.some(
              (g) =>
                g.multiplicity === multiplicity &&
                P.sub(g.coefficients, coefficients).length === 0
            )
          ).toBe(true);
        }
      }
    }
  );
  test.each([2, 3, 5])(
    'splitting fields of irreducible x^3-%i have degree six',
    (p) => {
      const r = splittingField([q(-BigInt(p)), q(0n), q(0n), q(1n)]);
      expect(r.status).toBe('complete');
      expect(r.field.degree).toBe(6);
      expect(r.roots).toHaveLength(3);
      for (const root of r.roots) {
        const K = r.field;
        expect(
          K.equals(
            K.mul(K.mul(root.value, root.value), root.value),
            K.fromInteger(BigInt(p))
          )
        ).toBe(true);
      }
    }
  );
  test('expanded bivariate products of a linear form and xy+c', () => {
    const vars = ['x', 'y'];
    const from = (terms: [number[], bigint][]) =>
      new MPoly(
        vars,
        new Map(terms.map(([exponents, c]) => [MPoly.key(exponents), c]))
      );
    for (let a = 1; a <= 5; a++)
      for (let c = 1; c <= 5; c++) {
        const first = from([
          [[1, 0], 1n],
          [[0, 1], BigInt(a)],
          [[0, 0], -2n],
        ]);
        // xy+c is primitive and linear in x over Q(y), hence irreducible for c != 0.
        const second = from([
          [[1, 1], 1n],
          [[0, 0], BigInt(c)],
        ]);
        const expanded = first.mul(first).mul(second);
        const r = factorSparseRationalPolynomial({
          variables: vars,
          terms: [...expanded.terms].map(([key, coefficient]) => ({
            exponents: MPoly.exp(key),
            coefficient: q(-3n * coefficient, 7n),
          })),
        });
        expect(r.status).toBe('complete');
        expect(r.coefficient).toEqual(q(-3n, 7n));
        expect(r.factors).toHaveLength(2);
        for (const [expected, multiplicity] of [
          [first, 2],
          [second, 1],
        ] as const) {
          expect(
            r.factors.some(
              (g) =>
                g.multiplicity === multiplicity &&
                new MPoly(
                  vars,
                  new Map(
                    g.polynomial.terms.map((t) => [
                      MPoly.key([...t.exponents]),
                      t.coefficient.numerator,
                    ])
                  )
                ).equals(expected)
            )
          ).toBe(true);
        }
      }
  });
});
